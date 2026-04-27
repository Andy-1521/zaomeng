import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import { verifyCodeStore } from '@/utils/verifyCodeStore';

/**
 * 用户注册接口（使用本地 MySQL 数据库存储）
 *
 * 功能说明：
 * - 验证邮箱验证码
 * - 检查邮箱是否已注册
 * - 在数据库中创建新用户记录
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { verifyCode, email, username, password } = body;

    // 验证验证码
    if (!verifyCode) {
      return NextResponse.json(
        { success: false, message: '请输入邮箱验证码' },
        { status: 400 }
      );
    }

    // 验证必填字段
    if (!email || !username || !password) {
      return NextResponse.json(
        { success: false, message: '请填写完整信息' },
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

    // 验证邮箱验证码（只检查，不删除）
    if (!(await verifyCodeStore.check(email, verifyCode))) {
      return NextResponse.json(
        { success: false, message: '验证码错误或已过期' },
        { status: 400 }
      );
    }

    // 检查邮箱是否已注册
    const existingUser = await userManager.getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: '该邮箱已注册' },
        { status: 400 }
      );
    }

    // 在数据库中创建用户
    const user = await userManager.createUser({
      username,
      email,
      password,
      points: 100,
    });

    // 所有操作成功后，删除验证码
    await verifyCodeStore.remove(email);

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
      message: '注册成功',
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        points: user.points,
        isAdmin: user.isAdmin || false,
      },
    });

    // 使用Next.js标准方法设置cookie（自动登录）
    response.cookies.set('user', userData, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/',
    });

    return response;
  } catch (error: unknown) {
    console.error('注册失败:', error);
    // 不暴露数据库内部错误信息，只返回友好的错误提示
    return NextResponse.json(
      { success: false, message: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}
