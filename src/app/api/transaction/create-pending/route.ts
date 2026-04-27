import { NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * POST /api/transaction/create-pending
 * 预创建"处理中"状态的订单记录
 * 用于在生图开始时立即创建订单，确保历史记录能及时显示
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, orderId, toolPage, description, prompt, requestParams } = body;

    // 参数验证
    if (!userId || !orderId || !toolPage || !description) {
      return NextResponse.json(
        {
          success: false,
          message: '缺少必要参数',
        },
        { status: 400 }
      );
    }

    console.log('[创建预订单] 开始创建"处理中"订单:', {
      userId,
      orderId,
      toolPage,
      description: description.substring(0, 50),
    });

    // 获取用户信息以获取当前积分
    const userManager = (await import('@/storage/database')).userManager;
    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: '用户不存在',
        },
        { status: 404 }
      );
    }

    // 创建"处理中"状态的订单记录（不扣除积分）
    await transactionManager.createTransaction({
      userId: userId,
      orderNumber: orderId,
      toolPage: toolPage,
      description: description,
      prompt: prompt || description,
      points: 0, // 预创建时不扣除积分，积分在生图完成时扣除
      remainingPoints: user.points,
      resultData: null,
      requestParams: requestParams ? JSON.stringify(requestParams) : undefined,
      status: '处理中',
    });

    console.log('[创建预订单] 订单创建成功:', orderId);

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        status: '处理中',
      },
    });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('[创建预订单] 创建订单失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '创建订单失败',
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
