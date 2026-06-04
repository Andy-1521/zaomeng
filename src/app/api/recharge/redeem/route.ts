import { NextRequest, NextResponse } from 'next/server';
import { rechargeCodeManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '兑换失败，请稍后重试';
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
    const message = getErrorMessage(error);
    const status = message.includes('不存在') || message.includes('已被使用') ? 400 : 500;
    console.error('[Recharge] 兑换码兑换失败:', error);
    return NextResponse.json({ success: false, message }, { status });
  }
}
