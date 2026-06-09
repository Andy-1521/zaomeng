import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, getMysqlPool } from './client';
import { marketItems, users } from './shared/schema';
import type { InsertMarketItem, MarketItem } from './shared/schema';

export type MarketItemStatus = 'pending' | 'approved' | 'rejected' | 'delisted';

type CreateMarketItemInput = Omit<InsertMarketItem, 'sellerId' | 'status'> & {
  sellerId: string;
  status?: MarketItemStatus;
};

type MarketPurchaseResult = {
  orderNumber: string;
  buyerRemainingPoints: number;
  sellerRemainingPoints: number;
  pricePoints: number;
  sellerPoints: number;
  platformFeePoints: number;
};

export type MarketAdminStats = {
  totalItems: number;
  pendingItems: number;
  approvedItems: number;
  rejectedItems: number;
  delistedItems: number;
  psdItems: number;
  totalPurchases: number;
  totalSalesPoints: number;
  totalSellerPoints: number;
  totalPlatformFeePoints: number;
  todayPurchases: number;
  todaySalesPoints: number;
};

const MARKET_ITEM_SELECT = `
  mi.id,
  mi.seller_id AS sellerId,
  mi.source_order_number AS sourceOrderNumber,
  mi.source_image_url AS sourceImageUrl,
  mi.preview_image_url AS previewImageUrl,
  mi.thumbnail_url AS thumbnailUrl,
  mi.title,
  mi.description,
  mi.category,
  mi.tags,
  mi.price_points AS pricePoints,
  mi.platform_fee_rate AS platformFeeRate,
  mi.status,
  mi.license_type AS licenseType,
  mi.allow_commercial_use AS allowCommercialUse,
  mi.psd_url AS psdUrl,
  mi.psd_file_name AS psdFileName,
  mi.psd_file_size AS psdFileSize,
  mi.psd_layer_count AS psdLayerCount,
  mi.psd_layers AS psdLayers,
  mi.rejection_reason AS rejectionReason,
  mi.approved_at AS approvedAt,
  mi.created_at AS createdAt,
  mi.updated_at AS updatedAt
`;

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
}

function parseJsonArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function sanitizeItem(item: MarketItem & { sellerName?: string | null; purchased?: boolean }) {
  return {
    ...item,
    tags: parseJsonArray<string>(item.tags),
    psdLayers: parseJsonArray(item.psdLayers),
    pricePoints: Number(item.pricePoints || 0),
    psdLayerCount: Number(item.psdLayerCount || 0),
    platformFeeRate: Number(item.platformFeeRate || 0),
    purchased: item.purchased === true,
  };
}

export class MarketManager {
  async createItem(data: CreateMarketItemInput): Promise<ReturnType<typeof sanitizeItem>> {
    const db = await getDb();
    const id = randomUUID();
    const tags = normalizeTags(data.tags);

    await db.insert(marketItems).values({
      id,
      sellerId: data.sellerId,
      sourceOrderNumber: data.sourceOrderNumber ?? null,
      sourceImageUrl: data.sourceImageUrl,
      previewImageUrl: data.previewImageUrl,
      thumbnailUrl: data.thumbnailUrl ?? null,
      title: data.title,
      description: data.description ?? null,
      category: data.category || '手机壳图案',
      tags,
      pricePoints: data.pricePoints,
      platformFeeRate: data.platformFeeRate ?? '20.00',
      status: data.status || 'pending',
      licenseType: data.licenseType || 'standard',
      allowCommercialUse: data.allowCommercialUse ?? true,
      psdUrl: data.psdUrl ?? null,
      psdFileName: data.psdFileName ?? null,
      psdFileSize: data.psdFileSize ?? null,
      psdLayerCount: data.psdLayerCount ?? 0,
      psdLayers: Array.isArray(data.psdLayers) ? data.psdLayers : [],
      rejectionReason: data.rejectionReason ?? null,
    });

    const item = await this.getItemById(id);
    if (!item) throw new Error('市场商品创建后读取失败');
    return item;
  }

  async getItemById(id: string, viewerId?: string | null) {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<(RowDataPacket & MarketItem & { sellerName?: string | null; purchased?: number })[]>(
      `SELECT ${MARKET_ITEM_SELECT}, u.username AS sellerName,
        CASE WHEN mp.id IS NULL THEN 0 ELSE 1 END AS purchased
       FROM market_items mi
       LEFT JOIN users u ON u.id = mi.seller_id
       LEFT JOIN market_purchases mp ON mp.item_id = mi.id AND mp.buyer_id = ?
       WHERE mi.id = ?
       LIMIT 1`,
      [viewerId || '', id]
    );

    const item = rows[0];
    return item ? sanitizeItem({ ...item, purchased: Boolean(item.purchased) }) : null;
  }

  async listApproved(viewerId?: string | null, options?: { keyword?: string; limit?: number }) {
    const pool = await getMysqlPool();
    const keyword = options?.keyword?.trim();
    const limit = Math.max(1, Math.min(options?.limit ?? 80, 120));
    const params: unknown[] = [viewerId || ''];
    let keywordSql = '';

    if (keyword) {
      keywordSql = ` AND (mi.title LIKE ? OR mi.category LIKE ? OR mi.description LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    params.push(limit);

    const [rows] = await pool.query<(RowDataPacket & MarketItem & { sellerName?: string | null; purchased?: number })[]>(
      `SELECT ${MARKET_ITEM_SELECT}, u.username AS sellerName,
        CASE WHEN mp.id IS NULL THEN 0 ELSE 1 END AS purchased
       FROM market_items mi
       LEFT JOIN users u ON u.id = mi.seller_id
       LEFT JOIN market_purchases mp ON mp.item_id = mi.id AND mp.buyer_id = ?
       WHERE mi.status = 'approved'${keywordSql}
       ORDER BY mi.created_at DESC
       LIMIT ?`,
      params
    );

    return rows.map((row) => sanitizeItem({ ...row, purchased: Boolean(row.purchased) }));
  }

  async listUserItems(sellerId: string) {
    const db = await getDb();
    const items = await db
      .select()
      .from(marketItems)
      .where(eq(marketItems.sellerId, sellerId))
      .orderBy(desc(marketItems.createdAt));
    return items.map((item) => sanitizeItem(item));
  }

  async listByStatus(status: MarketItemStatus, viewerId?: string | null) {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<(RowDataPacket & MarketItem & { sellerName?: string | null; purchased?: number })[]>(
      `SELECT ${MARKET_ITEM_SELECT}, u.username AS sellerName,
        CASE WHEN mp.id IS NULL THEN 0 ELSE 1 END AS purchased
       FROM market_items mi
       LEFT JOIN users u ON u.id = mi.seller_id
       LEFT JOIN market_purchases mp ON mp.item_id = mi.id AND mp.buyer_id = ?
       WHERE mi.status = ?
       ORDER BY mi.created_at DESC`,
      [viewerId || '', status]
    );

    return rows.map((row) => sanitizeItem({ ...row, purchased: Boolean(row.purchased) }));
  }

  async countByStatus(status: MarketItemStatus) {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) AS count FROM market_items WHERE status = ?`,
      [status]
    );
    return Number(rows[0]?.count || 0);
  }

  async getAdminStats(): Promise<MarketAdminStats> {
    const pool = await getMysqlPool();
    const [itemRows] = await pool.query<(RowDataPacket & {
      totalItems: number;
      pendingItems: number;
      approvedItems: number;
      rejectedItems: number;
      delistedItems: number;
      psdItems: number;
    })[]>(
      `SELECT
         COUNT(*) AS totalItems,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingItems,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approvedItems,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedItems,
         SUM(CASE WHEN status = 'delisted' THEN 1 ELSE 0 END) AS delistedItems,
         SUM(CASE WHEN psd_url IS NOT NULL AND psd_url <> '' THEN 1 ELSE 0 END) AS psdItems
       FROM market_items`
    );
    const [purchaseRows] = await pool.query<(RowDataPacket & {
      totalPurchases: number;
      totalSalesPoints: number;
      totalSellerPoints: number;
      totalPlatformFeePoints: number;
      todayPurchases: number;
      todaySalesPoints: number;
    })[]>(
      `SELECT
         COUNT(*) AS totalPurchases,
         COALESCE(SUM(price_points), 0) AS totalSalesPoints,
         COALESCE(SUM(seller_points), 0) AS totalSellerPoints,
         COALESCE(SUM(platform_fee_points), 0) AS totalPlatformFeePoints,
         SUM(CASE WHEN created_at >= UTC_DATE() THEN 1 ELSE 0 END) AS todayPurchases,
         COALESCE(SUM(CASE WHEN created_at >= UTC_DATE() THEN price_points ELSE 0 END), 0) AS todaySalesPoints
       FROM market_purchases`
    );

    const itemStats = itemRows[0] || {};
    const purchaseStats = purchaseRows[0] || {};

    return {
      totalItems: Number(itemStats.totalItems || 0),
      pendingItems: Number(itemStats.pendingItems || 0),
      approvedItems: Number(itemStats.approvedItems || 0),
      rejectedItems: Number(itemStats.rejectedItems || 0),
      delistedItems: Number(itemStats.delistedItems || 0),
      psdItems: Number(itemStats.psdItems || 0),
      totalPurchases: Number(purchaseStats.totalPurchases || 0),
      totalSalesPoints: Number(purchaseStats.totalSalesPoints || 0),
      totalSellerPoints: Number(purchaseStats.totalSellerPoints || 0),
      totalPlatformFeePoints: Number(purchaseStats.totalPlatformFeePoints || 0),
      todayPurchases: Number(purchaseStats.todayPurchases || 0),
      todaySalesPoints: Number(purchaseStats.todaySalesPoints || 0),
    };
  }

  async updatePsdPreview(id: string, data: { psdLayerCount: number; psdLayers: unknown[] }, viewerId?: string | null) {
    const db = await getDb();
    await db
      .update(marketItems)
      .set({
        psdLayerCount: data.psdLayerCount,
        psdLayers: Array.isArray(data.psdLayers) ? data.psdLayers : [],
        updatedAt: sql`UTC_TIMESTAMP()`,
      })
      .where(eq(marketItems.id, id));

    return this.getItemById(id, viewerId);
  }

  async listPurchased(buyerId: string) {
    const pool = await getMysqlPool();
    const [rows] = await pool.query<(RowDataPacket & MarketItem & { sellerName?: string | null; orderNumber?: string | null; purchasedAt?: string | null; purchased?: number })[]>(
      `SELECT ${MARKET_ITEM_SELECT}, u.username AS sellerName, mp.order_number AS orderNumber, mp.created_at AS purchasedAt, 1 AS purchased
       FROM market_purchases mp
       JOIN market_items mi ON mi.id = mp.item_id
       LEFT JOIN users u ON u.id = mi.seller_id
       WHERE mp.buyer_id = ?
       ORDER BY mp.created_at DESC`,
      [buyerId]
    );

    return rows.map((row) => sanitizeItem({ ...row, purchased: true }));
  }

  async reviewItem(id: string, status: MarketItemStatus, rejectionReason?: string) {
    const db = await getDb();
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: sql`UTC_TIMESTAMP()`,
      rejectionReason: status === 'rejected' ? rejectionReason || '未通过审核' : null,
      approvedAt: status === 'approved' ? sql`UTC_TIMESTAMP()` : null,
    };

    await db.update(marketItems).set(updateData).where(eq(marketItems.id, id));
    return this.getItemById(id);
  }

  async purchaseItem(itemId: string, buyerId: string): Promise<MarketPurchaseResult> {
    const pool = await getMysqlPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [itemRows] = await connection.query<(RowDataPacket & {
        id: string;
        seller_id: string;
        title: string;
        price_points: number;
        platform_fee_rate: string | number;
        status: string;
        preview_image_url: string;
        psd_url: string | null;
      })[]>(
        `SELECT id, seller_id, title, price_points, platform_fee_rate, status, preview_image_url, psd_url
         FROM market_items
         WHERE id = ?
         FOR UPDATE`,
        [itemId]
      );
      const item = itemRows[0];
      if (!item || item.status !== 'approved') {
        throw new Error('该素材暂不可购买');
      }
      if (item.seller_id === buyerId) {
        throw new Error('不能购买自己上架的素材');
      }

      const [existingRows] = await connection.query<(RowDataPacket & { id: string })[]>(
        `SELECT id FROM market_purchases WHERE item_id = ? AND buyer_id = ? LIMIT 1`,
        [itemId, buyerId]
      );
      if (existingRows[0]) {
        throw new Error('你已购买过该素材');
      }

      const [buyerRows] = await connection.query<(RowDataPacket & { points: number })[]>(
        `SELECT points FROM users WHERE id = ? AND is_active = TRUE FOR UPDATE`,
        [buyerId]
      );
      const [sellerRows] = await connection.query<(RowDataPacket & { points: number })[]>(
        `SELECT points FROM users WHERE id = ? AND is_active = TRUE FOR UPDATE`,
        [item.seller_id]
      );
      const buyer = buyerRows[0];
      const seller = sellerRows[0];
      if (!buyer || !seller) {
        throw new Error('买家或卖家账号不可用');
      }

      const pricePoints = Number(item.price_points || 0);
      if (!Number.isFinite(pricePoints) || pricePoints <= 0) {
        throw new Error('素材价格异常');
      }
      if (Number(buyer.points || 0) < pricePoints) {
        throw new Error(`积分不足，当前积分：${buyer.points}，需要：${pricePoints}`);
      }

      const feeRate = Math.max(0, Math.min(100, Number(item.platform_fee_rate || 20)));
      const platformFeePoints = Math.floor(pricePoints * feeRate / 100);
      const sellerPoints = pricePoints - platformFeePoints;
      const buyerRemainingPoints = Number(buyer.points) - pricePoints;
      const sellerRemainingPoints = Number(seller.points) + sellerPoints;
      const purchaseId = randomUUID();
      const buyerTransactionId = randomUUID();
      const sellerTransactionId = randomUUID();
      const orderNumber = `MKT${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

      await connection.query(`UPDATE users SET points = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [buyerRemainingPoints, buyerId]);
      await connection.query(`UPDATE users SET points = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [sellerRemainingPoints, item.seller_id]);
      await connection.query(
        `INSERT INTO market_purchases
          (id, item_id, buyer_id, seller_id, order_number, price_points, seller_points, platform_fee_points, buyer_remaining_points, seller_remaining_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, itemId, buyerId, item.seller_id, orderNumber, pricePoints, sellerPoints, platformFeePoints, buyerRemainingPoints, sellerRemainingPoints]
      );
      await connection.query(
        `INSERT INTO transactions
          (id, user_id, order_number, tool_page, description, points, actual_points, remaining_points, status, request_params, result_data, psd_url)
         VALUES (?, ?, ?, '图市购买', ?, ?, ?, ?, '成功', ?, ?, ?)`,
        [
          buyerTransactionId,
          buyerId,
          orderNumber,
          `购买图市素材：${item.title}`,
          pricePoints,
          pricePoints,
          buyerRemainingPoints,
          JSON.stringify({ kind: 'market-purchase', itemId, sellerId: item.seller_id, platformFeePoints, sellerPoints }),
          JSON.stringify([{ imageUrl: item.preview_image_url }]),
          item.psd_url,
        ]
      );
      await connection.query(
        `INSERT INTO transactions
          (id, user_id, order_number, tool_page, description, points, actual_points, remaining_points, status, request_params, result_data, psd_url)
         VALUES (?, ?, ?, '图市收益', ?, ?, ?, ?, '成功', ?, ?, ?)`,
        [
          sellerTransactionId,
          item.seller_id,
          `${orderNumber}-SELLER`,
          `图市素材售出：${item.title}`,
          sellerPoints,
          sellerPoints,
          sellerRemainingPoints,
          JSON.stringify({ kind: 'market-sale', itemId, buyerId, sourceOrderNumber: orderNumber, platformFeePoints, pricePoints }),
          JSON.stringify([{ imageUrl: item.preview_image_url }]),
          item.psd_url,
        ]
      );

      await connection.commit();
      return { orderNumber, buyerRemainingPoints, sellerRemainingPoints, pricePoints, sellerPoints, platformFeePoints };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async userCanDownload(itemId: string, userId: string) {
    const db = await getDb();
    const [ownedItem] = await db
      .select({ id: marketItems.id })
      .from(marketItems)
      .where(and(eq(marketItems.id, itemId), eq(marketItems.sellerId, userId)))
      .limit(1);
    if (ownedItem) return true;

    const pool = await getMysqlPool();
    const [rows] = await pool.query<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM market_purchases WHERE item_id = ? AND buyer_id = ? LIMIT 1`,
      [itemId, userId]
    );
    return Boolean(rows[0]);
  }
}

export const marketManager = new MarketManager();
