import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database/userManager';
import { transactionManager } from '@/storage/database/transactionManager';
import {
  createTask,
  waitForTaskComplete,
  getTaskOutputs,
} from '@/lib/runningHub';
import { mergeImagesToPsd, PsdLayerConfig } from '@/lib/psdMerge';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';
import { S3Storage } from 'coze-coding-dev-sdk';

function generateOrderNumber(): string {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `CG${timestamp}${random}`;
}

// Coze工作流API配置
const COZE_WORKFLOW_URL = 'https://frzr6k4qcc.coze.site/run';
const COZE_WORKFLOW_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkOGYxNGZiLTM3M2MtNDRjMS1hZTJjLTcxMmRkMDk3OWFiYyJ9.eyJpc3MiOiJodHRwczovL2FwaS5jb3plLmNuIiwiYXVkIjpbIjE0Sm9lYVpCZkJmaXEzUHRQbWQ5QUlIMm5wbDJSV3RmIl0sImV4cCI6ODIxMDI2Njg3Njc5OSwiaWF0IjoxNzc2MjU5NzQ0LCJzdWIiOiJzcGlmZmU6Ly9hcGkuY296ZS5jbi93b3JrbG9hZF9pZGVudGl0eS9pZDo3NjI4OTE4NjY5NzgyODEwNjcwIiwic3JjIjoiaW5ib3VuZF9hdXRoX2FjY2Vzc190b2tlbl9pZDo3NjI4OTc3NTEzNzcwNzc4NjYwIn0.s5Y1qtl40GwKdVIkFEmYVyc_cpbzem4i1rxpHOfQQUpoeITkCZxSUIT-wz4l1GFBpVHWF4E5ktwZkkfddCt3Ft3cNJfXUql7SL5oZJyVYS0qkkp6gGnhvIykUaQnYrPB9XmOPeQsQumY8GmXLOixx1AQM5wxzlFjYlwibCAndLB-4O2Y4NEsJ571dBiF9cyF2eROVeNBXyhBLA7y9q_tXkAP2cukEDjfdhBTYDrILRMWz53zlVbKD0SYhDUM7xgDJYys3xPkv-VqjHLDrqt7drTyhoJ0GBvRpK_LnX-206KJScSHDQ27eWBuiykaEk3O2U2HrMV33Zrm_9daRClAdA';

// 初始化Coze对象存储（用于PSD文件上传）
const cozeStorage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: process.env.COZE_ACCESS_KEY,
  secretKey: process.env.COZE_SECRET_KEY,
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

const MAX_POLLING_TIME = 600000;

/**
 * 下载提取图片并上传到对象存储
 */
async function uploadImageToStorage(imageUrl: string, orderId: string): Promise<string> {
  console.log(`[重新生成-上传] 开始上传图片到对象存储，源URL: ${imageUrl.substring(0, 80)}...`);
  const fileName = `cjkch_png/${orderId}.png`;
  const result = await uploadFromUrlToCozeStorage(imageUrl, fileName, 'image/png');
  console.log(`[重新生成-上传] 图片已上传: ${result.substring(0, 80)}...`);
  return result;
}

/**
 * RunningHub分层 + PSD生成
 */
async function processRunningHubLayeringAndPsd(extractionImageUrl: string, orderId: string): Promise<{ psdUrl?: string; error?: string }> {
  console.log(`[重新生成-PSD] ========== 开始RunningHub分层工作流 ==========`);
  console.log(`[重新生成-PSD] 输入图片URL: ${extractionImageUrl.substring(0, 80)}...`);
  console.log(`[重新生成-PSD] 订单号: ${orderId}`);

  try {
    // 步骤1: 下载提取图片并上传到对象存储
    console.log(`[重新生成-PSD] 步骤1: 下载图片并上传到对象存储`);
    const uploadedImageUrl = await uploadImageToStorage(extractionImageUrl, orderId);
    console.log(`[重新生成-PSD] 图片已上传: ${uploadedImageUrl.substring(0, 80)}...`);

    // 步骤2: 创建RunningHub分层任务
    console.log(`[重新生成-PSD] 步骤2: 创建RunningHub分层任务`);
    const taskId = await createTask(uploadedImageUrl);
    console.log(`[重新生成-PSD] 任务创建成功: ${taskId}`);

    // 步骤3: 轮询等待任务完成
    console.log(`[重新生成-PSD] 步骤3: 轮询等待任务完成`);
    await waitForTaskComplete(taskId, 9);
    console.log(`[重新生成-PSD] 任务完成: ${taskId}`);

    // 步骤4: 获取分层结果
    console.log(`[重新生成-PSD] 步骤4: 获取分层结果`);
    const outputs = await getTaskOutputs(taskId);
    console.log(`[重新生成-PSD] 获取到分层结果，数量: ${outputs.length}`);

    if (!outputs || outputs.length === 0) {
      throw new Error('RunningHub分层任务未返回任何结果');
    }

    // 提取PNG图片URL
    const layerUrls = outputs
      .filter((output: any) => output.fileType === 'png' && output.fileUrl)
      .map((output: any) => output.fileUrl);
    console.log(`[重新生成-PSD] 提取到PNG图层数量: ${layerUrls.length}`);

    if (layerUrls.length === 0) {
      throw new Error('RunningHub分层任务未返回PNG图片');
    }

    // 步骤5: 合并图层为PSD文件
    console.log(`[重新生成-PSD] 步骤5: 合并图层为PSD文件`);
    const layerInfos: PsdLayerConfig[] = layerUrls.map((url, index) => ({
      url,
      name: `Layer ${index + 1}`,
    }));

    const psdBuffer = await mergeImagesToPsd(layerInfos);
    console.log(`[重新生成-PSD] PSD文件生成成功，大小: ${psdBuffer.length} bytes`);

    // 步骤6: 上传PSD文件到对象存储
    console.log(`[重新生成-PSD] 步骤6: 上传PSD文件到对象存储`);
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
    console.log(`[重新生成-PSD] PSD上传成功: ${psdUrl.substring(0, 80)}...`);
    console.log(`[重新生成-PSD] ========== RunningHub分层工作流完成 ==========`);

    return { psdUrl };
  } catch (error: any) {
    console.error(`[重新生成-PSD] ========== 分层工作流失败 ==========`);
    console.error(`[重新生成-PSD] 错误:`, error.message);
    return { error: error.message || '分层工作流失败' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, originalImageUrl } = body;

    if (!userId || !originalImageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 获取用户信息
    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    // 检查积分
    const pointsCost = 30;
    if ((user.points || 0) < pointsCost) {
      return NextResponse.json(
        { success: false, error: `积分不足，需要${pointsCost}积分，当前剩余${user.points || 0}积分` },
        { status: 400 }
      );
    }

    // 生成新的订单号
    const newOrderNumber = generateOrderNumber();
    const currentPoints = user.points || 0;

    // 创建新订单（处理中状态）
    await transactionManager.createTransaction({
      userId,
      orderNumber: newOrderNumber,
      toolPage: '彩绘提取',
      description: '手机壳彩绘提取（重新生成）',
      prompt: '',
      points: pointsCost,
      remainingPoints: currentPoints - pointsCost,
      resultData: null,
      requestParams: JSON.stringify({
        imageUrl: originalImageUrl,
        type: 'regenerate',
      }),
      status: '处理中',
    });

    // 扣除积分
    await userManager.deductPointsAtomically(userId, pointsCost);

    // 异步调用Coze工作流（不阻塞响应）
    const workflowPromise = (async () => {
      try {
        console.log(`[重新生成] 开始调用Coze工作流，订单号: ${newOrderNumber}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), MAX_POLLING_TIME);

        const response = await fetch(COZE_WORKFLOW_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${COZE_WORKFLOW_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input_image: {
              url: originalImageUrl,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Coze工作流调用失败: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[重新生成] Coze工作流响应:`, JSON.stringify(data).substring(0, 200));

        // 提取结果URL
        let resultUrl: string | undefined;

        if (data.result_url) {
          resultUrl = data.result_url;
        } else if (data.data && data.data.output) {
          if (data.data.output.image_url) {
            resultUrl = data.data.output.image_url;
          } else if (data.data.output.imageUrl) {
            resultUrl = data.data.output.imageUrl;
          } else if (data.data.output.url) {
            resultUrl = data.data.output.url;
          } else if (Array.isArray(data.data.output) && data.data.output.length > 0) {
            resultUrl = data.data.output[0];
          }
        }

        if (resultUrl) {
          // 上传提取结果到对象存储
          console.log('[重新生成] 步骤1.5: 下载生成的图片并上传到对象存储');
          const storageFileName = `cjkch_result/${newOrderNumber}.png`;
          const storageUrl = await uploadFromUrlToCozeStorage(resultUrl, storageFileName, 'image/png');
          console.log(`[重新生成] 提取图片已保存到对象存储: ${storageUrl.substring(0, 80)}...`);

          // 更新订单为成功
          await transactionManager.updateTransaction(newOrderNumber, {
            status: '成功',
            resultData: storageUrl,
            uploadedImage: originalImageUrl,
            actualPoints: 30,
          });
          console.log(`[重新生成] 订单 ${newOrderNumber} 提取成功`);

          // 后台异步处理分层和PSD生成
          (async () => {
            try {
              console.log(`[重新生成-后台] ========== 开始PSD生成 ==========`);
              console.log(`[重新生成-后台] 订单号: ${newOrderNumber}`);

              const psdResult = await processRunningHubLayeringAndPsd(storageUrl, newOrderNumber);

              if (psdResult.psdUrl) {
                console.log(`[重新生成-后台] ========== PSD生成成功 ==========`);
                console.log(`[重新生成-后台] PSD文件URL: ${psdResult.psdUrl.substring(0, 80)}...`);

                await transactionManager.updateTransaction(newOrderNumber, {
                  psdUrl: psdResult.psdUrl,
                });

                console.log(`[重新生成-后台] 订单 ${newOrderNumber} PSD已更新`);
              } else {
                console.error(`[重新生成-后台] PSD生成失败:`, psdResult.error);
                console.warn(`[重新生成-后台] PSD生成失败但提取成功，保持订单状态不变`);
              }
            } catch (error: any) {
              console.error(`[重新生成-后台] 后台PSD任务异常:`, error.message);
            }
          })();

        } else {
          // 更新订单为失败，退还积分
          await userManager.addPointsAtomically(userId, pointsCost);
          await transactionManager.updateTransaction(newOrderNumber, {
            status: '失败',
            actualPoints: 0,
          });
          console.error(`[重新生成] 订单 ${newOrderNumber} 失败：未找到结果URL，已退还积分`);
        }
      } catch (error: any) {
        console.error(`[重新生成] 工作流调用失败:`, error.message);
        // 退还积分
        await userManager.addPointsAtomically(userId, pointsCost);
        await transactionManager.updateTransaction(newOrderNumber, {
          status: '失败',
          actualPoints: 0,
        });
      }
    })();

    // 不等待工作流完成，直接返回
    workflowPromise.catch(() => {});

    return NextResponse.json({
      success: true,
      message: '重新生成请求已提交，请稍后刷新查看结果',
      orderNumber: newOrderNumber,
    });

  } catch (error) {
    console.error('重新生成失败:', error);
    return NextResponse.json(
      { success: false, error: '重新生成失败，请重试' },
      { status: 500 }
    );
  }
}
