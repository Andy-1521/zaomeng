import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

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
    const body = await request.json();
    const { userId, newUsername } = body;

    if (!userId || !newUsername) {
      return NextResponse.json(
        { success: false, message: '用户ID和新用户名不能为空' },
        { status: 400 }
      );
    }

    if (newUsername.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: '用户名不能为空' },
        { status: 400 }
      );
    }

    // 检查用户是否存在
    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    // 更新用户名
    await userManager.updateUser(userId, {
      username: newUsername.trim(),
    });

    return NextResponse.json({
      success: true,
      message: '用户名修改成功',
      data: {
        username: newUsername.trim(),
      },
    });
  } catch (error: unknown) {
    console.error('修改用户名失败:', error);
    return NextResponse.json(
      { success: false, message: `修改用户名失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
