import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { capturedImageManager, transactionManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';
import { isImageEditTimeoutError, runPsydoImageEditFromUrl } from '@/lib/psydoImageEdits';
import { saveBufferToLocalMaterialFile } from '@/lib/localUploadStorage';
import { DEFAULT_SMART_EDIT_SIZE_OPTION, getSmartEditOutputSize, isSmartEditAspectRatioOption, isSmartEditResolution } from '@/lib/smartEditSize';

const REQUIRED_POINTS = 30;
const FIXED_PROMPT = '请将商品主图中的手机壳背面彩绘图案精准提取为可直接用于工厂打印的平面印刷稿，并严格执行以下要求：\n1. 只保留手机壳背面的彩绘/印刷图案区域，彻底移除所有与手机壳硬件结构相关的内容，包括但不限于摄像头开孔、镜头边框、壳体边缘、侧边、按键位、孔位、阴影、高光、反射、手持道具、背景布景及其他非图案元素；\n2. 将原商品图中的透视角度、倾斜变形、弯曲展示效果自动校正为正视、平整、无透视畸变的二维平面图；\n3. 输出结果必须是手机壳背面图案的完整平面印刷稿，不是商品效果图，不要保留产品摄影感、立体感、材质反光或展示场景；\n4. 严格保留原图中的全部设计内容与细节，包括纹理、笔触、线条、渐变、边缘、图案层次、细小装饰元素，禁止擅自增删、重绘、简化、脑补或风格化；\n5. 色彩必须高度还原原商品图中的设计颜色，禁止出现偏色、灰化、过饱和、失真或对比度异常；\n6. 图案内容必须完整覆盖整个输出画布，边界完整，不留白，不内缩，不裁掉边缘图案；\n7. 如果原商品主图中图案区域本身没有独立背景，请自动补出与主体设计清晰区分、适合打印生产识别的纯色平整背景；如果原本已有明确背景设计，则完整保留原背景设计；\n8. 输出图像必须清晰、干净、无水印、无噪点、无压缩痕迹、无模糊、无锯齿，达到印刷生产可用标准；\n9. 输出结果为高精度、高清晰度、适合后续喷绘、UV打印、彩绘生产使用的手机壳背面平面图。\n这是一个生产提取任务，不是创意生成任务。禁止风格迁移、禁止自动美化、禁止重新设计、禁止脑补缺失内容、禁止增加原图中不存在的元素，只允许在提取与校正范围内进行最小必要处理。';

function getUserFacingImageGenerationMessage(error: unknown) {
  if (isImageEditTimeoutError(error)) {
    return '处理时间较长，请稍后重试';
  }

  return '暂时未能完成处理，请稍后重试';
}

function getUserFacingImageGenerationStatus(error: unknown) {
  return isImageEditTimeoutError(error) ? 504 : 500;
}

function normalizeSourceSize(sourceSize?: { width?: number | null; height?: number | null }) {
  const width = sourceSize?.width ?? 0;
  const height = sourceSize?.height ?? 0;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

async function readRemoteImageSize(imageUrl: string) {
  try {
    const response = await fetch(imageUrl, {
      headers: buildBrowserImageHeaders(imageUrl),
    });
    if (!response.ok) return null;

    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).rotate().metadata();
    if (!metadata.width || !metadata.height) return null;
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    console.warn('[AI生图] 读取原图尺寸失败，回退默认比例:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let orderId = '';

  try {
    console.log('[AI生图] ========== 开始处理请求 ==========' );
    const body = await request.json() as {
      userId?: string;
      imageUrl?: string;
      prompt?: string;
      aspectRatio?: string;
      resolution?: string;
      sourceSize?: {
        width?: number | null;
        height?: number | null;
      };
      orderId?: string;
    };

    const userId = body.userId?.trim();
    const imageUrl = body.imageUrl?.trim();
    const userPrompt = body.prompt?.trim();
    const requestedAspectRatio = isSmartEditAspectRatioOption(body.aspectRatio) ? body.aspectRatio : DEFAULT_SMART_EDIT_SIZE_OPTION;
    const requestedResolution = isSmartEditResolution(body.resolution) ? body.resolution : '2k';
    orderId = body.orderId?.trim() || `AIG${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    console.log('[AI生图] 请求参数:', {
      userId,
      orderId,
      hasImageUrl: !!imageUrl,
      promptLength: userPrompt?.length || 0,
      requestedAspectRatio,
      requestedResolution,
    });

    if (!userId || !imageUrl) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return NextResponse.json({ success: false, message: '图片URL格式不正确' }, { status: 400 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    if ((user.points || 0) < REQUIRED_POINTS) {
      return NextResponse.json({ success: false, message: `积分不足，当前 ${user.points || 0}，需要 ${REQUIRED_POINTS}` }, { status: 400 });
    }

    const providedSourceSize = normalizeSourceSize(body.sourceSize);
    const sourceSize = requestedAspectRatio === 'auto' && !providedSourceSize
      ? await readRemoteImageSize(imageUrl)
      : providedSourceSize;
    const targetOutputSize = getSmartEditOutputSize(requestedAspectRatio, requestedResolution, sourceSize || undefined);
    const finalPrompt = userPrompt
      ? `${FIXED_PROMPT}\n输出比例：${targetOutputSize.resolvedAspectRatio}，清晰度：${requestedResolution}。\n附加要求：${userPrompt}`
      : `${FIXED_PROMPT}\n输出比例：${targetOutputSize.resolvedAspectRatio}，清晰度：${requestedResolution}。`;

    await transactionManager.createTransaction({
      userId,
      orderNumber: orderId,
      toolPage: 'AI生图',
      description: 'AI生图（图生图）',
      prompt: finalPrompt,
      points: REQUIRED_POINTS,
      remainingPoints: user.points,
      resultData: null,
      requestParams: JSON.stringify({
        imageUrl,
        userPrompt: userPrompt || '',
        mode: 'image-to-image',
        aspectRatio: requestedAspectRatio,
        imageSize: requestedResolution,
        requestedAspectRatio,
        resolvedAspectRatio: targetOutputSize.resolvedAspectRatio,
        requestedResolution,
        requestedOutputSize: {
          width: targetOutputSize.width,
          height: targetOutputSize.height,
        },
        sourceSize,
      }),
      status: '处理中',
    });

    const imageEditBuffer = await runPsydoImageEditFromUrl({
      imageUrl,
      prompt: finalPrompt,
      aspectRatio: targetOutputSize.resolvedAspectRatio,
      quality: 'high',
    });
    const editedBuffer = await sharp(imageEditBuffer)
      .resize({ width: targetOutputSize.width, height: targetOutputSize.height, fit: 'fill' })
      .png()
      .toBuffer();

    console.log('[AI生图] Psydo 返回成功，buffer bytes:', editedBuffer.length);

    let uploadedUrl = '';
    try {
      uploadedUrl = await uploadToCozeStorage(editedBuffer, `image-to-image/${orderId}.png`, 'image/png');
    } catch (error) {
      console.warn('[AI生图] 对象存储上传失败，回退本地 material-file:', error);
      const localUrl = await saveBufferToLocalMaterialFile(editedBuffer, `ai-generate/${orderId}.png`);
      uploadedUrl = new URL(localUrl, request.nextUrl.origin).toString();
    }

    const updatedUser = await userManager.deductPointsAtomically(userId, REQUIRED_POINTS);
    if (!updatedUser) {
      throw new Error('积分不足');
    }

    await transactionManager.updateTransaction(orderId, {
      status: '成功',
      points: REQUIRED_POINTS,
      actualPoints: REQUIRED_POINTS,
      remainingPoints: updatedUser.points,
      resultData: uploadedUrl,
    });

    const record = await capturedImageManager.createCapturedImage({
      userId,
      imageUrl: uploadedUrl,
      originalUrl: imageUrl,
      pageUrl: null,
      pageTitle: 'AI生图生成',
      sourceHost: 'image-to-image',
      imageType: 'edited',
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        id: record.id,
        url: uploadedUrl,
        remainingPoints: updatedUser.points,
      },
    });
  } catch (error) {
    console.error('[AI生图] 处理失败:', error);

    if (orderId) {
      try {
        await transactionManager.updateTransaction(orderId, {
          status: isImageEditTimeoutError(error) ? '超时' : '失败',
          resultData: JSON.stringify({
            error: getUserFacingImageGenerationMessage(error),
          }),
          actualPoints: 0,
        });
      } catch (updateError) {
        console.error('[AI生图] 回写失败状态异常:', updateError);
      }
    }

    return NextResponse.json(
      { success: false, message: getUserFacingImageGenerationMessage(error) },
      { status: getUserFacingImageGenerationStatus(error) }
    );
  }
}
