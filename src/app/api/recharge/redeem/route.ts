import { NextRequest, NextResponse } from 'next/server';
import { rechargeCodeManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

function getSafeRedeemError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('不存在') || message.includes('已被使用')) {
    return { message, status: 400 };
  }

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT') ||
    message.includes('connect ') ||
    message.includes('数据库')
  ) {
    return { message: '兑换服务暂时不可用，请稍后重试', status: 500 };
  }

  return { message: message || '兑换失败，请稍后重试', status: 500 };
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '请先登录后再兑换' }, { status: 401 });
    }

    const body = await request.json();
    const code = String(body.code || '').trim();

    if (!code) {
      return NextResponse.json({ success: false, message: '请输入兑换码' }, { status: 400 });
    }

    const result = await rechargeCodeManager.redeemCode({ code, userId });

    return NextResponse.json({
      success: true,
      message: '兑换成功',
      data: result,
    });
  } catch (error: unknown) {
    const { message, status } = getSafeRedeemError(error);
    console.error('[Recharge] 兑换码兑换失败:', error);
    return NextResponse.json({ success: false, message }, { status });
  }
}
