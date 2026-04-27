import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';
import type { UpdateUser } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 更新用户信息接口（管理员专用）
 *
 * 功能说明：
 * - 管理员可以更新用户的积分和头像
 * - 只有管理员才能访问此接口
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, points, avatar } = body;

    // 检查是否登录
    const userCookie = request.cookies.get('user');
    let currentUser;

    // 从 Cookie 获取用户信息
    if (userCookie) {
      try {
        currentUser = JSON.parse(userCookie.value);
      } catch (error) {
        console.error('[API] 解析 user cookie 失败:', error);
      }
    }

    // 备用方案：从查询参数获取 userId
    if (!currentUser) {
      const { searchParams } = new URL(request.url);
      const adminUserId = searchParams.get('userId');
      if (adminUserId) {
        currentUser = { id: adminUserId };
      }
    }

    if (!currentUser || !currentUser.id) {
      console.log('[API] 未登录：未找到用户信息');
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    // 检查是否是管理员
    const adminUser = await userManager.getUserById(currentUser.id);
    if (!adminUser || !adminUser.isAdmin) {
      return NextResponse.json(
        { success: false, message: '无权限访问' },
        { status: 403 }
      );
    }

    // 验证目标用户是否存在
    const targetUser = await userManager.getUserById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: '目标用户不存在' },
        { status: 404 }
      );
    }

    // 更新用户信息
    const updateData: Pick<UpdateUser, 'points' | 'avatar'> = {};
    if (typeof points === 'number') {
      updateData.points = points;
    }
    if (avatar !== undefined) {
      updateData.avatar = avatar;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, message: '没有要更新的字段' },
        { status: 400 }
      );
    }

    await userManager.updateUser(userId, updateData);

    // 返回更新后的用户信息
    const updatedUser = await userManager.getUserById(userId);

    return NextResponse.json({
      success: true,
      message: '更新成功',
      data: updatedUser,
    });
  } catch (error: unknown) {
    console.error('更新用户信息失败:', error);
    return NextResponse.json(
      { success: false, message: `更新失败，请稍后重试: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
