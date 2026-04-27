import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

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

    // 准备用户cookie数据
    const userData = JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      points: user.points,
      isAdmin: user.isAdmin || false,
    });

    // 创建响应并设置cookie
    const response = NextResponse.json({
      success: true,
      message: '登录成功',
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        points: user.points,
        isAdmin: user.isAdmin || false,
      },
    });

    // 使用Next.js标准方法设置cookie
    response.cookies.set('user', userData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // 生产环境true，开发环境false
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/',
      // 不设置domain，让浏览器自动处理
    });

    console.log('[API] 登录成功，已设置Cookie，userData前100字符:', userData.substring(0, 100));

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
