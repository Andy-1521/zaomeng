/**
 * 数据库初始化脚本
 * 创建 MySQL 所需表结构
 */

import { getDb, getMysqlPool } from "./client";
import { sql } from "drizzle-orm";

let initialized = false;

async function ensureColumn(tableName: string, columnName: string, alterSql: string) {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName]
  );

  if (Number((rows as Array<{ count?: number }>)[0]?.count ?? 0) === 0) {
    await pool.query(alterSql);
  }
}

async function ensureIndex(tableName: string, indexName: string, createSql: string) {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
    `,
    [tableName, indexName]
  );

  if (Number((rows as Array<{ count?: number }>)[0]?.count ?? 0) === 0) {
    await pool.query(createSql);
  }
}

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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS captured_images (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      image_url TEXT NOT NULL,
      original_url TEXT NULL,
      page_url TEXT NULL,
      page_title TEXT NULL,
      source_host VARCHAR(255) NULL,
      image_type VARCHAR(20) NOT NULL DEFAULT 'main',
      folder_id VARCHAR(36) NULL,
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY captured_images_user_created_idx (user_id, created_at),
      KEY captured_images_user_folder_idx (user_id, folder_id),
      KEY captured_images_user_favorite_idx (user_id, is_favorite)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS material_folders (
      id VARCHAR(36) PRIMARY KEY NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(80) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY material_folders_user_name_unique (user_id, name),
      KEY material_folders_user_idx (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureColumn('captured_images', 'folder_id', 'ALTER TABLE captured_images ADD COLUMN folder_id VARCHAR(36) NULL');
  await ensureColumn('captured_images', 'is_favorite', 'ALTER TABLE captured_images ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureIndex('captured_images', 'captured_images_user_folder_idx', 'CREATE INDEX captured_images_user_folder_idx ON captured_images (user_id, folder_id)');
  await ensureIndex('captured_images', 'captured_images_user_favorite_idx', 'CREATE INDEX captured_images_user_favorite_idx ON captured_images (user_id, is_favorite)');

  initialized = true;
}
