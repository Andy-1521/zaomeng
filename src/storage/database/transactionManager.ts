import { and, desc, eq, inArray, like, notLike, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./client";
import { transactions } from "./shared/schema";
import { insertTransactionSchema } from "./shared/schema";
import type { InsertTransaction, Transaction } from "./shared/schema";

type TransactionFilters = {
  toolPage?: string;
  status?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  includeUserIds?: string[];
  excludeUserIds?: string[];
  excludeSubOrders?: boolean;
};

function buildConditions(filters?: TransactionFilters) {
  const conditions = [];

  if (filters?.toolPage) {
    conditions.push(eq(transactions.toolPage, filters.toolPage));
  }

  if (filters?.status) {
    conditions.push(eq(transactions.status, filters.status));
  }

  if (filters?.userId) {
    conditions.push(eq(transactions.userId, filters.userId));
  }

  if (filters?.startDate) {
    conditions.push(sql`${transactions.createdAt} >= ${filters.startDate.toISOString()}`);
  }

  if (filters?.endDate) {
    conditions.push(sql`${transactions.createdAt} <= ${filters.endDate.toISOString()}`);
  }

  if (filters?.includeUserIds && filters.includeUserIds.length > 0) {
    conditions.push(inArray(transactions.userId, filters.includeUserIds));
  }

  if (filters?.excludeUserIds && filters.excludeUserIds.length > 0) {
    conditions.push(sql`${transactions.userId} NOT IN (${sql.join(filters.excludeUserIds.map((id) => sql`${id}`), sql`, `)})`);
  }

  if (filters?.excludeSubOrders) {
    conditions.push(notLike(transactions.orderNumber, "%-polling%"));
    conditions.push(notLike(transactions.orderNumber, "%-sub%"));
  }

  return conditions;
}

async function getTransactionBy(field: "id" | "orderNumber", value: string) {
  const db = await getDb();
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(field === "id" ? eq(transactions.id, value) : eq(transactions.orderNumber, value))
    .limit(1);

  return transaction ?? null;
}

export class TransactionManager {
  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const db = await getDb();
    const validated = insertTransactionSchema.parse(data);
    const id = randomUUID();

    await db.insert(transactions).values({
      id,
      userId: validated.userId,
      orderNumber: validated.orderNumber,
      toolPage: validated.toolPage,
      description: validated.description,
      points: validated.points,
      actualPoints: validated.actualPoints ?? 0,
      remainingPoints: validated.remainingPoints,
      status: validated.status ?? "成功",
      prompt: validated.prompt ?? null,
      requestParams: validated.requestParams ?? null,
      resultData: validated.resultData ?? null,
      psdUrl: validated.psdUrl ?? null,
      uploadedImage: validated.uploadedImage ?? null,
    });

    const transaction = await getTransactionBy("id", id);

    if (!transaction) {
      throw new Error("创建订单后读取失败");
    }

    return transaction;
  }

  async getTransactionById(id: string): Promise<Transaction | null> {
    return getTransactionBy("id", id);
  }

  async getTransactionByOrderNumber(orderNumber: string): Promise<Transaction | null> {
    return getTransactionBy("orderNumber", orderNumber);
  }

  async getUserTransactions(userId: string, limit = 50, cursor?: string | null): Promise<Transaction[]> {
    const db = await getDb();
    const conditions = [eq(transactions.userId, userId)];

    if (cursor) {
      conditions.push(sql`${transactions.createdAt} < ${cursor}`);
    }

    return db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(limit);
  }

  async getAllTransactions(skip = 0, limit = 100, filters?: TransactionFilters): Promise<Transaction[]> {
    const db = await getDb();
    const conditions = buildConditions(filters);
    const query = db.select().from(transactions);

    if (conditions.length > 0) {
      return query.where(and(...conditions)).orderBy(desc(transactions.createdAt)).limit(limit).offset(skip);
    }

    return query.orderBy(desc(transactions.createdAt)).limit(limit).offset(skip);
  }

  async getStats(filters?: TransactionFilters): Promise<{
    total: number;
    colorExtractionCount: number;
    successCount: number;
    failureCount: number;
  }> {
    const db = await getDb();
    const conditions = buildConditions(filters);
    const query = db
      .select({
        total: sql<number>`count(*)`,
        colorExtractionCount: sql<number>`sum(case when ${transactions.toolPage} = '彩绘提取' then 1 else 0 end)`,
        successCount: sql<number>`sum(case when ${transactions.status} = '成功' then 1 else 0 end)`,
        failureCount: sql<number>`sum(case when ${transactions.status} = '失败' then 1 else 0 end)`,
      })
      .from(transactions);

    const [result] = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

    return {
      total: Number(result?.total ?? 0),
      colorExtractionCount: Number(result?.colorExtractionCount ?? 0),
      successCount: Number(result?.successCount ?? 0),
      failureCount: Number(result?.failureCount ?? 0),
    };
  }

  async searchByKeyword(
    keyword: string,
    filters?: Omit<TransactionFilters, "userId" | "excludeUserIds" | "excludeSubOrders">,
    limit = 50,
    skip = 0
  ): Promise<Transaction[]> {
    const db = await getDb();
    const conditions = buildConditions({ ...filters, excludeSubOrders: true });
    conditions.push(like(transactions.orderNumber, `%${keyword}%`));

    return db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(skip);
  }

  async getCount(filters?: TransactionFilters): Promise<number> {
    const db = await getDb();
    const conditions = buildConditions(filters);
    const query = db.select({ count: sql<number>`count(*)` }).from(transactions);
    const [result] = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return Number(result?.count ?? 0);
  }

  async updateTransaction(
    orderNumber: string,
    updates: {
      status?: string;
      resultData?: string;
      remainingPoints?: number;
      requestParams?: string;
      psdUrl?: string;
      points?: number;
      uploadedImage?: string;
      actualPoints?: number;
    }
  ): Promise<Transaction | null> {
    const db = await getDb();
    const updateData: Record<string, string | number | null | undefined> = {
      status: updates.status,
      resultData: updates.resultData,
      remainingPoints: updates.remainingPoints,
      requestParams: updates.requestParams,
      psdUrl: updates.psdUrl,
      points: updates.points,
      uploadedImage: updates.uploadedImage,
      actualPoints: updates.actualPoints,
    };

    const finalUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(finalUpdateData).length === 0) {
      return this.getTransactionByOrderNumber(orderNumber);
    }

    await db.update(transactions).set(finalUpdateData).where(eq(transactions.orderNumber, orderNumber));
    return this.getTransactionByOrderNumber(orderNumber);
  }

  generateOrderNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    return `ORD${timestamp}${random}`;
  }

  async clearUserTransactions(userId: string): Promise<number> {
    const db = await getDb();
    const existing = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, userId));

    if (existing.length === 0) {
      return 0;
    }

    await db.delete(transactions).where(eq(transactions.userId, userId));
    return existing.length;
  }

  async deleteTransaction(orderNumber: string): Promise<boolean> {
    const db = await getDb();
    const existing = await this.getTransactionByOrderNumber(orderNumber);

    if (!existing) {
      return false;
    }

    await db.delete(transactions).where(eq(transactions.orderNumber, orderNumber));
    return true;
  }
}

export const transactionManager = new TransactionManager();
