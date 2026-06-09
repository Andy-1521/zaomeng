import { NextRequest, NextResponse } from 'next/server';
import { marketManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json() as { itemId?: string };
    if (!body.itemId) {
      return NextResponse.json({ success: false, message: '缺少素材 ID' }, { status: 400 });
    }

    const result = await marketManager.purchaseItem(body.itemId, userId);
    return NextResponse.json({ success: true, message: '购买成功', data: result });
  } catch (error) {
    console.error('[图市] 购买失败:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '购买失败，请稍后重试' },
      { status: 400 }
    );
  }
}
