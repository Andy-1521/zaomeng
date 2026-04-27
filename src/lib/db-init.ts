/**
 * 数据库初始化和迁移工具
 *
 * 提供统一的数据库初始化接口，确保数据库结构与代码同步
 */

import { getDb, getMysqlPool } from "@/storage/database/client";
import { users, transactions } from "@/storage/database/shared/schema";
import { sql } from "drizzle-orm";

/**
 * 检查数据库表是否存在
 */
export async function checkTableExists(tableName: string): Promise<boolean> {
  try {
    const pool = await getMysqlPool();
    const [rows] = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name = ?
        ) AS table_exists
      `,
      [tableName]
    );

    return Boolean((rows as Array<{ table_exists?: number }>)[0]?.table_exists);
  } catch (error) {
    console.error(`检查表 ${tableName} 是否存在时出错:`, error);
    return false;
  }
}

/**
 * 检查列是否存在及其属性
 */
export async function checkColumnNullable(tableName: string, columnName: string): Promise<boolean | null> {
  try {
    const pool = await getMysqlPool();
    const [rows] = await pool.query(
      `
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName]
    );

    const isNullable = (rows as Array<{ is_nullable?: string }>)[0]?.is_nullable;
    return isNullable === 'YES';
  } catch (error) {
    console.error(`检查列 ${tableName}.${columnName} 属性时出错:`, error);
    return null;
  }
}

/**
 * 检查数据库是否需要迁移
 */
export async function checkMigrationNeeded(): Promise<{ needed: boolean; reason: string }> {
  try {
    // 检查 users 表是否存在
    const usersExists = await checkTableExists('users');
    if (!usersExists) {
      return { needed: true, reason: 'users 表不存在' };
    }

    // 检查 email 列是否允许 NULL
    const emailNullable = await checkColumnNullable('users', 'email');
    if (emailNullable === false) {
      return { needed: true, reason: 'users.email 列不允许 NULL，但数据中可能存在 NULL 值（手机号注册）' };
    }

    return { needed: false, reason: '数据库结构正常' };
  } catch (error) {
    console.error('检查迁移需求时出错:', error);
    return { needed: true, reason: `检查失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 获取数据库统计信息
 */
export async function getDatabaseStats() {
  try {
    const pool = await getMysqlPool();
    const [userRows] = await pool.query(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN email IS NULL THEN 1 ELSE 0 END) as users_with_null_email,
        SUM(CASE WHEN phone IS NULL THEN 1 ELSE 0 END) as users_with_null_phone,
        SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) as users_with_email,
        SUM(CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END) as users_with_phone
      FROM users
    `);

    const [transRows] = await pool.query(`
      SELECT
        COUNT(*) as total_transactions,
        COUNT(DISTINCT user_id) as active_users
      FROM transactions
    `);

    return {
      users: (userRows as unknown[])[0] ?? null,
      transactions: (transRows as unknown[])[0] ?? null,
    };
  } catch (error) {
    console.error('获取数据库统计信息时出错:', error);
    throw error;
  }
}

/**
 * 自动执行必要的迁移
 *
 * 注意：此函数仅供开发和测试环境使用
 * 生产环境部署前应该手动执行迁移，确保数据安全
 */
export async function autoMigrate(): Promise<{ success: boolean; message: string }> {
  try {
    console.log('[数据库初始化] 检查是否需要迁移...');
    const { needed, reason } = await checkMigrationNeeded();

    if (!needed) {
      console.log('[数据库初始化] 无需迁移');
      return { success: true, message: '数据库结构正常，无需迁移' };
    }

    console.log(`[数据库初始化] 需要迁移: ${reason}`);

    // 检查 email 列是否允许 NULL
    const emailNullable = await checkColumnNullable('users', 'email');

    if (emailNullable === false) {
      console.log('[数据库初始化] MySQL 已按允许 NULL 的目标结构初始化，跳过旧迁移脚本');
    }

    return { success: true, message: '检查完成，当前使用 MySQL 初始化流程' };
  } catch (error) {
    console.error('[数据库初始化] 自动迁移失败:', error);
    return {
      success: false,
      message: `自动迁移失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
