import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 清空用户历史记录接口
 *
 * 功能说明：
 * - 删除指定用户的所有消费记录
 * - 优先使用 cookie 校验当前登录用户
 * - 返回删除的记录数量
 */
export async function POST(request: NextRequest) {
  try {
    const cookieUserId = getCookieUserId(request);
    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({} as { userId?: unknown }));
    if (typeof body.userId === 'string' && body.userId.trim() && body.userId.trim() !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限清空其他用户历史记录' },
        { status: 403 }
      );
    }

    const deletedCount = await transactionManager.clearUserTransactions(cookieUserId);

    return NextResponse.json({
      success: true,
      message: `已清空 ${deletedCount} 条历史记录`,
      data: { deletedCount },
    });
  } catch (error: unknown) {
    console.error('清空历史记录失败:', error);
    return NextResponse.json(
      { success: false, message: `清空历史记录失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
