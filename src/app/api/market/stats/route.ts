import { NextRequest, NextResponse } from 'next/server';
import { marketManager, userManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { readDevPreviewUser } from '@/lib/devPreviewUser';

export async function GET(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const user = await userManager.getUserById(userId);
    if (!user?.isAdmin) {
      return NextResponse.json({ success: false, message: '无管理员权限' }, { status: 403 });
    }

    const pendingCount = await marketManager.countByStatus('pending');
    return NextResponse.json({ success: true, data: { pendingCount } });
  } catch (error) {
    console.error('[图市] 获取统计失败:', error);
    const userId = getCookieUserId(request);
    const previewUser = await readDevPreviewUser();

    if (previewUser?.isAdmin && previewUser.id === userId) {
      return NextResponse.json({ success: true, data: { pendingCount: 0 }, preview: true });
    }

    return NextResponse.json({ success: false, message: '获取图市统计失败' }, { status: 500 });
  }
}
