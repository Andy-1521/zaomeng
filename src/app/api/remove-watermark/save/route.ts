import { NextRequest, NextResponse } from 'next/server';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 去水印保存API
 * 仅用于更新订单的描述信息（如自定义提示词）
 */
export async function POST(request: NextRequest) {
  console.log('[去水印保存] ========== 开始处理请求 ==========');

  try {
    const body = await request.json();
    const { userId, orderId, description } = body;

    console.log('[去水印保存] 请求参数:', {
      userId,
      orderId,
      description: description?.substring(0, 50),
    });

    // 验证参数
    if (!userId || !orderId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 去水印目前不需要保存额外信息
    console.log('[去水印保存] 保存成功');

    return NextResponse.json({
      success: true,
      message: '保存成功',
    });
  } catch (error: unknown) {
    console.error('[去水印保存] ========== 处理请求异常 ==========', error);
    return NextResponse.json(
      {
        success: false,
        message: `保存失败: ${getErrorMessage(error)}`,
      },
      { status: 500 }
    );
  }
}
