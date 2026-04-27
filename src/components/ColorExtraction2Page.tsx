'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { addTaskRecord } from '@/components/TaskHistory';
import { taskPollingManager } from '@/lib/taskPollingManager';
import { showToast, showPointsToast } from '@/lib/toast';
import { uploadImage } from '@/lib/imageUploader';
import RedrawAnnotation from '@/components/RedrawAnnotation';
import { useUser } from '@/contexts/UserContext';

interface ColorExtractionOrder {
  id: string;
  orderNumber: string;
  toolPage: string;
  description: string;
  points: number;
  remainingPoints: number;
  time: string;
  status: string;
  prompt: string;
  resultData: string | null;
  psdUrl?: string;
}

type TaskOrderApiItem = {
  id?: string;
  orderNumber?: string;
  toolPage?: string;
  description?: string;
  points?: number;
  remainingPoints?: number;
  createdAt?: string;
  time?: string;
  status?: string;
  prompt?: string;
  resultData?: string | null;
  psdUrl?: string;
};

type TaskOrdersResponse = {
  success?: boolean;
  data?: TaskOrderApiItem[];
};

type TaskCompletedDetail = {
  orderId?: string;
  resultData?: string;
  remainingPoints?: number;
  psdUrl?: string;
};

type TaskFailedDetail = {
  orderId?: string;
};

// 彩绘提取页面 - 恢复原版前端结构
export default function ColorExtraction2Page() {
  const { user, updatePoints, setPoints } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orderCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [orders, setOrders] = useState<ColorExtractionOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [showAnnotation, setShowAnnotation] = useState(false);
  const [annotationImageUrl, setAnnotationImageUrl] = useState<string | null>(null);
  const [isRedrawing, setIsRedrawing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showCopySuccessForOrder, setShowCopySuccessForOrder] = useState<string | null>(null);

  const cleanStuckOrders = async (userId: string) => {
    try {
      console.log('[彩绘提取2] 开始清理旧订单...');
      const response = await fetch('/api/task/clean-stucked-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          maxAgeMinutes: 15,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        const result = await response.json() as { success?: boolean; data?: { updated?: number } };
        console.log('[彩绘提取2] 清理旧订单结果:', result);
        if (result.success && (result.data?.updated || 0) > 0) {
          console.log(`[彩绘提取2] 已清理 ${result.data?.updated || 0} 个旧订单`);
        }
      }
    } catch (error) {
      console.error('[彩绘提取2] 清理旧订单失败:', error);
    }
  };

  const mapTaskOrder = (order: TaskOrderApiItem): ColorExtractionOrder => ({
    id: order.id || order.orderNumber || `order-${Date.now()}`,
    orderNumber: order.orderNumber || order.id || '',
    toolPage: order.toolPage || '彩绘提取',
    description: order.description || '手机壳彩绘提取',
    points: order.points || 30,
    remainingPoints: order.remainingPoints || 0,
    time: order.createdAt || order.time || new Date().toISOString(),
    status: order.status || '处理中',
    prompt: order.prompt || '',
    resultData: typeof order.resultData === 'string' ? order.resultData : null,
    psdUrl: order.psdUrl || undefined,
  });

  const loadOrders = async (showLoading: boolean = false, restorePolling: boolean = false) => {
    if (!user?.id) return;

    if (showLoading) {
      setIsLoadingOrders(true);
      await cleanStuckOrders(user.id);
    }

    try {
      const toolPageParam = '彩绘提取';
      const response = await fetch(`/api/task/orders?userId=${user.id}&toolPage=${encodeURIComponent(toolPageParam)}`, {
        method: 'GET',
        credentials: 'include',
      });

      console.log('[彩绘提取2] 订单响应状态:', response.status, response.statusText);

      if (response.ok) {
        const result = await response.json() as TaskOrdersResponse;
        if (result.success) {
          const dbOrders = result.data || [];
          console.log('[彩绘提取2] ========== 订单加载成功 ==========' );
          console.log('[彩绘提取2] 订单数量:', dbOrders.length);

          setOrders((prevOrders) => {
            const dbOrderNumbers = new Set(dbOrders.map((order) => order.orderNumber).filter(Boolean));
            const localOrders = prevOrders.filter((order) => order.orderNumber && !dbOrderNumbers.has(order.orderNumber));
            const mappedDbOrders = dbOrders.map(mapTaskOrder);
            const combined = [...mappedDbOrders, ...localOrders];

            combined.sort((a, b) => {
              const timeA = new Date(a.time).getTime();
              const timeB = new Date(b.time).getTime();
              return timeB - timeA;
            });

            console.log('[彩绘提取2] 合并后订单数量:', combined.length);
            return combined;
          });

          if (restorePolling) {
            const processingOrders = dbOrders.filter((order) => order.status === '处理中' && order.orderNumber);
            if (processingOrders.length > 0) {
              console.log('[彩绘提取2] 发现', processingOrders.length, '个处理中的订单，恢复轮询...');
              taskPollingManager.stopAllTasks();
              processingOrders.forEach((order) => {
                if (!order.orderNumber) {
                  return;
                }

                const orderCreatedAt = new Date(order.createdAt || order.time || Date.now()).getTime();
                const age = Date.now() - orderCreatedAt;

                if (!isNaN(age) && age > 10 * 60 * 1000) {
                  console.log('[彩绘提取2] 订单年龄超过10分钟，不恢复轮询:', order.orderNumber);
                  return;
                }

                if (!taskPollingManager.hasTask(order.orderNumber)) {
                  console.log('[彩绘提取2] 恢复轮询:', order.orderNumber);
                  taskPollingManager.addTask(order.orderNumber, order.orderNumber, Date.now(), user.id);
                }
              });
            } else {
              console.log('[彩绘提取2] 没有需要恢复轮询的订单');
            }
          }
        }
      } else {
        const errorText = await response.text();
        console.error('[彩绘提取2] 订单请求失败:', errorText.substring(0, 500));
        throw new Error(`订单请求失败 (${response.status})`);
      }
    } catch (error) {
      console.error('[彩绘提取2] 加载订单失败:', error);
    } finally {
      if (showLoading) {
        setIsLoadingOrders(false);
      }
    }
  };

  const isValidImageUrl = (url: string | null | undefined): url is string => {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('http://') || url.startsWith('https://');
  };

  useEffect(() => {
    const handleTaskCompleted = (event: Event) => {
      const detail = (event as CustomEvent<TaskCompletedDetail>).detail;
      console.log('[彩绘提取2] ========== 收到 taskCompleted 事件 ==========' );
      console.log('[彩绘提取2] 事件详情:', {
        orderId: detail.orderId,
        resultData: detail.resultData ? detail.resultData.substring(0, 80) + '...' : 'none',
        remainingPoints: detail.remainingPoints,
        psdUrl: detail.psdUrl || 'none',
      });

      if (detail.orderId) {
        setOrders((prevOrders) =>
          prevOrders.map((order) =>
            order.orderNumber === detail.orderId
              ? {
                  ...order,
                  status: '成功',
                  resultData: detail.resultData || order.resultData,
                  remainingPoints: detail.remainingPoints ?? order.remainingPoints,
                  psdUrl: detail.psdUrl || order.psdUrl,
                }
              : order
          )
        );

        const checkIntervals = [5, 30, 60, 120];
        checkIntervals.forEach((seconds) => {
          setTimeout(() => {
            if (user?.id) {
              void loadOrders(false);
            }
          }, seconds * 1000);
        });
      }
    };

    const handleTaskFailed = (event: Event) => {
      const detail = (event as CustomEvent<TaskFailedDetail>).detail;
      if (detail.orderId) {
        setOrders((prevOrders) =>
          prevOrders.map((order) =>
            order.orderNumber === detail.orderId
              ? { ...order, status: '失败' }
              : order
          )
        );
      }
    };

    let loadTimeout: NodeJS.Timeout | null = null;
    const handleTaskHistoryUpdate = () => {
      if (user?.id) {
        if (loadTimeout) {
          clearTimeout(loadTimeout);
        }
        loadTimeout = setTimeout(() => {
          void loadOrders(false);
        }, 1000);
      }
    };

    window.addEventListener('taskCompleted', handleTaskCompleted);
    window.addEventListener('taskFailed', handleTaskFailed);
    window.addEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);

    const psdCheckInterval = setInterval(() => {
      if (user?.id) {
        setOrders((prevOrders) => {
          const ordersNeedingPsdCheck = prevOrders.filter(
            (order) => order.status === '成功' && !order.psdUrl && isValidImageUrl(order.resultData)
          );

          if (ordersNeedingPsdCheck.length > 0) {
            void loadOrders(false);
          }

          return prevOrders;
        });
      }
    }, 30000);

    return () => {
      window.removeEventListener('taskCompleted', handleTaskCompleted);
      window.removeEventListener('taskFailed', handleTaskFailed);
      window.removeEventListener('taskHistoryUpdated', handleTaskHistoryUpdate);
      if (loadTimeout) {
        clearTimeout(loadTimeout);
      }
      clearInterval(psdCheckInterval);
    };
  }, [user?.id]);

  const generateWithImage = async (imageUrl: string) => {
    if (!user?.id) {
      showToast('请先登录后再使用彩绘提取功能', 'error');
      return;
    }

    const userId = user.id;
    const startTime = Date.now();

    orderCounterRef.current += 1;
    const tempOrderId = `ORD${Date.now()}_${orderCounterRef.current}_${Math.floor(Math.random() * 10000)}`;

    const pendingOrder: ColorExtractionOrder = {
      id: `temp-${tempOrderId}`,
      orderNumber: tempOrderId,
      toolPage: '彩绘提取',
      description: '手机壳彩绘提取',
      points: 30,
      remainingPoints: user.points || 0,
      time: new Date().toISOString(),
      status: '处理中',
      prompt: '提取手机壳上面的彩绘图案，输出分辨率≥300DPI，必须保留原图细节及色彩，完整保留图案的纹理、图案铺满整个画布，不需要手机摄像头，色彩层次与边缘细节，确保图案清晰无模糊，达到彩绘打印的精度要求，如果是透明手机壳壳则给我透明底PNG图，不要有半透明的图层。',
      resultData: null,
    };

    setOrders((prevOrders) => [pendingOrder, ...prevOrders]);

    try {
      addTaskRecord(
        'color-extraction',
        '彩绘提取',
        '手机壳彩绘提取',
        undefined,
        tempOrderId,
        undefined,
        imageUrl,
        '处理中'
      );
    } catch (error) {
      console.error('[彩绘提取2] 添加历史记录失败:', error);
    }

    taskPollingManager.addTask(tempOrderId, tempOrderId, startTime, userId);

    try {
      const requestBody = {
        userId,
        imageUrl,
        orderId: tempOrderId,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      let response: Response;
      try {
        response = await fetch('/api/color-extraction2/workflow', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('处理时间过长，请稍后在历史记录中查看结果');
        }
        throw error;
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `请求失败 (${response.status} ${response.statusText})`;
        try {
          const responseText = await response.text();
          try {
            const errorData = JSON.parse(responseText) as { message?: string; debug?: { error?: string } };
            errorMessage = errorData.message || errorData.debug?.error || errorMessage;
          } catch {
            if (responseText && responseText.length < 200) {
              errorMessage = responseText;
            }
          }
        } catch (error) {
          console.error('[彩绘提取2] 读取响应失败:', error);
        }

        throw new Error(errorMessage);
      }

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        data?: {
          imageUrl?: string;
          remainingPoints?: number;
        };
      };

      if (!data.success) {
        throw new Error(data.message || '生成失败');
      }

      const imageResultUrl = data.data?.imageUrl || null;
      if (data.data?.remainingPoints !== undefined) {
        setPoints(data.data.remainingPoints);
      }

      const duration = (Date.now() - startTime) / 1000;
      setOrders((prevOrders) =>
        prevOrders.map((order) =>
          order.orderNumber === tempOrderId
            ? {
                ...order,
                status: '成功',
                resultData: imageResultUrl,
                remainingPoints: data.data?.remainingPoints ?? order.remainingPoints,
              }
            : order
        )
      );

      showToast(`彩绘提取成功！耗时 ${duration.toFixed(1)} 秒`, 'success');

      if (imageResultUrl && isValidImageUrl(imageResultUrl)) {
        setPreviewImageUrl(imageResultUrl);
      }

      setTimeout(() => {
        void loadOrders(false);
      }, 5000);

      showPointsToast(`剩余积分 ${data.data?.remainingPoints ?? user.points}`);
      return imageResultUrl;
    } catch (error) {
      console.error('[彩绘提取2] 生图失败:', error);
      const message = error instanceof Error ? error.message : '生成失败，请稍后重试';

      setOrders((prevOrders) =>
        prevOrders.map((order) =>
          order.orderNumber === tempOrderId
            ? { ...order, status: '失败' }
            : order
        )
      );

      showToast(message, 'error');
      return null;
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error');
      return;
    }

    if (!user?.id) {
      showToast('请先登录后再使用彩绘提取功能', 'error');
      return;
    }

    try {
      const uploadedUrl = await uploadImage(file, 'color-extraction');
      await generateWithImage(uploadedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传图片失败，请重试';
      console.error('[彩绘提取2] 上传图片失败:', error);
      showToast(message, 'error');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const generateFromFile = async (file: File) => {
    try {
      showToast('正在上传图片...', 'info');
      const imageUrl = await uploadImage(file, 'color-extraction');
      void generateWithImage(imageUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传图片失败，请重试';
      console.error('上传图片失败:', error);
      showToast(message, 'error');
    }
  };

  const ensureEnoughPoints = async (fileCount: number) => {
    if (!user?.id) return false;

    try {
      const profileResponse = await fetch(`/api/user/profile?userId=${user.id}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json() as { success?: boolean; data?: { points?: number } };
        if (profileData.success && profileData.data) {
          const currentPoints = profileData.data.points || 0;
          const requiredPoints = 30 * fileCount;

          if (currentPoints < requiredPoints) {
            showToast(`积分不足！当前积分：${currentPoints}，需要积分：${requiredPoints}（${fileCount}张图 × 30）`, 'error');
            return false;
          }
        }
      }
    } catch (error) {
      console.error('获取用户积分失败:', error);
    }

    return true;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) {
      showToast('请选择要上传的图片', 'error');
      return;
    }

    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} 不是图片格式，已跳过`, 'error');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} 大小超过5MB，已跳过`, 'error');
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      return;
    }

    const hasEnoughPoints = await ensureEnoughPoints(validFiles.length);
    if (!hasEnoughPoints) {
      return;
    }

    showToast('订单图片已开始生成✔', 'info');
    for (const file of validFiles) {
      await generateFromFile(file);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) {
      return;
    }

    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} 不是图片格式，已跳过`, 'error');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} 大小超过5MB，已跳过`, 'error');
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      return;
    }

    const hasEnoughPoints = await ensureEnoughPoints(validFiles.length);
    if (!hasEnoughPoints) {
      return;
    }

    showToast('订单图片已开始生成✔', 'info');
    for (const file of validFiles) {
      await generateFromFile(file);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadHD = async (imageUrl: string, orderNumber: string) => {
    try {
      showToast('正在下载图片...', 'info');
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `彩绘提取_${orderNumber}.jpg`;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
      showToast('图片下载成功', 'success');
    } catch (error) {
      console.error('下载图片失败:', error);
      showToast('下载失败，请重试', 'error');
    }
  };

  const handleDownloadPSD = async (order: ColorExtractionOrder) => {
    const psdUrl = order.psdUrl;

    if (!psdUrl) {
      showToast('PSD文件尚未生成完成', 'error');
      return;
    }

    try {
      new URL(psdUrl);
    } catch {
      showToast('PSD下载链接无效', 'error');
      console.error('[PSD下载] 无效的URL:', psdUrl);
      return;
    }

    window.open(psdUrl, '_blank');
    showToast('已在新标签页打开下载链接', 'info');
  };

  const handleCopyOrderNumber = (orderNumber: string) => {
    navigator.clipboard.writeText(orderNumber).then(() => {
      setShowCopySuccessForOrder(orderNumber);
      setTimeout(() => setShowCopySuccessForOrder(null), 2000);
    }).catch(() => {
      showToast('复制失败，请手动复制', 'error');
    });
  };

  const handleRegenerate = async (order: ColorExtractionOrder) => {
    if (!user?.id) {
      showToast('请先登录', 'error');
      return;
    }

    setIsRegenerating(true);

    try {
      const response = await fetch('/api/color-extraction2/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: user.id,
          originalImageUrl: order.resultData,
        }),
      });

      const result = await response.json() as { success?: boolean; error?: string };

      if (result.success) {
        updatePoints(-30);
        showToast('重新生成请求已提交', 'success');
        void loadOrders(false);
      } else {
        showToast(result.error || '重新生成失败，请重试', 'error');
      }
    } catch (error) {
      console.error('重新生成失败:', error);
      showToast('重新生成失败，请重试', 'error');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRedrawSubmit = async (data: { maskImageBase64: string; prompt: string }) => {
    if (!user?.id) {
      showToast('请先登录', 'error');
      return;
    }

    setIsRedrawing(true);

    try {
      const response = await fetch('/api/color-extraction2/redraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: user.id,
          originalImageUrl: annotationImageUrl,
          maskImageBase64: data.maskImageBase64,
          prompt: data.prompt,
          description: data.prompt ? `局部重绘: ${data.prompt.substring(0, 60)}` : '局部重绘',
        }),
      });

      const result = await response.json() as { success?: boolean; error?: string };

      if (result.success) {
        updatePoints(-30);
        showToast('局部重绘请求已提交，请在订单记录中查看结果', 'success');
        setShowAnnotation(false);
        setAnnotationImageUrl(null);
        setTimeout(() => {
          void loadOrders(true, true);
        }, 1000);
      } else {
        showToast(result.error || '提交失败，请重试', 'error');
      }
    } catch (error) {
      console.error('局部重绘提交失败:', error);
      showToast('提交失败，请重试', 'error');
    } finally {
      setIsRedrawing(false);
    }
  };

  const formatTime = (time: string) => {
    try {
      const date = new Date(time);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return time;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { className: string; icon: ReactNode }> = {
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
    };

    const config = statusConfig[status] || statusConfig['失败'];
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.className}`}>
        {config.icon}
        <span>{status}</span>
      </div>
    );
  };

  useEffect(() => {
    if (user?.id) {
      queueMicrotask(() => {
        void loadOrders(true, true);
      });
    }
  }, [user?.id]);

  return (
    <div className="flex-1 px-6 py-4 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold text-white mb-4">彩绘提取</h2>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 mb-8">
          <div
            className={`
              border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
              ${isDragging
                ? 'border-purple-500/50 bg-purple-500/10'
                : 'border-white/30 hover:border-purple-500/50'
              }
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-white mb-2">直接将图片拖至框内自动生成</p>
            <p className="text-white/40 text-sm">支持 JPG、PNG 格式，最大 5MB</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            multiple
          />
        </div>

        <div className="mt-8 p-6 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10">
          <h3 className="text-xl font-semibold text-white mb-4">使用提示</h3>
          <ul className="text-white/60 space-y-2">
            <li>• 直接将图片拖至框内自动生成（可多图同步生成）</li>
            <li>• 每张图提取会消耗 30 积分</li>
            <li>• 建议使用清晰彩绘的手机壳图片，效果更佳</li>
          </ul>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-semibold text-white">订单记录</h3>
            <button
              onClick={() => void loadOrders(false)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-lg text-white text-sm hover:bg-white/20 transition-all border border-white/20"
              disabled={isLoadingOrders}
            >
              <svg
                className={`w-4 h-4 ${isLoadingOrders ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新
            </button>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 p-6 max-h-[600px] overflow-y-auto">
            {isLoadingOrders && orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500 mb-3"></div>
                <p className="text-white/60 text-sm">加载订单记录中...</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <svg className="w-12 h-12 text-white/20 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-white/40 text-sm">暂无订单记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div
                    key={order.orderNumber || order.id}
                    className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 hover:border-purple-500/50 transition-all"
                  >
                    <div className="flex gap-4">
                      <div className="flex-shrink-0">
                        {isValidImageUrl(order.resultData) ? (
                          <img
                            src={order.resultData}
                            alt="生成结果"
                            className="w-24 h-24 rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setPreviewImageUrl(order.resultData)}
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-lg bg-white/10 flex items-center justify-center">
                            <svg className="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2">
                        <div>
                          <p className="text-white/40 text-xs mb-1">生成页面</p>
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-white text-sm">{order.toolPage}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-white/40 text-xs mb-1">订单时间</p>
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-white text-sm">{formatTime(order.time)}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-white/40 text-xs mb-1">订单号</p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopyOrderNumber(order.orderNumber)}
                              className="text-neutral-500 hover:text-purple-400 transition-colors shrink-0"
                              title="点击复制订单号"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <span className="text-white text-xs font-mono truncate max-w-[120px]">{order.orderNumber}</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-white/40 text-xs mb-1">状态</p>
                          {getStatusBadge(order.status)}
                        </div>
                      </div>

                      <div className="flex items-center gap-6 ml-auto">
                        <div className={`flex items-center gap-1 text-white text-lg min-w-[80px] ${order.status !== '成功' ? 'invisible' : ''}`}>
                          <img src="/points-icon.png" alt="积分" className="w-5 h-5" />
                          <span>&minus;{order.points}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void handleRegenerate(order)}
                              disabled={order.status !== '成功' || isRegenerating}
                              className={`
                                px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                                ${order.status !== '成功' || isRegenerating
                                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                                  : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                                }
                              `}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              重新生成
                            </button>

                            <button
                              onClick={() => order.resultData && void handleDownloadHD(order.resultData, order.orderNumber)}
                              disabled={!isValidImageUrl(order.resultData) || order.status !== '成功'}
                              className={`
                                px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                                ${!isValidImageUrl(order.resultData) || order.status !== '成功'
                                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
                                }
                              `}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              高清下载
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (isValidImageUrl(order.resultData)) {
                                  setAnnotationImageUrl(order.resultData);
                                  setShowAnnotation(true);
                                } else {
                                  showToast('该订单暂无生成结果，无法进行局部重绘', 'error');
                                }
                              }}
                              disabled={!isValidImageUrl(order.resultData) || order.status !== '成功'}
                              className={`
                                px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                                ${!isValidImageUrl(order.resultData) || order.status !== '成功'
                                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                                  : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                                }
                              `}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              局部重绘
                            </button>

                            <button
                              onClick={() => void handleDownloadPSD(order)}
                              disabled={order.status !== '成功' || !order.psdUrl}
                              className={`
                                px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                                ${order.status !== '成功' || !order.psdUrl
                                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                                  : 'bg-[#001e36] text-[#31a8ff] hover:bg-[#001e36]/80'
                                }
                              `}
                              title={!order.psdUrl ? 'PSD文件尚未生成，请稍后刷新' : '下载PSD文件'}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              {order.psdUrl ? '下载PSD' : '暂无PSD'}
                            </button>
                          </div>
                        </div>
                      </div>

                      {showCopySuccessForOrder === order.orderNumber && (
                        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/10 backdrop-blur-xl border border-white/20 text-white px-3 py-1.5 rounded-2xl shadow-lg text-xs flex items-center gap-2 z-50">
                          <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>复制成功</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewImageUrl && createPortal(
        <div
          className="fixed left-0 right-0 top-0 bottom-0 z-[9999] flex flex-col items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
          onClick={() => setPreviewImageUrl(null)}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center justify-end px-6 py-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImageUrl(null);
              }}
              className="w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center text-white text-2xl transition-colors"
            >
              ×
            </button>
          </div>
          <img
            src={previewImageUrl}
            alt="预览大图"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {showAnnotation && annotationImageUrl && createPortal(
        <RedrawAnnotation
          imageUrl={annotationImageUrl}
          onClose={() => {
            setShowAnnotation(false);
            setAnnotationImageUrl(null);
          }}
          onSubmit={handleRedrawSubmit}
          isSubmitting={isRedrawing}
        />,
        document.body
      )}
    </div>
  );
}
