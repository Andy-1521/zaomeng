import { NextRequest, NextResponse } from 'next/server';
import { userManager, transactionManager } from '@/storage/database';
import {
  createTask,
  waitForTaskComplete,
  getTaskOutputs,
} from '@/lib/runningHub';
import { mergeImagesToPsd, PsdLayerConfig } from '@/lib/psdMerge';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';
import { S3Storage } from 'coze-coding-dev-sdk';

// Coze工作流API配置（彩绘提取）
const COZE_WORKFLOW_URL = 'https://frzr6k4qcc.coze.site/run';
const COZE_WORKFLOW_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkOGYxNGZiLTM3M2MtNDRjMS1hZTJjLTcxMmRkMDk3OWFiYyJ9.eyJpc3MiOiJodHRwczovL2FwaS5jb3plLmNuIiwiYXVkIjpbIjE0Sm9lYVpCZkJmaXEzUHRQbWQ5QUlIMm5wbDJSV3RmIl0sImV4cCI6ODIxMDI2Njg3Njc5OSwiaWF0IjoxNzc2MjU5NzQ0LCJzdWIiOiJzcGlmZmU6Ly9hcGkuY296ZS5jbi93b3JrbG9hZF9pZGVudGl0eS9pZDo3NjI4OTE4NjY5NzgyODEwNjcwIiwic3JjIjoiaW5ib3VuZF9hdXRoX2FjY2Vzc190b2tlbl9pZDo3NjI4OTc3NTEzNzcwNzc4NjYwIn0.s5Y1qtl40GwKdVIkFEmYVyc_cpbzem4i1rxpHOfQQUpoeITkCZxSUIT-wz4l1GFBpVHWF4E5ktwZkkfddCt3Ft3cNJfXUql7SL5oZJyVYS0qkkp6gGnhvIykUaQnYrPB9XmOPeQsQumY8GmXLOixx1AQM5wxzlFjYlwibCAndLB-4O2Y4NEsJ571dBiF9cyF2eROVeNBXyhBLA7y9q_tXkAP2cukEDjfdhBTYDrILRMWz53zlVbKD0SYhDUM7xgDJYys3xPkv-VqjHLDrqt7drTyhoJ0GBvRpK_LnX-206KJScSHDQ27eWBuiykaEk3O2U2HrMV33Zrm_9daRClAdA';

// Coze工作流API配置（去除背景 - 镂空图模式）
const COZE_REMOVE_BG_WORKFLOW_URL = 'https://jzc4k83fbz.coze.site/run';
const COZE_REMOVE_BG_WORKFLOW_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImNhMmQ5ZWNiLTcwYTMtNDNhYS1hYjhkLTJkYWM3MWMzNDIyYSJ9.eyJpc3MiOiJodHRwczovL2FwaS5jb3plLmNuIiwiYXVkIjpbIjJXMlFKNGhaNGpmbGhBTUpGZFpGVXRLalExemJEbmplIl0sImV4cCI6ODIxMDI2Njg3Njc5OSwiaWF0IjoxNzY5NzA1OTg1LCJzdWIiOiJzcGlmZmU6Ly9hcGkuY296ZS5jbi93b3JrbG9hZF9pZGVudGl0eS9pZDo3NjAwNzEzNTEwMDcwMjU1NjUxIiwic3JjIjoiaW5ib3VuZF9hdXRoX2FjY2Vzc190b2tlbl9pZDo3NjAwODI5MzMwMzMxMDA5MDU4In0.ww0zvjayPMw0o0OF5d9e1uNBT65mh0Wos06zmd0_jC9niZmY0eliM7EOuOqycBMnfgrV4sbXnqY1o8RTgRQB-pSO1g_WadfhftzVXDevVn-x47QVkDHDrqmAYoe1aeCrhR3_DiCVQeDvk0h9D-iGRLkFxxhpr2HiM_dfshRYa6DKSAPRyZloZfRwhErZH4u83C06oQlWBPSCm6XfgDrP3aE7SzbkeUjnZpW_fbvyYG5MJPKwT-xuN2iYM8G3CZhUEzI-tpX44nSqPsdX0Kft53D6FUyW3u-Jg4nvGnD3iDHkZy4tuP7XVfC0HBgi8TwiSdNDtKjPDYrRhOluKYonWw';

// 初始化Coze对象存储（用于PSD文件上传）
const cozeStorage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: process.env.COZE_ACCESS_KEY,
  secretKey: process.env.COZE_SECRET_KEY,
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 超时配置
const FETCH_TIMEOUT = 60000;
const POLLING_INTERVAL = 5000;
const MAX_POLLING_TIME = 600000; // 超时时间：600秒（10分钟）
const MAX_POLLING_ATTEMPTS = Math.floor(MAX_POLLING_TIME / POLLING_INTERVAL);
const BACKEND_TOTAL_TIMEOUT = 1200000;

// 积分配置
const REQUIRED_POINTS = 30;

// 彩绘提取提示词（专业版）
const COLOR_EXTRACTION_PROMPT = '专业提取手机壳表面的完整彩绘图案，执行以下强制要求：\n1. 移除所有手机硬件元素（重点删除摄像头开孔及边框），仅保留彩绘图案本体；\n2. 若原手机壳为透明材质，直接输出**完全透明底PNG图像（带alpha通道，无任何白色/灰色底色）**；若为非透明壳，保留图案原始背景；\n3. 图像分辨率≥300 DPI，图案必须100%铺满整个画布，无留白、无缩放裁剪；\n4. 严格保留原图所有细节：包括彩绘的纹理、笔触、渐变色彩层次、微小图案元素，边缘轮廓锐利无模糊、无锯齿、无像素化；\n5. 色彩完全还原原图，无偏色、无饱和度损失，达到专业彩绘打印的精度标准；\n6. 最终输出图像无水印、无噪点、无压缩失真，可直接用于喷绘制作。';

// 带超时的fetch函数
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout}ms）: ${url}`);
    }
    throw error;
  }
}

// ========== Coze工作流API - 彩绘提取（唯一接口） ==========

/**
 * 调用Coze工作流API进行彩绘提取
 */
async function submitCozeWorkflowExtractionTask(imageUrl: string): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
  console.log(`[Coze工作流] ========== 开始彩绘提取 ==========`);
  console.log(`[Coze工作流] API URL: ${COZE_WORKFLOW_URL}`);
  console.log(`[Coze工作流] Token前缀: ${COZE_WORKFLOW_TOKEN.substring(0, 30)}...`);
  console.log(`[Coze工作流] 图片URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const requestBody = JSON.stringify({
      input_image: {
        url: imageUrl,
      },
    });
    console.log(`[Coze工作流] 请求体: ${requestBody.substring(0, 200)}...`);

    const response = await fetchWithTimeout(
      COZE_WORKFLOW_URL,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COZE_WORKFLOW_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
      MAX_POLLING_TIME  // 使用10分钟超时
    );

    console.log(`[Coze工作流] 响应状态: ${response.status} ${response.statusText}`);
    console.log(`[Coze工作流] 响应头:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Coze工作流] 提交任务失败:`, response.status);
      console.error(`[Coze工作流] 错误响应体:`, errorText);
      console.error(`[Coze工作流] 错误响应体长度:`, errorText.length);
      throw new Error(`Coze工作流调用失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Coze工作流] 响应数据:`, JSON.stringify(data, null, 2));

    // Coze工作流可能直接返回结果，也可能返回异步任务
    // 支持两种格式：
    // 1. 直接格式: { result_url: "...", run_id: "..." }
    // 2. 嵌套格式: { data: { output: { image_url: "..." } } }

    // 先尝试直接格式
    if (data.result_url) {
      console.log(`[Coze工作流] ========== 彩绘提取成功 ==========`);
      console.log(`[Coze工作流] 提取图片URL: ${data.result_url.substring(0, 80)}...`);
      return {
        success: true,
        resultUrl: data.result_url,
      };
    }

    // 再尝试嵌套格式
    if (data.data && data.data.output) {
      let resultUrl: string | undefined;

      // 尝试从不同字段提取图片URL
      if (data.data.output.image_url) {
        resultUrl = data.data.output.image_url;
      } else if (data.data.output.imageUrl) {
        resultUrl = data.data.output.imageUrl;
      } else if (data.data.output.url) {
        resultUrl = data.data.output.url;
      } else if (Array.isArray(data.data.output) && data.data.output.length > 0) {
        resultUrl = data.data.output[0];
      }

      if (resultUrl) {
        console.log(`[Coze工作流] ========== 彩绘提取成功 ==========`);
        console.log(`[Coze工作流] 提取图片URL: ${resultUrl.substring(0, 80)}...`);
        return {
          success: true,
          resultUrl: resultUrl,
        };
      }
    }

    // 如果没有找到结果URL，可能是异步模式或错误
    console.error(`[Coze工作流] 未能从响应中提取图片URL`);
    return {
      success: false,
      errorMsg: 'Coze工作流返回格式异常，未找到图片URL',
    };

  } catch (error: any) {
    console.error(`[Coze工作流] ========== 彩绘提取失败 ==========`);
    console.error(`[Coze工作流] 错误:`, error.message);

    // 检测是否为超时错误
    const isTimeout = error.message?.includes('超时') || error.name === 'AbortError';

    return {
      success: false,
      errorMsg: error.message || 'Coze工作流彩绘提取失败',
      isTimeout,
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
  console.log(`[Coze去除背景] API URL: ${COZE_REMOVE_BG_WORKFLOW_URL}`);
  console.log(`[Coze去除背景] Token前缀: ${COZE_REMOVE_BG_WORKFLOW_TOKEN.substring(0, 30)}...`);
  console.log(`[Coze去除背景] 图片URL: ${imageUrl.substring(0, 80)}...`);

  try {
    const requestBody = JSON.stringify({
      input_image: {
        url: imageUrl,
      },
    });
    console.log(`[Coze去除背景] 请求体: ${requestBody.substring(0, 200)}...`);

    const response = await fetchWithTimeout(
      COZE_REMOVE_BG_WORKFLOW_URL,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COZE_REMOVE_BG_WORKFLOW_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
      MAX_POLLING_TIME  // 使用10分钟超时
    );

    console.log(`[Coze去除背景] 响应状态: ${response.status} ${response.statusText}`);
    console.log(`[Coze去除背景] 响应头:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Coze去除背景] 提交任务失败:`, response.status);
      console.error(`[Coze去除背景] 错误响应体:`, errorText);
      console.error(`[Coze去除背景] 错误响应体长度:`, errorText.length);
      throw new Error(`Coze去除背景调用失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Coze去除背景] 响应数据:`, JSON.stringify(data, null, 2));

    // Coze工作流可能直接返回结果，也可能返回异步任务
    // 支持两种格式：
    // 1. 直接格式: { result_url: "...", removed_bg_url: "...", processed_image_url: "..." }
    // 2. 嵌套格式: { data: { output: { result_url: "...", removed_bg_url: "...", processed_image_url: "..." } } }

    // 先尝试直接格式
    if (data.result_url || data.removed_bg_url || data.processed_image_url) {
      const resultUrl = data.result_url;
      const removedBgUrl = data.removed_bg_url;
      const processedImageUrl = data.processed_image_url;

      // 如果至少有removedBgUrl，就认为成功
      if (removedBgUrl || processedImageUrl) {
        console.log(`[Coze去除背景] ========== 去除背景成功 ==========`);
        console.log(`[Coze去除背景] resultUrl: ${resultUrl ? resultUrl.substring(0, 80) : 'none'}...`);
        console.log(`[Coze去除背景] removedBgUrl: ${removedBgUrl ? removedBgUrl.substring(0, 80) : 'none'}...`);
        console.log(`[Coze去除背景] processedImageUrl: ${processedImageUrl ? processedImageUrl.substring(0, 80) : 'none'}...`);
        return {
          success: true,
          resultUrl,
          removedBgUrl,
          processedImageUrl,
        };
      }
    }

    // 再尝试嵌套格式
    if (data.data && data.data.output) {
      let resultUrl: string | undefined;
      let removedBgUrl: string | undefined;
      let processedImageUrl: string | undefined;

      // 提取三个URL字段
      if (data.data.output.result_url) {
        resultUrl = data.data.output.result_url;
      }
      if (data.data.output.removed_bg_url) {
        removedBgUrl = data.data.output.removed_bg_url;
      }
      if (data.data.output.processed_image_url) {
        processedImageUrl = data.data.output.processed_image_url;
      }

      if (removedBgUrl && processedImageUrl) {
        console.log(`[Coze去除背景] ========== 去除背景成功 ==========`);
        console.log(`[Coze去除背景] resultUrl: ${resultUrl ? resultUrl.substring(0, 80) : 'none'}...`);
        console.log(`[Coze去除背景] removedBgUrl: ${removedBgUrl.substring(0, 80)}...`);
        console.log(`[Coze去除背景] processedImageUrl: ${processedImageUrl.substring(0, 80)}...`);
        return {
          success: true,
          resultUrl,
          removedBgUrl,
          processedImageUrl,
        };
      }
    }

    // 如果没有找到结果URL，可能是异步模式或错误
    console.error(`[Coze去除背景] 未能从响应中提取图片URL`);
    return {
      success: false,
      errorMsg: 'Coze去除背景返回格式异常，未找到图片URL',
    };

  } catch (error: any) {
    console.error(`[Coze去除背景] ========== 去除背景失败 ==========`);
    console.error(`[Coze去除背景] 错误:`, error.message);

    // 检测是否为超时错误
    const isTimeout = error.message?.includes('超时') || error.name === 'AbortError';

    return {
      success: false,
      errorMsg: error.message || 'Coze去除背景失败',
      isTimeout,
    };
  }
}

/**
 * 提取彩绘（使用Coze工作流API）
 * @param imageUrl 图片URL
 * @param workflowStartTime 工作流开始时间
 * @returns 提取结果
 */
async function extractColorExtractionWithFallback(imageUrl: string, workflowStartTime: number): Promise<{ success: boolean; resultUrl?: string; errorMsg?: string; isTimeout?: boolean }> {
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
  } catch (error: any) {
    console.error(`[彩绘提取] ========== 彩绘提取异常 ==========`);
    console.error(`[彩绘提取] 异常:`, error.message);

    // 检测是否为超时错误
    const isTimeout = error.message?.includes('超时') || error.name === 'AbortError';

    return {
      success: false,
      errorMsg: error.message || '彩绘提取异常',
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
    const fileName = `cjkch_png/${orderId}.png`;
    const result = await uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');

    console.log(`[彩绘提取2工作流] ========== 图片已上传到对象存储 ==========`);
    console.log(`[彩绘提取2工作流] cozeUrl: ${result.substring(0, 80)}...`);

    return result;
  } catch (error: any) {
    console.error('[彩绘提取2工作流] 上传图片到对象存储失败:', error);
    throw new Error(`上传图片失败: ${error.message}`);
  }
}

/**
 * 使用RunningHub API进行分层，并生成PSD文件
 * @param extractionImageUrl 提取的图片URL（用于分层）
 * @param orderId 订单号
 * @param additionalImageUrl 额外图片URL（可选，将作为额外图层添加到PSD中）
 * @returns PSD文件的URL
 */
async function processRunningHubLayeringAndPsd(extractionImageUrl: string, orderId: string, additionalImageUrl?: string): Promise<{ psdUrl?: string; error?: string }> {
  console.log(`[RunningHub分层+PSD] ========== 开始RunningHub分层工作流 ==========`);
  console.log(`[RunningHub分层+PSD] 输入图片URL: ${extractionImageUrl.substring(0, 80)}...`);
  console.log(`[RunningHub分层+PSD] 订单号: ${orderId}`);

  try {
    // 步骤1: 下载提取图片并上传到对象存储（与彩绘提取1保持一致）
    console.log(`[RunningHub分层+PSD] 步骤1: 下载图片并上传到对象存储`);
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    console.log(`[RunningHub分层+PSD] 图片已上传: ${uploadedImageUrl.substring(0, 80)}...`);

    // 步骤2: 创建RunningHub分层任务（使用上传后的URL）
    console.log(`[RunningHub分层+PSD] 步骤2: 创建RunningHub分层任务`);
    const taskId = await createTask(uploadedImageUrl);
    console.log(`[RunningHub分层+PSD] 任务创建成功: ${taskId}`);

    // 步骤3: 轮询等待任务完成
    console.log(`[RunningHub分层+PSD] 步骤3: 轮询等待任务完成（最多9分钟）`);
    await waitForTaskComplete(taskId, 9);
    console.log(`[RunningHub分层+PSD] 任务完成: ${taskId}`);

    // 步骤4: 获取分层结果
    console.log(`[RunningHub分层+PSD] 步骤4: 获取分层结果`);
    const outputs = await getTaskOutputs(taskId);
    console.log(`[RunningHub分层+PSD] 获取到分层结果，数量: ${outputs.length}`);

    if (!outputs || outputs.length === 0) {
      throw new Error('RunningHub分层任务未返回任何结果');
    }

    // 提取PNG图片URL
    const layerUrls = outputs
      .filter((output: any) => output.fileType === 'png' && output.fileUrl)
      .map((output: any) => output.fileUrl);
    console.log(`[RunningHub分层+PSD] 提取到PNG图层数量: ${layerUrls.length}`);

    if (layerUrls.length === 0) {
      throw new Error('RunningHub分层任务未返回PNG图片');
    }

    // 如果有额外图片URL，将其添加到图层列表中
    if (additionalImageUrl) {
      console.log(`[RunningHub分层+PSD] 添加额外图层: ${additionalImageUrl.substring(0, 80)}...`);
      layerUrls.push(additionalImageUrl);
      console.log(`[RunningHub分层+PSD] 图层总数（含额外图层）: ${layerUrls.length}`);
    }

    // 步骤5: 合并图层为PSD文件
    console.log(`[RunningHub分层+PSD] 步骤5: 合并图层为PSD文件`);

    // 构建图层信息，标记额外图层
    const layerInfos: PsdLayerConfig[] = layerUrls.map((url, index) => {
      const isAdditional = index === layerUrls.length - 1 && additionalImageUrl;
      return {
        url,
        name: isAdditional ? '背景图（原图）' : `Layer ${index + 1}`,
        ...(isAdditional && { isBackground: true }),
      };
    });

    const psdBuffer = await mergeImagesToPsd(layerInfos);
    console.log(`[RunningHub分层+PSD] PSD文件生成成功，大小: ${psdBuffer.length} bytes`);

    // 步骤6: 上传PSD文件到对象存储
    console.log(`[RunningHub分层+PSD] 步骤6: 上传PSD文件到对象存储`);
    const fileName = `cjkch_PSD/${orderId}.psd`;
    const psdKey = await cozeStorage.uploadFile({
      fileContent: psdBuffer,
      fileName: fileName,
      contentType: 'application/octet-stream',
    });
    const psdUrl = await cozeStorage.generatePresignedUrl({
      key: psdKey,
      expireTime: 365 * 24 * 60 * 60, // 1年有效期
    });
    console.log(`[RunningHub分层+PSD] PSD上传成功: ${psdUrl.substring(0, 80)}...`);
    console.log(`[RunningHub分层+PSD] ========== RunningHub分层工作流完成 ==========`);

    return { psdUrl };
  } catch (error: any) {
    console.error(`[RunningHub分层+PSD] ========== RunningHub分层工作流失败 ==========`);
    console.error(`[RunningHub分层+PSD] 错误:`, error.message);
    return { error: error.message || 'RunningHub分层工作流失败' };
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
    console.log(`[彩绘提取2工作流] imageUrl: ${imageUrl.substring(0, 80)}...`);
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

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return NextResponse.json(
        { success: false, message: '图片URL格式不正确，必须为HTTP/HTTPS地址' },
        { status: 400 }
      );
    }

    userId = requestUserId;

    const finalPrompt = `专业提取手机壳表面的完整彩绘图案，执行以下强制要求：
1. 移除所有手机硬件元素（重点删除摄像头开孔及边框），仅保留彩绘图案本体；
2. 若原手机壳为透明材质，直接输出**完全透明底PNG图像（带alpha通道，无任何白色/灰色底色）**；若为非透明壳，保留图案原始背景；
3. 图像分辨率≥300 DPI，图案必须100%铺满整个画布，无留白、无缩放裁剪；
4. 严格保留原图所有细节：包括彩绘的纹理、笔触、渐变色彩层次、微小图案元素，边缘轮廓锐利无模糊、无锯齿、无像素化；
5. 色彩完全还原原图，无偏色、无饱和度损失，达到专业彩绘打印的精度标准；
6. 最终输出图像无水印、无噪点、无压缩失真，可直接用于喷绘制作。`;

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

    console.log(`[彩绘提取2工作流] 开始处理订单: ${finalOrderId}`);
    console.log(`[彩绘提取2工作流] 用户: ${userId}, 积分: ${currentPoints}`);
    console.log(`[彩绘提取2工作流] 图片URL: ${imageUrl.substring(0, 80)}...`);

    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: finalOrderId,
      toolPage: '彩绘提取',
      description: extractionMode === 'hollow' ? '手机壳彩绘提取（镂空图模式）' : '手机壳彩绘提取（全屏图模式）',
      prompt: finalPrompt,
      points: REQUIRED_POINTS,
      remainingPoints: currentPoints,
      resultData: null,
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
        extractionMode: extractionMode,
        actualExtractionMode: 'pending', // 后续更新
        workflow: extractionMode === 'hollow'
          ? '彩绘提取2完整工作流（Coze去除背景API + RunningHub API分层）'
          : '彩绘提取2完整工作流（Coze工作流API彩绘提取 + RunningHub API分层）',
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
    let extractionResult: any;
    let actualExtractionMode = extractionMode; // 记录实际使用的模式
    
    if (extractionMode === 'hollow') {
      console.log(`[彩绘提取2工作流] 使用镂空图模式（去除背景API）`);
      extractionResult = await submitCozeRemoveBgWorkflowTask(imageUrl);
      
      // 如果镂空图模式失败，自动降级到全屏图模式
      if (!extractionResult.success) {
        console.warn(`[彩绘提取2工作流] ========== 镂空图模式失败，自动降级到全屏图模式 ==========`);
        console.warn(`[彩绘提取2工作流] 失败原因: ${extractionResult.errorMsg}`);
        actualExtractionMode = 'full';
        extractionResult = await extractColorExtractionWithFallback(imageUrl, workflowStartTime);
      }
    } else {
      console.log(`[彩绘提取2工作流] 使用全屏图模式（彩绘提取API）`);
      extractionResult = await extractColorExtractionWithFallback(imageUrl, workflowStartTime);
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

      // 步骤1.5: 下载图片并上传到对象存储
      console.log('[彩绘提取2工作流] 步骤1.5: 下载生成的图片并上传到对象存储');
      const fileName = `cjkch_result/${finalOrderId}.png`;
      const dualStorageResult = await uploadFromUrlToCozeStorage(extractionImageUrl, fileName, 'image/png');
      console.log(`[彩绘提取2工作流] 提取图片已保存到对象存储: ${dualStorageResult.substring(0, 80)}...`);

      // 使用对象存储的URL替换原始URL
      extractionImageUrl = dualStorageResult;

      // 如果是镂空图模式，也需要将额外图层保存到双存储
      if (actualExtractionMode === 'hollow' && processingImageUrl) {
        const additionalFileName = `cjkch_result/${finalOrderId}_additional.png`;
        const additionalStorageResult = await uploadFromUrlToCozeStorage(processingImageUrl, additionalFileName, 'image/png');
        console.log(`[彩绘提取2工作流] 额外图层已保存到对象存储: ${additionalStorageResult.substring(0, 80)}...`);

        // 使用对象存储的URL替换原始URL
        processingImageUrl = additionalStorageResult;
      }
    } else {
      errorMsg = extractionResult.errorMsg || '彩绘提取失败';
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
        let requestParams: any = {};
        try {
          requestParams = JSON.parse(currentTransaction.requestParams || '{}');
        } catch (e) {
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
        } catch (error: any) {
          console.error(`[后台任务] ========== 后台任务异常 ==========`);
          console.error(`[后台任务] 异常:`, error.message);
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
        message: `彩绘提取${status}`,
        debug: {
          error: errorMsg,
        },
      });
    }

  } catch (error: any) {
    console.error('[彩绘提取2工作流] ========== 工作流异常 ==========');
    console.error('[彩绘提取2工作流] 异常:', error);

    if (finalOrderId) {
      await transactionManager.updateTransaction(finalOrderId, {
        status: '失败',
        resultData: JSON.stringify({
          error: error.message || '工作流异常',
        }),
        actualPoints: 0, // 异常失败时不扣积分
      });
    }

    return NextResponse.json(
      {
        success: false,
        message: '服务器内部错误',
        debug: {
          error: error.message,
        },
      },
      { status: 500 }
    );
  }
}
