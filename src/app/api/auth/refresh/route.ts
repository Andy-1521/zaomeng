import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { AUTH_COOKIE_NAME, buildAuthCookieUser, createAuthCookieValue, getAuthCookieOptions, getCookieUserId } from '@/lib/serverAuth';
import { readDevPreviewUser } from '@/lib/devPreviewUser';

/**
 * 会话刷新接口
 *
 * 功能说明：
 * - 从请求体获取 userId
 * - 从数据库查询最新用户信息（包含 isAdmin 字段）
 * - 更新 Cookie 中的用户信息
 * - 用于老用户刷新会话，无需重新登录
 */
export async function POST(request: NextRequest) {
  let userId = '';
  let cookieUserId: string | null = null;

  try {
    const body = await request.json() as { userId?: unknown };
    userId = typeof body.userId === 'string' ? body.userId : '';
    cookieUserId = getCookieUserId(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, message: '用户ID不能为空' },
        { status: 400 }
      );
    }

    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (cookieUserId !== userId) {
      return NextResponse.json(
        { success: false, message: '无权限刷新其他用户会话' },
        { status: 403 }
      );
    }

    // 从数据库查询用户信息
    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    const authUser = buildAuthCookieUser(user);
    const userData = createAuthCookieValue(authUser);

    // 创建响应并更新cookie
    const response = NextResponse.json({
      success: true,
      message: '会话刷新成功',
      data: authUser,
    });

    response.cookies.set(AUTH_COOKIE_NAME, userData, getAuthCookieOptions(request));

    console.log('[API] 会话刷新成功，userId:', user.id, 'isAdmin:', user.isAdmin);

    return response;
  } catch (error: unknown) {
    console.error('会话刷新失败:', error);
    const previewUser = await readDevPreviewUser();

    if (previewUser && userId === previewUser.id && cookieUserId === previewUser.id) {
      const authUser = buildAuthCookieUser(previewUser);
      const userData = createAuthCookieValue(authUser);
      const response = NextResponse.json({
        success: true,
        message: '本地预览会话刷新成功',
        data: authUser,
        preview: true,
      });

      response.cookies.set(AUTH_COOKIE_NAME, userData, getAuthCookieOptions(request));
      return response;
    }

    return NextResponse.json(
      { success: false, message: '会话刷新失败，请稍后重试' },
      { status: 500 }
    );
  }
}
