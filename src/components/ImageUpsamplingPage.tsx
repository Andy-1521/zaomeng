'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { uploadImage } from '@/lib/imageUploader';
import { downloadImage } from '@/lib/imageDownloader';
import { showToast } from '@/lib/toast';
import { addTaskRecord, updateTaskRecordOrderId, updateTaskRecordStatus } from '@/components/TaskHistory';
import { taskPollingManager } from '@/lib/taskPollingManager';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface ImageUpsamplingResult {
  id: string;
  orderId: string;
  imageUrl: string;
  resultUrl: string;
  status: string;
  time: string;
}

export default function ImageUpsamplingPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [results, setResults] = useState<ImageUpsamplingResult[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const firstOrderIdRef = useRef<string | null>(null);
  const [user, setUser] = useState<any>(null);

  const hasLoadedFromDbRef = useRef(false);

  // 加载用户信息
  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        setUser(JSON.parse(userData));
      } catch (error) {
        console.error('[高清放大] 解析用户数据失败:', error);
      }
    }
  }, []);

  // 【重构】简化事件监听：任务完成后，直接从数据库重新加载所有订单
  useEffect(() => {
    console.log('[高清放大] ========== 注册事件监听器 ==========');

    // 从数据库加载订单的函数
    const loadOrdersFromDb = async () => {
      // 从 localStorage 获取用户信息
      const userFromStorage = localStorage.getItem('user');
      if (!userFromStorage) {
        console.log('[高清放大] 用户未登录，跳过加载');
        return;
      }

      let userData;
      try {
        userData = JSON.parse(userFromStorage);
      } catch (e) {
        console.error('[高清放大] 解析用户信息失败:', e);
        return;
      }

      if (!userData?.id) {
        console.log('[高清放大] 用户ID不存在，跳过加载');
        return;
      }

      try {
        const response = await fetch(`/api/task/orders?userId=${userData.id}&toolPage=${encodeURIComponent('高清放大')}`, {
          method: 'GET',
          credentials: 'include',
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const dbOrders = result.data || [];
            console.log('[高清放大] ========== 数据库订单加载成功 ==========');
            console.log('[高清放大] 订单数量:', dbOrders.length);

            // 【关键修复】将数据库订单转换为本地结果格式
            const dbResults = dbOrders.map((order: any) => ({
              id: order.orderNumber || order.id,
              orderId: order.orderNumber,
              imageUrl: order.uploadedImage || '',
              resultUrl: order.resultData || '',
              status: order.status,
              time: order.createdAt || order.time,
            }));

            // 按时间倒序排序
            dbResults.sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime());

            console.log('[高清放大] 设置订单记录:', dbResults.length);
            console.log('[高清放大] 订单状态:', dbResults.map((o: any) => ({ orderId: o.orderId, status: o.status })));

            // 【关键修复】完全替换订单记录，确保与数据库状态一致
            setResults(dbResults);
          }
        }
      } catch (error) {
        console.error('[高清放大] 加载订单失败:', error);
      }
    };

    // 监听任务完成事件
    const handleTaskComplete = (event: any) => {
      console.log('[高清放大] ========== 收到任务完成事件 ==========');
      console.log('[高清放大] 事件详情:', event.detail);
      console.log('[高清放大] 从数据库重新加载所有订单...');
      loadOrdersFromDb();
    };

    // 监听任务失败事件
    const handleTaskFailed = (event: any) => {
      console.log('[高清放大] ========== 收到任务失败事件 ==========');
      console.log('[高清放大] 事件详情:', event.detail);
      console.log('[高清放大] 从数据库重新加载所有订单...');
      loadOrdersFromDb();
    };

    // 监听历史记录更新事件
    const handleHistoryUpdated = () => {
      console.log('[高清放大] ========== 收到历史记录更新事件 ==========');
      console.log('[高清放大] 从数据库重新加载所有订单...');
      loadOrdersFromDb();
    };

    window.addEventListener('taskCompleted', handleTaskComplete);
    window.addEventListener('taskFailed', handleTaskFailed);
    window.addEventListener('taskHistoryUpdated', handleHistoryUpdated);

    return () => {
      window.removeEventListener('taskCompleted', handleTaskComplete);
      window.removeEventListener('taskFailed', handleTaskFailed);
      window.removeEventListener('taskHistoryUpdated', handleHistoryUpdated);
    };
  }, []);

  // 从数据库加载订单记录
  useEffect(() => {
    console.log('[高清放大] ========== 页面加载，从数据库加载订单 ==========');
    console.log('[高清放大] hasLoadedFromDbRef:', hasLoadedFromDbRef.current);
    console.log('[高清放大] user:', user);

    if (!user?.id) {
      console.log('[高清放大] 用户未登录，等待用户登录...');
      return;
    }

    if (hasLoadedFromDbRef.current) {
      console.log('[高清放大] 已加载过数据库订单，跳过');
      return;
    }

    console.log('[高清放大] 开始加载订单记录...');

    const loadOrdersFromDb = async () => {
      try {
        const toolPageParam = '高清放大';
        const response = await fetch(`/api/task/orders?userId=${user.id}&toolPage=${encodeURIComponent(toolPageParam)}`, {
          method: 'GET',
          credentials: 'include',
        });

        console.log('[高清放大] 订单响应状态:', response.status);

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            const dbOrders = result.data || [];
            console.log('[高清放大] ========== 订单加载成功 ==========');
            console.log('[高清放大] 数据库订单数量:', dbOrders.length);

            // 将数据库订单转换为本地结果格式
            const dbResults = dbOrders.map((order: any) => ({
              id: order.orderNumber || order.id,
              orderId: order.orderNumber,
              imageUrl: order.uploadedImage || order.uploadedImage || order.requestParams ? JSON.parse(order.requestParams).imageUrl : '', // 【修复】优先使用uploadedImage字段
              resultUrl: order.resultData || '',
              status: order.status,
              time: order.createdAt || order.time,
            }));

            // 按时间倒序排序
            dbResults.sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime());

            console.log('[高清放大] 设置订单记录:', dbResults.length);
            setResults(dbResults);
            hasLoadedFromDbRef.current = true;
          }
        }
      } catch (error) {
        console.error('[高清放大] 加载订单失败:', error);
      }
    };

    loadOrdersFromDb();
  }, [user]);

  // 处理文件选择
  const handleFileSelect = async (file: File) => {
    console.log('[高清放大] handleFileSelect 开始，当前results数量:', results.length);

    if (!file.type.startsWith('image/')) {
      showToast('请上传图片文件', 'error');
      return;
    }

    try {
      // 上传图片到对象存储
      showToast('正在上传图片...', 'info');
      const imageUrl = await uploadImage(file);
      console.log('[高清放大] 图片上传成功:', imageUrl);

      // 调用高清放大API
      await imageUpsampling(imageUrl, file.name);
    } catch (error: any) {
      console.error('[高清放大] 处理失败:', error);
      showToast(error.message || '高清放大失败，请重试', 'error');
    }

    console.log('[高清放大] handleFileSelect 结束，当前results数量:', results.length);
  };

  // 高清放大
  const imageUpsampling = async (imageUrl: string, fileName: string) => {
    if (!user?.id) {
      showToast('请先登录', 'error');
      return;
    }

    const tempId = `HD-${Date.now()}`;
    const startTime = Date.now();

    try {
      // 先添加"处理中"状态的结果
      const tempResult: ImageUpsamplingResult = {
        id: tempId,
        orderId: tempId,
        imageUrl: imageUrl,
        resultUrl: '',
        status: '处理中',
        time: new Date().toISOString(),
      };

      setResults(prev => {
        const newResults = [tempResult, ...prev];
        // 第一个新订单默认展开
        if (!firstOrderIdRef.current) {
          firstOrderIdRef.current = tempId;
          setExpandedOrders(prev => new Set(prev).add(tempId));
        }
        return newResults;
      });

      // 【修复】注释掉前端的 addTaskRecord 调用，避免重复记录
      // 订单记录由后端 API 负责创建，前端只负责显示
      // addTaskRecord(
      //   'quick-create',
      //   '高清放大',
      //   fileName ? `${fileName} - 高清放大` : '高清放大',
      //   undefined, // 处理中时没有结果URL
      //   tempId, // orderId
      //   undefined, // duration
      //   imageUrl, // uploadedImage (原图)
      //   '处理中'
      // );

      console.log('[高清放大] 开始调用 RunningHub API...');

      // 【修复】先调用 API 获取真实 orderId（创建订单，但不等待处理完成）
      const createResponse = await fetch('/api/image-upsampling/run', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          imageUrl: imageUrl,
        }),
      });

      console.log('[高清放大] API响应状态:', createResponse.status, createResponse.statusText);

      if (!createResponse.ok) {
        let errorMessage = '高清放大失败';
        try {
          const responseText = await createResponse.text();
          console.error('[高清放大] 错误响应体:', responseText);

          try {
            const errorData = JSON.parse(responseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            }
          } catch (e) {
            errorMessage = `请求失败 (${createResponse.status} ${createResponse.statusText})`;
          }
        } catch (readError) {
          errorMessage = `请求失败 (${createResponse.status} ${createResponse.statusText})`;
        }

        // 更新为失败状态
        setResults(prev => prev.map(result => {
          if (result.id === tempId) {
            return {
              ...result,
              status: '失败',
            };
          }
          return result;
        }));

        throw new Error(errorMessage);
      }

      const createData = await createResponse.json();
      console.log('[高清放大] API响应数据:', createData);

      if (createData.success && createData.data && createData.data.orderId) {
        // 获取到真实的 orderId，更新本地状态
        const realOrderId = createData.data.orderId;

        setResults(prev => prev.map(result => {
          if (result.id === tempId) {
            return {
              ...result,
              orderId: realOrderId,
            };
          }
          return result;
        }));

        // 【修复】注释掉 updateTaskRecordOrderId，不再使用前端缓存
        // updateTaskRecordOrderId(tempId, realOrderId);

        // 【新增】使用 taskPollingManager 轮询查询订单状态
        taskPollingManager.addTask(tempId, realOrderId, startTime, user.id);

        // 【关键修复】创建订单后，立即从数据库加载一次，确保历史记录立即显示
        console.log('[高清放大] 创建订单成功，立即从数据库加载订单...');
        setTimeout(() => {
          window.dispatchEvent(new Event('taskHistoryUpdated'));
        }, 500); // 延迟500ms，确保后端已经创建了订单

        // 如果后端已经返回了结果URL，直接更新状态
        if (createData.data.resultUrl) {
          setResults(prev => prev.map(result => {
            if (result.orderId === realOrderId) {
              return {
                ...result,
                resultUrl: createData.data.resultUrl,
                status: '成功',
              };
            }
            return result;
          }));

          // 【修复】注释掉 updateTaskRecordStatus，不再使用前端缓存
          // updateTaskRecordStatus(realOrderId, '成功', createData.data.resultUrl);
          showToast('高清放大成功！', 'success');
        } else {
          // 如果没有返回结果URL，说明后端正在处理，等待轮询完成
          showToast('高清放大处理中，请稍候...', 'info');
        }
      } else {
        throw new Error(createData.message || '高清放大失败');
      }
    } catch (error: any) {
      console.error('[高清放大] 处理失败:', error);

      // 更新结果为失败，并获取orderId
      let failedOrderId: string | undefined;
      setResults(prev =>
        prev.map(result => {
          if (result.id === tempId) {
            failedOrderId = result.orderId;
            return {
              ...result,
              status: '失败',
            };
          }
          return result;
        })
      );

      // 停止轮询
      if (failedOrderId) {
        taskPollingManager.stopTask(failedOrderId);
      }

      // 触发历史记录刷新（从数据库加载最新的订单状态）
      window.dispatchEvent(new Event('taskHistoryUpdated'));

      // 优化错误提示
      let errorMsg = error.message || '高清放大失败，请重试';

      if (errorMsg.includes('未获取到结果')) {
        errorMsg = '高清放大未返回结果，可能原因：\n• 图片不符合要求\n• 服务繁忙或临时故障\n\n建议：更换图片后重试';
      } else if (errorMsg.includes('超时')) {
        errorMsg = '服务繁忙，请稍后重试或更换图片';
      }

      showToast(errorMsg, 'error');
    }
  };

  // 拖拽事件处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // 图片预览弹窗
  const ImagePreviewModal = ({ imageUrl, onClose }: { imageUrl: string; onClose: () => void }) => {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}
        onClick={onClose}
      >
        <img
          src={imageUrl}
          alt="预览"
          className="max-w-[90vw] max-h-[90vh] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>,
      document.body
    );
  };

  // 下载图片
  const handleDownload = async (url: string, fileName: string) => {
    try {
      await downloadImage(url, fileName);
      showToast('下载已开始', 'success');
    } catch (error: any) {
      showToast(error.message || '下载失败，请重试', 'error');
    }
  };

  return (
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold text-white mb-2">高清放大</h2>
          <p className="text-white/60 text-lg">AI智能放大图片，提升清晰度和细节</p>
          <div className="flex items-center justify-center gap-2 mt-2 text-green-400">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span className="text-sm font-medium">限时免费</span>
          </div>
        </div>

        {/* 拖拽上传区域 */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all
            ${isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-white/20 hover:border-white/40'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />

          <div className="flex flex-col items-center">
            <svg className="w-16 h-16 text-white/40 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-white/80 text-lg mb-2">拖拽图片到此处，或点击选择</p>
            <p className="text-white/40 text-sm">支持 JPG、PNG、WEBP 格式</p>
          </div>
        </div>

        {/* 处理结果列表 */}
        {results.length > 0 && (
          <div className="mt-8 space-y-4">
            {results.map((result) => (
              <div
                key={result.id}
                className={`bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10 transition-all
                  ${expandedOrders.has(result.id) ? 'ring-2 ring-purple-500/50' : ''}
                `}
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => {
                    setExpandedOrders(prev => {
                      const newSet = new Set(prev);
                      if (newSet.has(result.id)) {
                        newSet.delete(result.id);
                      } else {
                        newSet.add(result.id);
                      }
                      return newSet;
                    });
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-black/20">
                      {result.imageUrl ? (
                        <img
                          src={result.imageUrl}
                          alt="原图"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">
                          无图片
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="text-white font-medium mb-1">
                        订单号：{result.orderId}
                      </h3>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={result.status as any} />
                        <span className="text-white/40 text-xs">
                          {new Date(result.time).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-white/60 transition-transform
                      ${expandedOrders.has(result.id) ? 'rotate-180' : ''}
                    `}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {expandedOrders.has(result.id) && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    {result.status === '处理中' ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500"></div>
                        <span className="ml-3 text-white/60">正在处理中...</span>
                      </div>
                    ) : result.status === '成功' && result.resultUrl ? (
                      <div className="grid grid-cols-2 gap-4">
                        {/* 原图 */}
                        <div>
                          <p className="text-white/60 text-sm mb-2">原图</p>
                          {result.imageUrl ? (
                            <div
                              className="rounded-lg overflow-hidden bg-black/20 cursor-pointer"
                              onClick={() => setPreviewImageUrl(result.imageUrl)}
                            >
                              <img
                                src={result.imageUrl}
                                alt="原图"
                                className="w-full h-auto"
                              />
                            </div>
                          ) : (
                            <div className="rounded-lg bg-black/20 h-48 flex items-center justify-center text-white/40">
                              无原图
                            </div>
                          )}
                        </div>
                        {/* 结果图 */}
                        <div>
                          <p className="text-white/60 text-sm mb-2">放大后</p>
                          {result.resultUrl ? (
                            <div
                              className="rounded-lg overflow-hidden bg-black/20 cursor-pointer"
                              onClick={() => setPreviewImageUrl(result.resultUrl)}
                            >
                              <img
                                src={result.resultUrl}
                                alt="放大后"
                                className="w-full h-auto"
                              />
                            </div>
                          ) : (
                            <div className="rounded-lg bg-black/20 h-48 flex items-center justify-center text-white/40">
                              无结果图
                            </div>
                          )}
                        </div>
                        {/* 下载按钮 */}
                        <div className="col-span-2">
                          <button
                            onClick={() => handleDownload(result.resultUrl, `upsampling_${result.orderId}.png`)}
                            className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                          >
                            下载高清图片
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-red-400">
                        处理失败，请重试
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 图片预览弹窗 */}
        {previewImageUrl && (
          <ImagePreviewModal
            imageUrl={previewImageUrl}
            onClose={() => setPreviewImageUrl(null)}
          />
        )}
      </div>
    </div>
  );
}
