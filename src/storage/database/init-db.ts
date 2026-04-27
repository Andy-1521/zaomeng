/**
 * 数据库初始化脚本
 * 创建 MySQL 所需表结构
 */

import { getDb } from "./client";
import { sql } from "drizzle-orm";

let initialized = false;

export async function initializeDatabase() {
  if (initialized) {
    return;
  }

  const db = await getDb();

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      username VARCHAR(50) NOT NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(11) NULL,
      password TEXT NOT NULL,
      avatar TEXT NULL,
      points INT NOT NULL DEFAULT 100,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY users_email_unique (email),
      UNIQUE KEY users_phone_unique (phone),
      KEY users_phone_idx (phone),
      KEY users_email_idx (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      order_number VARCHAR(50) NOT NULL,
      tool_page VARCHAR(50) NOT NULL,
      description TEXT NOT NULL,
      points INT NOT NULL,
      actual_points INT NOT NULL DEFAULT 0,
      remaining_points INT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT '成功',
      prompt TEXT NULL,
      request_params TEXT NULL,
      result_data TEXT NULL,
      psd_url VARCHAR(500) NULL,
      uploaded_image TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY transactions_order_number_unique (order_number),
      KEY transactions_user_id_idx (user_id),
      KEY transactions_order_number_idx (order_number),
      KEY transactions_user_created_idx (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      type VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT NULL,
      uploaded_images JSON NULL,
      loading BOOLEAN NOT NULL DEFAULT FALSE,
      order_id VARCHAR(50) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY chat_messages_user_id_idx (user_id),
      KEY chat_messages_created_at_idx (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  initialized = true;
}
