import { NextRequest, NextResponse } from 'next/server';
import { userManager, transactionManager } from '@/storage/database';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';
import {
  createWatermarkRemovalTask,
  waitForTaskComplete,
  getTaskOutputs,
} from '@/lib/runningHubWatermark';

interface WatermarkRemovalRequest {
  userId: string;
  imageUrl: string;
}

type WatermarkTaskOutput = {
  fileUrl: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

// 每次去水印消耗的积分（免费功能）
const REQUIRED_POINTS = 0;

/**
 * 去除水印API - 使用RunningHub工作流
 * 1. 检查用户积分
 * 2. 创建订单记录
 * 3. 创建RunningHub任务
 * 4. 轮询查询任务状态，直到成功
 * 5. 获取任务输出结果
 * 6. 上传到双存储
 * 7. 更新订单状态
 * 8. 扣除积分
 */
export async function POST(request: NextRequest) {
  console.log('[去水印] ========== 开始处理请求（RunningHub工作流） ==========');
  const startTime = Date.now();

  try {
    const body: WatermarkRemovalRequest = await request.json();
    const { userId, imageUrl } = body;

    console.log('[去水印] ========== 请求参数 ==========');
    console.log('[去水印] userId:', userId);
    console.log('[去水印] imageUrl:', imageUrl ? imageUrl.substring(0, 50) + '...' : 'none');

    // 验证参数
    if (!userId || !imageUrl) {
      console.error('[去水印] ========== 错误：缺少必要参数 ==========');
      return NextResponse.json(
        {
          success: false,
          message: '缺少必要参数',
        },
        { status: 400 }
      );
    }

    // 查询用户信息
    console.log('[去水印] 查询用户信息，userId:', userId);
    const user = await userManager.getUserById(userId);

    if (!user) {
      console.error('[去水印] 用户不存在，userId:', userId);
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    const currentPoints = user.points || 0;

    // 生成订单号
    const orderId = `RW-${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    console.log('[去水印] 生成订单号:', orderId);

    // 创建"处理中"订单记录
    console.log('[去水印] 创建处理中订单...');
    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: orderId,
      toolPage: '去除水印',
      description: '去除图片水印',
      points: REQUIRED_POINTS,
      remainingPoints: currentPoints,
      resultData: '',
      uploadedImage: imageUrl, // 【新增】保存原图URL
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
      }),
      status: '处理中',
    });

    console.log('[去水印] 去水印任务开始处理...');

    // 步骤1: 创建RunningHub任务
    console.log('[去水印] 步骤1: 创建RunningHub去水印任务');
    let taskId: string;
    try {
      taskId = await createWatermarkRemovalTask(imageUrl);
      console.log('[去水印] 任务创建成功:', taskId);
    } catch (error: unknown) {
      console.error('[去水印] 创建任务失败:', error);

      // 更新订单状态为失败
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: '',
      });

      return NextResponse.json(
        {
          success: false,
          message: '创建去水印任务失败，请稍后重试',
        },
        { status: 500 }
      );
    }

    // 步骤2: 等待任务完成
    console.log('[去水印] 步骤2: 等待任务完成');
    try {
      await waitForTaskComplete(taskId, 9); // 最多等待9分钟
    } catch (error: unknown) {
      console.error('[去水印] 等待任务完成失败:', error);

      // 更新订单状态为失败
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: '',
      });

      return NextResponse.json(
        {
          success: false,
          message: '去水印任务执行失败，请重试',
        },
        { status: 500 }
      );
    }

    // 步骤3: 获取任务输出结果
    console.log('[去水印] 步骤3: 获取任务输出结果');
    let outputs: WatermarkTaskOutput[];
    try {
      outputs = await getTaskOutputs(taskId);
      console.log('[去水印] 获取到输出结果数量:', outputs.length);

      if (outputs.length === 0) {
        throw new Error('去水印任务未返回任何结果');
      }

      // 获取第一个结果
      const firstOutput = outputs[0];
      const resultUrl = firstOutput.fileUrl;
      console.log('[去水印] 结果URL:', resultUrl.substring(0, 80) + '...');

      // 步骤4: 上传到对象存储
      console.log('[去水印] 步骤4: 上传到对象存储');
      const storageResult = await uploadFromUrlToCozeStorage(resultUrl, `watermark/${orderId}.png`, 'image/png');
      console.log('[去水印] 图片已上传到对象存储');

      // 步骤5: 扣除积分
      const updatedUser = await userManager.deductPointsAtomically(userId, REQUIRED_POINTS);

      if (!updatedUser) {
        throw new Error('积分不足，无法完成扣费');
      }

      console.log('[去水印] 用户积分已更新:', currentPoints, '->', updatedUser.points);

      // 步骤6: 更新订单状态为成功
      console.log('[去水印] 步骤6: 更新订单状态为成功');
      await transactionManager.updateTransaction(orderId, {
        status: '成功',
        resultData: storageResult,
      });

      console.log('[去水印] ========== 订单完成 ==========');
      console.log('[去水印] 耗时:', ((Date.now() - startTime) / 1000).toFixed(1), '秒');

      return NextResponse.json({
        success: true,
        message: '去水印成功',
        data: {
          orderId,
          resultUrl: storageResult,
        },
      });
    } catch (error: unknown) {
      console.error('[去水印] 处理输出结果失败:', error);

      // 更新订单状态为失败
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: '',
      });

      return NextResponse.json(
        {
          success: false,
          message: '获取去水印结果失败',
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('[去水印] ========== 处理请求异常 ==========', error);
    return NextResponse.json(
      {
        success: false,
        message: `去水印失败: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
