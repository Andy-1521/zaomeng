import { NextRequest, NextResponse } from 'next/server';
import { rechargeCodeManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '兑换失败，请稍后重试';
}

export async function POST(request: NextRequest) {
  try {
    const userCookie = request.cookies.get('user');
    if (!userCookie) {
      return NextResponse.json({ success: false, message: '请先登录后再兑换' }, { status: 401 });
    }

    let userId = '';
    try {
      const user = JSON.parse(userCookie.value) as { id?: string };
      userId = user.id || '';
    } catch {
      return NextResponse.json({ success: false, message: '登录状态异常，请重新登录' }, { status: 401 });
    }

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
