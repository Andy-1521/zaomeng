import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { verifyCodeStore } from '@/utils/verifyCodeStore';

/**
 * 重置密码接口（使用本地 MySQL 数据库）
 *
 * 功能说明：
 * - 验证邮箱验证码
 * - 验证用户是否存在
 * - 更新用户密码
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, verifyCode, newPassword } = body;

    // 验证数据
    if (!email || !verifyCode || !newPassword) {
      return NextResponse.json(
        { success: false, message: '邮箱、验证码和新密码不能为空' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: '密码至少6位' },
        { status: 400 }
      );
    }

    // 检查邮箱是否已注册
    const user = await userManager.getUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { success: false, message: '该邮箱未注册' },
        { status: 404 }
      );
    }

    // 验证邮箱验证码（只检查，不删除）
    if (!(await verifyCodeStore.check(email, verifyCode))) {
      return NextResponse.json(
        { success: false, message: '验证码错误或已过期' },
        { status: 400 }
      );
    }

    // 更新密码
    await userManager.updatePassword(user.id, newPassword);

    // 密码更新成功后，删除验证码
    await verifyCodeStore.remove(email);

    return NextResponse.json({
      success: true,
      message: '密码重置成功',
    });
  } catch (error: unknown) {
    console.error('重置密码失败:', error);
    // 不暴露数据库内部错误信息，只返回友好的错误提示
    return NextResponse.json(
      { success: false, message: '重置密码失败，请稍后重试' },
      { status: 500 }
    );
  }
}
