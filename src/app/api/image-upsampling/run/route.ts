import { NextRequest, NextResponse } from 'next/server';
import { userManager, transactionManager } from '@/storage/database';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';
import {
  createUpsamplingTask,
  waitForUpsamplingTaskComplete,
} from '@/lib/runningHubWatermark';

interface ImageUpsamplingRequest {
  userId: string;
  imageUrl: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '高清放大处理失败，请重试';
}

/**
 * 高清放大API - 使用RunningHub（限时免费）
 * 1. 创建订单记录
 * 2. 下载图片
 * 3. 创建高清放大任务（直接使用对象存储URL）
 * 4. 轮询查询任务状态，直到成功
 * 5. 上传到双存储
 * 6. 更新订单状态
 */
export async function POST(request: NextRequest) {
  console.log('[高清放大] ========== 开始处理请求 ==========');
  const startTime = Date.now();

  try {
    const body: ImageUpsamplingRequest = await request.json();
    const { userId, imageUrl } = body;

    console.log('[高清放大] ========== 请求参数 ==========');
    console.log('[高清放大] userId:', userId);
    console.log('[高清放大] imageUrl:', imageUrl ? imageUrl.substring(0, 50) + '...' : 'none');

    // 验证参数
    if (!userId || !imageUrl) {
      console.error('[高清放大] ========== 错误：缺少必要参数 ==========');
      return NextResponse.json(
        {
          success: false,
          message: '缺少必要参数',
        },
        { status: 400 }
      );
    }

    // 查询用户信息
    console.log('[高清放大] 查询用户信息，userId:', userId);
    const user = await userManager.getUserById(userId);

    if (!user) {
      console.error('[高清放大] 用户不存在，userId:', userId);
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    const currentPoints = user.points || 0;

    // 生成订单号
    const orderId = `HD-${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    console.log('[高清放大] 生成订单号:', orderId);

    // 创建"处理中"订单记录
    console.log('[高清放大] 创建处理中订单...');
    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: orderId,
      toolPage: '高清放大',
      description: '高清放大图片（限时免费）',
      points: 0, // 限时免费，不扣除积分
      remainingPoints: currentPoints,
      resultData: '',
      uploadedImage: imageUrl, // 【新增】保存原图URL
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
      }),
      status: '处理中',
    });

    console.log('[高清放大] 高清放大任务开始处理...');

    // 步骤1: 创建高清放大任务（直接使用对象存储URL，不需要上传到RunningHub）
    console.log('[高清放大] 步骤1: 创建高清放大任务');
    let taskId: string;
    try {
      taskId = await createUpsamplingTask(imageUrl);
      console.log('[高清放大] 任务创建成功:', taskId);
    } catch (error: unknown) {
      console.error('[高清放大] 创建任务失败:', error);
      
      // 更新订单状态为失败
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: '',
      });
      
      return NextResponse.json(
        {
          success: false,
          message: '创建高清放大任务失败，请稍后重试',
        },
        { status: 500 }
      );
    }

    // 步骤2: 等待任务完成
    console.log('[高清放大] 步骤2: 等待任务完成');
    let resultUrl: string;
    try {
      resultUrl = await waitForUpsamplingTaskComplete(taskId, 5); // 最多等待5分钟
      console.log('[高清放大] 任务完成，结果URL:', resultUrl.substring(0, 80) + '...');
    } catch (error: unknown) {
      console.error('[高清放大] 等待任务完成失败:', error);
      
      // 更新订单状态为失败，返还积分
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: '',
      });
      
      return NextResponse.json(
        {
          success: false,
          message: '高清放大任务执行失败，请重试',
        },
        { status: 500 }
      );
    }

    // 步骤3: 上传到对象存储
    console.log('[高清放大] 步骤3: 上传到对象存储');
    const storageResult = await uploadFromUrlToCozeStorage(resultUrl, `upsampling/${orderId}.png`, 'image/png');
    console.log('[高清放大] 图片已上传到对象存储');

    // 步骤4: 更新订单状态为成功（限时免费，不扣除积分）
    console.log('[高清放大] 步骤4: 更新订单状态为成功');
    await transactionManager.updateTransaction(orderId, {
      status: '成功',
      resultData: storageResult,
      requestParams: JSON.stringify({
        imageUrl: imageUrl,
      }),
    });

    console.log('[高清放大] ========== 订单完成 ==========');
    console.log('[高清放大] 耗时:', ((Date.now() - startTime) / 1000).toFixed(1), '秒');

    return NextResponse.json({
      success: true,
      message: '高清放大成功',
      data: {
        orderId,
        resultUrl: storageResult,
      },
    });

  } catch (error: unknown) {
    console.error('[高清放大] ========== 处理失败 ==========');
    console.error('[高清放大] 错误:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: '高清放大处理失败，请重试',
        error: process.env.NODE_ENV === 'development' ? getErrorMessage(error) : undefined,
      },
      { status: 500 }
    );
  }
}
