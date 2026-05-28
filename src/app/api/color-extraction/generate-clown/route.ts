import { NextRequest, NextResponse } from 'next/server';
import { transactionManager, userManager } from '@/storage/database';
import { generateClownWithRunningHub, isRunningHubClownConfigured } from '@/lib/runningHub';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';
import { tryCreateAndUploadResultThumbnailFromUrl } from '@/lib/resultThumbnail';
import { getGenerateClownPoints } from '@/lib/pricing';

type ParsedRecord = Record<string, unknown>;
type ClownGenerationStatus = 'processing' | 'success' | 'failed' | 'pending';

export const runtime = 'nodejs';
export const maxDuration = 600;

const CLOWN_POINTS = getGenerateClownPoints();
const CLOWN_PROCESSING_STALE_MS = 12 * 60 * 1000;

function getErrorMessage(error: unknown) {
  if (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message)) {
    return 'Clown生成时间较长，请稍后重试';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Clown生成失败，请稍后重试';
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveImageUrl(value: string, request: NextRequest) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return new URL(value, request.nextUrl.origin).toString();
}

function parseRecord(value: unknown): ParsedRecord | null {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ParsedRecord : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value as ParsedRecord : null;
}

function getClownGenerationStatus(record: ParsedRecord | null): ClownGenerationStatus | null {
  const status = record?.clownGenerationStatus;
  return status === 'processing' || status === 'success' || status === 'failed' || status === 'pending' ? status : null;
}

function getTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractImageUrls(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    const directUrl = getString(value);
    if (directUrl && (directUrl.startsWith('http://') || directUrl.startsWith('https://') || directUrl.startsWith('/'))) {
      return [directUrl];
    }

    try {
      return extractImageUrls(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractImageUrls(item));
  }

  if (typeof value === 'object') {
    const record = value as ParsedRecord;
    return [
      ...extractImageUrls(record.imageUrl),
      ...extractImageUrls(record.image_url),
      ...extractImageUrls(record.result_image_url),
      ...extractImageUrls(record.url),
      ...extractImageUrls(record.urls),
    ];
  }

  return [];
}

async function persistClownPngBuffer(clownBuffer: Buffer, orderNumber: string, request: NextRequest) {
  const clownUrl = await uploadToCozeStorage(clownBuffer, `color-extraction/clown/${orderNumber}.png`, 'image/png');
  const clownThumbnailUrl = await tryCreateAndUploadResultThumbnailFromUrl(
    clownUrl,
    `thumbnails/color-extraction/clown/${orderNumber}.webp`,
    'Clown生成',
    { localMaterialOrigin: request.nextUrl.origin },
  );
  return { clownUrl, clownThumbnailUrl };
}

async function persistRunningHubClownPng(outputUrl: string, orderNumber: string, request: NextRequest) {
  const image = await downloadSafeRemoteImage(outputUrl, {
    timeoutMs: 90000,
    maxBytes: 120 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  return persistClownPngBuffer(image.buffer, orderNumber, request);
}

export async function POST(request: NextRequest) {
  let chargedUserId = '';
  let chargedPoints = 0;
  let chargedByThisRequest = false;
  let activeOrderNumber = '';

  try {
    const body = await request.json();
    const { orderNumber } = body as { orderNumber?: string };

    if (!orderNumber) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }
    activeOrderNumber = orderNumber;

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    if (transaction.toolPage !== '彩绘提取' && transaction.toolPage !== '彩绘提取2') {
      return NextResponse.json({ success: false, error: '只有彩绘提取订单可以生成Clown图' }, { status: 400 });
    }

    if (transaction.status !== '成功' && transaction.status !== 'success') {
      return NextResponse.json({ success: false, error: '彩绘提取成功后才能生成Clown图' }, { status: 400 });
    }

    const requestParams = parseRecord(transaction.requestParams) || {};
    const existingClownUrl = getString(requestParams.clownUrl);
    const existingClownThumbnailUrl = getString(requestParams.clownThumbnailUrl);
    if (existingClownUrl) {
      return NextResponse.json({
        success: true,
        message: 'Clown图已存在',
        data: {
          clownUrl: existingClownUrl,
          clownThumbnailUrl: existingClownThumbnailUrl || '',
          remainingPoints: transaction.remainingPoints,
        },
      });
    }

    const clownGenerationStatus = getClownGenerationStatus(requestParams);
    const clownGenerationStartedAt = getTimestamp(requestParams.clownGenerationStartedAt);
    const isStaleProcessing = clownGenerationStatus === 'processing'
      && (!clownGenerationStartedAt || Date.now() - clownGenerationStartedAt > CLOWN_PROCESSING_STALE_MS);
    const clownPoints = typeof requestParams.clownPoints === 'number' && requestParams.clownPoints > 0
      ? requestParams.clownPoints
      : CLOWN_POINTS;
    const clownPointsCharged = requestParams.clownPointsCharged === true;

    if (clownGenerationStatus === 'processing' && !isStaleProcessing) {
      return NextResponse.json({ success: false, error: 'Clown生成中，请稍后再试' }, { status: 409 });
    }

    const resultImages = extractImageUrls(transaction.resultData);
    const extractionImageUrl = resultImages[0] ? resolveImageUrl(resultImages[0], request) : null;
    if (!extractionImageUrl) {
      return NextResponse.json({ success: false, error: '订单暂无可用于Clown生成的彩绘结果图' }, { status: 400 });
    }

    if (!isRunningHubClownConfigured()) {
      return NextResponse.json({ success: false, error: 'Clown 分割工作流未配置' }, { status: 400 });
    }

    let chargedForClown = clownPointsCharged;
    let remainingPoints = transaction.remainingPoints;

    if (!clownPointsCharged) {
      const user = await userManager.getUserById(transaction.userId);
      if (!user) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }

      if ((user.points || 0) < clownPoints) {
        return NextResponse.json({ success: false, error: `积分不足，当前积分：${user.points}，需要：${clownPoints}` }, { status: 400 });
      }

      const chargedUser = await userManager.deductPointsAtomically(transaction.userId, clownPoints);
      if (!chargedUser) {
        return NextResponse.json({ success: false, error: '积分不足' }, { status: 400 });
      }

      chargedUserId = transaction.userId;
      chargedPoints = clownPoints;
      chargedByThisRequest = true;
      chargedForClown = true;
      remainingPoints = chargedUser.points;
    }

    await transactionManager.updateTransaction(orderNumber, {
      remainingPoints,
      points: chargedForClown && !clownPointsCharged ? (transaction.points || 0) + clownPoints : (transaction.points || 0),
      actualPoints: chargedForClown && !clownPointsCharged ? (transaction.actualPoints || 0) + clownPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify({
        ...requestParams,
        clownPoints,
        clownGenerationStatus: 'processing',
        clownGenerationStartedAt: new Date().toISOString(),
        clownGenerationError: undefined,
        clownPointsCharged: chargedForClown,
      }),
    });

    const clownResult = await generateClownWithRunningHub(extractionImageUrl);
    const persisted = await persistRunningHubClownPng(clownResult.outputUrl, orderNumber, request);

    await transactionManager.updateTransaction(orderNumber, {
      remainingPoints,
      points: chargedForClown && !clownPointsCharged ? (transaction.points || 0) + clownPoints : (transaction.points || 0),
      actualPoints: chargedForClown && !clownPointsCharged ? (transaction.actualPoints || 0) + clownPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify({
        ...requestParams,
        clownUrl: persisted.clownUrl,
        clownThumbnailUrl: persisted.clownThumbnailUrl,
        clownGenerationStatus: 'success',
        clownGenerationStartedAt: undefined,
        clownGenerationError: undefined,
        clownTaskId: clownResult.taskId,
        clownProvider: 'runninghub',
        clownPoints,
        clownPointsCharged: true,
        clownGeneratedAt: new Date().toISOString(),
      }),
    });

    return NextResponse.json({
      success: true,
      message: 'Clown图生成成功',
      data: {
        clownUrl: persisted.clownUrl,
        clownThumbnailUrl: persisted.clownThumbnailUrl,
        remainingPoints,
      },
    });
  } catch (error: unknown) {
    console.error('[Clown生成] 异常:', error);

    try {
      if (activeOrderNumber) {
        const latest = await transactionManager.getTransactionByOrderNumber(activeOrderNumber);
        const requestParams = parseRecord(latest?.requestParams) || {};
        const clownPoints = typeof requestParams.clownPoints === 'number' && requestParams.clownPoints > 0 ? requestParams.clownPoints : CLOWN_POINTS;
        const shouldRefund = !!latest?.userId && requestParams.clownPointsCharged === true;
        const refundedUser = shouldRefund
          ? await userManager.addPointsAtomically(latest.userId, clownPoints)
          : null;
        chargedByThisRequest = false;
        await transactionManager.updateTransaction(activeOrderNumber, {
          remainingPoints: refundedUser?.points ?? latest?.remainingPoints,
          points: shouldRefund ? Math.max(0, (latest?.points || 0) - clownPoints) : (latest?.points || 0),
          actualPoints: shouldRefund ? Math.max(0, (latest?.actualPoints || 0) - clownPoints) : (latest?.actualPoints || 0),
          requestParams: JSON.stringify({
            ...requestParams,
            clownPoints,
            clownGenerationStatus: 'failed',
            clownGenerationStartedAt: undefined,
            clownGenerationError: getErrorMessage(error),
            clownPointsCharged: false,
          }),
        });
      }
    } catch (statusError) {
      console.error('[Clown生成] 写入失败状态失败:', statusError);
      if (chargedByThisRequest && chargedUserId && chargedPoints > 0) {
        try {
          await userManager.addPointsAtomically(chargedUserId, chargedPoints);
        } catch (refundError) {
          console.error('[Clown生成] 异常退款失败:', refundError);
        }
      }
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
