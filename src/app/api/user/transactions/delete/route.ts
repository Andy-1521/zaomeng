import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 删除单个历史记录接口
 *
 * 功能说明：
 * - 根据订单号删除指定的消费记录
 * - 使用 cookie 校验用户身份与订单归属
 * - 返回是否删除成功
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderNumber } = body;
    const cookieUserId = getCookieUserId(request);

    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (!orderNumber || typeof orderNumber !== 'string') {
      return NextResponse.json(
        { success: false, message: '订单号不能为空' },
        { status: 400 }
      );
    }

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) {
      return NextResponse.json(
        { success: false, message: '订单不存在' },
        { status: 404 }
      );
    }

    if (transaction.userId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权删除此订单' },
        { status: 403 }
      );
    }

    const deleted = await transactionManager.deleteTransaction(orderNumber);
    if (!deleted) {
      return NextResponse.json(
        { success: false, message: '删除失败，订单可能不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '删除成功',
    });
  } catch (error: unknown) {
    console.error('删除订单失败:', error);
    return NextResponse.json(
      { success: false, message: `删除订单失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
