import { NextResponse } from 'next/server';
import { getDb } from '@/storage/database/client';
import { sql } from 'drizzle-orm';
import type { RowDataPacket } from 'mysql2/promise';

type ColumnRow = RowDataPacket & {
  column_name: string;
};

type TransactionRow = RowDataPacket & {
  id: string;
  request_params: string | null;
};

/**
 * 数据库迁移：添加 uploaded_image 字段到 transactions 表
 */
export async function POST() {
  try {
    console.log('[Migration] 开始添加 uploaded_image 字段...');

    const db = await getDb();

    // 检查字段是否已存在
    const [existingColumns] = await db.execute<ColumnRow[]>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
      AND table_name = 'transactions'
      AND column_name = 'uploaded_image'
    `);

    if (existingColumns.length > 0) {
      console.log('[Migration] uploaded_image 字段已存在，跳过迁移');
      return NextResponse.json({
        success: true,
        message: '字段已存在，无需迁移',
      });
    }

    // 添加字段
    await db.execute(sql`
      ALTER TABLE transactions
      ADD COLUMN uploaded_image TEXT
    `);

    console.log('[Migration] uploaded_image 字段添加成功');

    // 检查是否有 request_params 中包含 imageUrl 的记录，尝试迁移数据
    // 使用更简单的方式，逐条处理
    const [rows] = await db.execute<TransactionRow[]>(sql`
      SELECT id, request_params
      FROM transactions
      WHERE request_params IS NOT NULL
      LIMIT 1000
    `);

    let migratedCount = 0;

    for (const row of rows) {
      try {
        const requestParams = row.request_params;
        if (requestParams && typeof requestParams === 'string') {
          const params = JSON.parse(requestParams);
          if (params.imageUrl) {
            await db.execute(sql`
              UPDATE transactions
              SET uploaded_image = ${params.imageUrl}
              WHERE id = ${row.id}
            `);
            migratedCount++;
          }
        }
      } catch {
        // 忽略解析失败的记录
      }
    }

    console.log('[Migration] 迁移了', migratedCount, '条记录的原图URL');

    return NextResponse.json({
      success: true,
      message: '迁移成功',
      migratedCount: migratedCount,
    });
  } catch (error: unknown) {
    console.error('[Migration] 迁移失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: '迁移失败',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
