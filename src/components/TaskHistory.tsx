'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '@/lib/toast';
import { clearCache } from '@/lib/globalRecordManager';
import { ImageThumbnail } from '@/components/ui/ImageThumbnail';

export type TabType = 'color-extraction' | 'auto-remove-bg' | 'watermark' | 'custom' | 'ai-generate';
export type FilterType = 'all' | TabType;
type TaskCenterFilter = 'all' | 'processing' | 'success' | 'failed';
export type TaskStatus = '处理中' | '成功' | '失败' | '超时' | '部分成功';

export interface TaskRecord {
  id: string;
  tab: TabType;
  tabName: string;
  description: string;
  time: number;
  imageUrl?: string | string[]; // 支持单图片（string）或多图片（string[]）
  imageUrls?: string[]; // 【废弃】用于多图片（已合并到imageUrl中，保留用于向后兼容）
  orderId?: string;
  duration?: number; // 运行时长（秒）
  uploadedImage?: string | string[]; // 上传的参考图片（支持单张或多张）
  status?: TaskStatus; // 任务状态
  psdUrl?: string; // PSD文件URL（彩绘提取订单）
  aspectRatio?: string; // 图像比例
  imageSize?: string; // 分辨率
  generateCount?: number; // 【新增】预期生成数量（用于判断部分成功）
  errorMessage?: string; // 失败原因
}

interface TaskHistoryProps {
  activeTab: TabType;
  onTaskClick?: (task: TaskRecord) => void;
  // 可选：传入用户ID，用于强制刷新（当用户切换账号时）
  userId?: string;
}

type ResultDataObject = {
  imageUrl?: string | string[];
  image_url?: string | string[];
  result_image_url?: string | string[];
  [key: string]: unknown;
};

type RequestParamsObject = {
  urls?: string[];
  uploadedImage?: string | string[];
  uploaded_image?: string | string[];
  aspectRatio?: string;
  imageSize?: string;
  generateCount?: number;
  [key: string]: unknown;
};

type TaskRecordApiItem = {
  id: string;
  orderNumber?: string;
  prompt?: string;
  description?: string;
  resultData?: unknown;
  requestParams?: unknown;
  psdUrl?: string;
  status?: string;
  duration?: number;
  time?: number | string;
  createdAt?: number | string;
  toolPage?: string;
};

type TaskRecordApiResponse = {
  success?: boolean;
  data?: TaskRecordApiItem[];
};

const taskRecordCacheByUser = new Map<string, TaskRecord[]>();

function getFirstImage(value?: string | string[]): string | null {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.length > 0) || null;
  }

  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getImageList(value?: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function isImageValue(value: string | null): value is string {
  return !!value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'));
}

function getOrderSuffix(orderId?: string) {
  if (!orderId) return '未生成';
  return orderId.slice(-6);
}

function getTaskDateGroup(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
}

function getTaskStatusLabel(task: TaskRecord) {
  if (task.status === '成功') return '成功';
  if (task.status === '失败') return '失败';
  if (task.status === '超时') return '超时';
  if (task.status === '部分成功') return '部分成功';
  if (task.status === '处理中') return '处理中';
  return '成功';
}

function getStatusClasses(status?: TaskStatus) {
  if (status === '成功') return 'border-emerald-400/50 bg-emerald-500/12 text-emerald-200';
  if (status === '失败') return 'border-red-400/50 bg-red-500/12 text-red-200';
  if (status === '超时') return 'border-amber-400/50 bg-amber-500/12 text-amber-200';
  if (status === '部分成功') return 'border-orange-400/50 bg-orange-500/12 text-orange-200';
  return 'border-blue-400/50 bg-blue-500/12 text-blue-200';
}

function getTaskCardClasses(status?: TaskStatus) {
  if (status === '成功') return 'border-emerald-400/16 bg-emerald-500/[0.055] hover:border-emerald-300/28 hover:bg-emerald-500/[0.075]';
  if (status === '失败') return 'border-red-400/18 bg-red-500/[0.05] hover:border-red-300/28 hover:bg-red-500/[0.07]';
  if (status === '超时') return 'border-amber-400/18 bg-amber-500/[0.05] hover:border-amber-300/28 hover:bg-amber-500/[0.07]';
  if (status === '部分成功') return 'border-orange-400/18 bg-orange-500/[0.05] hover:border-orange-300/28 hover:bg-orange-500/[0.07]';
  return 'border-blue-400/18 bg-blue-500/[0.05] hover:border-blue-300/28 hover:bg-blue-500/[0.07]';
}

function matchesTaskCenterFilter(task: TaskRecord, filter: TaskCenterFilter) {
  if (filter === 'all') return true;
  if (filter === 'processing') return task.status === '处理中';
  if (filter === 'success') return task.status === '成功' || task.status === '部分成功' || !task.status;
  return task.status === '失败' || task.status === '超时';
}

function getStatusPriority(status?: TaskStatus) {
  if (status === '处理中') return 0;
  if (status === '失败' || status === '超时') return 1;
  if (status === '部分成功') return 2;
  return 3;
}

function getStoredUserId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const userFromLocalStorage = localStorage.getItem('user');
  if (!userFromLocalStorage) {
    return null;
  }

  try {
    const userData = JSON.parse(userFromLocalStorage) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch (error) {
    console.error('[TaskHistory] 解析用户信息失败:', error);
    return null;
  }
}

function getTaskCacheKey(userId?: string): string {
  return userId || getStoredUserId() || 'anonymous';
}

function getTaskCache(userId?: string): TaskRecord[] {
  return taskRecordCacheByUser.get(getTaskCacheKey(userId)) ?? [];
}

function setTaskCache(records: TaskRecord[], userId?: string) {
  taskRecordCacheByUser.set(getTaskCacheKey(userId), records);
}

function updateTaskCache(
  updater: (records: TaskRecord[]) => TaskRecord[],
  userId?: string
): TaskRecord[] {
  const nextRecords = updater([...getTaskCache(userId)]);
  setTaskCache(nextRecords, userId);
  return nextRecords;
}

// 导出添加任务记录函数，供外部调用
// 注意：历史记录现在完全由后端 API 管理，此函数仅用于触发前端刷新
// 导出获取缓存记录的函数
export const getCachedTasks = () => {
  return getTaskCache();
};

// 清理缓存中已经没有意义的临时记录。
// 这里只移除没有订单号、且超过24小时的临时前端占位记录，
// 已入库的历史任务应长期保留并始终由后端接口返回。
const cleanExpiredCache = (userId?: string) => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const currentRecords = getTaskCache(userId);
  const filteredRecords = currentRecords.filter((record) => {
    if (record.orderId) {
      return true;
    }

    return now - record.time <= oneDay;
  });
  setTaskCache(filteredRecords, userId);

  if (filteredRecords.length < currentRecords.length) {
    console.log('[TaskHistory] 清理过期缓存记录:', currentRecords.length - filteredRecords.length, '条');
  }
};

export const addTaskRecord = (
  tab: TabType,
  tabName: string,
  description: string,
  imageUrl?: string,
  orderId?: string,
  duration?: number,
  uploadedImage?: string,
  status?: TaskStatus
) => {
  // 创建任务记录
  const record: TaskRecord = {
    id: orderId || `temp-${Date.now()}`,
    tab,
    tabName,
    description,
    time: Date.now(),
    imageUrl,
    orderId,
    duration,
    uploadedImage,
    status,
  };

  // 添加到缓存
  updateTaskCache((records) => [record, ...records]);

  // 触发自定义事件，通知 TaskHistory 组件立即刷新
  window.dispatchEvent(new Event('taskHistoryUpdated'));
};

// 导出更新任务记录orderId的函数（用于将临时ID更新为真实订单号）
export const updateTaskRecordOrderId = (tempOrderId: string, realOrderId: string) => {
  const record = getTaskCache().find((task) => task.orderId === tempOrderId);
  if (record) {
    updateTaskCache((records) =>
      records.map((task) =>
        task.orderId === tempOrderId
          ? {
              ...task,
              orderId: realOrderId,
              id: realOrderId,
            }
          : task
      )
    );
    console.log('[TaskHistory] 更新任务记录orderId:', tempOrderId, '->', realOrderId);
    window.dispatchEvent(new Event('taskHistoryUpdated'));
  }
};

// 导出更新任务记录状态的函数
export const updateTaskRecordStatus = (orderId: string, status: TaskStatus, imageUrl?: string) => {
  const record = getTaskCache().find((task) => task.orderId === orderId);
  if (record) {
    updateTaskCache((records) =>
      records.map((task) =>
        task.orderId === orderId
          ? {
              ...task,
              status,
              imageUrl: imageUrl ?? task.imageUrl,
            }
          : task
      )
    );
    console.log('[TaskHistory] 更新任务记录状态:', orderId, status);
    window.dispatchEvent(new Event('taskHistoryUpdated'));
  }
};

// 从数据库加载历史记录（带缓存优化）
const loadTasksFromDatabase = async (userId?: string): Promise<TaskRecord[]> => {
  console.log('[TaskHistory] loadTasksFromDatabase ========== 开始 ==========');
  console.log('[TaskHistory] loadTasksFromDatabase - userId:', userId);

  try {
    // 优先使用传入的userId，否则从 localStorage 获取
      let userData: { id: string };

    if (userId) {
      userData = { id: userId };
      console.log('[TaskHistory] loadTasksFromDatabase - 使用传入的userId:', userId);
      console.log('[TaskHistory] 使用传入的userId:', userId);
    } else {
      // 从 localStorage 获取用户信息
      const userFromLocalStorage = localStorage.getItem('user');
      if (!userFromLocalStorage) {
        console.log('[TaskHistory] 未找到用户信息，请先登录');
        return [];
      }

      try {
        userData = JSON.parse(userFromLocalStorage);
      } catch (e) {
        console.error('[TaskHistory] 解析用户信息失败:', e);
        return [];
      }
    }

    // 【优化】先尝试从缓存加载
    let response: Response;
    try {
      response = await fetch(`/api/user/transactions?userId=${userData.id}&limit=200`, {
        credentials: 'include',
      });
      } catch (fetchError: unknown) {
        // 捕获fetch本身的错误（网络错误、超时等）
        const errorMessage = fetchError instanceof Error ? fetchError.message : '未知错误';
        console.error('[TaskHistory] Fetch请求失败:', errorMessage);
        return [];
      }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TaskHistory] 加载数据库历史记录失败:', errorText.substring(0, 500));
      return [];
    }

    // 检查响应内容是否是JSON格式
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[TaskHistory] 响应不是JSON格式，内容:', text.substring(0, 500));
      return [];
    }

    const result = await response.json() as TaskRecordApiResponse;
    console.log('[TaskHistory] loadTasksFromDatabase - API返回数据:', {
      success: result.success,
      dataLength: result.data?.length,
      firstOrderNumber: result.data?.[0]?.orderNumber,
      lastOrderNumber: result.data?.[result.data.length - 1]?.orderNumber,
    });

    if (!result.success || !Array.isArray(result.data)) {
      console.error('[TaskHistory] 数据库返回数据格式错误');
      return [];
    }

    const transformed = transformDatabaseData(result.data);
    console.log('[TaskHistory] loadTasksFromDatabase ========== 完成，返回', transformed.length, '条记录 ==========');
    return transformed;
  } catch (error) {
    console.error('[TaskHistory] 从数据库加载历史记录异常:', error);
    return [];
  }
};

// 【新增】强制刷新缓存
export const forceRefreshCache = (userId?: string) => {
  clearCache();
  setTaskCache([], userId);
  window.dispatchEvent(new Event('taskHistoryUpdated'));
};

  // 转换数据库数据到 TaskRecord 格式
  const transformDatabaseData = (data: TaskRecordApiItem[]): TaskRecord[] => {
    console.log('[TaskHistory] transformDatabaseData ========== 开始 ==========');
    console.log('[TaskHistory] transformDatabaseData - 输入数据数量:', data.length);
    if (data.length > 0) {
      const firstItem = data[0];
      const lastItem = data[data.length - 1];
      console.log('[TaskHistory] transformDatabaseData - 第一条数据:', {
        orderNumber: firstItem.orderNumber,
        resultData: firstItem.resultData ? (typeof firstItem.resultData === 'string' ? firstItem.resultData.substring(0, 100) + '...' : JSON.stringify(firstItem.resultData).substring(0, 100) + '...') : null,
        createdAt: firstItem.createdAt,
      });
      console.log('[TaskHistory] transformDatabaseData - 最后一条数据:', {
        orderNumber: lastItem.orderNumber,
        resultData: lastItem.resultData ? (typeof lastItem.resultData === 'string' ? lastItem.resultData.substring(0, 100) + '...' : JSON.stringify(lastItem.resultData).substring(0, 100) + '...') : null,
        createdAt: lastItem.createdAt,
      });
    } else {
      console.warn('[TaskHistory] transformDatabaseData - 输入数据为空！');
    }

    // 映射数据库数据到 TaskRecord 格式
    const tasks: TaskRecord[] = data
      .filter((item) => item.orderNumber && (item.prompt || item.description)) // 过滤没有订单号、提示词或描述的记录
      .map((item) => {
      // 【调试】打印订单的原始数据
      console.log('[TaskHistory] 解析订单:', {
        orderNumber: item.orderNumber,
        toolPage: item.toolPage,
        resultData: item.resultData ? (typeof item.resultData === 'string' ? item.resultData.substring(0, 100) + '...' : JSON.stringify(item.resultData)) : null,
      });

      // 解析 resultData 获取图片 URL（支持多图片数组）
      let imageUrl: string | string[] = '';
      let errorMessage: string | undefined;
      if (item.resultData) {
        if (Array.isArray(item.resultData)) {
          // 【新增】如果resultData已经是数组（多图片），直接使用
          imageUrl = item.resultData;
          console.log('[TaskHistory] resultData是数组，图片数量:', item.resultData.length);
        } else if (typeof item.resultData === 'object') {
          // 如果resultData是对象，尝试获取imageUrl字段
          const resultDataObject = item.resultData as ResultDataObject;
          imageUrl = resultDataObject.imageUrl || resultDataObject.image_url || resultDataObject.result_image_url || '';
          const errorValue = resultDataObject.error;
          if (typeof errorValue === 'string' && errorValue.trim()) {
            errorMessage = errorValue.trim();
          }
          console.log('[TaskHistory] resultData是对象，提取imageUrl');
        } else if (typeof item.resultData === 'string') {
          // 如果resultData是字符串，可能是单个URL或JSON数组
          console.log('[TaskHistory] resultData是字符串，尝试解析:', item.resultData.substring(0, 80) + '...');
          try {
            // 尝试解析为JSON数组
            const parsed = JSON.parse(item.resultData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              imageUrl = parsed;
              console.log('[TaskHistory] resultData解析为数组，图片数量:', parsed.length);
            } else {
              imageUrl = item.resultData;
              console.log('[TaskHistory] 解析结果不是有效数组，使用原始字符串');
            }
          } catch {
            // 不是JSON格式，直接使用字符串
            imageUrl = item.resultData;
            if (!item.resultData.startsWith('http://') && !item.resultData.startsWith('https://') && !item.resultData.startsWith('/')) {
              errorMessage = item.resultData;
            }
            console.log('[TaskHistory] resultData无法解析为JSON，使用原始字符串');
          }
        }
      }
      console.log('[TaskHistory] 解析后imageUrl:', {
        type: typeof imageUrl,
        isArray: Array.isArray(imageUrl),
        length: Array.isArray(imageUrl) ? imageUrl.length : 0,
        value: typeof imageUrl === 'string' ? imageUrl.substring(0, 60) + '...' : JSON.stringify(imageUrl),
      });

      // 解析 requestParams 获取上传的参考图片
      let uploadedImage: string | string[] = '';
      let aspectRatio: string | undefined = undefined;
      let imageSize: string | undefined = undefined;
      let generateCount: number | undefined = undefined; // 【新增】预期生成数量

      if (item.requestParams) {
        try {
          let params: RequestParamsObject | undefined;
          if (typeof item.requestParams === 'object') {
            params = item.requestParams as RequestParamsObject;
          } else if (typeof item.requestParams === 'string') {
            // 尝试解析 JSON 字符串
            params = JSON.parse(item.requestParams) as RequestParamsObject;
          }

          if (params && params.urls && Array.isArray(params.urls) && params.urls.length > 0) {
            // 保存完整的图片数组
            uploadedImage = params.urls;
          } else if (params && params.uploadedImage) {
            uploadedImage = params.uploadedImage;
          } else if (params && params.uploaded_image) {
            uploadedImage = params.uploaded_image;
          }

          // 解析aspectRatio、imageSize和generateCount
          if (params && params.aspectRatio) {
            aspectRatio = params.aspectRatio;
          }
          if (params && params.imageSize) {
            imageSize = params.imageSize;
          }
          if (params && params.generateCount) {
            generateCount = params.generateCount;
          }
        } catch {
          // 解析失败
          uploadedImage = '';
        }
      }

      // 提取 PSD URL
      let psdUrl = '';
      if (item.psdUrl) {
        psdUrl = item.psdUrl;
      }

      // 确保 description 是字符串
      let description = '未知';
      if (typeof item.prompt === 'string' && item.prompt.trim() !== '') {
        description = item.prompt.trim();
      } else if (typeof item.description === 'string' && item.description.trim() !== '') {
        description = item.description.trim();
      }

      // 映射状态
      let status: TaskStatus = '成功';
      if (item.status === '失败' || item.status === 'failed') {
        status = '失败';
      } else if (item.status === '处理中' || item.status === 'pending') {
        status = '处理中';
      } else if (item.status === '超时' || item.status === 'timeout') {
        status = '超时';
      } else if (item.status !== '成功' && item.status !== 'success') {
        // 如果状态不是预期的任何值，标记为失败（修复状态异常的情况）
        console.warn('[TaskHistory] 订单状态异常:', item.orderNumber, 'status:', item.status, '将标记为失败');
        status = '失败';
      }

      // 【新增】判断是否为"部分成功"：预期生成数量 > 实际生成数量
      if (status === '成功' && generateCount && generateCount > 1) {
        const actualCount = Array.isArray(imageUrl) ? imageUrl.length : (imageUrl ? 1 : 0);
        if (actualCount > 0 && actualCount < generateCount) {
          status = '部分成功';
          description += `（生成${actualCount}/${generateCount}张）`;
          console.log('[TaskHistory] 订单部分成功:', item.orderNumber, '预期:', generateCount, '实际:', actualCount);
        }
      }

      // 计算运行时长（如果有开始时间和结束时间）
      const duration = item.duration || undefined;

      // 处理时间戳
      let time = 0;
      if (item.time) {
        // 如果 item.time 已经是时间戳（数字），直接使用
        if (typeof item.time === 'number') {
          time = item.time;
        } else if (typeof item.time === 'string') {
          // 如果是字符串，尝试解析为日期
          const parsedTime = new Date(item.time).getTime();
          if (!isNaN(parsedTime)) {
            time = parsedTime;
          }
        }
      } else if (item.createdAt) {
        // 使用 createdAt 字段作为后备
        if (typeof item.createdAt === 'number') {
          time = item.createdAt;
        } else if (typeof item.createdAt === 'string') {
          const parsedTime = new Date(item.createdAt).getTime();
          if (!isNaN(parsedTime)) {
            time = parsedTime;
          }
        }
      }

      // 根据 toolPage 映射到正确的 tab
      let tab: TabType = 'color-extraction';
      let tabName: string = '彩绘提取';

      // AI生图判断：兼容旧的“智能抠图”数据和订单号前缀
      if (item.toolPage === 'AI生图' || item.toolPage === 'AI生图（图生图）' || item.description?.includes('AI生图') || item.orderNumber?.startsWith('AIG')) {
        tab = 'ai-generate';
        tabName = 'AI生图';
      } else if (item.toolPage === '智能抠图' || item.orderNumber?.startsWith('ARB-')) {
        tab = 'auto-remove-bg';
        tabName = 'AI生图';
      } else if (item.toolPage === '彩绘提取' || item.toolPage === '彩绘提取2' || item.description?.includes('彩绘提取')) {
        tab = 'color-extraction';
        tabName = '彩绘提取';
      } else if (item.toolPage === '去除水印' || item.description?.includes('去除水印') || item.orderNumber?.startsWith('RW-')) {
        tab = 'watermark';
        tabName = '去除水印';
      } else if (item.toolPage === '高清放大' || item.description?.includes('高清放大') || item.orderNumber?.startsWith('HD-')) {
        tab = 'custom';
        tabName = '高清放大';
      } else if (item.toolPage === '去水印') {
        // 兼容性处理：旧数据可能使用'去水印'
        tab = 'watermark';
        tabName = '去除水印';
      } else if (item.toolPage === '快速制作') {
        // Keep legacy history visible without restoring the old page mode.
        tab = 'custom';
        tabName = '历史工具记录';
      }

      // 调试日志：记录toolPage映射
      if (process.env.NODE_ENV === 'development') {
        console.log('[TaskHistory] 订单映射:', {
          orderNumber: item.orderNumber,
          toolPage: item.toolPage,
          description: item.description,
          mappedTab: tab,
          mappedTabName: tabName,
        });
      }

      return {
        id: item.id,
        tab,
        tabName,
        description,
        time,
        imageUrl,  // 可能是string（单图片）或string[]（多图片）
        orderId: item.orderNumber,
        duration,
        uploadedImage,
        status,
        psdUrl,
        aspectRatio,
        imageSize,
        generateCount, // 【新增】预期生成数量
        errorMessage,
      };
    })
    .sort((a: TaskRecord, b: TaskRecord) => {
      const statusDiff = getStatusPriority(a.status) - getStatusPriority(b.status);
      if (statusDiff !== 0) return statusDiff;
      return b.time - a.time;
    }); // 处理中在前，失败紧跟其后

  return tasks;
};

// 导出更新任务记录状态的函数
export const updateTaskStatus = async (orderId: string, status: TaskStatus, imageUrl?: string, duration?: number, imageUrls?: string[]) => {
  // 【关键修复】直接调用 API 更新数据库，不依赖后端的延迟更新
  try {
    // 准备更新数据
    const updateData: {
      status: TaskStatus;
      resultData?: string;
    } = {
      status,
    };

    // 优先使用imageUrls（多张图片）
    if (imageUrls && imageUrls.length > 0) {
      updateData.resultData = JSON.stringify(imageUrls);
    } else if (imageUrl) {
      updateData.resultData = imageUrl;  // 单张图片
    }

    const response = await fetch('/api/transaction/update', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId,
        updateData,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[TaskHistory] 数据库更新成功:', result);
    } else {
      console.warn('[TaskHistory] 数据库更新失败，但继续刷新历史记录');
    }
  } catch (error) {
    console.error('[TaskHistory] 更新数据库失败:', error);
    // 即使更新失败，也继续刷新历史记录（因为缓存记录会被移除）
  }

  // 从缓存中移除对应的记录（因为数据库中已经有了最新的数据）
  updateTaskCache((records) => records.filter((task) => task.orderId !== orderId));

  // 立即触发刷新事件（不需要延迟，因为我们已经直接更新了数据库）
  window.dispatchEvent(new Event('taskHistoryUpdated'));
};

export default function TaskHistory({ activeTab, onTaskClick, userId }: TaskHistoryProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [showCopySuccessForOrder, setShowCopySuccessForOrder] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<string | null>(null);
  const [generatingPsdOrder, setGeneratingPsdOrder] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<TaskCenterFilter>('all');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const taskCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const processingCount = tasks.filter((task) => task.status === '处理中').length;
  const failedCount = tasks.filter((task) => task.status === '失败' || task.status === '超时').length;

  const historySourceTasks = showAllHistory ? tasks : tasks.slice(0, 20);
  const visibleTasks = historySourceTasks.filter((task) =>
    (filterTab === 'all' || task.tab === filterTab) && matchesTaskCenterFilter(task, statusFilter)
  );
  const groupedVisibleTasks = visibleTasks.reduce<Array<{ label: string; tasks: TaskRecord[] }>>((groups, task) => {
    let label = '历史';

    if (task.status === '处理中') {
      label = '处理中';
    } else if (task.status === '失败' || task.status === '超时') {
      label = '失败';
    } else if (task.status === '成功' || task.status === '部分成功') {
      label = '成功';
    } else {
      label = getTaskDateGroup(task.time);
    }

    const existing = groups.find((group) => group.label === label);
    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.push({ label, tasks: [task] });
    }
    return groups;
  }, []);
  const groupOrder = ['处理中', '失败', '成功'];
  groupedVisibleTasks.sort((a, b) => {
    const aIndex = groupOrder.indexOf(a.label);
    const bIndex = groupOrder.indexOf(b.label);
    if (aIndex !== -1 || bIndex !== -1) {
      const normalizedA = aIndex === -1 ? 999 : aIndex;
      const normalizedB = bIndex === -1 ? 999 : bIndex;
      return normalizedA - normalizedB;
    }
    return 0;
  });

  // 自动隐藏定时器
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 鼠标移入时展开任务历史
  const handleMouseEnter = () => {
    // 取消自动隐藏定时器
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    // 展开任务历史
    setIsCollapsed(false);
  };

  // 鼠标移出时启动自动隐藏定时器
  const handleMouseLeave = () => {
    // 设置2秒后自动隐藏
    autoHideTimerRef.current = setTimeout(() => {
      setIsCollapsed(true);
      autoHideTimerRef.current = null;
    }, 2000);
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
    };
  }, []);

  // 加载历史记录（从缓存 + 数据库加载）
  const loadTasks = useCallback(async (userId?: string) => {
    try {
      // 清理过期的缓存记录
      cleanExpiredCache(userId);

      // 先从数据库加载历史记录（传入userId以支持用户切换）
      const dbTasks = await loadTasksFromDatabase(userId);

      console.log('[TaskHistory] 从数据库加载到', dbTasks.length, '条记录');

      // 获取数据库中所有订单号
      const dbOrderIds = new Set(dbTasks.map(task => task.orderId));

      // 移除缓存中已经在数据库中存在的记录（避免重复）
      const filteredCache = getTaskCache(userId).filter(task => {
        const shouldRemove = task.orderId && dbOrderIds.has(task.orderId);
        return !shouldRemove;
      });

      console.log('[TaskHistory] 过滤后的缓存记录数:', filteredCache.length);

      setTaskCache(filteredCache, userId);

      // 合并数据库和缓存的任务记录
      const combinedTasks = [...dbTasks, ...filteredCache];

      // 按时间倒序排列
      combinedTasks.sort((a, b) => b.time - a.time);

      console.log('[TaskHistory] 合并后的任务记录数:', combinedTasks.length);

      setTasks(combinedTasks);
    } catch (error) {
      console.error('[TaskHistory] 加载历史记录时发生错误:', error);
      // 不抛出异常，避免影响组件渲染
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTasks(userId);
    });
  }, [loadTasks, userId]);

  // 监听 localStorage 变化（用于自动刷新）
  useEffect(() => {
    const handleStorageChange = () => {
      console.log('[TaskHistory] 检测到 localStorage 变化，重新加载历史记录');
      void loadTasks();
    };

    const handleTaskHistoryUpdate = () => {
      const latestTask = getTaskCache(userId)[0];
      if (latestTask?.id) {
        setIsCollapsed(false);
        setHighlightTaskId(latestTask.id);
      }
      void loadTasks(userId);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);
    };
  }, [loadTasks, userId]);

  useEffect(() => {
    if (!highlightTaskId || isCollapsed) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      taskCardRefs.current[highlightTaskId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });

    const timer = window.setTimeout(() => {
      setHighlightTaskId((current) => (current === highlightTaskId ? null : current));
    }, 5000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightTaskId, isCollapsed]);

  useEffect(() => {
    if (isCollapsed) {
      return;
    }

    const hasProcessingTask = tasks.some((task) => task.status === '处理中');
    if (!hasProcessingTask) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadTasks(userId);
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isCollapsed, loadTasks, tasks, userId]);



  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}小时前`;
    } else {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
  };

  // 获取标签页图标
  const getTabIcon = (tab: TabType) => {
    switch (tab) {
      case 'color-extraction':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        );
      case 'watermark':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'auto-remove-bg':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'custom':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        );
      default:
        return null;
    }
  };

  const downloadTaskImages = async (task: TaskRecord) => {
    const imagesToDownload = getImageList(task.imageUrl);

    if (imagesToDownload.length === 0) {
      showToast('没有可下载的图片', 'error');
      return;
    }

    try {
      showToast('正在下载图片...', 'info');

      for (let i = 0; i < imagesToDownload.length; i++) {
        const url = imagesToDownload[i];
        if (!url.startsWith('http')) {
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, i * 200));
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `image-${task.orderId || task.id}-${i + 1}.png`;
        link.click();
        window.URL.revokeObjectURL(blobUrl);
      }

      showToast('图片下载成功', 'success');
    } catch (error) {
      console.error('下载图片失败:', error);
      showToast('下载失败，请重试', 'error');
    }
  };

  const handleGeneratePsd = async (task: TaskRecord) => {
    if (!task.orderId) {
      showToast('订单号缺失，无法生成PSD', 'error');
      return;
    }

    const resultImage = getFirstImage(task.imageUrl);
    if (!isImageValue(resultImage)) {
      showToast('该订单暂无可用于分层的结果图', 'error');
      return;
    }

    setGeneratingPsdOrder(task.orderId);
    try {
      const response = await fetch('/api/color-extraction2/generate-psd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderNumber: task.orderId }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'PSD生成失败');
      }

      showToast(result.message || 'PSD生成成功', 'success');
      await loadTasks();
    } catch (error) {
      console.error('[TaskHistory] 手动生成PSD失败:', error);
      showToast(error instanceof Error ? error.message : 'PSD生成失败，请重试', 'error');
    } finally {
      setGeneratingPsdOrder(null);
    }
  };

  const openPsdUrl = (task: TaskRecord) => {
    if (!task.psdUrl) {
      showToast('PSD文件尚未生成完成', 'error');
      return;
    }

    if (typeof task.psdUrl !== 'string' || !task.psdUrl.startsWith('http')) {
      showToast('PSD链接无效', 'error');
      return;
    }

    window.open(task.psdUrl, '_blank');
    showToast('已在新标签页打开下载链接', 'info');
  };

  const copyOrderId = (task: TaskRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.orderId) return;

    navigator.clipboard.writeText(task.orderId).then(() => {
      setShowCopySuccessForOrder(task.orderId || null);
      setTimeout(() => setShowCopySuccessForOrder(null), 2000);
    }).catch((err) => {
      console.error('复制失败:', err);
    });
  };

  // 清空历史记录
  const clearHistory = async () => {
    // 确认弹窗
    const message = filterTab === 'all'
      ? '确定要清空所有历史记录吗？此操作不可恢复。'
      : `确定要清空所有"${getFilterLabel(filterTab)}"的历史记录吗？此操作不可恢复。`;
    const confirmed = window.confirm(message);
    if (!confirmed) {
      return;
    }

    try {
      // 从 localStorage 获取用户信息
      const userFromLocalStorage = localStorage.getItem('user');
      if (!userFromLocalStorage) {
        showToast('未找到用户信息，请先登录', 'error');
        return;
      }

      const userData = JSON.parse(userFromLocalStorage);
      console.log('[TaskHistory] 清空历史记录，用户ID:', userData.id, '筛选:', filterTab);

      if (filterTab === 'all') {
        // 清空所有记录
        const response = await fetch('/api/user/transactions/clear', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: userData.id,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('清空历史记录失败:', errorData.message || response.statusText);
          showToast(`清空历史记录失败：${errorData.message || response.statusText}`, 'error');
          return;
        }

        const result = await response.json() as { data?: { deletedCount?: number } };

        // 清空任务记录缓存
        setTaskCache([], userData.id);

        // 重新加载历史记录
        await loadTasks(userData.id);

        // 【关键修复】触发 taskHistoryUpdated 事件，通知其他组件（如彩绘提取页面）刷新订单记录
        console.log('[TaskHistory] 清空历史记录成功，触发 taskHistoryUpdated 事件');
        window.dispatchEvent(new Event('taskHistoryUpdated'));

        // 显示成功提示
        showToast(`成功清空 ${result.data?.deletedCount || 0} 条历史记录`, 'success');
      } else {
        // 清空特定类型的记录
        const filteredTasks = tasks.filter(task => task.tab === filterTab);
        const deletePromises = filteredTasks
          .filter(task => task.orderId)
          .map(task => fetch('/api/user/transactions/delete', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              orderNumber: task.orderId,
            }),
          }));

        await Promise.all(deletePromises);

        // 清空缓存中对应类型的记录
        const filteredCache = getTaskCache(userData.id).filter(task => task.tab !== filterTab);
        setTaskCache(filteredCache, userData.id);

        // 重新加载历史记录
        await loadTasks(userData.id);

        // 【关键修复】触发 taskHistoryUpdated 事件，通知其他组件（如彩绘提取页面）刷新订单记录
        console.log('[TaskHistory] 清空筛选历史记录成功，触发 taskHistoryUpdated 事件');
        window.dispatchEvent(new Event('taskHistoryUpdated'));

        // 显示成功提示
        showToast(`成功清空 ${filteredTasks.length} 条${getFilterLabel(filterTab)}记录`, 'success');
      }
    } catch (error) {
      console.error('清空历史记录异常:', error);
      showToast('清空历史记录失败，请稍后重试', 'error');
    }
  };

  // 获取筛选器标签
  const getFilterLabel = (filter: FilterType): string => {
    const labels: Record<FilterType, string> = {
      'all': '全部',
      'color-extraction': '彩绘提取',
      'auto-remove-bg': 'AI生图',
      'ai-generate': 'AI生图',
      'watermark': '去除水印',
      'custom': '其他工具',
    };
    return labels[filter] || filter;
  };

  // 删除单个历史记录
  const deleteTask = async (orderNumber: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // 确认弹窗
    const confirmed = window.confirm('确定要删除这条历史记录吗？此操作不可恢复。');
    if (!confirmed) {
      return;
    }

    try {
      setDeletingOrder(orderNumber);
      // 调用 API 删除历史记录
      const response = await fetch('/api/user/transactions/delete', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderNumber,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('删除历史记录失败:', errorData.message || response.statusText);
        showToast(`删除历史记录失败：${errorData.message || response.statusText}`, 'error');
        return;
      }

      // 从缓存中移除对应的记录
      updateTaskCache((records) => records.filter((task) => task.orderId !== orderNumber), userId);

      // 重新加载历史记录
      await loadTasks(userId);

      // 【关键修复】触发 taskHistoryUpdated 事件，通知其他组件（如彩绘提取页面）刷新订单记录
      console.log('[TaskHistory] 删除历史记录成功，触发 taskHistoryUpdated 事件');
      window.dispatchEvent(new Event('taskHistoryUpdated'));

      // 显示成功提示
      showToast('删除成功', 'success');
    } catch (error) {
      console.error('删除历史记录异常:', error);
      showToast('删除历史记录失败，请稍后重试', 'error');
    } finally {
      setDeletingOrder(null);
    }
  };

  return (
    <div
      className="fixed right-5 top-1/2 -translate-y-1/2 z-50"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={`
          overflow-hidden border border-white/15 bg-[#050509]/82 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition-all duration-300
          ${isCollapsed ? 'w-[58px] rounded-[1.35rem]' : 'w-[390px] rounded-[1.7rem]'}
        `}
      >
        <button
          type="button"
          className={`relative w-full transition-colors hover:bg-white/[0.06] ${isCollapsed ? 'flex min-h-[170px] flex-col items-center justify-center gap-3 px-2 py-4' : 'border-b border-white/10 px-4 py-4 text-left'}`}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <>
              <div className={`relative flex h-10 w-10 items-center justify-center rounded-2xl border ${processingCount > 0 ? 'border-blue-300/45 bg-blue-500/18 text-blue-200' : 'border-white/12 bg-white/8 text-white/70'}`}>
                {processingCount > 0 && <span className="absolute inset-[-3px] rounded-[1.15rem] border border-blue-300/35 animate-pulse" />}
                <svg className={processingCount > 0 ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {processingCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold text-white shadow-lg shadow-blue-500/30">
                    {processingCount}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-[0.22em] text-white/78">任务中心</span>
                {processingCount > 0 ? (
                  <span className="rounded-full bg-blue-500/20 px-1.5 py-1 text-[10px] text-blue-200 [writing-mode:vertical-rl]">处理中{processingCount}</span>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-purple-300/25 bg-purple-500/15 text-purple-200">
                    <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">任务中心</h3>
                    <p className="text-xs text-white/42">订单进度、结果与下载</p>
                  </div>
                </div>
              
              </div>
              <svg className="h-5 w-5 rotate-180 text-white/45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          )}
        </button>

        {!isCollapsed && (
          <>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/8 bg-white/[0.035] p-1">
                {([
                  ['all', '全部'],
                  ['processing', '处理中'],
                  ['success', '成功'],
                  ['failed', '失败'],
                ] as Array<[TaskCenterFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={`rounded-xl px-2 py-1.5 text-xs transition-colors ${statusFilter === value ? 'bg-white/14 text-white shadow-sm' : 'text-white/45 hover:bg-white/8 hover:text-white/75'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-2 text-xs text-white/55">
                  <span>工具</span>
                  <select
                    value={filterTab}
                    onChange={(event) => setFilterTab(event.target.value as FilterType)}
                    className="bg-transparent text-white outline-none"
                  >
                    {(['all', 'color-extraction', 'ai-generate', 'auto-remove-bg', 'watermark', 'custom'] as FilterType[]).map((filter) => (
                      <option key={filter} value={filter} className="bg-[#111]">{getFilterLabel(filter)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="max-h-[680px] overflow-y-auto px-3 py-3 history-scrollbar">
                {visibleTasks.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.035] px-5 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8 text-white/36">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-white/56">暂无匹配任务</p>
                  <p className="mt-1 text-xs text-white/32">提交图片处理后会自动出现在这里</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedVisibleTasks.map((group) => (
                    <section key={group.label} className="space-y-2">
                      <div className="flex items-center gap-2 px-1 text-xs font-medium text-white/38">
                        <span>{group.label}</span>
                        <span className="h-px flex-1 bg-white/8" />
                      </div>
                      {group.tasks.map((task) => {
                        const resultImage = getFirstImage(task.imageUrl);
                        const hasResult = isImageValue(resultImage);
                        const statusLabel = getTaskStatusLabel(task);
                        const isSuccessTask = task.status === '成功' || task.status === '部分成功' || !task.status;
                        const isFailedTask = task.status === '失败' || task.status === '超时';

                        const canDelete = task.status !== '处理中';

                        return (
                          <div
                            key={task.id}
                            ref={(node) => {
                              taskCardRefs.current[task.id] = node;
                            }}
                            onClick={() => onTaskClick?.(task)}
                            className={`group rounded-2xl border p-3 transition-all ${task.status === '失败' || task.status === '超时' ? 'border-red-300/35 bg-red-500/[0.075] hover:border-red-200/50 hover:bg-red-500/[0.095]' : task.tab === activeTab ? 'border-white/22 bg-white/[0.075]' : getTaskCardClasses(task.status)} ${highlightTaskId === task.id ? 'ring-2 ring-purple-300/70 shadow-[0_0_0_1px_rgba(196,181,253,0.26),0_0_32px_rgba(139,92,246,0.24)]' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-[88px] shrink-0 overflow-hidden rounded-xl border border-white/8 bg-black/30 self-start transition-colors group-hover:border-white/16">
                                <button type="button" onClick={(e) => { e.stopPropagation(); if (hasResult) setPreviewImageUrl(resultImage); }} className="block w-full text-left">
                                  {hasResult ? (
                                    <ImageThumbnail src={resultImage} alt="结果图" width={88} height={88} thumbnailSize="small" className="h-[88px] w-[88px] object-cover transition duration-200 group-hover:scale-[1.02] group-hover:opacity-90" />
                                  ) : (
                                    <div className="flex h-[88px] w-[88px] items-center justify-center text-[11px] text-white/32 text-center leading-tight px-2">
                                      {task.status === '处理中' ? '处理中' : '暂无结果'}
                                    </div>
                                  )}
                                </button>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2.5">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8 text-purple-200">
                                      {getTabIcon(task.tab)}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <h4 className="truncate text-sm font-medium text-white/95 leading-tight">{task.tabName}</h4>
                                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-tight tracking-[0.02em] ${getStatusClasses(task.status)}`}>{statusLabel}</span>
                                      </div>
                                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/30 flex-wrap leading-tight">
                                        <div className="inline-flex items-center gap-1">
                                          <span>订单#{getOrderSuffix(task.orderId)}</span>
                                          <button type="button" onClick={(e) => copyOrderId(task, e)} className="rounded p-0.5 transition-colors hover:bg-white/8 hover:text-white/80" title="复制订单号">
                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                          </button>
                                        </div>
                                        <span>{formatTime(task.time)}</span>
                                        {task.duration && <span>{task.duration.toFixed(1)}秒</span>}
                                      </div>
                                      {task.status !== '成功' && task.errorMessage && (
                                        <div className="mt-1 text-[11px] text-red-300/80 line-clamp-2 leading-tight">
                                          失败原因: {task.errorMessage}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                    <div className="flex items-center gap-1 text-white/35">
                                     <button type="button" onClick={(e) => task.orderId && canDelete && void deleteTask(task.orderId, e)} disabled={!task.orderId || deletingOrder === task.orderId || !canDelete} className="rounded-lg p-1.5 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40" title={canDelete ? '删除记录' : '处理中任务不能删除'}>
                                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                {isSuccessTask && (
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); void downloadTaskImages(task); }} disabled={!hasResult} className="rounded-full border border-white/8 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/72 transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40">
                                      下载
                                    </button>
                                    {task.tab === 'color-extraction' && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (task.psdUrl) {
                                            openPsdUrl(task);
                                          } else {
                                            void handleGeneratePsd(task);
                                          }
                                        }}
                                        disabled={generatingPsdOrder === task.orderId}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${task.psdUrl ? 'border-[#31a8ff]/20 bg-[#001e36] text-[#31a8ff] hover:bg-[#001e36]/80' : 'border-amber-300/25 bg-amber-500/15 text-amber-200 hover:bg-amber-500/22'}`}
                                        title={generatingPsdOrder === task.orderId ? 'PSD生成中' : task.psdUrl ? '下载PSD文件' : '点击生成PSD'}
                                      >
                                        {generatingPsdOrder === task.orderId ? '生成中...' : task.psdUrl ? '下载PSD' : '生成PSD'}
                                      </button>
                                    )}
                                  </div>
                                )}

                                {isFailedTask && (
                                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); showToast('请回到对应工具重新提交该任务', 'info'); }} className="rounded-full border border-red-300/18 bg-red-500/14 px-2.5 py-1 text-[11px] text-red-200 transition-colors hover:bg-red-500/22">
                                      重新提交
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
              )}
            </div>

            {tasks.length > 0 && (
              <div className="flex gap-2 border-t border-white/10 p-3">
                <button
                  onClick={() => setShowAllHistory((current) => !current)}
                  className="flex-1 rounded-xl bg-white/8 px-4 py-2 text-sm text-white/75 transition-colors hover:bg-white/14"
                >
                  {showAllHistory ? '只看最近20条' : '显示全部历史'}
                </button>
                <button
                  onClick={clearHistory}
                  className="rounded-xl bg-red-500/14 px-4 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/22"
                >
                  清空
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 复制成功提示 */}
      {showCopySuccessForOrder && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/10 backdrop-blur-xl border border-white/20 text-white px-3 py-1.5 rounded-2xl shadow-lg text-xs flex items-center gap-2 z-50">
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>复制成功</span>
        </div>
      )}

      {/* 大图预览弹窗 - 使用 Portal 渲染到 body */}
      {previewImageUrl && createPortal(
        <div
          className="fixed left-0 right-0 top-0 bottom-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.9)" }}
          onClick={() => setPreviewImageUrl(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImageUrl(null);
            }}
            className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center text-white text-2xl transition-colors z-[10000]"
          >
            ×
          </button>
          <img
            src={previewImageUrl}
            alt="预览大图"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
