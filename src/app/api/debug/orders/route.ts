import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/storage/database/client';
import { transactions } from '@/storage/database/shared/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const db = await getDb();

    // 查询最近3个彩绘提取订单
    const orders = await db
      .select()
      .from(transactions)
      .where(eq(transactions.toolPage, '彩绘提取'))
      .orderBy(desc(transactions.createdAt))
      .limit(3);

    const result = orders.map(order => ({
      orderNumber: order.orderNumber,
      status: order.status,
      description: order.description,
      resultDataType: typeof order.resultData,
      resultData: order.resultData
        ? (typeof order.resultData === 'string'
          ? order.resultData.substring(0, 200) + (order.resultData.length > 200 ? '...' : '')
          : JSON.stringify(order.resultData).substring(0, 200) + '...')
        : null,
      createdAt: order.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[Debug] 查询订单失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '查询订单失败',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
