import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { AUTH_COOKIE_NAME, buildAuthCookieUser, createAuthCookieValue, getAuthCookieOptions } from '@/lib/serverAuth';

/**
 * 用户登录接口（使用本地 MySQL 数据库验证）
 *
 * 功能说明：
 * - 验证邮箱和密码
 * - 从数据库中查询用户记录
 * - 返回用户信息并设置cookie
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // 验证数据
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: '邮箱和密码不能为空' },
        { status: 400 }
      );
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, message: '请输入有效的邮箱地址' },
        { status: 400 }
      );
    }

    // 从数据库中验证用户
    const user = await userManager.verifyUser(email, password);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '邮箱或密码错误' },
        { status: 401 }
      );
    }

    // 准备带签名的用户 cookie 数据，避免伪造 user.id / isAdmin 盗刷积分或兑换码
    const authUser = buildAuthCookieUser(user);
    const userData = createAuthCookieValue(authUser);

    // 创建响应并设置cookie
    const response = NextResponse.json({
      success: true,
      message: '登录成功',
      data: authUser,
    });

    // 使用Next.js标准方法设置cookie
    response.cookies.set(AUTH_COOKIE_NAME, userData, getAuthCookieOptions(request));

    console.log('[API] 登录成功，已设置安全登录态 Cookie，userId:', authUser.id);

    return response;
  } catch (error: unknown) {
    console.error('登录失败:', error);
    // 不暴露数据库内部错误信息，只返回友好的错误提示
    return NextResponse.json(
      { success: false, message: '登录失败，请检查邮箱和密码是否正确' },
      { status: 500 }
    );
  }
}
