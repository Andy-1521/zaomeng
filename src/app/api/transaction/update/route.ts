import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

/**
 * 更新订单状态接口
 *
 * 功能说明：
 * - 根据订单号更新消费记录
 * - 支持更新状态、结果数据、剩余积分等字段
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, updateData } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, message: '订单号不能为空' },
        { status: 400 }
      );
    }

    if (!updateData) {
      return NextResponse.json(
        { success: false, message: '更新数据不能为空' },
        { status: 400 }
      );
    }

    console.log('[UpdateTransaction] 更新订单:', orderId, '更新数据:', updateData);

    // 更新消费记录
    await transactionManager.updateTransaction(orderId, updateData);

    console.log('[UpdateTransaction] 订单更新成功');

    return NextResponse.json({
      success: true,
      message: '订单更新成功',
    });
  } catch (error) {
    console.error('[UpdateTransaction] 更新订单失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '更新订单失败',
        error: String(error),
      },
      { status: 500 }
    );
  }
}
