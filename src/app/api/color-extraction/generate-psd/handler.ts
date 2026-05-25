import { NextRequest, NextResponse } from 'next/server';
import { transactionManager, userManager } from '@/storage/database';
import { decomposeLayersWithRunningHub } from '@/lib/layer-decomposition';
import { generatePsdFromDecomposition } from '@/lib/psd-generator';
import { uploadFromUrlToCozeStorage, uploadToCozeStorage } from '@/lib/dualStorage';
import { getGeneratePsdPoints } from '@/lib/pricing';

type ParsedRecord = Record<string, unknown>;

const PSD_POINTS = getGeneratePsdPoints();

function getErrorMessage(error: unknown) {
  if (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message)) {
    return '处理时间较长，请稍后重试';
  }

  return '暂时未能完成处理，请稍后重试';
}

async function uploadImageToStorage(imageUrl: string, orderId: string): Promise<string> {
  const fileName = `color-extraction/layering-inputs/${orderId}.png`;
  return uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');
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

function getPsdGenerationStatus(record: ParsedRecord | null) {
  const status = record?.psdGenerationStatus;
  return status === 'processing' || status === 'success' || status === 'failed' || status === 'pending' ? status : null;
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
      ...extractImageUrls(record.uploadedImage),
      ...extractImageUrls(record.uploaded_image),
    ];
  }

  return [];
}

async function processRunningHubLayeringAndPsd(
  extractionImageUrl: string,
  orderId: string,
  additionalImageUrl?: string,
): Promise<{ psdUrl?: string; error?: string }> {
  try {
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    const decomposition = await decomposeLayersWithRunningHub(uploadedImageUrl);
    const layers = [...decomposition.layers];

    if (additionalImageUrl) {
      layers.push({
        name: '背景图（原图）',
        kind: 'background',
        imageUrl: additionalImageUrl,
        zIndex: layers.length,
      });
    }

    const psdBuffer = await generatePsdFromDecomposition({
      ...decomposition,
      layers,
    });

    const fileName = `color-extraction/psd/${orderId}.psd`;
    const psdUrl = await uploadToCozeStorage(psdBuffer, fileName, 'application/octet-stream');

    return { psdUrl };
  } catch (error: unknown) {
    console.error('[手动PSD生成] 分层失败:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function POST(request: NextRequest) {
  let chargedUserId = '';
  let chargedPoints = 0;
  let chargedByThisRequest = false;

  try {
    const body = await request.json();
    const { orderNumber } = body;

    if (!orderNumber) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    const requestParams = parseRecord(transaction.requestParams);
    const extractionMode = getString(requestParams?.actualExtractionMode) || getString(requestParams?.extractionMode);
    const psdGenerationStatus = getPsdGenerationStatus(requestParams);
    const psdPoints = typeof requestParams?.psdPoints === 'number' && requestParams.psdPoints > 0 ? requestParams.psdPoints : PSD_POINTS;
    const psdPointsCharged = requestParams?.psdPointsCharged === true;
    const resultImages = extractImageUrls(transaction.resultData);
    const layeringImageUrl = resultImages[0] ? resolveImageUrl(resultImages[0], request) : null;

    let additionalImageUrl: string | undefined;
    if (extractionMode === 'hollow') {
      const storedAdditionalImageUrl = getString(requestParams?.psdAdditionalImageUrl);
      if (storedAdditionalImageUrl) {
        additionalImageUrl = resolveImageUrl(storedAdditionalImageUrl, request);
      } else {
        const uploadedImages = extractImageUrls(transaction.uploadedImage);
        if (uploadedImages[0]) {
          additionalImageUrl = resolveImageUrl(uploadedImages[0], request);
        }
      }
    }

    if (!layeringImageUrl) {
      return NextResponse.json({ success: false, error: '订单暂无可用于分层的结果图' }, { status: 400 });
    }

    if (transaction.psdUrl) {
      return NextResponse.json({ success: true, message: 'PSD已存在', data: { psdUrl: transaction.psdUrl } });
    }

    if (psdGenerationStatus === 'processing') {
      return NextResponse.json({ success: false, error: 'PSD正在生成中，请稍后再试' }, { status: 409 });
    }

    if (psdGenerationStatus === 'success' && transaction.psdUrl) {
      return NextResponse.json({ success: true, message: 'PSD已存在', data: { psdUrl: transaction.psdUrl } });
    }

    let chargedForPsd = psdPointsCharged;
    let remainingPoints = transaction.remainingPoints;

    if (!psdPointsCharged) {
      const user = await userManager.getUserById(transaction.userId);
      if (!user) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }

      if ((user.points || 0) < psdPoints) {
        return NextResponse.json({ success: false, error: `积分不足，当前积分：${user.points}，需要：${psdPoints}` }, { status: 400 });
      }

      const chargedUser = await userManager.deductPointsAtomically(transaction.userId, psdPoints);
      if (!chargedUser) {
        return NextResponse.json({ success: false, error: '积分不足' }, { status: 400 });
      }

      chargedUserId = transaction.userId;
      chargedPoints = psdPoints;
      chargedByThisRequest = true;
      chargedForPsd = true;
      remainingPoints = chargedUser.points;
    }

    await transactionManager.updateTransaction(orderNumber, {
      remainingPoints,
      points: chargedForPsd && !psdPointsCharged ? (transaction.points || 0) + psdPoints : (transaction.points || 0),
      actualPoints: chargedForPsd && !psdPointsCharged ? (transaction.actualPoints || 0) + psdPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify({
        ...requestParams,
        psdPoints,
        psdGenerationStatus: 'processing',
        psdPointsCharged: chargedForPsd,
      }),
    });

    const psdResult = await processRunningHubLayeringAndPsd(layeringImageUrl, orderNumber, additionalImageUrl);
    if (!psdResult.psdUrl) {
      const refundedUser = chargedForPsd && !psdPointsCharged
        ? await userManager.addPointsAtomically(transaction.userId, psdPoints)
        : null;
      chargedByThisRequest = false;
      await transactionManager.updateTransaction(orderNumber, {
        remainingPoints: refundedUser?.points ?? remainingPoints,
        points: transaction.points || 0,
        actualPoints: transaction.actualPoints || 0,
        requestParams: JSON.stringify({
          ...requestParams,
          psdPoints,
          psdGenerationStatus: 'failed',
          psdPointsCharged: false,
          psdGenerationError: psdResult.error || 'PSD生成失败',
        }),
      });
      return NextResponse.json({ success: false, error: psdResult.error || 'PSD生成失败' }, { status: 500 });
    }

    await transactionManager.updateTransaction(orderNumber, {
      psdUrl: psdResult.psdUrl,
      remainingPoints,
      points: chargedForPsd && !psdPointsCharged ? (transaction.points || 0) + psdPoints : (transaction.points || 0),
      actualPoints: chargedForPsd && !psdPointsCharged ? (transaction.actualPoints || 0) + psdPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify({
        ...requestParams,
        psdPoints,
        psdGenerationStatus: 'success',
        psdPointsCharged: true,
        psdGeneratedAt: new Date().toISOString(),
      }),
    });

    return NextResponse.json({
      success: true,
      message: 'PSD生成成功',
      data: {
        psdUrl: psdResult.psdUrl,
        remainingPoints,
      },
    });
  } catch (error: unknown) {
    console.error('[手动PSD生成] 异常:', error);
    if (chargedByThisRequest && chargedUserId && chargedPoints > 0) {
      try {
        await userManager.addPointsAtomically(chargedUserId, chargedPoints);
      } catch (refundError) {
        console.error('[手动PSD生成] 异常退款失败:', refundError);
      }
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
