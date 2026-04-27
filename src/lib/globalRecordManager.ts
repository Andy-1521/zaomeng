/**
 * 全局记录管理器
 * 统一管理去水印、智能抠图、彩绘提取等所有页面的记录
 * 解决问题：
 * 1. 订单加载慢 - 使用缓存机制
 * 2. 状态不统一 - 统一的数据结构和管理方式
 * 3. 重复加载 - 跨页面共享数据
 */

import { showToast } from '@/lib/toast';

export type RecordType = 'watermark' | 'remove-bg' | 'color-extraction';

export interface GlobalRecord {
  id: string;
  type: RecordType;
  orderId?: string;
  title: string;
  imageUrl?: string;
  resultUrl?: string;
  status: 'processing' | 'success' | 'failed';
  createdAt: number;
  uploadedImages?: string[];
  metadata?: Record<string, any>;
}

// 全局缓存
const recordCache = new Map<RecordType, GlobalRecord[]>();
const cacheTimestamps = new Map<RecordType, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 事件监听器
const listeners = new Set<(type: RecordType, records: GlobalRecord[]) => void>();

/**
 * 订阅记录变化
 */
export function subscribe(
  type: RecordType,
  callback: (records: GlobalRecord[]) => void
): () => void {
  const listener = (recordType: RecordType, records: GlobalRecord[]) => {
    if (recordType === type) {
      callback(records);
    }
  };

  listeners.add(listener);

  // 返回取消订阅的函数
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 通知所有监听器
 */
function notifyListeners(type: RecordType, records: GlobalRecord[]): void {
  listeners.forEach(listener => {
    try {
      listener(type, records);
    } catch (error) {
      console.error('[GlobalRecordManager] 通知监听器失败:', error);
    }
  });
}

/**
 * 添加记录
 */
export function addRecord(record: GlobalRecord): void {
  const records = recordCache.get(record.type) || [];
  records.unshift(record);
  recordCache.set(record.type, records);
  cacheTimestamps.set(record.type, Date.now());

  notifyListeners(record.type, records);
}

/**
 * 更新记录
 */
export function updateRecord(
  type: RecordType,
  recordId: string,
  updates: Partial<GlobalRecord>
): void {
  const records = recordCache.get(type) || [];
  const index = records.findIndex(r => r.id === recordId);

  if (index !== -1) {
    records[index] = { ...records[index], ...updates };
    recordCache.set(type, records);
    notifyListeners(type, records);
  }
}

/**
 * 删除记录
 */
export function deleteRecord(type: RecordType, recordId: string): void {
  const records = recordCache.get(type) || [];
  const filtered = records.filter(r => r.id !== recordId);
  recordCache.set(type, filtered);
  notifyListeners(type, filtered);
}

/**
 * 获取记录（带缓存）
 */
export function getRecords(type: RecordType): GlobalRecord[] {
  const now = Date.now();
  const timestamp = cacheTimestamps.get(type);

  // 检查缓存是否有效
  if (timestamp && now - timestamp < CACHE_TTL) {
    console.log(`[GlobalRecordManager] 使用缓存记录: ${type}, 数量: ${recordCache.get(type)?.length}`);
    return recordCache.get(type) || [];
  }

  // 缓存已过期，清除
  recordCache.delete(type);
  cacheTimestamps.delete(type);

  return [];
}

/**
 * 从服务器加载记录
 */
export async function loadRecordsFromServer(type: RecordType, userId: string): Promise<GlobalRecord[]> {
  try {
    console.log(`[GlobalRecordManager] 从服务器加载记录: ${type}, userId: ${userId}`);

    let endpoint = '';
    switch (type) {
      case 'watermark':
        endpoint = `/api/user/transactions?userId=${userId}`;
        break;
      case 'remove-bg':
        endpoint = `/api/user/transactions?userId=${userId}`;
        break;
      case 'color-extraction':
        endpoint = `/api/user/transactions?userId=${userId}`;
        break;
      default:
        throw new Error(`未知的记录类型: ${type}`);
    }

    const response = await fetch(endpoint, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`加载记录失败: ${response.status}`);
    }

    const result = await response.json();

    // 转换为统一格式
    const records = transformToRecords(type, result.data || []);

    // 更新缓存
    recordCache.set(type, records);
    cacheTimestamps.set(type, Date.now());

    console.log(`[GlobalRecordManager] 从服务器加载记录成功: ${type}, 数量: ${records.length}`);

    notifyListeners(type, records);

    return records;
  } catch (error: any) {
    console.error(`[GlobalRecordManager] 从服务器加载记录失败: ${type}`, error);
    showToast('加载记录失败', 'error');
    return [];
  }
}

/**
 * 转换为统一格式
 */
function transformToRecords(type: RecordType, data: any[]): GlobalRecord[] {
  return data.map((item: any) => {
    switch (type) {
      default:
        // 对于其他类型，从transaction数据转换
        return {
          id: item.id,
          type: type,
          orderId: item.orderNumber,
          title: item.description,
          resultUrl: typeof item.resultData === 'string' ? item.resultData : item.resultData?.imageUrl,
          status: item.status === '处理中' ? 'processing' : item.status === '成功' ? 'success' : 'failed',
          createdAt: item.createdAt || item.time,
          metadata: {
            points: item.points,
            toolPage: item.toolPage,
          },
        };
    }
  });
}

/**
 * 清除缓存
 */
export function clearCache(type?: RecordType): void {
  if (type) {
    recordCache.delete(type);
    cacheTimestamps.delete(type);
  } else {
    recordCache.clear();
    cacheTimestamps.clear();
  }
}
