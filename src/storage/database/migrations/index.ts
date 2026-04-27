/**
 * 数据库迁移系统
 *
 * 提供统一的迁移管理和执行接口
 */

import { migrateEmailToNullable } from "./fix_email_null";
import { createChatMessagesTable } from "./create_chat_messages_table";

// 迁移定义
export interface Migration {
  name: string;
  version: string;
  description: string;
  execute: () => Promise<unknown>;
}

// 可用的迁移列表
const migrations: Migration[] = [
  {
    name: "fix_email_null",
    version: "1.0.0",
    description: "修复 users 表 email 字段允许 NULL，支持手机号注册",
    execute: migrateEmailToNullable,
  },
  {
    name: "create_chat_messages_table",
    version: "1.1.0",
    description: "创建 chat_messages 表，支持跨设备同步聊天记录",
    execute: createChatMessagesTable,
  },
];

/**
 * 获取所有可用迁移
 */
export function getAllMigrations(): Migration[] {
  return migrations;
}

/**
 * 获取指定名称的迁移
 */
export function getMigration(name: string): Migration | undefined {
  return migrations.find(m => m.name === name);
}

/**
 * 执行指定迁移
 */
export async function runMigration(name: string) {
  const migration = getMigration(name);
  if (!migration) {
    throw new Error(`迁移 "${name}" 不存在`);
  }

  console.log(`\n========== 执行迁移: ${migration.name} ==========`);
  console.log(`版本: ${migration.version}`);
  console.log(`描述: ${migration.description}`);
  console.log("=================================================");

  const result = await migration.execute();

  console.log(`\n========== 迁移 ${migration.name} 完成 ==========\n`);

  return result;
}

/**
 * 执行所有迁移
 */
export async function runAllMigrations() {
  const results = [];

  for (const migration of migrations) {
    try {
      const result = await runMigration(migration.name);
      results.push({
        name: migration.name,
        success: true,
        result
      });
    } catch (error) {
      results.push({
        name: migration.name,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      // 继续执行其他迁移
    }
  }

  return results;
}
