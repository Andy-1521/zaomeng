import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * 检查订单状态接口
 *
 * 功能说明：
 * - 根据订单号查询消费记录
 * - 返回订单的详细信息和生成结果
 */
export async function GET(request: NextRequest) {
  console.log('[CheckOrder] ========== 开始处理请求 ==========');

  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    console.log('[CheckOrder] 查询参数 orderId:', orderId);

    if (!orderId) {
      console.log('[CheckOrder] 订单号为空，返回错误');
      return NextResponse.json(
        { success: false, message: '订单号不能为空' },
        { status: 400 }
      );
    }

    console.log('[CheckOrder] 步骤1：开始查询订单...');

    // 查询消费记录
    const transaction = await transactionManager.getTransactionByOrderNumber(orderId);

    if (!transaction) {
      console.log('[CheckOrder] 步骤1完成：订单不存在');
      return NextResponse.json({
        success: false,
        message: '订单不存在',
        found: false,
      });
    }

    console.log('[CheckOrder] 步骤1完成：订单查询成功');
    console.log('[CheckOrder] 订单信息:', {
      orderId: transaction.orderNumber,
      status: transaction.status,
      description: transaction.description,
      hasResultData: !!transaction.resultData,
    });

    console.log('[CheckOrder] ========== 请求成功 ==========');

    return NextResponse.json({
      success: true,
      data: {
        orderId: transaction.orderNumber,
        status: transaction.status,
        description: transaction.description,
        resultData: transaction.resultData,
        points: transaction.points,
        remainingPoints: transaction.remainingPoints,
        requestParams: transaction.requestParams,
        createdAt: transaction.createdAt,
      },
    });
  } catch (error: unknown) {
    console.error('[CheckOrder] ========== 请求失败 ==========');
    console.error('[CheckOrder] 错误类型:', getErrorName(error));
    console.error('[CheckOrder] 错误消息:', getErrorMessage(error));
    console.error('[CheckOrder] 错误堆栈:', getErrorStack(error));

    return NextResponse.json(
      {
        success: false,
        message: '查询订单失败',
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
