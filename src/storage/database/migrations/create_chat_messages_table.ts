/**
 * 迁移脚本：创建 chat_messages 表
 *
 * 功能说明：
 * - 创建聊天记录表，用于存储 AI 生图的对话历史
 * - 支持跨设备同步聊天记录
 * - 跟随用户账号隔离
 */

import { getDb } from "../client";
import { sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";

type TableRow = RowDataPacket & {
  table_name: string;
};

type IndexRow = RowDataPacket & {
  index_name: string;
};

export async function createChatMessagesTable() {
  console.log("开始创建 chat_messages 表...");

  try {
    const db = await getDb();

    // 检查表是否已存在
    const [existingTables] = await db.execute<TableRow[]>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'chat_messages'
    `);

    if (existingTables.length > 0) {
      console.log("  - chat_messages 表已存在，跳过创建");
      return {
        success: true,
        message: "chat_messages 表已存在",
        skipped: true,
      };
    }

    // 创建表
    console.log("  - 创建 chat_messages 表...");
    await db.execute(sql`
      CREATE TABLE chat_messages (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        type VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        uploaded_images JSON,
        loading BOOLEAN DEFAULT false NOT NULL,
        order_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("  - 表创建成功");

    // 创建索引
    console.log("  - 创建索引...");
    await db.execute(sql`
      CREATE INDEX chat_messages_user_id_idx ON chat_messages (user_id)
    `);
    console.log("  - user_id 索引创建成功");

    await db.execute(sql`
      CREATE INDEX chat_messages_created_at_idx ON chat_messages (created_at DESC)
    `);
    console.log("  - created_at 索引创建成功");

    // 验证表结构
    const [tables] = await db.execute<TableRow[]>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'chat_messages'
    `);

    const [indexes] = await db.execute<IndexRow[]>(sql`
      SELECT index_name
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'chat_messages'
    `);

    console.log("\n创建完成！统计信息：");
    console.log(`  - 表: ${tables.length > 0 ? '✓' : '✗'} chat_messages`);
    console.log(`  - 索引数量: ${indexes.length}`);
    indexes.forEach((idx) => {
      console.log(`    - ${(idx as { index_name?: string }).index_name}`);
    });

    return {
      success: true,
      message: "chat_messages 表创建成功",
      stats: {
        tables: tables.length,
        indexes: indexes.length,
      },
    };
  } catch (error) {
    console.error("创建 chat_messages 表失败:", error);
    throw error;
  }
}

/**
 * 回滚迁移
 */
export async function rollbackChatMessagesTable() {
  console.log("开始回滚 chat_messages 表...");

  try {
    const db = await getDb();

    // 删除表（会自动删除索引）
    await db.execute(sql`
      DROP TABLE IF EXISTS chat_messages
    `);

    console.log("回滚完成");
    return { success: true };
  } catch (error) {
    console.error("回滚失败:", error);
    throw error;
  }
}
