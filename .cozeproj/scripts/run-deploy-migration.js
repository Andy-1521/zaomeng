/**
 * 部署前数据库迁移脚本（纯SQL版本）
 *
 * 此脚本在部署构建阶段执行，确保数据库表结构与代码一致
 * 主要修复 users.email 字段的 NULL 值问题
 *
 * 特点：
 * - 不依赖项目源码
 * - 使用纯 SQL 执行
 * - 通过环境变量获取数据库连接
 */

const { Pool } = require('pg');

// 从环境变量获取数据库连接
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('错误：DATABASE_URL 环境变量未设置');
  process.exit(1);
}

// 创建数据库连接池
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') === false ? { rejectUnauthorized: false } : false
});

const TEMP_EMAIL_PREFIX = 'temp_null_';

async function migrate() {
  console.log('========================================');
  console.log('开始执行部署前数据库迁移...');
  console.log('========================================\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 步骤 1: 检查表和列是否存在
    console.log('步骤 1: 检查数据库表结构...');

    const columnsResult = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name = 'email'
      AND table_schema = 'public';
    `);

    if (columnsResult.rows.length === 0) {
      console.log('  ✓ email 列不存在或表不存在，跳过迁移\n');
      console.log('========================================');
      console.log('✓ 部署前迁移完成（无需迁移）');
      console.log('========================================\n');
      return true;
    }

    const isNullable = columnsResult.rows[0].is_nullable;

    if (isNullable === 'YES') {
      console.log('  ✓ email 列已允许 NULL，无需迁移\n');
      console.log('========================================');
      console.log('✓ 部署前迁移完成（无需迁移）');
      console.log('========================================\n');
      return true;
    }

    console.log('  检测到 email 列不允许 NULL，开始迁移...\n');

    // 步骤 2: 为所有 email 为 NULL 的记录设置临时值
    console.log('步骤 2: 为 NULL 值设置临时占位符...');
    const tempEmailValue = `${TEMP_EMAIL_PREFIX}${Date.now()}`;

    const nullEmailResult = await client.query(
      `UPDATE users SET email = $1 WHERE email IS NULL RETURNING id, phone`,
      [tempEmailValue]
    );

    console.log(`  ✓ 处理了 ${nullEmailResult.rows.length} 条 NULL 值记录\n`);

    // 步骤 3: 修改表结构，允许 email 为 NULL
    console.log('步骤 3: 修改表结构允许 email 为 NULL...');
    await client.query(`
      ALTER TABLE users
      ALTER COLUMN email DROP NOT NULL
    `);
    console.log('  ✓ 表结构修改成功\n');

    // 步骤 4: 将临时值改回 NULL
    console.log('步骤 4: 将临时值改回 NULL...');
    const resetResult = await client.query(
      `UPDATE users SET email = NULL WHERE email LIKE $1 RETURNING id`,
      [`${TEMP_EMAIL_PREFIX}%`]
    );

    console.log(`  ✓ 重置了 ${resetResult.rows.length} 条记录\n`);

    // 步骤 5: 验证迁移结果
    console.log('步骤 5: 验证迁移结果...');
    const verificationResult = await client.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN email IS NULL THEN 1 END) as null_emails,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as non_null_emails
      FROM users
    `);

    const stats = verificationResult.rows[0];
    console.log(`  - 总用户数: ${stats.total_users}`);
    console.log(`  - email 为 NULL: ${stats.null_emails}`);
    console.log(`  - email 有值: ${stats.non_null_emails}\n`);

    await client.query('COMMIT');

    console.log('========================================');
    console.log('✓ 部署前迁移执行成功！');
    console.log('========================================\n');

    return true;

  } catch (error) {
    await client.query('ROLLBACK');

    console.error('\n========================================');
    console.error('✗ 迁移失败:');
    console.error('========================================\n');

    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    } else {
      console.error(error);
    }

    console.error('\n========================================\n');

    throw error;
  } finally {
    client.release();
  }
}

// 执行迁移
migrate()
  .then(() => {
    console.log('迁移脚本执行完成\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('迁移执行出错:', error);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
