import { NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 创建测试用户（仅限开发环境使用）
 *
 * POST /api/debug/create-test-user
 * Body:
 * - email: 邮箱（必需）
 * - password: 密码（必需，至少6位）
 * - username: 用户名（可选）
 * - points: 积分（可选，默认100）
 */
export async function POST(request: Request) {
  // 仅限开发环境
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      {
        success: false,
        message: '此接口仅限开发环境使用',
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { email, password, username, points = 100 } = body;

    // 验证参数
    if (!email || !password) {
      return NextResponse.json(
        {
          success: false,
          message: '邮箱和密码不能为空',
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        {
          success: false,
          message: '密码至少需要6位',
        },
        { status: 400 }
      );
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        {
          success: false,
          message: '邮箱格式不正确',
        },
        { status: 400 }
      );
    }

    console.log('[Debug] ========== 创建测试用户 ==========');
    console.log('[Debug] 邮箱:', email);
    console.log('[Debug] 用户名:', username || email.split('@')[0]);
    console.log('[Debug] 积分:', points);

    // 检查邮箱是否已存在
    const existingUser = await userManager.getUserByEmail(email);
    if (existingUser) {
      console.warn('[Debug] 邮箱已存在:', email);
      return NextResponse.json(
        {
          success: false,
          message: '该邮箱已被注册',
        },
        { status: 409 }
      );
    }

    // 创建用户
    const newUser = await userManager.createUser({
      email,
      password,
      username: username || email.split('@')[0],
      points,
    });

    console.log('[Debug] ========== 测试用户创建成功 ==========');
    console.log('[Debug] 用户ID:', newUser.id);
    console.log('[Debug] 用户名:', newUser.username);
    console.log('[Debug] 邮箱:', newUser.email);
    console.log('[Debug] 积分:', newUser.points);

    return NextResponse.json({
      success: true,
      message: '测试用户创建成功',
      data: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        points: newUser.points,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error: unknown) {
    console.error('[Debug] 创建测试用户失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '创建测试用户失败',
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
