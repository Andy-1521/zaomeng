import { after, NextRequest, NextResponse } from 'next/server';
import { userManager, transactionManager } from '@/storage/database';
import { uploadFromUrlToCozeStorage, uploadToCozeStorage } from '@/lib/dualStorage';
import { isImageEditTimeoutError, runPsydoImageEditFromUrl } from '@/lib/psydoImageEdits';
import { getColorExtractionPoints, getGeneratePsdPoints } from '@/lib/pricing';
import { tryCreateAndUploadResultThumbnailFromUrl } from '@/lib/resultThumbnail';

const COLOR_EXTRACTION_POINTS = getColorExtractionPoints();
const PSD_POINTS = getGeneratePsdPoints();
const COLOR_EXTRACTION_IMAGE_EDIT_TIMEOUT_MS = 280000;

type ExtractionTaskResult = {
  success: boolean;
  resultUrl?: string;
  errorMsg?: string;
  isTimeout?: boolean;
};

type RequestParamsRecord = Record<string, unknown> & {
  actualExtractionMode?: string;
  psdGenerationStatus?: 'processing' | 'success' | 'failed' | 'pending';
  psdPoints?: number;
  psdPointsCharged?: boolean;
};

type ColorExtractionJob = {
  userId: string;
  imageUrl: string;
  finalOrderId: string;
  chargedRemainingPoints: number;
  localMaterialOrigin: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '工作流异常';
}

function getUserFacingExtractionMessage(error: unknown) {
  if (isImageEditTimeoutError(error)) {
    return '处理时间较长，请稍后重试';
  }

  return '暂时未能完成处理，请稍后重试';
}

function isTimeoutLikeError(error: unknown) {
  return isImageEditTimeoutError(error)
    || (error instanceof Error && (error.message?.includes('超时') || error.name === 'AbortError'));
}

// 彩绘提取提示词（Psydo 图生图版）
const COLOR_EXTRACTION_PROMPT = '请将商品主图中的手机壳背面彩绘图案精准提取为可直接用于工厂打印的平面印刷稿，并严格执行以下要求：\n1. 只保留手机壳背面的彩绘/印刷图案区域，彻底移除所有与手机壳硬件结构相关的内容，包括但不限于摄像头开孔、镜头边框、壳体边缘、侧边、按键位、孔位、阴影、高光、反射、手持道具、背景布景及其他非图案元素；\n2. 将原商品图中的透视角度、倾斜变形、弯曲展示效果自动校正为正视、平整、无透视畸变的二维平面图；\n3. 输出结果必须是手机壳背面图案的完整平面印刷稿，不是商品效果图，不要保留产品摄影感、立体感、材质反光或展示场景；\n4. 严格保留原图中的全部设计内容与细节，包括纹理、笔触、线条、渐变、边缘、图案层次、细小装饰元素，禁止擅自增删、重绘、简化、脑补或风格化；\n5. 色彩必须高度还原原商品图中的设计颜色，禁止出现偏色、灰化、过饱和、失真或对比度异常；\n6. 图案内容必须完整覆盖整个输出画布，边界完整，不留白，不内缩，不裁掉边缘图案；\n7. 如果原商品主图中图案区域本身没有独立背景，请自动补出与主体设计清晰区分、适合打印生产识别的纯色平整背景；如果原本已有明确背景设计，则完整保留原背景设计；\n8. 输出图像必须清晰、干净、无水印、无噪点、无压缩痕迹、无模糊、无锯齿，达到印刷生产可用标准；\n9. 输出结果为高精度、高清晰度、适合后续喷绘、UV打印、彩绘生产使用的手机壳背面平面图。\n这是一个生产提取任务，不是创意生成任务。禁止风格迁移、禁止自动美化、禁止重新设计、禁止脑补缺失内容、禁止增加原图中不存在的元素，只允许在提取与校正范围内进行最小必要处理。';

// ========== Psydo 图生图 API - 彩绘提取（唯一接口） ==========

/**
 * 调用 Psydo gpt-image-2 进行彩绘提取
 */
async function submitCozeWorkflowExtractionTask(imageUrl: string, localMaterialOrigin?: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[Psydo彩绘提取] ========== 开始彩绘提取 ==========`);
  console.log(`[Psydo彩绘提取] 图片URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const resultBuffer = await runPsydoImageEditFromUrl({
      imageUrl,
      prompt: COLOR_EXTRACTION_PROMPT,
      size: '1024x1792',
      quality: 'high',
      timeoutMs: COLOR_EXTRACTION_IMAGE_EDIT_TIMEOUT_MS,
      localMaterialOrigin,
    });

    const fileName = `color-extraction/results/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`;
    const persistedUrl = await uploadToCozeStorage(resultBuffer, fileName, 'image/png');

    console.log(`[Psydo彩绘提取] ========== 彩绘提取成功 ==========`);
    console.log(`[Psydo彩绘提取] 提取图片URL: ${persistedUrl.substring(0, 80)}...`);
    return {
      success: true,
      resultUrl: persistedUrl,
    };
  } catch (error: unknown) {
    console.error(`[Psydo彩绘提取] ========== 彩绘提取失败 ==========`);
    console.error(`[Psydo彩绘提取] 错误:`, error instanceof Error ? error.message : error);

    // 检测是否为超时错误
    const isTimeout = isTimeoutLikeError(error);

    return {
      success: false,
      errorMsg: getUserFacingExtractionMessage(error),
      isTimeout,
    };
  }
}

/**
 * 提取彩绘（使用 Psydo 图生图 API）
 * @param imageUrl 图片URL
 * @returns 提取结果
 */
async function extractColorExtraction(imageUrl: string, localMaterialOrigin?: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[彩绘提取] ========== 开始彩绘提取（Psydo 图生图 API） ==========`);

  try {
    const result = await submitCozeWorkflowExtractionTask(imageUrl, localMaterialOrigin);

    if (result.success) {
      console.log(`[彩绘提取] ========== 彩绘提取成功 ==========`);
      return {
        success: true,
        resultUrl: result.resultUrl,
      };
    } else {
      console.error(`[彩绘提取] ========== 彩绘提取失败 ==========`);
      console.error(`[彩绘提取] 错误: ${result.errorMsg}`);
      console.error(`[彩绘提取] isTimeout: ${result.isTimeout}`);
      return {
        success: false,
        errorMsg: result.errorMsg,
        isTimeout: result.isTimeout, // 传递超时标志
      };
    }
  } catch (error: unknown) {
    console.error(`[彩绘提取] ========== 彩绘提取异常 ==========`);
    console.error(`[彩绘提取] 异常:`, getErrorMessage(error));

    // 检测是否为超时错误
    const isTimeout = isTimeoutLikeError(error);

    return {
      success: false,
      errorMsg: getUserFacingExtractionMessage(error),
      isTimeout,
    };
  }
}

async function persistExternalResultImage(
  sourceUrl: string,
  relativeFilePath: string
): Promise<string> {
  return uploadFromUrlToCozeStorage(sourceUrl, relativeFilePath, 'image/png');
}

async function processColorExtractionJob(params: ColorExtractionJob) {
  const workflowStartTime = Date.now();
  const {
    userId,
    imageUrl,
    finalOrderId,
    chargedRemainingPoints,
    localMaterialOrigin,
  } = params;
  let shouldRefund = true;

  try {
    console.log(`[彩绘提取2工作流] ========== 开始彩绘提取工作流（Psydo 图生图彩绘提取API，PSD手动生成） ==========`);

    const actualExtractionMode = 'full';
    const extractionResult: ExtractionTaskResult = await extractColorExtraction(imageUrl, localMaterialOrigin);

    console.log(`[彩绘提取2工作流] ========== 提取函数返回结果 ==========`);
    console.log(`[彩绘提取2工作流] success: ${extractionResult.success}`);

    let extractionImageUrl = '';
    let errorMsg = '';
    let success = false;
    let isTimeout = false;

    if (extractionResult.success) {
      success = true;
      extractionImageUrl = extractionResult.resultUrl || '';
      console.log(`[彩绘提取2工作流] 全屏图模式成功:`);
      console.log(`[彩绘提取2工作流] resultUrl: ${extractionImageUrl.substring(0, 80)}...`);

      if (!extractionImageUrl) {
        throw new Error('彩绘提取未返回完整结果图');
      }

      console.log('[彩绘提取2工作流] 步骤1.5: 持久化生成的图片');
      const fileName = `color-extraction/${finalOrderId}-result.png`;
      extractionImageUrl = await persistExternalResultImage(extractionImageUrl, fileName);
      console.log(`[彩绘提取2工作流] 提取图片已持久化: ${extractionImageUrl.substring(0, 80)}...`);

    } else {
      errorMsg = extractionResult.errorMsg || '暂时未能完成处理，请稍后重试';
      isTimeout = extractionResult.isTimeout || false;
      success = false;
    }

    console.log(`[彩绘提取2工作流] errorMsg: ${errorMsg || 'none'}`);
    console.log(`[彩绘提取2工作流] 已用时间: ${((Date.now() - workflowStartTime) / 1000 / 60).toFixed(1)}分钟`);

    if (success && extractionImageUrl) {
      console.log(`[彩绘提取2工作流] ========== 彩绘提取API成功 ==========`);
      console.log(`[彩绘提取2工作流] 提取图片URL: ${extractionImageUrl.substring(0, 80)}...`);

      const currentTransaction = await transactionManager.getTransactionByOrderNumber(finalOrderId);
      if (currentTransaction) {
        let requestParams: RequestParamsRecord = {};
        try {
          requestParams = JSON.parse(currentTransaction.requestParams || '{}') as RequestParamsRecord;
        } catch {
          console.warn('[彩绘提取2工作流] 解析requestParams失败，使用空对象');
        }
        requestParams.actualExtractionMode = actualExtractionMode;
        requestParams.psdPoints = PSD_POINTS;
        requestParams.psdGenerationStatus = 'pending';
        requestParams.psdPointsCharged = false;
        requestParams.thumbnailUrl = await tryCreateAndUploadResultThumbnailFromUrl(
          extractionImageUrl,
          `thumbnails/color-extraction/${finalOrderId}.webp`,
          '彩绘提取2工作流',
          { localMaterialOrigin },
        );

        await transactionManager.updateTransaction(finalOrderId, {
          status: '成功',
          resultData: extractionImageUrl,
          uploadedImage: imageUrl,
          requestParams: JSON.stringify(requestParams),
          remainingPoints: chargedRemainingPoints,
          points: COLOR_EXTRACTION_POINTS,
          actualPoints: COLOR_EXTRACTION_POINTS,
        });
      } else {
        await transactionManager.updateTransaction(finalOrderId, {
          status: '成功',
          resultData: extractionImageUrl,
          uploadedImage: imageUrl,
          remainingPoints: chargedRemainingPoints,
          points: COLOR_EXTRACTION_POINTS,
          actualPoints: COLOR_EXTRACTION_POINTS,
        });
      }

      shouldRefund = false;
      console.log(`[彩绘提取2工作流] ========== 订单 ${finalOrderId} 提取完成（PSD待手动生成） ==========`);
      return;
    }

    const status = isTimeout ? '超时' : '失败';
    console.error(`[彩绘提取2工作流] ========== 彩绘提取API${status} ==========`);
    console.error(`[彩绘提取2工作流] 错误:`, errorMsg);

    let refundedPoints: number | undefined;
    if (shouldRefund) {
      try {
        const refundedUser = await userManager.addPointsAtomically(userId, COLOR_EXTRACTION_POINTS);
        refundedPoints = refundedUser?.points;
        shouldRefund = false;
      } catch (refundError) {
        console.error('[彩绘提取2工作流] 失败退款异常:', refundError);
      }
    }

    await transactionManager.updateTransaction(finalOrderId, {
      status,
      resultData: JSON.stringify({ error: errorMsg }),
      remainingPoints: refundedPoints,
      actualPoints: 0,
    });
  } catch (error: unknown) {
    console.error('[彩绘提取2工作流] ========== 后台工作流异常 ==========');
    console.error('[彩绘提取2工作流] 异常:', error);

    let refundedPoints: number | undefined;
    if (shouldRefund) {
      try {
        const refundedUser = await userManager.addPointsAtomically(userId, COLOR_EXTRACTION_POINTS);
        refundedPoints = refundedUser?.points;
        shouldRefund = false;
      } catch (refundError) {
        console.error('[彩绘提取2工作流] 异常退款失败:', refundError);
      }
    }

    await transactionManager.updateTransaction(finalOrderId, {
      status: isTimeoutLikeError(error) ? '超时' : '失败',
      resultData: JSON.stringify({
        error: getUserFacingExtractionMessage(error),
      }),
      remainingPoints: refundedPoints,
      actualPoints: 0,
    });
  }
}

// 主API处理逻辑
export async function POST(request: NextRequest) {
  const workflowStartTime = Date.now();
  let userId = '';
  let currentPoints = 0;
  let finalOrderId = '';
  let colorExtractionPointsCharged = false;
  let chargedRemainingPoints = 0;

  console.log('[彩绘提取2工作流] ========== 彩绘提取2工作流开始 ==========');
  console.log('[彩绘提取2工作流] 时间:', new Date(workflowStartTime).toISOString());

  try {
    const requestBody = await request.json();
    const { userId: requestUserId, imageUrl, orderId } = requestBody;

    console.log(`[彩绘提取2工作流] ========== 接收到请求 ==========`);
    console.log(`[彩绘提取2工作流] userId: ${requestUserId}`);
    console.log(`[彩绘提取2工作流] orderId: ${orderId}`);
    console.log(`[彩绘提取2工作流] extractionMode: full`);
    console.log(`[彩绘提取2工作流] ========== 请求参数解析完成 ==========`);

    if (!requestUserId || !imageUrl) {
      console.error('[彩绘提取2工作流] 参数验证失败:', { hasUserId: !!requestUserId, hasImageUrl: !!imageUrl });
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    console.log(`[彩绘提取2工作流] imageUrl: ${imageUrl.substring(0, 80)}...`);

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return NextResponse.json(
        { success: false, message: '图片URL格式不正确，必须为HTTP/HTTPS地址' },
        { status: 400 }
      );
    }

    userId = requestUserId;

    const finalPrompt = `专业提取手机壳表面的完整彩绘图案，执行以下强制要求：
1. 移除所有手机硬件元素，仅保留手机壳上的彩绘图案本体，重点清除摄像头开孔、边框、按键、镜头圈、壳体轮廓与所有非图案结构；
2. 若原手机壳为透明或半透明材质，最终结果必须输出为真正透明背景的 PNG（带 alpha 通道），不得出现白底、灰底、伪透明、阴影底、残留描边或雾化背景；
3. 若原手机壳并非透明材质，则保留图案原有底色、背景质感和画面表现，不得错误抠成透明底；
4. 严格保留原图案的构图、主体位置、比例、纹理、笔触、渐变、装饰元素、边缘细节和颜色准确性，不得擅自重绘、补画、改结构、改布局或新增无关元素；
5. 图案应完整铺满最终画布，边缘清晰锐利，无留白、无裁切缺失、无模糊、无锯齿、无像素化，达到可直接喷绘制作的精度；
6. 严禁把非透明手机壳错误处理成透明底，也严禁把透明手机壳处理成白底或灰底成品；
7. 最终输出图像无水印、无噪点、无压缩失真，可直接用于专业彩绘打印。`;

    const user = await userManager.getUserById(userId);

    if (!user) {
      console.error(`[彩绘提取2工作流] 用户不存在，userId: ${userId}`);
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    currentPoints = user.points || 0;

    if (currentPoints < COLOR_EXTRACTION_POINTS) {
      return NextResponse.json(
        {
          success: false,
          message: '积分不足',
          debug: {
            currentPoints,
            requiredPoints: COLOR_EXTRACTION_POINTS,
          },
        },
        { status: 400 }
      );
    }

    finalOrderId = orderId || `ORD${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    console.log(`[彩绘提取2工作流] 开始处理订单: ${finalOrderId}`);
    console.log(`[彩绘提取2工作流] 用户: ${userId}, 积分: ${currentPoints}`);
    console.log(`[彩绘提取2工作流] 图片URL: ${imageUrl.substring(0, 80)}...`);

    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: finalOrderId,
      toolPage: '彩绘提取',
      description: '手机壳彩绘提取',
      prompt: finalPrompt,
      points: COLOR_EXTRACTION_POINTS,
      remainingPoints: currentPoints,
      resultData: null,
      uploadedImage: imageUrl,
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
        extractionMode: 'full',
        actualExtractionMode: 'pending', // 后续更新
        psdPoints: PSD_POINTS,
        psdGenerationStatus: 'pending',
        psdPointsCharged: false,
        workflow: '彩绘提取工作流（Psydo 图生图 API，PSD需手动生成）',
      }),
      status: '处理中',
    });

    console.log(`[彩绘提取2工作流] 订单记录已创建`);

    const chargedUser = await userManager.deductPointsAtomically(userId, COLOR_EXTRACTION_POINTS);
    if (!chargedUser) {
      await transactionManager.updateTransaction(finalOrderId, {
        status: '失败',
        resultData: JSON.stringify({ error: '积分不足' }),
        actualPoints: 0,
      });
      return NextResponse.json(
        { success: false, message: `积分不足，当前积分：${currentPoints}，需要：${COLOR_EXTRACTION_POINTS}` },
        { status: 400 }
      );
    }

    colorExtractionPointsCharged = true;
    chargedRemainingPoints = chargedUser.points;
    await transactionManager.updateTransaction(finalOrderId, {
      actualPoints: COLOR_EXTRACTION_POINTS,
      remainingPoints: chargedRemainingPoints,
    });
    console.log(`[彩绘提取2工作流] 用户积分已预扣: ${currentPoints} -> ${chargedRemainingPoints}`);

    colorExtractionPointsCharged = false;
    after(async () => {
      await processColorExtractionJob({
        userId,
        imageUrl,
        finalOrderId,
        chargedRemainingPoints,
        localMaterialOrigin: request.nextUrl.origin,
      });
    });

    return NextResponse.json({
      success: true,
      message: '彩绘提取任务已提交',
      data: {
        orderId: finalOrderId,
        remainingPoints: chargedRemainingPoints,
      },
    });

  } catch (error: unknown) {
    console.error('[彩绘提取2工作流] ========== 工作流异常 ==========');
    console.error('[彩绘提取2工作流] 异常:', error);

    let refundedPoints: number | undefined;
    if (finalOrderId && colorExtractionPointsCharged) {
      try {
        const refundedUser = await userManager.addPointsAtomically(userId, COLOR_EXTRACTION_POINTS);
        refundedPoints = refundedUser?.points;
        colorExtractionPointsCharged = false;
      } catch (refundError) {
        console.error('[彩绘提取2工作流] 异常退款失败:', refundError);
      }
    }

    if (finalOrderId) {
      await transactionManager.updateTransaction(finalOrderId, {
        status: '失败',
        resultData: JSON.stringify({
          error: getUserFacingExtractionMessage(error),
        }),
        remainingPoints: refundedPoints,
        actualPoints: 0, // 异常失败时不扣积分
      });
    }

    return NextResponse.json(
        {
          success: false,
          message: getUserFacingExtractionMessage(error),
          debug: {
            error: getUserFacingExtractionMessage(error),
          },
        },
      { status: isTimeoutLikeError(error) ? 504 : 500 }
    );
  }
}
