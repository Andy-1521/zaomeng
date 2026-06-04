import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

/**
 * GET /api/transaction/[orderNumber]
 *
 * 查询订单详情（调试用）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  try {
    const { orderNumber } = await params;

    if (!orderNumber) {
      return NextResponse.json(
        { success: false, message: '缺少订单号' },
        { status: 400 }
      );
    }

    const cookieUserId = getCookieUserId(request);
    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    console.log('[GetTransaction] 查询订单详情:', orderNumber);

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);

    if (!transaction) {
      return NextResponse.json(
        { success: false, message: '订单不存在' },
        { status: 404 }
      );
    }

    if (transaction.userId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权查看其他用户订单' },
        { status: 403 }
      );
    }

    console.log('[GetTransaction] 订单详情:', {
      orderNumber: transaction.orderNumber,
      status: transaction.status,
      hasResultData: !!transaction.resultData,
      resultDataType: typeof transaction.resultData,
      resultDataLength: transaction.resultData?.length || 0,
      resultDataPreview: transaction.resultData ? transaction.resultData.substring(0, 100) + '...' : 'none',
    });

    return NextResponse.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error('[GetTransaction] 查询订单失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '查询订单失败',
        error: String(error),
      },
      { status: 500 }
    );
  }
}
