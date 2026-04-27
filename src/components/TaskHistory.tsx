'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '@/lib/toast';
import { clearCache } from '@/lib/globalRecordManager';
import { ImageThumbnail } from '@/components/ui/ImageThumbnail';

export type TabType = 'color-extraction' | 'auto-remove-bg' | 'watermark' | 'custom';
export type FilterType = 'all' | TabType;
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

// 清理过期的缓存记录（超过10分钟）
const cleanExpiredCache = (userId?: string) => {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  const currentRecords = getTaskCache(userId);
  const filteredRecords = currentRecords.filter((record) => now - record.time <= tenMinutes);
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
      response = await fetch(`/api/user/transactions?userId=${userData.id}`, {
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
      console.log('[TaskHistory] transformDatabaseData - 第一条数据:', {
        orderNumber: data[0].orderNumber,
        resultData: data[0].resultData ? (typeof data[0].resultData === 'string' ? data[0].resultData.substring(0, 100) + '...' : JSON.stringify(data[0].resultData).substring(0, 100) + '...') : null,
        createdAt: data[0].createdAt,
      });
      console.log('[TaskHistory] transformDatabaseData - 最后一条数据:', {
        orderNumber: data[data.length - 1].orderNumber,
        resultData: data[data.length - 1].resultData ? (typeof data[data.length - 1].resultData === 'string' ? data[data.length - 1].resultData.substring(0, 100) + '...' : JSON.stringify(data[data.length - 1].resultData).substring(0, 100) + '...') : null,
        createdAt: data[data.length - 1].createdAt,
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
      if (item.resultData) {
        if (Array.isArray(item.resultData)) {
          // 【新增】如果resultData已经是数组（多图片），直接使用
          imageUrl = item.resultData;
          console.log('[TaskHistory] resultData是数组，图片数量:', item.resultData.length);
        } else if (typeof item.resultData === 'object') {
          // 如果resultData是对象，尝试获取imageUrl字段
          const resultDataObject = item.resultData as ResultDataObject;
          imageUrl = resultDataObject.imageUrl || resultDataObject.image_url || resultDataObject.result_image_url || '';
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

      // 智能抠图判断：检查toolPage字段和订单号前缀
      if (item.toolPage === '智能抠图' || item.orderNumber?.startsWith('ARB-')) {
        tab = 'auto-remove-bg';
        tabName = '智能抠图';
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
        // 快速制作（通用，不包含具体的子功能）
        tab = 'custom';
        tabName = '快速制作';
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
      };
    })
    .sort((a: TaskRecord, b: TaskRecord) => b.time - a.time); // 按时间倒序排列

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
  const [filterTab, setFilterTab] = useState<FilterType>('all');

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
      void loadTasks(userId);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);
    };
  }, [loadTasks, userId]);



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

  // 获取状态标签
  const getStatusBadge = (status?: TaskStatus) => {
    if (!status) return null;

    const statusConfig = {
      '处理中': {
        className: 'bg-blue-500/20 text-blue-300',
        icon: (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ),
      },
      '成功': {
        className: 'bg-green-500/20 text-green-300',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
      },
      '失败': {
        className: 'bg-red-500/20 text-red-300',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
      },
      '超时': {
        className: 'bg-yellow-500/20 text-yellow-300',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      '部分成功': {
        className: 'bg-orange-500/20 text-orange-300',
        icon: (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ),
      },
    };

    const config = statusConfig[status];
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.className}`}>
        {config.icon}
        <span>{status}</span>
      </div>
    );
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
      'auto-remove-bg': '智能抠图',
      'watermark': '去除水印',
      'custom': '自定义',
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
      className="fixed right-6 top-1/2 -translate-y-1/2 z-50"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 任务列表 */}
      <div
        className={`
          bg-black/60 backdrop-blur-xl rounded-2xl border border-white/20 overflow-hidden transition-all duration-300
          ${isCollapsed ? 'w-12' : 'w-80'}
        `}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors border-b border-white/10"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {!isCollapsed && (
            <span className="text-white text-sm font-medium flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              历史记录
            </span>
          )}
          <svg
            className={`w-5 h-5 text-white/60 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* 任务列表内容 */}
        {!isCollapsed && (
          <>
            {/* 筛选器 */}
            <div className="p-3 border-b border-white/10">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setFilterTab('all');
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filterTab === 'all'
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                    }
                  `}
                >
                  全部
                </button>

                <button
                  onClick={() => {
                    setFilterTab('color-extraction');
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filterTab === 'color-extraction'
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                    }
                  `}
                >
                  彩绘提取
                </button>

                <button
                  onClick={() => {
                    setFilterTab('auto-remove-bg');
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filterTab === 'auto-remove-bg'
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                    }
                  `}
                >
                  智能抠图
                </button>

                <button
                  onClick={() => {
                    setFilterTab('watermark');
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filterTab === 'watermark'
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                    }
                  `}
                >
                  去除水印
                </button>

                <button
                  onClick={() => {
                    setFilterTab('custom');
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filterTab === 'custom'
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent'
                    }
                  `}
                >
                  自定义
                </button>
              </div>
            </div>

            <div
              className="max-h-[700px] overflow-y-auto p-3 space-y-2 history-scrollbar"
            >
              {(() => {
                // 筛选逻辑：
                // - 'all': 显示所有记录
                // - 其他：只显示对应类型的记录
                const filteredTasks = filterTab === 'all'
                  ? tasks
                  : tasks.filter(task => task.tab === filterTab);

                if (filteredTasks.length === 0) {
                  return (
                    <div className="text-center py-8 text-white/40 text-sm">
                      {filterTab === 'all' ? '暂无历史记录' : `暂无${getFilterLabel(filterTab)}记录`}
                    </div>
                  );
                }

                return filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => onTaskClick?.(task)}
                    className={`
                      p-3 rounded-xl transition-all cursor-pointer
                      ${task.tab === activeTab
                        ? 'bg-white/20 border border-white/30'
                        : 'bg-white/5 hover:bg-white/10 border border-transparent'
                      }
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-purple-400">
                        {getTabIcon(task.tab)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-white text-sm font-medium truncate">{task.tabName}</span>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(task.status)}
                            <span className="text-white/40 text-xs shrink-0">{formatTime(task.time)}</span>
                          </div>
                        </div>
                        {/* 关键信息 */}
                        <div className="mt-2 space-y-1 text-xs text-white/50">
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>{new Date(task.time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="flex-1">{task.orderId || 'N/A'}</span>
                            {/* 复制按钮 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (task.orderId) {
                                  navigator.clipboard.writeText(task.orderId).then(() => {
                                    setShowCopySuccessForOrder(task.orderId || null);
                                    setTimeout(() => setShowCopySuccessForOrder(null), 2000);
                                  }).catch((err) => {
                                    console.error('复制失败:', err);
                                  });
                                }
                              }}
                              className="hover:bg-white/10 rounded p-1 transition-colors cursor-pointer"
                              title="复制订单号"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                            {/* 删除按钮 */}
                            <button
                              onClick={(e) => deleteTask(task.orderId!, e)}
                              disabled={deletingOrder === task.orderId}
                              className={`hover:bg-red-500/20 rounded p-1 transition-colors cursor-pointer ${
                                deletingOrder === task.orderId ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                              title="删除记录"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                          {task.duration && (
                            <div className="flex items-center gap-2">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{task.duration.toFixed(1)}秒</span>
                            </div>
                          )}
                        </div>

                        {/* 生成结果图片 - 统一处理 */}
                        {(task.imageUrl) ? (
                          <div className="mt-2">
                            {/* 图片数量标签 */}
                            {Array.isArray(task.imageUrl) && task.imageUrl.length > 1 && (
                              <div className="text-xs text-purple-400 mb-1 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span>生成{task.imageUrl.length}张图片</span>
                              </div>
                            )}
                            {Array.isArray(task.imageUrl) && task.imageUrl.length > 0 ? (
                              // 多张图片：水平排列
                              <div className="flex gap-2">
                                {task.imageUrl.map((imageUrl, index) => (
                                  <img
                                    key={index}
                                    src={imageUrl}
                                    alt={`生成结果 ${index + 1}`}
                                    className="object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity flex-1 min-w-0"
                                    style={{ maxHeight: '80px' }}
                                    onClick={() => setPreviewImageUrl(imageUrl)}
                                  />
                                ))}
                              </div>
                            ) : (
                              // 单张图片：正常显示
                              <ImageThumbnail
                                src={typeof task.imageUrl === 'string' ? task.imageUrl : task.imageUrl![0]}
                                alt="生成结果"
                                width={200}
                                height={80}
                                thumbnailSize="small"
                                className="w-full h-20 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => {
                                  const imageToShow = typeof task.imageUrl === 'string' ? task.imageUrl : task.imageUrl![0];
                                  setPreviewImageUrl(imageToShow || null);
                                }}
                              />
                            )}
                          </div>
                        ) : null}

                        {/* 操作按钮 - 图片加载完成后显示 */}
                        {task.imageUrl && (
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const imagesToDownload = Array.isArray(task.imageUrl) ? task.imageUrl : [task.imageUrl];

                                if (imagesToDownload.length === 0) {
                                  showToast('没有可下载的图片', 'error');
                                  return;
                                }

                                try {
                                  showToast('正在下载图片...', 'info');

                                  // 批量下载（间隔200ms）
                                  for (let i = 0; i < imagesToDownload.length; i++) {
                                    const url = imagesToDownload[i];
                                    if (typeof url !== 'string' || !url.startsWith('http')) {
                                      continue;
                                    }
                                    await new Promise(resolve => setTimeout(resolve, i * 200));
                                    const response = await fetch(url);
                                    const blob = await response.blob();
                                    const blobUrl = window.URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = blobUrl;
                                    link.download = `image-${task.orderId}-${i + 1}.png`;
                                    link.click();
                                    window.URL.revokeObjectURL(blobUrl);
                                  }

                                  showToast('图片下载成功', 'success');
                                } catch (error) {
                                  console.error('下载图片失败:', error);
                                  showToast('下载失败，请重试', 'error');
                                }
                              }}
                              className="flex-1 py-1.5 px-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/80 text-xs transition-colors flex items-center justify-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              高清下载
                            </button>
                            {/* 彩绘提取订单显示下载PSD按钮 */}
                            {task.tab === 'color-extraction' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (!task.psdUrl) {
                                    showToast('PSD文件尚未生成完成', 'error');
                                    return;
                                  }

                                  if (typeof task.psdUrl !== 'string' || !task.psdUrl.startsWith('http')) {
                                    showToast('PSD链接无效', 'error');
                                    return;
                                  }

                                  // 直接在新标签页打开PSD链接，避免CORS跨域问题
                                  window.open(task.psdUrl, '_blank');
                                  showToast('已在新标签页打开下载链接', 'info');
                                }}
                                disabled={!task.psdUrl}
                                className={`
                                  flex-1 py-1.5 px-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1
                                  ${!task.psdUrl
                                    ? 'bg-white/10 text-white/40 cursor-not-allowed'
                                    : 'bg-[#001e36] text-[#31a8ff] hover:bg-[#001e36]/80'
                                  }
                                `}
                                title={!task.psdUrl ? 'PSD文件尚未生成' : '下载PSD文件'}
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                {!task.psdUrl ? '暂无PSD' : '下载PSD'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* 底部操作 */}
            {tasks.length > 0 && (
              <div className="p-3 border-t border-white/10 flex gap-2">
                <button
                  onClick={() => void loadTasks(userId)}
                  className="flex-1 py-2 px-4 bg-white/10 hover:bg-white/20 text-white/80 text-sm rounded-xl transition-colors flex items-center justify-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  刷新
                </button>
                <button
                  onClick={clearHistory}
                  className="flex-1 py-2 px-4 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-xl transition-colors"
                >
                  清空{filterTab === 'all' ? '' : getFilterLabel(filterTab)}
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
