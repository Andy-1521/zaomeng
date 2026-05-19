import { transactionManager } from '@/storage/database';
import type { Transaction } from '@/storage/database/shared/schema';

const DEFAULT_MAX_AGE_MINUTES = 15;
const DEFAULT_TIMEOUT_MESSAGE = '订单处理超时，已自动标记为超时';

function isProcessingStatus(status?: string | null) {
  return status === '处理中' || status === 'pending';
}

function isUrlLike(value: string) {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/');
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values));
}

function extractImageUrls(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null) return [];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (isUrlLike(trimmed)) return [trimmed];

    try {
      return extractImageUrls(JSON.parse(trimmed), seen);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return [];
    seen.add(value);
    return dedupeStrings(value.flatMap((item) => extractImageUrls(item, seen)));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return [];
    seen.add(value);

    const record = value as Record<string, unknown>;
    const preferredKeys = ['imageUrl', 'image_url', 'result_image_url', 'url', 'fileUrl', 'urls', 'images', 'data'];
    const preferredValues = preferredKeys.filter((key) => key in record).map((key) => record[key]);
    const fallbackValues = preferredValues.length > 0 ? preferredValues : Object.values(record);
    return dedupeStrings(fallbackValues.flatMap((item) => extractImageUrls(item, seen)));
  }

  return [];
}

function extractFailureMessage(value: unknown, seen = new Set<unknown>()): string {
  if (value == null) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (isUrlLike(trimmed)) return '';

    try {
      return extractFailureMessage(JSON.parse(trimmed), seen);
    } catch {
      return trimmed;
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '';
    seen.add(value);

    for (const item of value) {
      const message = extractFailureMessage(item, seen);
      if (message) return message;
    }
    return '';
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);

    const record = value as Record<string, unknown>;
    const candidateKeys = ['error', 'message', 'detail', 'reason'];
    for (const key of candidateKeys) {
      const message = extractFailureMessage(record[key], seen);
      if (message) return message;
    }

    for (const item of Object.values(record)) {
      const message = extractFailureMessage(item, seen);
      if (message) return message;
    }
  }

  return '';
}

function isOlderThan(createdAt: Transaction['createdAt'], maxAgeMinutes: number) {
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return false;
  return Date.now() - createdTime > maxAgeMinutes * 60 * 1000;
}

function resolveStaleTransactionUpdate(transaction: Transaction) {
  const imageUrls = extractImageUrls(transaction.resultData);
  if (imageUrls.length > 0) {
    return { status: '成功' };
  }

  const failureMessage = extractFailureMessage(transaction.resultData);
  if (failureMessage) {
    return {
      status: /timeout|超时/i.test(failureMessage) ? '超时' : '失败',
      resultData: failureMessage,
    };
  }

  return {
    status: '超时',
    resultData: DEFAULT_TIMEOUT_MESSAGE,
  };
}

export async function reconcileProcessingTransactions(
  records: Transaction[],
  options?: {
    maxAgeMinutes?: number;
    logPrefix?: string;
  },
) {
  const maxAgeMinutes = options?.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;
  const staleRecords = records.filter((record) => isProcessingStatus(record.status) && isOlderThan(record.createdAt, maxAgeMinutes));

  if (staleRecords.length === 0) {
    return records;
  }

  const updatedByOrderNumber = new Map<string, Transaction>();

  await Promise.all(staleRecords.map(async (record) => {
    const updates = resolveStaleTransactionUpdate(record);
    try {
      const updated = await transactionManager.updateTransaction(record.orderNumber, updates);
      if (updated) {
        updatedByOrderNumber.set(record.orderNumber, updated);
      }
    } catch (error) {
      console.error(`[${options?.logPrefix || 'Transactions'}] 自动纠正陈旧处理中订单失败:`, record.orderNumber, error);
    }
  }));

  if (updatedByOrderNumber.size === 0) {
    return records;
  }

  return records.map((record) => updatedByOrderNumber.get(record.orderNumber) || record);
}
