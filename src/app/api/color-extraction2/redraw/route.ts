import { NextRequest, NextResponse } from 'next/server';
import { transactionManager, userManager } from '@/storage/database';
import { S3Storage } from 'coze-coding-dev-sdk';
import {
  createTask,
  waitForTaskComplete,
  getTaskOutputs,
} from '@/lib/runningHub';
import { mergeImagesToPsd, PsdLayerConfig } from '@/lib/psdMerge';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';

// Coze工作流API配置（局部重绘）
const REDRAW_WORKFLOW_URL = 'https://frzr6k4qcc.coze.site/run';
const REDRAW_WORKFLOW_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkOGYxNGZiLTM3M2MtNDRjMS1hZTJjLTcxMmRkMDk3OWFiYyJ9.eyJpc3MiOiJodHRwczovL2FwaS5jb3plLmNuIiwiYXVkIjpbIjE0Sm9lYVpCZkJmaXEzUHRQbWQ5QUlIMm5wbDJSV3RmIl0sImV4cCI6ODIxMDI2Njg3Njc5OSwiaWF0IjoxNzc2MjU5NzQ0LCJzdWIiOiJzcGlmZmU6Ly9hcGkuY296ZS5jbi93b3JrbG9hZF9pZGVudGl0eS9pZDo3NjI4OTE4NjY5NzgyODEwNjcwIiwic3JjIjoiaW5ib3VuZF9hdXRoX2FjY2Vzc190b2tlbl9pZDo3NjI4OTc3NTEzNzcwNzc4NjYwIn0.s5Y1qtl40GwKdVIkFEmYVyc_cpbzem4i1rxpHOfQQUpoeITkCZxSUIT-wz4l1GFBpVHWF4E5ktwZkkfddCt3Ft3cNJfXUql7SL5oZJyVYS0qkkp6gGnhvIykUaQnYrPB9XmOPeQsQumY8GmXLOixx1AQM5wxzlFjYlwibCAndLB-4O2Y4NEsJ571dBiF9cyF2eROVeNBXyhBLA7y9q_tXkAP2cukEDjfdhBTYDrILRMWz53zlVbKD0SYhDUM7xgDJYys3xPkv-VqjHLDrqt7drTyhoJ0GBvRpK_LnX-206KJScSHDQ27eWBuiykaEk3O2U2HrMV33Zrm_9daRClAdA';

// 初始化Coze对象存储（用于PSD文件上传）
const cozeStorage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: process.env.COZE_ACCESS_KEY,
  secretKey: process.env.COZE_SECRET_KEY,
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 超时配置
const FETCH_TIMEOUT = 600000; // 10分钟

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
      throw new Error(`请求超时（${timeout}ms）`);
    }
    throw error;
  }
}

/**
 * 下载提取图片并上传到对象存储
 */
async function uploadImageToStorage(imageUrl: string, orderId: string): Promise<string> {
  console.log(`[局部重绘-上传] 开始上传图片到对象存储，源URL: ${imageUrl.substring(0, 80)}...`);
  const fileName = `cjkch_png/${orderId}.png`;
  const result = await uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');
  console.log(`[局部重绘-上传] 图片已上传: ${result.substring(0, 80)}...`);
  return result;
}

/**
 * RunningHub分层 + PSD生成
 */
async function processRunningHubLayeringAndPsd(extractionImageUrl: string, orderId: string): Promise<{ psdUrl?: string; error?: string }> {
  console.log(`[局部重绘-PSD] ========== 开始RunningHub分层工作流 ==========`);
  console.log(`[局部重绘-PSD] 输入图片URL: ${extractionImageUrl.substring(0, 80)}...`);
  console.log(`[局部重绘-PSD] 订单号: ${orderId}`);

  try {
    // 步骤1: 下载提取图片并上传到对象存储
    console.log(`[局部重绘-PSD] 步骤1: 下载图片并上传到对象存储`);
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    console.log(`[局部重绘-PSD] 图片已上传: ${uploadedImageUrl.substring(0, 80)}...`);

    // 步骤2: 创建RunningHub分层任务
    console.log(`[局部重绘-PSD] 步骤2: 创建RunningHub分层任务`);
    const taskId = await createTask(uploadedImageUrl);
    console.log(`[局部重绘-PSD] 任务创建成功: ${taskId}`);

    // 步骤3: 轮询等待任务完成
    console.log(`[局部重绘-PSD] 步骤3: 轮询等待任务完成`);
    await waitForTaskComplete(taskId, 9);
    console.log(`[局部重绘-PSD] 任务完成: ${taskId}`);

    // 步骤4: 获取分层结果
    console.log(`[局部重绘-PSD] 步骤4: 获取分层结果`);
    const outputs = await getTaskOutputs(taskId);
    console.log(`[局部重绘-PSD] 获取到分层结果，数量: ${outputs.length}`);

    if (!outputs || outputs.length === 0) {
      throw new Error('RunningHub分层任务未返回任何结果');
    }

    // 提取PNG图片URL
    const layerUrls = outputs
      .filter((output: any) => output.fileType === 'png' && output.fileUrl)
      .map((output: any) => output.fileUrl);
    console.log(`[局部重绘-PSD] 提取到PNG图层数量: ${layerUrls.length}`);

    if (layerUrls.length === 0) {
      throw new Error('RunningHub分层任务未返回PNG图片');
    }

    // 步骤5: 合并图层为PSD文件
    console.log(`[局部重绘-PSD] 步骤5: 合并图层为PSD文件`);
    const layerInfos: PsdLayerConfig[] = layerUrls.map((url, index) => ({
      url,
      name: `Layer ${index + 1}`,
    }));

    const psdBuffer = await mergeImagesToPsd(layerInfos);
    console.log(`[局部重绘-PSD] PSD文件生成成功，大小: ${psdBuffer.length} bytes`);

    // 步骤6: 上传PSD文件到对象存储
    console.log(`[局部重绘-PSD] 步骤6: 上传PSD文件到对象存储`);
    const psdFileName = `cjkch_PSD/${orderId}.psd`;
    const psdKey = await cozeStorage.uploadFile({
      fileContent: psdBuffer,
      fileName: psdFileName,
      contentType: 'application/octet-stream',
    });
    const psdUrl = await cozeStorage.generatePresignedUrl({
      key: psdKey,
      expireTime: 365 * 24 * 60 * 60,
    });
    console.log(`[局部重绘-PSD] PSD上传成功: ${psdUrl.substring(0, 80)}...`);
    console.log(`[局部重绘-PSD] ========== RunningHub分层工作流完成 ==========`);

    return { psdUrl };
  } catch (error: any) {
    console.error(`[局部重绘-PSD] ========== 分层工作流失败 ==========`);
    console.error(`[局部重绘-PSD] 错误:`, error.message);
    return { error: error.message || '分层工作流失败' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, originalImageUrl, maskImageBase64, prompt, description } = body;

    // 验证参数
    if (!userId || !originalImageUrl || !maskImageBase64) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 检查用户积分（局部重绘也消耗积分）
    const REQUIRED_POINTS = 30;
    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    if ((user.points || 0) < REQUIRED_POINTS) {
      return NextResponse.json(
        { success: false, error: `积分不足，当前积分：${user.points}，需要：${REQUIRED_POINTS}` },
        { status: 400 }
      );
    }

    // 生成订单号
    const orderNumber = `RD${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // 上传 mask 图片到对象存储
    console.log('[局部重绘] 上传 mask 遮罩图到对象存储');
    const maskBuffer = Buffer.from(maskImageBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    const maskFileName = `cjkch_mask/${orderNumber}_mask.png`;
    const maskKey = await cozeStorage.uploadFile({
      fileContent: maskBuffer,
      fileName: maskFileName,
      contentType: 'image/png',
    });
    const maskImageUrl = await cozeStorage.generatePresignedUrl({
      key: maskKey,
      expireTime: 365 * 24 * 60 * 60,
    });
    console.log(`[局部重绘] mask 遮罩图已上传: ${maskImageUrl.substring(0, 80)}...`);

    // 组合指令
    let combinedInstruction = prompt || '局部调整优化';

    console.log('[局部重绘] ========== 开始处理 ==========');
    console.log('[局部重绘] 订单号:', orderNumber);
    console.log('[局部重绘] 用户ID:', userId);
    console.log('[局部重绘] 原图URL:', originalImageUrl.substring(0, 80) + '...');
    console.log('[局部重绘] mask图片URL:', maskImageUrl.substring(0, 80) + '...');
    console.log('[局部重绘] 组合指令:', combinedInstruction);

    // 调用重绘API - 传入原图 + mask遮罩图 + 指令
    const response = await fetchWithTimeout(
      REDRAW_WORKFLOW_URL,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REDRAW_WORKFLOW_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input_image: {
            url: originalImageUrl,
          },
          mask_image: {
            url: maskImageUrl,
          },
          instruction: combinedInstruction,
        }),
      },
      FETCH_TIMEOUT
    );

    console.log('[局部重绘] API响应状态:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[局部重绘] API调用失败:', errorText);
      throw new Error(`重绘API调用失败: ${response.status}`);
    }

    const data = await response.json();
    console.log('[局部重绘] API响应数据:', JSON.stringify(data, null, 2));

    // 提取结果图片URL
    let resultUrl: string | undefined;

    if (data.result_url) {
      resultUrl = data.result_url;
    } else if (data.data?.output?.image_url) {
      resultUrl = data.data.output.image_url;
    } else if (data.data?.output?.imageUrl) {
      resultUrl = data.data.output.imageUrl;
    } else if (data.data?.output?.url) {
      resultUrl = data.data.output.url;
    } else if (data.data?.output) {
      resultUrl = String(data.data.output);
    }

    if (!resultUrl) {
      console.error('[局部重绘] 未找到结果图片URL');
      throw new Error('重绘处理未返回结果图片');
    }

    // 扣除积分
    await userManager.deductPointsAtomically(userId, REQUIRED_POINTS);

    // 上传提取结果到对象存储
    console.log('[局部重绘] 下载生成的图片并上传到对象存储');
    const storageFileName = `cjkch_result/${orderNumber}.png`;
    const storageUrl = await uploadFromUrlToCozeStorage(resultUrl, storageFileName, 'image/png');
    console.log(`[局部重绘] 提取图片已保存到对象存储: ${storageUrl.substring(0, 80)}...`);

    // 创建交易记录
    await transactionManager.createTransaction({
      userId,
      orderNumber,
      toolPage: '彩绘提取',
      description: description || `局部重绘: ${combinedInstruction.substring(0, 50)}`,
      points: REQUIRED_POINTS,
      actualPoints: REQUIRED_POINTS,
      remainingPoints: (user.points || 0) - REQUIRED_POINTS,
      status: '成功',
      prompt: combinedInstruction,
      resultData: storageUrl,
      uploadedImage: originalImageUrl,
    });

    console.log('[局部重绘] ========== 提取完成，PSD后台生成中 ==========');

    // 后台异步处理分层和PSD生成
    (async () => {
      try {
        console.log(`[局部重绘-后台] ========== 开始PSD生成 ==========`);
        console.log(`[局部重绘-后台] 订单号: ${orderNumber}`);

        const psdResult = await processRunningHubLayeringAndPsd(storageUrl, orderNumber);

        if (psdResult.psdUrl) {
          console.log(`[局部重绘-后台] ========== PSD生成成功 ==========`);
          console.log(`[局部重绘-后台] PSD文件URL: ${psdResult.psdUrl.substring(0, 80)}...`);

          await transactionManager.updateTransaction(orderNumber, {
            psdUrl: psdResult.psdUrl,
          });

          console.log(`[局部重绘-后台] 订单 ${orderNumber} PSD已更新`);
        } else {
          console.error(`[局部重绘-后台] PSD生成失败:`, psdResult.error);
          console.warn(`[局部重绘-后台] PSD生成失败但重绘成功，保持订单状态不变`);
        }
      } catch (error: any) {
        console.error(`[局部重绘-后台] 后台PSD任务异常:`, error.message);
      }
    })();

    return NextResponse.json({
      success: true,
      data: {
        orderNumber,
        resultUrl: storageUrl,
        remainingPoints: (user.points || 0) - REQUIRED_POINTS,
      },
    });

  } catch (error: any) {
    console.error('[局部重绘] ========== 处理失败 ==========');
    console.error('[局部重绘] 错误:', error.message);

    return NextResponse.json(
      { success: false, error: error.message || '局部重绘处理失败' },
      { status: 500 }
    );
  }
}
