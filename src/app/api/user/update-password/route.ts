import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 修改密码接口
 *
 * 功能说明：
 * - 验证用户ID、旧密码和新密码
 * - 验证旧密码是否正确
 * - 更新密码
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
    const { userId, oldPassword, newPassword } = body;

    if (typeof userId === 'string' && userId.trim() && userId.trim() !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限修改其他用户密码' },
        { status: 403 }
      );
    }

    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { success: false, message: '旧密码和新密码不能为空' },
        { status: 400 }
      );
    }

    if (String(newPassword).length < 6) {
      return NextResponse.json(
        { success: false, message: '新密码至少6位' },
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

    // 验证旧密码
    if (user.password !== oldPassword) {
      return NextResponse.json(
        { success: false, message: '旧密码错误' },
        { status: 401 }
      );
    }

    await userManager.updatePassword(cookieUserId, String(newPassword));

    return NextResponse.json({
      success: true,
      message: '密码修改成功',
    });
  } catch (error: unknown) {
    console.error('修改密码失败:', error);
    return NextResponse.json(
      { success: false, message: `修改密码失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
