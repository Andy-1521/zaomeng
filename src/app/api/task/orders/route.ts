import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/storage/database/client';
import { transactions } from '@/storage/database/shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * GET /api/task/orders
 *
 * 查询用户的订单记录
 *
 * 查询参数：
 * - userId: 用户ID（必需）
 * - toolPage: 工具页面名称（可选，如"彩绘提取"、"去除水印"等）
 *
 * 返回：
 * - success: 是否成功
 * - data: 订单列表
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const toolPage = searchParams.get('toolPage');

    console.log('[订单查询] 收到请求，参数:', { userId, toolPage });

    if (!userId) {
      console.error('[订单查询] 缺少必需参数: userId');
      return NextResponse.json(
        {
          success: false,
          message: '缺少必需参数: userId',
        },
        { status: 400 }
      );
    }

    const db = await getDb();

    // 构建查询条件
    const conditions = [eq(transactions.userId, userId)];

    if (toolPage) {
      // 兼容"彩绘提取"和"彩绘提取2"
      if (toolPage === '彩绘提取') {
        conditions.push(sql`(${transactions.toolPage} = ${toolPage} OR ${transactions.toolPage} = '彩绘提取2')`);
      } else {
        conditions.push(eq(transactions.toolPage, toolPage));
      }
    }

    console.log('[订单查询] 查询条件:', conditions);

    const orders = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt));

    console.log('[订单查询] 查询成功，订单数量:', orders.length);

    return NextResponse.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error('[订单查询] 查询失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '查询订单记录失败',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
