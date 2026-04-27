import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

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
  try {
    const body = await request.json();
    const { userId } = body;
    const userCookie = request.cookies.get('user');
    let cookieUserId: string | null = null;

    if (userCookie) {
      try {
        const userData = JSON.parse(userCookie.value);
        if (typeof userData.id === 'string' && userData.id) {
          cookieUserId = userData.id;
        }
      } catch (error) {
        console.error('[API] 解析 refresh user cookie 失败:', error);
      }
    }

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

    // 准备用户cookie数据
    const userData = JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      points: user.points,
      isAdmin: user.isAdmin || false,
    });

    // 创建响应并更新cookie
    const response = NextResponse.json({
      success: true,
      message: '会话刷新成功',
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/',
    });

    console.log('[API] 会话刷新成功，userId:', user.id, 'isAdmin:', user.isAdmin);

    return response;
  } catch (error: unknown) {
    console.error('会话刷新失败:', error);
    return NextResponse.json(
      { success: false, message: '会话刷新失败，请稍后重试' },
      { status: 500 }
    );
  }
}
