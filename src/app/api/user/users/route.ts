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
    const userCookie = request.cookies.get('user');
    let currentUser: { id?: string } | null = null;

    if (userCookie) {
      try {
        currentUser = JSON.parse(userCookie.value);
      } catch (error) {
        console.error('[API] 解析 user cookie 失败:', error);
      }
    }

    if (!currentUser || !currentUser.id) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    const adminUser = await userManager.getUserById(currentUser.id);

    if (!adminUser) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    if (!adminUser.isAdmin) {
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
