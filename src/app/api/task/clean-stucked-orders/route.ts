import { NextRequest, NextResponse } from 'next/server';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 清理异常订单状态接口
 *
 * 功能说明：
 * - 将超过一定时间的"处理中"订单标记为"失败"
 * - 用于清理因异常导致的卡死订单
 */
export async function POST(request: NextRequest) {
  console.log('[CleanStuckOrders] ========== 开始处理请求 ==========');

  try {
    const { userId, maxAgeMinutes = 15 } = await request.json();

    console.log('[CleanStuckOrders] 查询参数:', { userId, maxAgeMinutes });

    if (!userId) {
      return NextResponse.json(
        { success: false, message: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 导入数据库管理器
    const { transactionManager } = await import('@/storage/database');

    // 获取用户的所有"处理中"订单
    const allOrders = await transactionManager.getUserTransactions(userId, 1000);

    const stuckOrders = allOrders.filter(order => {
      if (order.status !== '处理中') return false;

      const createdAt = new Date(order.createdAt).getTime();
      const age = Date.now() - createdAt;
      const ageMinutes = age / (1000 * 60);

      return ageMinutes > maxAgeMinutes;
    });

    console.log(`[CleanStuckOrders] 找到 ${stuckOrders.length} 个超过 ${maxAgeMinutes} 分钟的"处理中"订单`);

    // 更新这些订单的状态为"失败"
    const updatedOrders = [];
    for (const order of stuckOrders) {
      try {
        await transactionManager.updateTransaction(order.orderNumber, {
          status: '失败',
          resultData: '订单处理超时，已自动标记为失败',
        });
        updatedOrders.push(order.orderNumber);
        console.log(`[CleanStuckOrders] 已标记订单为失败: ${order.orderNumber}`);
      } catch (error) {
        console.error(`[CleanStuckOrders] 更新订单失败: ${order.orderNumber}`, error);
      }
    }

    console.log('[CleanStuckOrders] ========== 处理完成 ==========');

    return NextResponse.json({
      success: true,
      data: {
        totalFound: stuckOrders.length,
        updated: updatedOrders.length,
        orderNumbers: updatedOrders,
      },
    });
  } catch (error: unknown) {
    console.error('[CleanStuckOrders] ========== 请求失败 ==========');
    console.error('[CleanStuckOrders] 错误:', error);

    return NextResponse.json(
      {
        success: false,
        message: '清理订单失败',
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
