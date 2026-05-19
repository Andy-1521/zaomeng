import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { decomposeLayersWithRunningHub } from '@/lib/layer-decomposition';
import { generatePsdFromDecomposition } from '@/lib/psd-generator';
import { uploadFromUrlToCozeStorage, uploadToCozeStorage } from '@/lib/dualStorage';

type ParsedRecord = Record<string, unknown>;

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
    const resultImages = extractImageUrls(transaction.resultData);
    const layeringImageUrl = resultImages[0] ? resolveImageUrl(resultImages[0], request) : null;

    let additionalImageUrl: string | undefined;
    if (extractionMode === 'hollow') {
      const uploadedImages = extractImageUrls(transaction.uploadedImage);
      if (uploadedImages[0]) {
        additionalImageUrl = resolveImageUrl(uploadedImages[0], request);
      }
    }

    if (!layeringImageUrl) {
      return NextResponse.json({ success: false, error: '订单暂无可用于分层的结果图' }, { status: 400 });
    }

    if (transaction.psdUrl) {
      return NextResponse.json({ success: true, message: 'PSD已存在', data: { psdUrl: transaction.psdUrl } });
    }

    const psdResult = await processRunningHubLayeringAndPsd(layeringImageUrl, orderNumber, additionalImageUrl);
    if (!psdResult.psdUrl) {
      return NextResponse.json({ success: false, error: psdResult.error || 'PSD生成失败' }, { status: 500 });
    }

    await transactionManager.updateTransaction(orderNumber, {
      psdUrl: psdResult.psdUrl,
    });

    return NextResponse.json({
      success: true,
      message: 'PSD生成成功',
      data: {
        psdUrl: psdResult.psdUrl,
      },
    });
  } catch (error: unknown) {
    console.error('[手动PSD生成] 异常:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
