import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { getCozeStorage } from '@/lib/cozeStorage';
import { decomposeLayersWithRunningHub } from '@/lib/layer-decomposition';
import { generatePsdFromDecomposition } from '@/lib/psd-generator';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';

async function uploadImageToStorage(imageUrl: string, orderId: string): Promise<string> {
  const fileName = `cjkch_png/${orderId}.png`;
  return uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');
}

async function processRunningHubLayeringAndPsd(extractionImageUrl: string, orderId: string): Promise<{ psdUrl?: string; error?: string }> {
  try {
    const cozeStorage = getCozeStorage();
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    const decomposition = await decomposeLayersWithRunningHub(uploadedImageUrl);
    const psdBuffer = await generatePsdFromDecomposition(decomposition);

    const fileName = `cjkch_PSD/${orderId}.psd`;
    const psdKey = await cozeStorage.uploadFile({
      fileContent: psdBuffer,
      fileName,
      contentType: 'application/octet-stream',
    });
    const psdUrl = await cozeStorage.generatePresignedUrl({
      key: psdKey,
      expireTime: 365 * 24 * 60 * 60,
    });

    return { psdUrl };
  } catch (error: any) {
    console.error('[手动PSD生成] 分层失败:', error);
    return { error: error.message || 'PSD生成失败' };
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

    if (!transaction.resultData || typeof transaction.resultData !== 'string' || !transaction.resultData.startsWith('http')) {
      return NextResponse.json({ success: false, error: '订单暂无可用于分层的结果图' }, { status: 400 });
    }

    if (transaction.psdUrl) {
      return NextResponse.json({ success: true, message: 'PSD已存在', data: { psdUrl: transaction.psdUrl } });
    }

    const psdResult = await processRunningHubLayeringAndPsd(transaction.resultData, orderNumber);
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
  } catch (error: any) {
    console.error('[手动PSD生成] 异常:', error);
    return NextResponse.json({ success: false, error: error.message || 'PSD生成失败' }, { status: 500 });
  }
}
