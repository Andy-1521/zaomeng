import { and, desc, eq, inArray, like, notLike, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "./client";
import { transactions } from "./shared/schema";
import { insertTransactionSchema } from "./shared/schema";
import type { InsertTransaction, Transaction } from "./shared/schema";

type TransactionFilters = {
  toolPage?: string;
  toolPages?: string[];
  status?: string;
  diagnostic?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  includeUserIds?: string[];
  excludeUserIds?: string[];
  excludeSubOrders?: boolean;
};

type FailureBreakdown = {
  upstreamErrorCount: number;
  timeoutErrorCount: number;
  missingResultCount: number;
  otherFailureCount: number;
};

type TransactionStats = {
  total: number;
  colorExtractionCount: number;
  successCount: number;
  failureCount: number;
  processingCount: number;
  failureBreakdown: FailureBreakdown;
};

function parseStatsResult(result: {
  total?: number | null;
  colorExtractionCount?: number | null;
  successCount?: number | null;
  failureCount?: number | null;
  processingCount?: number | null;
  upstreamErrorCount?: number | null;
  timeoutErrorCount?: number | null;
  missingResultCount?: number | null;
  otherFailureCount?: number | null;
} | undefined): TransactionStats {
  return {
    total: Number(result?.total ?? 0),
    colorExtractionCount: Number(result?.colorExtractionCount ?? 0),
    successCount: Number(result?.successCount ?? 0),
    failureCount: Number(result?.failureCount ?? 0),
    processingCount: Number(result?.processingCount ?? 0),
    failureBreakdown: {
      upstreamErrorCount: Number(result?.upstreamErrorCount ?? 0),
      timeoutErrorCount: Number(result?.timeoutErrorCount ?? 0),
      missingResultCount: Number(result?.missingResultCount ?? 0),
      otherFailureCount: Number(result?.otherFailureCount ?? 0),
    },
  };
}

function buildConditions(filters?: TransactionFilters) {
  const conditions = [];

  if (filters?.toolPages && filters.toolPages.length > 0) {
    conditions.push(inArray(transactions.toolPage, filters.toolPages));
  } else if (filters?.toolPage) {
    conditions.push(eq(transactions.toolPage, filters.toolPage));
  }

  if (filters?.status) {
    conditions.push(eq(transactions.status, filters.status));
  }

  if (filters?.diagnostic) {
    switch (filters.diagnostic) {
      case "missing-result":
        conditions.push(sql`(
          ${transactions.resultData} is null
          or ${transactions.resultData} = ''
          or ${transactions.resultData} = 'null'
          or (
            ${transactions.resultData} not like '%http%'
            and ${transactions.resultData} not like '%result_image_url%'
            and ${transactions.resultData} not like '%imageUrl%'
            and ${transactions.resultData} not like '%image_url%'
          )
        )`);
        break;
      case "has-reference":
        conditions.push(sql`(${transactions.uploadedImage} is not null and ${transactions.uploadedImage} <> '')`);
        break;
      case "has-psd":
        conditions.push(sql`(${transactions.psdUrl} is not null and ${transactions.psdUrl} <> '')`);
        break;
      case "upstream-error":
        conditions.push(sql`(${transactions.resultData} like '%upstream_error%' or ${transactions.resultData} like '%Upstream request failed%')`);
        break;
      case "timeout-error":
        conditions.push(sql`(${transactions.resultData} like '%ETIMEDOUT%' or ${transactions.resultData} like '%timeout%' or ${transactions.resultData} like '%超时%')`);
        break;
      case "other-failure":
        conditions.push(eq(transactions.status, '失败'));
        conditions.push(sql`not (
          ${transactions.resultData} like '%upstream_error%'
          or ${transactions.resultData} like '%Upstream request failed%'
          or ${transactions.resultData} like '%ETIMEDOUT%'
          or ${transactions.resultData} like '%timeout%'
          or ${transactions.resultData} like '%超时%'
        )`);
        break;
      default:
        break;
    }
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

function buildSearchCondition(keyword: string, includeUserIds?: string[]): SQL<unknown> {
  const keywordPattern = `%${keyword}%`;
  const searchConditions: SQL<unknown>[] = [
    like(transactions.orderNumber, keywordPattern),
    like(transactions.description, keywordPattern),
    like(transactions.resultData, keywordPattern),
  ];

  if (includeUserIds && includeUserIds.length > 0) {
    searchConditions.push(inArray(transactions.userId, includeUserIds));
  }
  return or(...searchConditions) as SQL<unknown>;
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

  async getStats(filters?: TransactionFilters): Promise<TransactionStats> {
    const db = await getDb();
    const conditions = buildConditions(filters);
    const query = db
      .select({
        total: sql<number>`count(*)`,
        colorExtractionCount: sql<number>`sum(case when ${transactions.toolPage} in ('彩绘提取', '彩绘提取2') then 1 else 0 end)`,
        successCount: sql<number>`sum(case when ${transactions.status} = '成功' then 1 else 0 end)`,
        failureCount: sql<number>`sum(case when ${transactions.status} = '失败' then 1 else 0 end)`,
        processingCount: sql<number>`sum(case when ${transactions.status} in ('处理中', 'pending') then 1 else 0 end)`,
        upstreamErrorCount: sql<number>`sum(case when ${transactions.status} = '失败' and (${transactions.resultData} like '%upstream_error%' or ${transactions.resultData} like '%Upstream request failed%') then 1 else 0 end)`,
        timeoutErrorCount: sql<number>`sum(case when ${transactions.status} = '失败' and (${transactions.resultData} like '%ETIMEDOUT%' or ${transactions.resultData} like '%timeout%' or ${transactions.resultData} like '%超时%') then 1 else 0 end)`,
        missingResultCount: sql<number>`sum(case when ${transactions.status} <> '失败' and (
          ${transactions.resultData} is null
          or ${transactions.resultData} = ''
          or ${transactions.resultData} = 'null'
          or (
            ${transactions.resultData} not like '%http%'
            and ${transactions.resultData} not like '%result_image_url%'
            and ${transactions.resultData} not like '%imageUrl%'
            and ${transactions.resultData} not like '%image_url%'
          )
        ) then 1 else 0 end)`,
        otherFailureCount: sql<number>`sum(case when ${transactions.status} = '失败' and not (
          ${transactions.resultData} like '%upstream_error%'
          or ${transactions.resultData} like '%Upstream request failed%'
          or ${transactions.resultData} like '%ETIMEDOUT%'
          or ${transactions.resultData} like '%timeout%'
          or ${transactions.resultData} like '%超时%'
        ) then 1 else 0 end)`,
      })
      .from(transactions);

    const [result] = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

    return parseStatsResult(result);
  }

  async searchByKeyword(
    keyword: string,
    filters?: Omit<TransactionFilters, "userId" | "excludeUserIds" | "excludeSubOrders">,
    limit = 50,
    skip = 0
  ): Promise<Transaction[]> {
    const db = await getDb();
    const conditions = buildConditions({
      ...filters,
      includeUserIds: undefined,
      excludeSubOrders: true,
    });
    conditions.push(buildSearchCondition(keyword, filters?.includeUserIds));

    return db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(skip);
  }

  async getSearchStats(
    keyword: string,
    filters?: Omit<TransactionFilters, "userId" | "excludeUserIds" | "excludeSubOrders">
  ): Promise<TransactionStats> {
    const db = await getDb();
    const conditions = buildConditions({
      ...filters,
      includeUserIds: undefined,
      excludeSubOrders: true,
    });
    conditions.push(buildSearchCondition(keyword, filters?.includeUserIds));

    const [result] = await db
      .select({
        total: sql<number>`count(*)`,
        colorExtractionCount: sql<number>`sum(case when ${transactions.toolPage} in ('彩绘提取', '彩绘提取2') then 1 else 0 end)`,
        successCount: sql<number>`sum(case when ${transactions.status} = '成功' then 1 else 0 end)`,
        failureCount: sql<number>`sum(case when ${transactions.status} = '失败' then 1 else 0 end)`,
        processingCount: sql<number>`sum(case when ${transactions.status} in ('处理中', 'pending') then 1 else 0 end)`,
        upstreamErrorCount: sql<number>`sum(case when ${transactions.status} = '失败' and (${transactions.resultData} like '%upstream_error%' or ${transactions.resultData} like '%Upstream request failed%') then 1 else 0 end)`,
        timeoutErrorCount: sql<number>`sum(case when ${transactions.status} = '失败' and (${transactions.resultData} like '%ETIMEDOUT%' or ${transactions.resultData} like '%timeout%' or ${transactions.resultData} like '%超时%') then 1 else 0 end)`,
        missingResultCount: sql<number>`sum(case when ${transactions.status} <> '失败' and (
          ${transactions.resultData} is null
          or ${transactions.resultData} = ''
          or ${transactions.resultData} = 'null'
          or (
            ${transactions.resultData} not like '%http%'
            and ${transactions.resultData} not like '%result_image_url%'
            and ${transactions.resultData} not like '%imageUrl%'
            and ${transactions.resultData} not like '%image_url%'
          )
        ) then 1 else 0 end)`,
        otherFailureCount: sql<number>`sum(case when ${transactions.status} = '失败' and not (
          ${transactions.resultData} like '%upstream_error%'
          or ${transactions.resultData} like '%Upstream request failed%'
          or ${transactions.resultData} like '%ETIMEDOUT%'
          or ${transactions.resultData} like '%timeout%'
          or ${transactions.resultData} like '%超时%'
        ) then 1 else 0 end)`,
      })
      .from(transactions)
      .where(and(...conditions));

    return parseStatsResult(result);
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
      prompt?: string;
      description?: string;
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
      prompt: updates.prompt,
      description: updates.description,
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
