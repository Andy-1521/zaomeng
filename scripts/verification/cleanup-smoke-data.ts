import dotenv from 'dotenv';
import { getMysqlPool } from '@/storage/database';

dotenv.config({ path: '.env.local' });

async function tableExists(pool: Awaited<ReturnType<typeof getMysqlPool>>, tableName: string) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [tableName],
  );
  return Number((rows as Array<{ count?: number }>)[0]?.count || 0) > 0;
}

async function main() {
  const pool = await getMysqlPool();
  const [userRows] = await pool.query(
    'SELECT id, email FROM users WHERE email LIKE ? OR email = ?',
    ['assistant-prod-smoke-%@example.test', 'assistant-real-smoke@example.test'],
  );
  const userIds = (userRows as Array<{ id: string }>).map((row) => row.id).filter(Boolean);

  if (userIds.length === 0) {
    console.log(JSON.stringify({ ok: true, users: 0, marketItems: 0, message: 'no smoke users found' }));
    await pool.end();
    return;
  }

  const hasMarketItems = await tableExists(pool, 'market_items');
  const hasMarketPurchases = await tableExists(pool, 'market_purchases');
  const hasCapturedImages = await tableExists(pool, 'captured_images');
  const hasChatMessages = await tableExists(pool, 'chat_messages');
  const hasMaterialFolders = await tableExists(pool, 'material_folders');
  const hasRechargeCodes = await tableExists(pool, 'recharge_codes');
  const placeholders = userIds.map(() => '?').join(',');
  let itemIds: string[] = [];

  if (hasMarketItems) {
    const [itemRows] = await pool.query(
      `SELECT id FROM market_items WHERE seller_id IN (${placeholders})`,
      userIds,
    );
    itemIds = (itemRows as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
  }

  if (hasMarketPurchases) {
    await pool.query(
      `DELETE FROM market_purchases WHERE buyer_id IN (${placeholders}) OR seller_id IN (${placeholders})`,
      [...userIds, ...userIds],
    );
    if (itemIds.length > 0) {
      await pool.query(
        `DELETE FROM market_purchases WHERE item_id IN (${itemIds.map(() => '?').join(',')})`,
        itemIds,
      );
    }
  }

  if (hasMarketItems && itemIds.length > 0) {
    await pool.query(
      `DELETE FROM market_items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds,
    );
  }

  if (hasCapturedImages) {
    await pool.query(`DELETE FROM captured_images WHERE user_id IN (${placeholders})`, userIds);
  }

  if (hasChatMessages) {
    await pool.query(`DELETE FROM chat_messages WHERE user_id IN (${placeholders})`, userIds);
  }

  if (hasMaterialFolders) {
    await pool.query(`DELETE FROM material_folders WHERE user_id IN (${placeholders})`, userIds);
  }

  if (hasRechargeCodes) {
    await pool.query(
      `DELETE FROM recharge_codes WHERE created_by IN (${placeholders}) OR redeemed_by IN (${placeholders})`,
      [...userIds, ...userIds],
    );
  }

  await pool.query(`DELETE FROM transactions WHERE user_id IN (${placeholders})`, userIds);
  await pool.query(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);

  const [remainingRows] = await pool.query(
    'SELECT COUNT(*) AS count FROM users WHERE email LIKE ? OR email = ?',
    ['assistant-prod-smoke-%@example.test', 'assistant-real-smoke@example.test'],
  );
  const remainingUsers = Number((remainingRows as Array<{ count?: number }>)[0]?.count || 0);

  console.log(JSON.stringify({ ok: remainingUsers === 0, users: userIds.length, marketItems: itemIds.length, remainingUsers }));
  if (remainingUsers !== 0) {
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await getMysqlPool().then((pool) => pool.end()).catch(() => {});
  process.exitCode = 1;
});
