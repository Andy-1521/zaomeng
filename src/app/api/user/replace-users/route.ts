import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/storage/database/client';
import { users } from '@/storage/database/shared/schema';
import { sql } from 'drizzle-orm';

/**
 * 用户数据替换 API（管理员专用，一次性使用）
 *
 * POST: 清空现有用户并批量导入新用户数据
 * 鉴权: X-Admin-Secret 请求头 或 管理员 Cookie
 */
export async function POST(request: NextRequest) {
  try {
    // 鉴权：支持 X-Admin-Secret 请求头 或 管理员 Cookie
    const adminSecret = request.headers.get('X-Admin-Secret');
    const SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'replace-users-2026';

    if (adminSecret !== SECRET_KEY) {
      const userCookie = request.cookies.get('user');
      let currentUser;
      if (userCookie) {
        try { currentUser = JSON.parse(userCookie.value); } catch { /* ignore */ }
      }
      if (!currentUser?.id) {
        return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
      }
      const { userManager } = await import('@/storage/database');
      const adminUser = await userManager.getUserById(currentUser.id);
      if (!adminUser?.isAdmin) {
        return NextResponse.json({ success: false, message: '无权限访问' }, { status: 403 });
      }
    }

    const body = await request.json();
    const { users: newUsers } = body;

    if (!Array.isArray(newUsers) || newUsers.length === 0) {
      return NextResponse.json({ success: false, message: '用户数据不能为空' }, { status: 400 });
    }

    const db = await getDb();

    // 1. 清空现有用户
    await db.delete(users);

    // 2. 批量插入，每批10条
    const BATCH_SIZE = 10;
    let insertedCount = 0;

    for (let i = 0; i < newUsers.length; i += BATCH_SIZE) {
      const batch = newUsers.slice(i, i + BATCH_SIZE).map((u: Record<string, unknown>) => ({
        id: u.id as string,
        username: u.username as string,
        email: (u.email as string) || null,
        phone: (u.phone as string) || null,
        password: u.password as string,
        avatar: (u.avatar as string) || null,
        points: Number(u.points) || 0,
        isAdmin: u.is_admin === true || u.is_admin === 'true' || u.isAdmin === true,
        isActive: u.is_active !== false && u.is_active !== 'false' && u.isActive !== false,
        createdAt: u.created_at ? String(u.created_at) : new Date().toISOString(),
        updatedAt: u.updated_at ? String(u.updated_at) : null,
      }));
      await db.insert(users).values(batch);
      insertedCount += batch.length;
    }

    // 3. 验证
    const result = await db.select({ count: sql<number>`count(*)` }).from(users);
    const finalCount = Number(result[0]?.count) || 0;

    return NextResponse.json({
      success: true,
      message: '用户数据替换完成',
      data: { insertedCount, totalCount: finalCount },
    });
  } catch (error) {
    console.error('[API] 用户数据替换失败:', error);
    return NextResponse.json(
      { success: false, message: '用户数据替换失败', error: String(error) },
      { status: 500 }
    );
  }
}
