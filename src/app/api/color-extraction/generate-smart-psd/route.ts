import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { generateSmartPsdFromImageUrl } from '@/lib/smartPsdSegmentation';

type ParsedRecord = Record<string, unknown>;

export const runtime = 'nodejs';
export const maxDuration = 600;

const SMART_PSD_PROCESSING_STALE_MS = 12 * 60 * 1000;

function getErrorMessage(error: unknown) {
  if (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message)) {
    return '智能PSD处理时间较长，请稍后重试';
  }
  if (error instanceof Error && error.message) return error.message;
  return '智能PSD生成失败，请稍后重试';
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseRecord(value: unknown): ParsedRecord {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ParsedRecord : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as ParsedRecord : {};
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
  if (Array.isArray(value)) return value.flatMap((item) => extractImageUrls(item));
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

function resolveImageUrl(value: string, request: NextRequest) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return new URL(value, request.nextUrl.origin).toString();
}

export async function POST(request: NextRequest) {
  let requestOrderNumber = '';
  try {
    const body = await request.json() as { orderNumber?: string };
    const orderNumber = getString(body.orderNumber);
    if (!orderNumber) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }
    requestOrderNumber = orderNumber;

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    const requestParams = parseRecord(transaction.requestParams);
    const existingUrl = getString(requestParams.smartPsdUrl);
    if (existingUrl) {
      return NextResponse.json({
        success: true,
        message: '智能PSD已存在',
        data: {
          smartPsdUrl: existingUrl,
          smartPsdLayerCount: requestParams.smartPsdLayerCount,
          smartPsdMaskCount: requestParams.smartPsdMaskCount,
        },
      });
    }

    const status = requestParams.smartPsdGenerationStatus;
    const startedAt = getTimestamp(requestParams.smartPsdGenerationStartedAt);
    const processingIsFresh = status === 'processing'
      && startedAt
      && Date.now() - startedAt <= SMART_PSD_PROCESSING_STALE_MS;
    if (processingIsFresh) {
      return NextResponse.json({ success: false, error: '智能PSD正在生成中，请稍后查看' }, { status: 409 });
    }

    const resultImage = extractImageUrls(transaction.resultData)[0];
    const imageUrl = resultImage ? resolveImageUrl(resultImage, request) : null;
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '订单暂无可用于智能分层的结果图' }, { status: 400 });
    }

    await transactionManager.updateTransaction(orderNumber, {
      requestParams: JSON.stringify({
        ...requestParams,
        smartPsdGenerationStatus: 'processing',
        smartPsdGenerationStartedAt: new Date().toISOString(),
        smartPsdGenerationError: undefined,
      }),
    });

    const result = await generateSmartPsdFromImageUrl(imageUrl);
    const smartPsdUrl = await uploadToCozeStorage(
      result.psdBuffer,
      `color-extraction/smart-psd/${orderNumber}.psd`,
      'application/octet-stream',
    );

    await transactionManager.updateTransaction(orderNumber, {
      requestParams: JSON.stringify({
        ...requestParams,
        smartPsdUrl,
        smartPsdGenerationStatus: 'success',
        smartPsdGenerationStartedAt: undefined,
        smartPsdGeneratedAt: new Date().toISOString(),
        smartPsdTaskId: result.taskId,
        smartPsdMaskCount: result.maskCount,
        smartPsdLayerCount: result.layerCount,
        smartPsdSourceWidth: result.sourceWidth,
        smartPsdSourceHeight: result.sourceHeight,
      }),
    });

    return NextResponse.json({
      success: true,
      message: `智能PSD生成成功（${result.layerCount}层）`,
      data: {
        smartPsdUrl,
        smartPsdLayerCount: result.layerCount,
        smartPsdMaskCount: result.maskCount,
        smartPsdTaskId: result.taskId,
      },
    });
  } catch (error) {
    console.error('[智能PSD] 生成失败:', error);
    if (requestOrderNumber) {
      const transaction = await transactionManager.getTransactionByOrderNumber(requestOrderNumber).catch(() => null);
      const requestParams = parseRecord(transaction?.requestParams);
      await transactionManager.updateTransaction(requestOrderNumber, {
        requestParams: JSON.stringify({
          ...requestParams,
          smartPsdGenerationStatus: 'failed',
          smartPsdGenerationStartedAt: undefined,
          smartPsdGenerationError: getErrorMessage(error),
        }),
      }).catch((updateError) => {
        console.error('[智能PSD] 写入失败状态失败:', updateError);
      });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
