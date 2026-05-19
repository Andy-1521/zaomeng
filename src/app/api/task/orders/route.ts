import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/storage/database/client';
import { transactions } from '@/storage/database/shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { reconcileProcessingTransactions } from '@/lib/reconcileProcessingTransactions';

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
    const requestedUserId = searchParams.get('userId');
    const toolPage = searchParams.get('toolPage');
    const userCookie = request.cookies.get('user');
    let cookieUserId: string | null = null;

    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
        }
      } catch (error) {
        console.error('[订单查询] 解析 user cookie 失败:', error);
      }
    }

    if (!cookieUserId) {
      return NextResponse.json(
        {
          success: false,
          message: '未登录',
        },
        { status: 401 }
      );
    }

    const userId = requestedUserId || cookieUserId;

    if (requestedUserId && requestedUserId !== cookieUserId) {
      return NextResponse.json(
        {
          success: false,
          message: '无权限访问其他用户订单',
        },
        { status: 403 }
      );
    }

    const db = await getDb();

    // 构建查询条件
    const conditions = [eq(transactions.userId, userId)];

    if (toolPage) {
      // 兼容"彩绘提取"和"彩绘提取2"
      if (toolPage === '彩绘提取') {
        conditions.push(sql`(${transactions.toolPage} = ${toolPage} OR ${transactions.toolPage} = '彩绘提取2')`);
      } else if (toolPage === '智能改图') {
        conditions.push(sql`(${transactions.toolPage} = ${toolPage} OR ${transactions.toolPage} = '局部改图')`);
      } else {
        conditions.push(eq(transactions.toolPage, toolPage));
      }
    }

    const orders = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt));

    const reconciledOrders = await reconcileProcessingTransactions(orders, {
      logPrefix: '订单查询',
    });

    return NextResponse.json({
      success: true,
      data: reconciledOrders,
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
