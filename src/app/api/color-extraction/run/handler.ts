import { NextRequest, NextResponse } from 'next/server';
import { userManager, transactionManager } from '@/storage/database';
import {
  runRemoveBgWorkflow,
} from '@/lib/color-extraction-api/cozeWorkflows';
import {
  uploadFileUrlToCozeOpenApi,
  type CozeWorkflowInputImage,
} from '@/lib/cozeOpenApiFiles';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { decomposeLayersWithRunningHub } from '@/lib/layer-decomposition';
import { generatePsdFromDecomposition } from '@/lib/psd-generator';
import { uploadFromUrlToCozeStorage, uploadToCozeStorage } from '@/lib/dualStorage';
import { localUploadRoots } from '@/lib/localUploadStorage';
import { isImageEditTimeoutError, runPsydoImageEditFromUrl } from '@/lib/psydoImageEdits';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';

// 积分配置
const REQUIRED_POINTS = 30;

type ExtractionTaskResult = {
  success: boolean;
  resultUrl?: string;
  removedBgUrl?: string;
  processedImageUrl?: string;
  errorMsg?: string;
  isTimeout?: boolean;
};

type RequestParamsRecord = Record<string, unknown> & {
  actualExtractionMode?: string;
  degraded?: boolean;
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
async function submitCozeWorkflowExtractionTask(imageUrl: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[Psydo彩绘提取] ========== 开始彩绘提取 ==========`);
  console.log(`[Psydo彩绘提取] 图片URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const resultBuffer = await runPsydoImageEditFromUrl({
      imageUrl,
      prompt: COLOR_EXTRACTION_PROMPT,
      size: '1024x1792',
      quality: 'high',
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

async function createCozeWorkflowInputImage(
  imageUrl: string,
  fallbackFileName: string
): Promise<CozeWorkflowInputImage> {
  try {
    const uploadedFile = await uploadFileUrlToCozeOpenApi(imageUrl, fallbackFileName);
    console.log('[彩绘提取2工作流] 已上传 Coze OpenAPI 文件:', {
      fileId: uploadedFile.id,
      fileName: uploadedFile.fileName,
      bytes: uploadedFile.bytes,
    });

    return {
      file_id: uploadedFile.id,
      file_type: 'image',
    };
  } catch (error) {
    console.warn('[彩绘提取2工作流] Coze OpenAPI 文件上传失败，回退 URL 输入:', error);
    return {
      url: imageUrl,
      file_type: 'image',
    };
  }
}

/**
 * 调用Coze去除背景工作流API（镂空图模式）
 * 返回三个URL：
 * - result_url: 不让用户看到
 * - removed_bg_url: 作为结果图展示给用户
 * - processed_image_url: 上传到PSD图层
 */
async function submitCozeRemoveBgWorkflowTask(imageUrl: string): Promise<{ success: boolean; resultUrl?: string; removedBgUrl?: string; processedImageUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[Coze去除背景] ========== 开始去除背景 ==========`);
  console.log(`[Coze去除背景] 图片URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const workflowInputImage = await createCozeWorkflowInputImage(imageUrl, 'remove-bg-input.jpg');
    const result = await runRemoveBgWorkflow(workflowInputImage);

    if (result.success) {
      console.log(`[Coze去除背景] ========== 去除背景成功 ==========`);
      return {
        success: true,
        resultUrl: result.resultUrl,
        removedBgUrl: result.removedBgUrl,
        processedImageUrl: result.processedImageUrl,
      };
    }

    return {
      success: false,
      errorMsg: result.errorMsg,
      isTimeout: result.isTimeout,
    };

  } catch (error: unknown) {
    console.error(`[Coze去除背景] ========== 去除背景失败 ==========`);
    console.error(`[Coze去除背景] 错误:`, error instanceof Error ? error.message : error);

    // 检测是否为超时错误
    const isTimeout = error instanceof Error && (error.message?.includes('超时') || error.name === 'AbortError');

    return {
      success: false,
      errorMsg: error instanceof Error ? error.message : 'Coze去除背景失败',
      isTimeout,
    };
  }
}

/**
 * 提取彩绘（使用Coze工作流API）
 * @param imageUrl 图片URL
 * @returns 提取结果
 */
async function extractColorExtractionWithFallback(imageUrl: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[彩绘提取] ========== 开始彩绘提取（Coze工作流API） ==========`);

  try {
    const result = await submitCozeWorkflowExtractionTask(imageUrl);

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

// ========== RunningHub API - 分层 + PSD生成 ==========

/**
 * 下载图片并上传到对象存储
 */
async function uploadImageToStorage(imageUrl: string, orderId: string): Promise<string> {
  console.log(`[彩绘提取2工作流] 开始上传图片到对象存储，源URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const fileName = `color-extraction/layering-inputs/${orderId}.png`;
    const result = await uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');

    console.log(`[彩绘提取2工作流] ========== 图片已上传到对象存储 ==========`);
    console.log(`[彩绘提取2工作流] cozeUrl: ${result.substring(0, 80)}...`);

    return result;
  } catch (error: unknown) {
    console.error('[彩绘提取2工作流] 上传图片到对象存储失败:', error);
    throw new Error(`上传图片失败: ${getErrorMessage(error)}`);
  }
}

async function normalizeWorkflowSourceImage(imageUrl: string, orderId: string): Promise<string> {
  console.log(`[彩绘提取2工作流] 开始标准化工作流输入图片: ${imageUrl.substring(0, 80)}...`);
  let sourceBuffer: Buffer;

  const localMaterialPrefix = '/api/material-file/';
  if (imageUrl.includes(localMaterialPrefix)) {
    const url = new URL(imageUrl);
    const relativePath = decodeURIComponent(url.pathname.slice(localMaterialPrefix.length));
    const segments = relativePath.split('/').filter(Boolean);
    const root = segments[0];

    if (!root || !localUploadRoots.has(root)) {
      throw new Error('工作流输入图片路径无效');
    }

    const publicRoot = path.join(process.cwd(), 'public');
    const filePath = path.join(publicRoot, ...segments);
    if (!filePath.startsWith(publicRoot)) {
      throw new Error('工作流输入图片路径无效');
    }

    sourceBuffer = await readFile(filePath);
  } else {
    const response = await fetch(imageUrl, {
      headers: buildBrowserImageHeaders(imageUrl),
    });

    if (!response.ok) {
      throw new Error(`下载工作流输入图片失败 (${response.status})`);
    }

    sourceBuffer = Buffer.from(await response.arrayBuffer());
  }

  const normalizedBuffer = await sharp(sourceBuffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

    const fileName = `color-extraction/workflow-sources/${orderId}.jpg`;

  try {
    const uploadedUrl = await uploadToCozeStorage(normalizedBuffer, fileName, 'image/jpeg');
    console.log(`[彩绘提取2工作流] 工作流输入图片已上传到对象存储: ${uploadedUrl.substring(0, 80)}...`);
    return uploadedUrl;
  } catch (error) {
    console.warn('[彩绘提取2工作流] 工作流输入图上传对象存储失败，继续使用原始图片URL:', error);
    return imageUrl;
  }
}

async function persistExternalResultImage(
  sourceUrl: string,
  relativeFilePath: string
): Promise<string> {
  return uploadFromUrlToCozeStorage(sourceUrl, relativeFilePath, 'image/png');
}

async function persistImageBestEffort(
  sourceUrl: string,
  relativeFilePath: string
): Promise<{ url: string; persisted: boolean; error?: string }> {
  try {
    const url = await persistExternalResultImage(sourceUrl, relativeFilePath);
    return { url, persisted: true };
  } catch (error) {
    console.error('[彩绘提取2工作流] 持久化图片失败，保留原始结果URL:', error);
    return {
      url: sourceUrl,
      persisted: false,
      error: error instanceof Error ? error.message : '持久化图片失败',
    };
  }
}

/**
 * 使用分层接口层进行分层，并生成PSD文件
 * @param extractionImageUrl 提取的图片URL（用于分层）
 * @param orderId 订单号
 * @param additionalImageUrl 额外图片URL（可选，将作为额外图层添加到PSD中）
 * @returns PSD文件的URL
 */
async function processRunningHubLayeringAndPsd(extractionImageUrl: string, orderId: string, additionalImageUrl?: string): Promise<{ psdUrl?: string; error?: string }> {
  console.log(`[RunningHub分层+PSD] ========== 开始分层与PSD工作流 ==========`);
  console.log(`[RunningHub分层+PSD] 输入图片URL: ${extractionImageUrl.substring(0, 80)}...`);
  console.log(`[RunningHub分层+PSD] 订单号: ${orderId}`);

  try {
    // 步骤1: 下载提取图片并上传到对象存储（与彩绘提取1保持一致）
    console.log(`[RunningHub分层+PSD] 步骤1: 下载图片并上传到对象存储`);
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    console.log(`[RunningHub分层+PSD] 图片已上传: ${uploadedImageUrl.substring(0, 80)}...`);

    // 步骤2: 获取分层结果
    console.log(`[RunningHub分层+PSD] 步骤2: 调用分层接口层`);
    const decomposition = await decomposeLayersWithRunningHub(uploadedImageUrl);
    console.log(`[RunningHub分层+PSD] 分层来源: ${decomposition.source}, 图层数量: ${decomposition.layers.length}`);

    const layers = [...decomposition.layers];

    // 如果有额外图片URL，将其添加到图层列表中
    if (additionalImageUrl) {
      console.log(`[RunningHub分层+PSD] 添加额外图层: ${additionalImageUrl.substring(0, 80)}...`);
      layers.push({
        name: '背景图（原图）',
        kind: 'background',
        imageUrl: additionalImageUrl,
        zIndex: layers.length,
      });
      console.log(`[RunningHub分层+PSD] 图层总数（含额外图层）: ${layers.length}`);
    }

    // 步骤3: 合并图层为PSD文件
    console.log(`[RunningHub分层+PSD] 步骤3: 合并图层为PSD文件`);
    const psdBuffer = await generatePsdFromDecomposition({
      ...decomposition,
      layers,
    });
    console.log(`[RunningHub分层+PSD] PSD文件生成成功，大小: ${psdBuffer.length} bytes`);

    // 步骤4: 上传PSD文件到对象存储
    console.log(`[RunningHub分层+PSD] 步骤4: 上传PSD文件到对象存储`);
    const fileName = `color-extraction/psd/${orderId}.psd`;
    const psdUrl = await uploadToCozeStorage(psdBuffer, fileName, 'application/octet-stream');
    console.log(`[RunningHub分层+PSD] PSD上传成功: ${psdUrl.substring(0, 80)}...`);
    console.log(`[RunningHub分层+PSD] ========== RunningHub分层工作流完成 ==========`);

    return { psdUrl };
  } catch (error: unknown) {
    console.error(`[RunningHub分层+PSD] ========== RunningHub分层工作流失败 ==========`);
    console.error(`[RunningHub分层+PSD] 错误:`, getErrorMessage(error));
    return { error: getErrorMessage(error) };
  }
}

// 主API处理逻辑
export async function POST(request: NextRequest) {
  const workflowStartTime = Date.now();
  let userId = '';
  let currentPoints = 0;
  let finalOrderId = '';

  console.log('[彩绘提取2工作流] ========== 彩绘提取2工作流开始 ==========');
  console.log('[彩绘提取2工作流] 时间:', new Date(workflowStartTime).toISOString());

  try {
    const requestBody = await request.json();
    const { userId: requestUserId, imageUrl, orderId, extractionMode = 'full' } = requestBody;

    console.log(`[彩绘提取2工作流] ========== 接收到请求 ==========`);
    console.log(`[彩绘提取2工作流] userId: ${requestUserId}`);
    console.log(`[彩绘提取2工作流] orderId: ${orderId}`);
    console.log(`[彩绘提取2工作流] extractionMode: ${extractionMode}`);
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

    if (currentPoints < REQUIRED_POINTS) {
      return NextResponse.json(
        {
          success: false,
          message: '积分不足',
          debug: {
            currentPoints,
            requiredPoints: REQUIRED_POINTS,
          },
        },
        { status: 400 }
      );
    }

    finalOrderId = orderId || `ORD${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const workflowInputImageUrl = await normalizeWorkflowSourceImage(imageUrl, finalOrderId);

    console.log(`[彩绘提取2工作流] 开始处理订单: ${finalOrderId}`);
    console.log(`[彩绘提取2工作流] 用户: ${userId}, 积分: ${currentPoints}`);
    console.log(`[彩绘提取2工作流] 图片URL: ${imageUrl.substring(0, 80)}...`);
    console.log(`[彩绘提取2工作流] 工作流输入URL: ${workflowInputImageUrl.substring(0, 80)}...`);

    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: finalOrderId,
      toolPage: '彩绘提取',
      description: '手机壳彩绘提取',
      prompt: finalPrompt,
      points: REQUIRED_POINTS,
      remainingPoints: currentPoints,
      resultData: null,
      uploadedImage: imageUrl,
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
        extractionMode: extractionMode,
        actualExtractionMode: 'pending', // 后续更新
        workflow: extractionMode === 'hollow'
          ? '彩绘提取完整工作流（Coze去除背景API + RunningHub API分层）'
          : '彩绘提取完整工作流（Coze工作流API彩绘提取 + RunningHub API分层）',
      }),
      status: '处理中',
    });

    console.log(`[彩绘提取2工作流] 订单记录已创建`);

    // ========== 彩绘提取2工作流 ==========
    if (extractionMode === 'hollow') {
      console.log(`[彩绘提取2工作流] ========== 开始彩绘提取2工作流（Coze去除背景API + RunningHub API分层） ==========`);
    } else {
      console.log(`[彩绘提取2工作流] ========== 开始彩绘提取2工作流（Coze工作流API彩绘提取 + RunningHub API分层） ==========`);
    }

    // 步骤1: 调用彩绘提取函数（根据模式选择不同的API）
    let extractionResult: ExtractionTaskResult;
    let actualExtractionMode = extractionMode; // 记录实际使用的模式

    if (extractionMode === 'hollow') {
      console.log(`[彩绘提取2工作流] 使用镂空图模式（去除背景API）`);
      extractionResult = await submitCozeRemoveBgWorkflowTask(workflowInputImageUrl);

      // 如果镂空图模式失败，自动降级到全屏图模式
      if (!extractionResult.success) {
        console.warn(`[彩绘提取2工作流] ========== 镂空图模式失败，自动降级到全屏图模式 ==========`);
        console.warn(`[彩绘提取2工作流] 失败原因: ${extractionResult.errorMsg}`);
        actualExtractionMode = 'full';
        extractionResult = await extractColorExtractionWithFallback(workflowInputImageUrl);
      }
    } else {
      console.log(`[彩绘提取2工作流] 使用全屏图模式（Psydo 图生图彩绘提取API）`);
      extractionResult = await extractColorExtractionWithFallback(workflowInputImageUrl);
    }

    console.log(`[彩绘提取2工作流] ========== 提取函数返回结果 ==========`);
    console.log(`[彩绘提取2工作流] success: ${extractionResult.success}`);

    let extractionImageUrl = ''; // 用户可见的结果图
    let processingImageUrl = ''; // 用于分层的图片
    let errorMsg = '';
    let success = false;
    let isTimeout = false; // 是否超时

    if (extractionResult.success) {
      success = true;
      if (actualExtractionMode === 'hollow') {
        // 镂空图模式
        extractionImageUrl = extractionResult.removedBgUrl || '';
        processingImageUrl = extractionResult.processedImageUrl || '';
        console.log(`[彩绘提取2工作流] 镂空图模式成功:`);
        console.log(`[彩绘提取2工作流] removedBgUrl: ${extractionImageUrl.substring(0, 80)}...`);
        console.log(`[彩绘提取2工作流] processedImageUrl: ${processingImageUrl.substring(0, 80)}...`);
        console.log(`[彩绘提取2工作流] resultUrl: ${extractionResult.resultUrl ? extractionResult.resultUrl.substring(0, 80) : 'none'}...`);
      } else {
        // 全屏图模式
        extractionImageUrl = extractionResult.resultUrl || '';
        processingImageUrl = extractionImageUrl; // 全屏图模式使用同一张图
        console.log(`[彩绘提取2工作流] 全屏图模式成功:`);
        console.log(`[彩绘提取2工作流] resultUrl: ${extractionImageUrl.substring(0, 80)}...`);
        if (extractionMode === 'hollow' && actualExtractionMode === 'full') {
          console.warn(`[彩绘提取2工作流] 注意：镂空图模式失败，已降级到全屏图模式`);
        }
      }

      // 步骤1.5: 尽力持久化结果图片，但不能影响主结果成功
      console.log('[彩绘提取2工作流] 步骤1.5: 持久化生成的图片（失败则保留原始结果URL）');
      const fileName = `color-extraction/${finalOrderId}-result.png`;
      const persistedResult = await persistImageBestEffort(extractionImageUrl, fileName);
      extractionImageUrl = persistedResult.url;
      if (persistedResult.persisted) {
        console.log(`[彩绘提取2工作流] 提取图片已持久化: ${extractionImageUrl.substring(0, 80)}...`);
      } else {
        console.warn(`[彩绘提取2工作流] 提取图片持久化失败，继续使用原始结果URL: ${persistedResult.error}`);
      }

      // 如果是镂空图模式，也尽力持久化额外图层，但不能影响主流程成功
      if (actualExtractionMode === 'hollow' && processingImageUrl) {
        const additionalFileName = `color-extraction/${finalOrderId}-additional.png`;
        const persistedAdditional = await persistImageBestEffort(processingImageUrl, additionalFileName);
        processingImageUrl = persistedAdditional.url;
        if (persistedAdditional.persisted) {
          console.log(`[彩绘提取2工作流] 额外图层已持久化: ${processingImageUrl.substring(0, 80)}...`);
        } else {
          console.warn(`[彩绘提取2工作流] 额外图层持久化失败，继续使用原始结果URL: ${persistedAdditional.error}`);
        }
      }
    } else {
      errorMsg = extractionResult.errorMsg || '暂时未能完成处理，请稍后重试';
      isTimeout = extractionResult.isTimeout || false;
      success = false;
    }

    console.log(`[彩绘提取2工作流] errorMsg: ${errorMsg || 'none'}`);
    console.log(`[彩绘提取2工作流] 已用时间: ${((Date.now() - workflowStartTime) / 1000 / 60).toFixed(1)}分钟`);

    // 更新订单状态
    if (success && extractionImageUrl) {
      console.log(`[彩绘提取2工作流] ========== 彩绘提取API成功 ==========`);
      console.log(`[彩绘提取2工作流] 提取图片URL: ${extractionImageUrl.substring(0, 80)}...`);

      // 步骤2: 原子扣除积分（防止并发超扣）
      const updatedUser = await userManager.deductPointsAtomically(userId, REQUIRED_POINTS);

      if (!updatedUser) {
        console.error('[彩绘提取2工作流] 扣除积分失败：积分不足');
        throw new Error('积分不足');
      }

      const newPoints = updatedUser.points;
      console.log(`[彩绘提取2工作流] 用户积分已更新: ${currentPoints} -> ${newPoints}`);

      // 步骤3: 更新订单状态为"成功"，并保存提取图片URL
      console.log('[彩绘提取2工作流] ========== 更新订单状态为成功（提取完成） ==========');

      // 更新requestParams，记录实际使用的模式
      const currentTransaction = await transactionManager.getTransactionByOrderNumber(finalOrderId);
      if (currentTransaction) {
        let requestParams: RequestParamsRecord = {};
        try {
          requestParams = JSON.parse(currentTransaction.requestParams || '{}') as RequestParamsRecord;
        } catch {
          console.warn('[彩绘提取2工作流] 解析requestParams失败，使用空对象');
        }
        requestParams.actualExtractionMode = actualExtractionMode;
        if (extractionMode === 'hollow' && actualExtractionMode === 'full') {
          requestParams.degraded = true;
        }

        await transactionManager.updateTransaction(finalOrderId, {
          status: '成功',
          resultData: extractionImageUrl, // 保存双存储的URL
          uploadedImage: imageUrl, // 保存用户上传的原图URL
          requestParams: JSON.stringify(requestParams),
          remainingPoints: newPoints,
          actualPoints: 30, // 彩绘提取成功，扣除30积分
        });
      } else {
        await transactionManager.updateTransaction(finalOrderId, {
          status: '成功',
          resultData: extractionImageUrl, // 保存双存储的URL
          uploadedImage: imageUrl, // 保存用户上传的原图URL
          remainingPoints: newPoints,
          actualPoints: 30, // 彩绘提取成功，扣除30积分
        });
      }

      console.log(`[彩绘提取2工作流] ========== 订单 ${finalOrderId} 提取完成（PSD后台生成中） ==========`);
      console.log(`[彩绘提取2工作流] 已用时间: ${((Date.now() - workflowStartTime) / 1000 / 60).toFixed(1)}分钟`);

      // 步骤4: 立即返回响应给前端（不等待分层和PSD生成）
      const response = NextResponse.json({
        success: true,
        message: '彩绘提取成功',
        data: {
          imageUrl: extractionImageUrl,
          psdUrl: '', // PSD尚未生成
          orderId: finalOrderId,
          remainingPoints: newPoints,
        },
      });

      // 步骤5: 后台异步处理分层和PSD生成（不阻塞响应）
      // 使用立即执行的异步函数（IIFE）启动后台任务
      (async () => {
        try {
          console.log(`[后台任务] ========== 开始后台任务 ==========`);
          console.log(`[后台任务] 订单号: ${finalOrderId}`);
          console.log(`[后台任务] extractionMode: ${extractionMode}`);

          let layeringImageUrl = '';
          let additionalImageUrl: string | undefined = undefined;

          if (actualExtractionMode === 'hollow') {
            // 镂空图模式：使用removedBgUrl进行分层，processedImageUrl作为额外图层
            layeringImageUrl = extractionImageUrl; // removedBgUrl
            additionalImageUrl = processingImageUrl; // processedImageUrl
            console.log(`[后台任务] 镂空图模式：`);
            console.log(`[后台任务]   分层图片URL: ${layeringImageUrl.substring(0, 80)}...`);
            console.log(`[后台任务]   额外图层URL: ${additionalImageUrl.substring(0, 80)}...`);
          } else {
            // 全屏图模式：使用extractionImageUrl进行分层
            layeringImageUrl = extractionImageUrl;
            console.log(`[后台任务] 全屏图模式（含降级）：`);
            console.log(`[后台任务]   分层图片URL: ${layeringImageUrl.substring(0, 80)}...`);
          }

          console.log(`[后台任务] ========== 开始RunningHub分层 + PSD生成 ==========`);

          const psdResult = await processRunningHubLayeringAndPsd(layeringImageUrl, finalOrderId, additionalImageUrl);

          if (psdResult.psdUrl) {
            console.log(`[后台任务] ========== 分层 + PSD生成成功 ==========`);
            console.log(`[后台任务] PSD文件URL: ${psdResult.psdUrl.substring(0, 80)}...`);

            await transactionManager.updateTransaction(finalOrderId, {
              psdUrl: psdResult.psdUrl,
              // resultData保持为提取图片URL（用户可见的结果图），不修改
            });

            console.log(`[后台任务] ========== 订单 ${finalOrderId} PSD已更新 ==========`);

            // 触发前端刷新事件，通知用户PSD已生成
            console.log(`[后台任务] 触发 taskHistoryUpdated 事件`);
            // 注意：这里不能直接使用window，因为这是在服务器端执行的
            // 前端会通过定时检查机制自动刷新
          } else {
            console.error(`[后台任务] ========== 分层失败 ==========`);
            console.error(`[后台任务] 错误:`, psdResult.error);

            // 分层失败不影响提取结果，不修改resultData
            console.warn(`[后台任务] 分层失败但提取成功，保持订单状态不变`);
          }
        } catch (error: unknown) {
          console.error(`[后台任务] ========== 后台任务异常 ==========`);
          console.error(`[后台任务] 异常:`, getErrorMessage(error));
        }
      })();

      // 立即返回响应
      return response;

    } else {
      // 彩绘提取失败或超时
      const status = isTimeout ? '超时' : '失败';
      console.error(`[彩绘提取2工作流] ========== 彩绘提取API${status} ==========`);
      console.error(`[彩绘提取2工作流] 错误:`, errorMsg);

      await transactionManager.updateTransaction(finalOrderId, {
        status: status,
        resultData: JSON.stringify({
          error: errorMsg,
        }),
        actualPoints: 0, // 失败时不扣积分
      });

      return NextResponse.json({
        success: false,
        message: isTimeout ? '处理时间较长，请稍后重试' : '暂时未能完成处理，请稍后重试',
        debug: {
          error: errorMsg,
        },
      }, { status: isTimeout ? 504 : 500 });
    }

  } catch (error: unknown) {
    console.error('[彩绘提取2工作流] ========== 工作流异常 ==========');
    console.error('[彩绘提取2工作流] 异常:', error);

    if (finalOrderId) {
      await transactionManager.updateTransaction(finalOrderId, {
        status: '失败',
        resultData: JSON.stringify({
          error: getUserFacingExtractionMessage(error),
        }),
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
