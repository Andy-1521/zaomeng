import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

/**
 * 创建订单接口
 *
 * 功能说明：
 * - 预先创建订单，避免并发创建重复订单
 * - 如果订单已存在，返回现有订单
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      orderNumber,
      toolPage,
      description,
      prompt,
      points,
      actualPoints,
      remainingPoints,
      requestParams
    } = body;

    if (!userId || !orderNumber) {
      return NextResponse.json(
        { success: false, message: '缺少必需参数' },
        { status: 400 }
      );
    }

    console.log('[CreateTransaction] 准备创建订单:', orderNumber);

    // 先检查订单是否已存在
    const existingOrder = await transactionManager.getTransactionByOrderNumber(orderNumber);

    if (existingOrder) {
      console.log('[CreateTransaction] 订单已存在，返回现有订单:', orderNumber);
      return NextResponse.json({
        success: true,
        data: existingOrder,
        message: '订单已存在',
      });
    }

    // 创建新订单
    const transaction = await transactionManager.createTransaction({
      userId,
      orderNumber,
      toolPage: toolPage || '彩绘提取',
      description: description || '',
      prompt: prompt || '',
      points: points || 0,
      actualPoints: actualPoints || 0, // 添加实际扣除积分字段
      remainingPoints: remainingPoints || 0,
      resultData: null,
      requestParams: requestParams || null,
      status: '处理中',
    });

    console.log('[CreateTransaction] 订单创建成功:', orderNumber);

    return NextResponse.json({
      success: true,
      data: transaction,
      message: '订单创建成功',
    });
  } catch (error) {
    console.error('[CreateTransaction] 创建订单失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '创建订单失败',
        error: String(error),
      },
      { status: 500 }
    );
  }
}
