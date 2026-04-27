import { NextRequest, NextResponse } from 'next/server';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 获取所有用户列表接口
 *
 * 功能说明：
 * - 返回所有用户的列表
 * - 用于管理员后台的用户管理功能
 */
export async function GET(request: NextRequest) {
  try {
    // 检查是否登录
    const userCookie = request.cookies.get('user');
    console.log('[API] /api/user/users - 所有 cookies:', request.cookies.getAll());
    console.log('[API] /api/user/users - userCookie:', userCookie?.value?.substring(0, 100));

    let currentUser;

    // 方式1：从 Cookie 获取用户信息
    if (userCookie) {
      try {
        currentUser = JSON.parse(userCookie.value);
        console.log('[API] 从Cookie解析用户信息:', { id: currentUser?.id, username: currentUser?.username, isAdmin: currentUser?.isAdmin });
      } catch (error) {
        console.error('[API] 解析 user cookie 失败:', error);
      }
    }

    // 方式2：如果 Cookie 失败，尝试从查询参数获取 userId（备用方案）
    if (!currentUser) {
      const { searchParams } = new URL(request.url);
      const userId = searchParams.get('userId');
      if (userId) {
        currentUser = { id: userId };
        console.log('[API] 从查询参数获取 userId:', currentUser.id);
      }
    }

    if (!currentUser || !currentUser.id) {
      console.log('[API] 未登录：未找到用户信息');
      console.log('[API] Request URL:', request.url);
      console.log('[API] Request headers:', Object.fromEntries(request.headers.entries()));
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    // 从数据库重新查询用户完整信息（包含 isAdmin 字段）
    const adminUser = await userManager.getUserById(currentUser.id);
    console.log('[API] 数据库查询结果:', adminUser ? { id: adminUser.id, isAdmin: adminUser.isAdmin } : null);

    if (!adminUser) {
      console.log('[API] 用户不存在:', currentUser.id);
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    // 检查是否是管理员
    if (!adminUser.isAdmin) {
      console.log('[API] 无权限访问: isAdmin =', adminUser.isAdmin);
      return NextResponse.json(
        { success: false, message: '无权限访问' },
        { status: 403 }
      );
    }

    // 获取搜索关键词
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword')?.trim() || '';

    // 获取所有用户
    const allUsers = await userManager.getUsers(0, 1000);

    // 如果有搜索关键词，进行过滤
    let filteredUsers = allUsers;
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      filteredUsers = allUsers.filter(user =>
        user.username.toLowerCase().includes(lowerKeyword) ||
        user.email?.toLowerCase().includes(lowerKeyword)
      );
    }

    return NextResponse.json({
      success: true,
      data: filteredUsers,
    });
  } catch (error: unknown) {
    console.error('获取用户列表失败:', error);
    return NextResponse.json(
      { success: false, message: `获取失败，请稍后重试: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
