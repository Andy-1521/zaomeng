import dotenv from 'dotenv';
import { inArray } from 'drizzle-orm';
import { getDb, getMysqlPool, userManager } from '@/storage/database';
import { capturedImageManager } from '@/storage/database/capturedImageManager';
import { marketItems, marketPurchases } from '@/storage/database/shared/schema';

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
  const db = await getDb();
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
  let itemIds: string[] = [];

  if (hasMarketItems) {
    const placeholders = userIds.map(() => '?').join(',');
    const [itemRows] = await pool.query(
      `SELECT id FROM market_items WHERE seller_id IN (${placeholders})`,
      userIds,
    );
    itemIds = (itemRows as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
  }

  if (hasMarketPurchases) {
    if (itemIds.length > 0) {
      await db.delete(marketPurchases).where(inArray(marketPurchases.itemId, itemIds));
    }
    await db.delete(marketPurchases).where(inArray(marketPurchases.buyerId, userIds));
    await db.delete(marketPurchases).where(inArray(marketPurchases.sellerId, userIds));
  }

  if (hasMarketItems && itemIds.length > 0) {
    await db.delete(marketItems).where(inArray(marketItems.id, itemIds));
  }

  for (const userId of userIds) {
    await capturedImageManager.clearUserCapturedImages(userId).catch(() => {});
    await pool.query('DELETE FROM transactions WHERE user_id = ?', [userId]).catch(() => {});
    await userManager.deleteUser(userId).catch(() => {});
  }

  console.log(JSON.stringify({ ok: true, users: userIds.length, marketItems: itemIds.length }));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await getMysqlPool().then((pool) => pool.end()).catch(() => {});
  process.exitCode = 1;
});
