/**
 * 迁移脚本：修复 users 表 email 字段的 NULL 值问题
 *
 * 问题描述：
 * - users 表的 email 字段当前不允许 NULL
 * - 但数据中已存在 NULL 值（手机号注册的用户）
 * - 需要修改表结构允许 NULL，同时处理现有数据
 *
 * 迁移步骤：
 * 1. 为所有 email 为 NULL 的记录设置临时值（用于修改表结构）
 * 2. 修改表结构，允许 email 为 NULL
 * 3. 将临时值改回 NULL
 */

import { getDb } from "../client";
import { users } from "../shared/schema";
import { sql } from "drizzle-orm";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

const TEMP_EMAIL_PREFIX = "temp_null_";
type CountRow = RowDataPacket & {
  count: number;
};

type VerificationRow = RowDataPacket & {
  total_users: number;
  null_emails: number;
  non_null_emails: number;
};

export async function migrateEmailToNullable() {
  console.log("开始迁移 users 表 email 字段...");

  try {
    const db = await getDb();

    // 步骤 1: 为所有 email 为 NULL 的记录设置临时值
    console.log("步骤 1: 为 NULL 值设置临时占位符...");
    const nullEmailResult = await db.execute(sql`
      UPDATE ${users}
      SET email = CONCAT(${TEMP_EMAIL_PREFIX}, id, '@placeholder.local')
      WHERE email IS NULL
    `);

    console.log(`  - 处理了 ${(nullEmailResult[0] as ResultSetHeader).affectedRows} 条 NULL 值记录`);

    // 步骤 2: 修改表结构，允许 email 为 NULL
    console.log("步骤 2: 修改表结构允许 email 为 NULL...");
    await db.execute(
      sql`
         ALTER TABLE users
         MODIFY email VARCHAR(255) NULL
       `
     );
    console.log("  - 表结构修改成功");

    // 步骤 3: 将临时值改回 NULL
    console.log("步骤 3: 将临时值改回 NULL...");
    await db.execute(
      sql`
        UPDATE ${users}
        SET email = NULL
        WHERE email LIKE ${`%${TEMP_EMAIL_PREFIX}%`}
      `
    );

    const [resetRows] = await db.execute<CountRow[]>(sql`
      SELECT COUNT(*) AS count
      FROM ${users}
      WHERE email LIKE ${`%${TEMP_EMAIL_PREFIX}%`}
    `);

    const remainingTempCount = Number(resetRows[0]?.count ?? 0);

    console.log(`  - 临时占位残留记录数: ${remainingTempCount}`);

    // 步骤 4: 验证迁移结果
    const [verificationRows] = await db.execute<VerificationRow[]>(sql`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN email IS NULL THEN 1 ELSE 0 END) as null_emails,
        SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) as non_null_emails
      FROM ${users}
    `);

    const stats = verificationRows[0] ?? {
      total_users: 0,
      null_emails: 0,
      non_null_emails: 0,
    };
    console.log("\n迁移完成！统计信息：");
    console.log(`  - 总用户数: ${stats.total_users}`);
    console.log(`  - email 为 NULL: ${stats.null_emails}`);
    console.log(`  - email 有值: ${stats.non_null_emails}`);

    return {
      success: true,
      message: "迁移成功完成",
      stats
    };

  } catch (error) {
    console.error("迁移失败:", error);
    throw error;
  }
}

/**
 * 回滚迁移（如果需要）
 */
export async function rollbackEmailMigration() {
  console.log("开始回滚 email 字段迁移...");

  try {
    const db = await getDb();

    // 为所有 email 为 NULL 的记录设置临时值
    await db.execute(
      sql`
        UPDATE ${users}
        SET email = CONCAT(${TEMP_EMAIL_PREFIX}, id, '@placeholder.local')
        WHERE email IS NULL
      `
    );

    // 修改表结构，不允许 NULL
    await db.execute(
      sql`
         ALTER TABLE users
         MODIFY email VARCHAR(255) NOT NULL
       `
     );

    console.log("回滚完成");
    return { success: true };
  } catch (error) {
    console.error("回滚失败:", error);
    throw error;
  }
}
