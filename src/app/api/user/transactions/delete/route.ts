import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

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
    const { orderNumber, userId: bodyUserId } = body;
    const userCookie = request.cookies.get('user');
    let cookieUserId: string | null = null;

    if (!orderNumber) {
      return NextResponse.json(
        { success: false, message: '订单号不能为空' },
        { status: 400 }
      );
    }

    console.log('[API/DeleteTransaction] 删除订单，订单号:', orderNumber);

    let userId = bodyUserId;
    console.log('[API/DeleteTransaction] 尝试从 cookie 获取用户信息:', userCookie ? '存在' : '不存在');

    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
          if (!userId) {
            userId = userData.id;
          }
          console.log('[API/DeleteTransaction] 从 cookie 解析用户ID成功:', cookieUserId);
        }
      } catch (e) {
        console.error('[API/DeleteTransaction] 解析 user cookie 失败:', e);
      }
    }

    if (bodyUserId && !cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (bodyUserId && cookieUserId && bodyUserId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权删除其他用户的订单' },
        { status: 403 }
      );
    }

    if (userId) {
      const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
      if (!transaction) {
        console.log('[API/DeleteTransaction] 订单不存在:', orderNumber);
        return NextResponse.json(
          { success: false, message: '订单不存在' },
          { status: 404 }
        );
      }

      if (transaction.userId !== userId) {
        console.log('[API/DeleteTransaction] 订单归属权验证失败:', { orderNumber, transactionUserId: transaction.userId, currentUserId: userId });
        return NextResponse.json(
          { success: false, message: '无权删除此订单' },
          { status: 403 }
        );
      }
    }

    const deleted = await transactionManager.deleteTransaction(orderNumber);

    if (!deleted) {
      console.log('[API/DeleteTransaction] 删除订单失败，可能订单不存在');
      return NextResponse.json(
        { success: false, message: '删除失败，订单可能不存在' },
        { status: 404 }
      );
    }

    console.log('[API/DeleteTransaction] 删除订单成功:', orderNumber);

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
