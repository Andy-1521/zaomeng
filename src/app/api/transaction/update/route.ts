import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

/**
 * 更新订单状态接口
 *
 * 功能说明：
 * - 根据订单号更新消费记录
 * - 支持更新状态、结果数据、剩余积分等字段
 */
const ALLOWED_CLIENT_STATUSES = new Set(['处理中', '成功', '失败', '超时', '部分成功']);

function getSafeClientUpdate(updateData: unknown) {
  if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData)) return null;
  const source = updateData as Record<string, unknown>;
  const safeUpdate: { status?: string; resultData?: string } = {};

  if (typeof source.status === 'string') {
    if (!ALLOWED_CLIENT_STATUSES.has(source.status)) return null;
    safeUpdate.status = source.status;
  }

  if (typeof source.resultData === 'string') {
    safeUpdate.resultData = source.resultData;
  }

  return Object.keys(safeUpdate).length > 0 ? safeUpdate : null;
}

export async function POST(request: NextRequest) {
  try {
    const cookieUserId = getCookieUserId(request);
    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { orderId, updateData } = body;

    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json(
        { success: false, message: '订单号不能为空' },
        { status: 400 }
      );
    }

    const safeUpdate = getSafeClientUpdate(updateData);
    if (!safeUpdate) {
      return NextResponse.json(
        { success: false, message: '更新数据不允许或为空' },
        { status: 400 }
      );
    }

    const transaction = await transactionManager.getTransactionByOrderNumber(orderId);
    if (!transaction) {
      return NextResponse.json(
        { success: false, message: '订单不存在' },
        { status: 404 }
      );
    }

    if (transaction.userId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权更新其他用户订单' },
        { status: 403 }
      );
    }

    console.log('[UpdateTransaction] 用户更新订单:', orderId, '字段:', Object.keys(safeUpdate));

    await transactionManager.updateTransaction(orderId, safeUpdate);

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
      },
      { status: 500 }
    );
  }
}
