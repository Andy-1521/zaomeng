import dotenv from 'dotenv';
import { initializeDatabase } from '@/storage/database/init-db';
import { getMysqlPool } from '@/storage/database/client';

dotenv.config({ path: '.env.local' });

async function main() {
  await initializeDatabase();
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?) ORDER BY table_name",
    ['market_items', 'market_purchases'],
  );
  console.log(JSON.stringify({ ok: true, checkedTables: rows }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await getMysqlPool().then((pool) => pool.end()).catch(() => {});
  process.exitCode = 1;
});
