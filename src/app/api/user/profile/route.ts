import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 获取用户完整信息接口
 *
 * 功能说明：
 * - 根据 userId 获取用户完整信息
 * - 包括用户ID、用户名、邮箱、头像、剩余积分等
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const userCookie = request.cookies.get('user');
    let cookieUserId: string | null = null;

    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
        }
      } catch (error) {
        console.error('[API/Profile] 解析 user cookie 失败:', error);
      }
    }

    const userId = requestedUserId || cookieUserId;

    if (!userId) {
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

    if (requestedUserId && cookieUserId && requestedUserId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限访问其他用户信息' },
        { status: 403 }
      );
    }

    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar || '/images/avatar.png',
        points: user.points || 0,
        isAdmin: user.isAdmin || false,
        createTime: user.createdAt,
      },
    });
  } catch (error: unknown) {
    console.error('获取用户信息失败:', error);
    return NextResponse.json(
      { success: false, message: `获取用户信息失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
