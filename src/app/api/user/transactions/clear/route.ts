import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';

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
    const body = await request.json();
    const requestedUserId = typeof body.userId === 'string' ? body.userId : undefined;
    let userId = requestedUserId;
    let cookieUserId: string | null = null;

    console.log('[API/ClearTransactions] 开始处理请求，请求体userId:', userId);

    const userCookie = request.cookies.get('user');
    console.log('[API/ClearTransactions] 尝试从 cookie 获取用户信息:', userCookie ? '存在' : '不存在');

    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
          if (!userId) {
            userId = userData.id;
          }
          console.log('[API/ClearTransactions] 从 cookie 解析用户ID成功:', cookieUserId);
        }
      } catch (e) {
        console.error('[API/ClearTransactions] 解析 user cookie 失败:', e);
      }
    }

    if (!userId) {
      const { searchParams } = new URL(request.url);
      userId = searchParams.get('userId') || undefined;
      console.log('[API/ClearTransactions] 从查询参数获取用户ID:', userId);
    }

    if (!userId) {
      console.log('[API/ClearTransactions] 用户ID为空，所有方法都失败');
      return NextResponse.json(
        { success: false, message: '用户ID不能为空' },
        { status: 401 }
      );
    }

    if (requestedUserId && !cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (cookieUserId && userId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限清空其他用户历史记录' },
        { status: 403 }
      );
    }

    console.log('[API/ClearTransactions] 使用用户ID:', userId);

    const deletedCount = await transactionManager.clearUserTransactions(userId);

    console.log('[API/ClearTransactions] 清空历史记录成功，删除数量:', deletedCount);

    return NextResponse.json({
      success: true,
      message: `已清空 ${deletedCount} 条历史记录`,
      data: {
        deletedCount,
      },
    });
  } catch (error: unknown) {
    console.error('清空历史记录失败:', error);
    return NextResponse.json(
      { success: false, message: `清空历史记录失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
