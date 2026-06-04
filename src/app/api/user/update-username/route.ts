import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { AUTH_COOKIE_NAME, buildAuthCookieUser, createAuthCookieValue, getAuthCookieOptions, getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 修改用户名接口（使用数据库）
 *
 * 功能说明：
 * - 验证用户ID和新用户名
 * - 更新用户名
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

    const body = await request.json();
    const { userId, newUsername } = body;

    if (typeof userId === 'string' && userId.trim() && userId.trim() !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限修改其他用户信息' },
        { status: 403 }
      );
    }

    if (!newUsername) {
      return NextResponse.json(
        { success: false, message: '新用户名不能为空' },
        { status: 400 }
      );
    }

    const normalizedUsername = String(newUsername).trim();
    if (normalizedUsername.length === 0) {
      return NextResponse.json(
        { success: false, message: '用户名不能为空' },
        { status: 400 }
      );
    }

    const user = await userManager.getUserById(cookieUserId);
    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    await userManager.updateUser(cookieUserId, { username: normalizedUsername });
    const updatedUser = await userManager.getUserById(cookieUserId);
    const authUser = buildAuthCookieUser(updatedUser || { ...user, username: normalizedUsername });
    const response = NextResponse.json({
      success: true,
      message: '用户名修改成功',
      data: {
        username: normalizedUsername,
      },
    });
    response.cookies.set(AUTH_COOKIE_NAME, createAuthCookieValue(authUser), getAuthCookieOptions(request));
    return response;
  } catch (error: unknown) {
    console.error('修改用户名失败:', error);
    return NextResponse.json(
      { success: false, message: `修改用户名失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
