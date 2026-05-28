import { after, NextRequest, NextResponse } from 'next/server';
import { transactionManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { tryCreateAndUploadResultThumbnail } from '@/lib/resultThumbnail';
import { createUpsamplingTask, waitForUpsamplingTaskComplete } from '@/lib/runningHubWatermark';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';
import { getHdUpscalePoints } from '@/lib/pricing';

type HdUpscaleRequest = {
  userId?: string;
  imageUrl?: string;
};

const IMAGE_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

function getResolvedImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

function isTimeoutLikeError(error: unknown) {
  return error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message || '');
}

function getUserFacingMessage(error: unknown) {
  if (isTimeoutLikeError(error)) return '高清放大处理超时，请稍后重试';
  return '高清放大暂时未能完成，请稍后重试';
}

async function downloadImageBuffer(imageUrl: string, localMaterialOrigin?: string | null) {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 60000,
    maxBytes: IMAGE_DOWNLOAD_MAX_BYTES,
    allowLocalMaterialFile: true,
    localMaterialOrigin,
  });
  return {
    buffer: image.buffer,
    contentType: image.contentType || 'image/png',
  };
}

export async function runHdUpscaleRoute(request: NextRequest) {
  let orderId = '';
  let chargedPoints = 0;
  let chargedUserId = '';

  try {
    const body = await request.json() as HdUpscaleRequest;
    const userId = body.userId?.trim();
    const imageUrl = body.imageUrl?.trim();

    if (!userId || !imageUrl) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/')) {
      return NextResponse.json({ success: false, message: '图片URL格式不正确' }, { status: 400 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    const currentPoints = user.points || 0;
    const requiredPoints = getHdUpscalePoints();
    if (currentPoints < requiredPoints) {
      return NextResponse.json({ success: false, message: `积分不足，当前积分：${currentPoints}，需要：${requiredPoints}` }, { status: 400 });
    }

    orderId = `HD-${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await transactionManager.createTransaction({
      userId,
      orderNumber: orderId,
      toolPage: '高清放大',
      description: '高清放大处理',
      points: requiredPoints,
      actualPoints: 0,
      remainingPoints: currentPoints,
      resultData: '',
      uploadedImage: imageUrl,
      requestParams: JSON.stringify({
        imageUrl,
        workflow: 'runninghub-hd-upscale',
        requiredPoints,
      }),
      status: '处理中',
    });

    const chargedUser = await userManager.deductPointsAtomically(userId, requiredPoints);
    if (!chargedUser) {
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: JSON.stringify({ error: '积分不足' }),
        actualPoints: 0,
      });
      return NextResponse.json({ success: false, message: `积分不足，当前积分：${currentPoints}，需要：${requiredPoints}` }, { status: 400 });
    }

    chargedUserId = userId;
    chargedPoints = requiredPoints;
    await transactionManager.updateTransaction(orderId, {
      actualPoints: requiredPoints,
      remainingPoints: chargedUser.points,
    });

    const response = NextResponse.json({
      success: true,
      message: '高清放大任务已提交',
      data: {
        orderId,
        remainingPoints: chargedUser.points,
      },
    });

    const resolvedInputImageUrl = getResolvedImageUrl(imageUrl, request);

    after(async () => {
      try {
        console.log('[高清放大] ========== 后台任务开始 ==========', { orderId });
        const upsamplingTaskId = await createUpsamplingTask(resolvedInputImageUrl);
        const upsamplingResultUrl = await waitForUpsamplingTaskComplete(upsamplingTaskId, 5);
        const result = await downloadImageBuffer(upsamplingResultUrl, request.nextUrl.origin);
        const finalResultUrl = await uploadToCozeStorage(result.buffer, `hd-upscale/${orderId}.png`, result.contentType);
        const thumbnailUrl = await tryCreateAndUploadResultThumbnail(
          result.buffer,
          `thumbnails/hd-upscale/${orderId}.webp`,
          '高清放大',
        );

        await transactionManager.updateTransaction(orderId, {
          status: '成功',
          points: requiredPoints,
          actualPoints: requiredPoints,
          remainingPoints: chargedUser.points,
          resultData: finalResultUrl,
          requestParams: JSON.stringify({
            imageUrl,
            workflow: 'runninghub-hd-upscale',
            requiredPoints,
            upsamplingTaskId,
            upsamplingResultUrl,
            thumbnailUrl,
          }),
        });
        console.log('[高清放大] ========== 后台任务完成 ==========', { orderId });
      } catch (error: unknown) {
        console.error('[高清放大] ========== 后台任务失败 ==========', error);
        let refundedPoints: number | undefined;
        if (chargedPoints > 0 && chargedUserId) {
          try {
            const refundedUser = await userManager.addPointsAtomically(chargedUserId, chargedPoints);
            refundedPoints = refundedUser?.points;
            chargedPoints = 0;
          } catch (refundError) {
            console.error('[高清放大] 后台任务失败退款异常:', refundError);
          }
        }

        await transactionManager.updateTransaction(orderId, {
          status: isTimeoutLikeError(error) ? '超时' : '失败',
          actualPoints: 0,
          remainingPoints: refundedPoints,
          resultData: JSON.stringify({ error: getUserFacingMessage(error) }),
        });
      }
    });

    return response;
  } catch (error: unknown) {
    console.error('[高清放大] 创建任务失败:', error);

    let refundedPoints: number | undefined;
    if (chargedPoints > 0 && chargedUserId) {
      try {
        const refundedUser = await userManager.addPointsAtomically(chargedUserId, chargedPoints);
        refundedPoints = refundedUser?.points;
        chargedPoints = 0;
      } catch (refundError) {
        console.error('[高清放大] 创建任务失败退款异常:', refundError);
      }
    }

    if (orderId) {
      await transactionManager.updateTransaction(orderId, {
        status: isTimeoutLikeError(error) ? '超时' : '失败',
        actualPoints: 0,
        remainingPoints: refundedPoints,
        resultData: JSON.stringify({ error: getUserFacingMessage(error) }),
      });
    }

    return NextResponse.json(
      { success: false, message: getUserFacingMessage(error) },
      { status: isTimeoutLikeError(error) ? 504 : 500 }
    );
  }
}
