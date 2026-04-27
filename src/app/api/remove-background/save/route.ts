import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '保存记录失败';
}

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json();
    const { userId, imageUrl, resultUrl, originalFileName } = requestBody;

    console.log('[去除背景保存] 接收到请求参数:', {
      hasUserId: !!userId,
      hasImageUrl: !!imageUrl,
      hasResultUrl: !!resultUrl,
      originalFileName: originalFileName || 'N/A',
    });

    // 参数验证
    if (!userId || !imageUrl || !resultUrl) {
      console.error('[去除背景保存] 参数验证失败');
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 生成订单号
    const orderNumber = `RB-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 生成描述信息（包含文件名，统一排版布局）
    const description = originalFileName
      ? `${originalFileName} - 移除背景`
      : '移除背景';

    // 保存到数据库（去除背景免费，不消耗积分）
    const savedTransaction = await transactionManager.createTransaction({
      userId: userId,
      orderNumber: orderNumber,
      toolPage: '去除背景',
      description: description,
      points: 0, // 免费功能
      remainingPoints: 0, // 不消耗积分，所以保持不变（由transactionManager处理）
      resultData: JSON.stringify({ imageUrl: resultUrl }),
      requestParams: JSON.stringify({ uploadedImage: imageUrl, originalFileName }),
      status: '成功',
    });

    console.log('[去除背景保存] 保存成功:', {
      id: savedTransaction.id,
      orderNumber: savedTransaction.orderNumber,
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId: savedTransaction.orderNumber,
        transactionId: savedTransaction.id,
      },
    });
  } catch (error: unknown) {
    console.error('[去除背景保存] 保存失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
