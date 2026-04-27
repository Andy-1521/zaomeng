import { NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 删除测试用户（仅限开发环境使用）
 *
 * DELETE /api/debug/delete-test-user
 * Body:
 * - email: 邮箱（必需）
 */
export async function DELETE(request: Request) {
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
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          message: '邮箱不能为空',
        },
        { status: 400 }
      );
    }

    console.log('[Debug] ========== 删除测试用户 ==========');
    console.log('[Debug] 邮箱:', email);

    // 查询用户
    const user = await userManager.getUserByEmail(email);
    if (!user) {
      console.warn('[Debug] 用户不存在:', email);
      return NextResponse.json(
        {
          success: false,
          message: '用户不存在',
        },
        { status: 404 }
      );
    }

    // 软删除用户（设置 isActive 为 false）
    const deleted = await userManager.deleteUser(user.id);

    if (deleted) {
      console.log('[Debug] ========== 测试用户删除成功 ==========');
      console.log('[Debug] 用户ID:', user.id);
      console.log('[Debug] 邮箱:', email);

      return NextResponse.json({
        success: true,
        message: '测试用户删除成功',
        data: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      });
    } else {
      console.error('[Debug] 删除用户失败');
      return NextResponse.json(
        {
          success: false,
          message: '删除用户失败',
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error('[Debug] 删除测试用户失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '删除测试用户失败',
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
