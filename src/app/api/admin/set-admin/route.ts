import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 设置/取消管理员权限接口
 *
 * 功能说明：
 * - 只有管理员才能调用此接口
 * - 可以设置用户为管理员或取消管理员权限
 * - 操作记录日志便于审计
 */
export async function POST(request: NextRequest) {
  try {
    // 获取当前登录用户
    const userCookie = request.cookies.get('user');
    if (!userCookie) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const currentUser = JSON.parse(userCookie.value);

    // 检查当前用户是否是管理员
    const adminUser = await userManager.getUserById(currentUser.id);
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json(
        { success: false, message: '无权限执行此操作' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { targetUserId, isAdmin } = body;

    // 验证必填字段
    if (!targetUserId || typeof isAdmin !== 'boolean') {
      return NextResponse.json(
        { success: false, message: '参数错误' },
        { status: 400 }
      );
    }

    // 验证目标用户是否存在
    const targetUser = await userManager.getUserById(targetUserId);
    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: '目标用户不存在' },
        { status: 404 }
      );
    }

    // 更新用户权限
    const updatedUser = await userManager.updateUser(targetUserId, { isAdmin });

    if (!updatedUser) {
      return NextResponse.json(
        { success: false, message: '更新失败' },
        { status: 500 }
      );
    }

    // 记录操作日志
    console.log(`[Admin] ${adminUser.username}(${adminUser.id}) ${isAdmin ? '设置' : '取消'} ${targetUser.username}(${targetUser.id}) 为管理员`);

    return NextResponse.json({
      success: true,
      message: isAdmin ? '已设置为管理员' : '已取消管理员权限',
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        isAdmin: updatedUser.isAdmin,
      },
    });
  } catch (error: unknown) {
    console.error('设置管理员失败:', error);
    return NextResponse.json(
      { success: false, message: `操作失败，请稍后重试: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
