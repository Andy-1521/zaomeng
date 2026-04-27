'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { uploadImage } from '@/lib/imageUploader';
import { showToast } from '@/lib/toast';
import { addTaskRecord } from '@/components/TaskHistory';
import type { TabType } from '@/components/TaskHistory';

interface RemoveBackgroundResult {
  id: string;
  imageUrl: string;
  resultUrl: string;
  status: string;
  time: string;
}

interface RemoveBackgroundPageProps {
  title?: string; // 可选标题，默认为"去除背景"
  description?: string; // 可选描述
  storageKey?: string; // 可选localStorage key，用于区分不同模块的数据
  tabId?: TabType; // tab标识，用于历史记录
  tabName?: string; // 可选tab名称，用于历史记录
  showFreeHint?: boolean; // 是否显示免费提示
}

export default function RemoveBackgroundPage({
  title = '去除背景',
  description = '拖拽图片到下方区域，自动识别并移除背景',
  storageKey = 'remove-bg-results',
  tabId = 'remove-bg' as TabType,
  tabName = '去除背景',
  showFreeHint = false,
}: RemoveBackgroundPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [results, setResults] = useState<RemoveBackgroundResult[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const firstOrderIdRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);

  // 从localStorage加载处理结果
  useEffect(() => {
    console.log(`[${title}] 组件加载，从localStorage读取数据`);
    console.log(`[${title}] hasLoadedRef:`, hasLoadedRef.current);

    if (!hasLoadedRef.current) {
      const savedResults = localStorage.getItem(storageKey);
      console.log(`[${title}] localStorage数据:`, savedResults);
      if (savedResults) {
        try {
          const parsed = JSON.parse(savedResults);
          console.log(`[${title}] 解析后的数据:`, parsed);
          console.log(`[${title}] 数据数量:`, parsed.length);
          setResults(parsed);
          hasLoadedRef.current = true;
        } catch (error) {
          console.error(`[${title}] 加载保存结果失败:`, error);
        }
      } else {
        console.log(`[${title}] localStorage中没有数据`);
        hasLoadedRef.current = true;
      }
    }
  }, [storageKey, title]);

  // 保存结果到localStorage
  useEffect(() => {
    console.log(`[${title}] 保存数据到localStorage，当前结果数量:`, results.length);
    console.log(`[${title}] results:`, results);
    localStorage.setItem(storageKey, JSON.stringify(results));
  }, [results, storageKey, title]);

  // 处理文件选择
  const handleFileSelect = async (file: File) => {
    console.log(`[${title}] handleFileSelect 开始，当前results数量:`, results.length);

    if (!file.type.startsWith('image/')) {
      showToast('请上传图片文件', 'error');
      return;
    }

    try {
      // 上传图片到对象存储
      showToast('正在上传图片...', 'info');
      const imageUrl = await uploadImage(file);
      console.log(`[${title}] 图片上传成功:`, imageUrl);

      // 调用智能抠图API
      await removeBackground(imageUrl, file.name);
    } catch (error: any) {
      console.error(`[${title}] 处理失败:`, error);
      showToast(error.message || '去除背景失败，请重试', 'error');
    }

    console.log(`[${title}] handleFileSelect 结束，当前results数量:`, results.length);
  };

  // 去除背景
  const removeBackground = async (imageUrl: string, fileName: string) => {
    try {
      const tempId = `TEMP-${Date.now()}`;

      // 先添加"处理中"状态的结果
      const tempResult: RemoveBackgroundResult = {
        id: tempId,
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

      console.log(`[${title}] 开始调用 RunningHub API...`);

      const response = await fetch('/api/remove-background/run', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: imageUrl,
          fileName: fileName,
        }),
      });

      console.log(`[${title}] API响应状态:`, response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = '去除背景失败';
        try {
          const responseText = await response.text();
          console.error(`[${title}] 错误响应体:`, responseText);

          try {
            const errorData = JSON.parse(responseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            }
          } catch (e) {
            errorMessage = `请求失败 (${response.status} ${response.statusText})`;
          }
        } catch (readError) {
          errorMessage = `请求失败 (${response.status} ${response.statusText})`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`[${title}] API响应数据:`, data);

      if (!data.success || !data.data?.resultUrl) {
        console.error(`[${title}] API返回错误:`, data);
        throw new Error(data.message || '未获取到去除背景结果');
      }

      const resultUrl = data.data.resultUrl;
      const taskId = data.data.taskId;
      console.log(`[${title}] 结果URL:`, resultUrl);
      console.log(`[${title}] 任务ID:`, taskId);

      // 更新结果
      setResults(prev =>
        prev.map(result =>
          result.id === tempId
            ? {
                ...result,
                resultUrl: resultUrl,
                status: '成功',
              }
            : result
        )
      );

      // 保存到数据库
      try {
        const userFromLocalStorage = localStorage.getItem('user');
        if (userFromLocalStorage) {
          const userData = JSON.parse(userFromLocalStorage);

          const saveResponse = await fetch('/api/remove-background/save', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: userData.id,
              imageUrl: imageUrl,
              resultUrl: resultUrl,
              originalFileName: fileName,
            }),
          });

          if (saveResponse.ok) {
            const saveData = await saveResponse.json();
            console.log(`[${title}] 保存到数据库成功:`, saveData);

            if (saveData.data?.orderId) {
              const realOrderId = saveData.data.orderId;
              console.log(`[${title}] ✓ 准备更新订单 ID:`, tempId, '->', realOrderId);

              setTimeout(() => {
                setResults(prev => {
                  const updated = prev.map(result => {
                    if (result.id === tempId) {
                      return {
                        ...result,
                        id: realOrderId,
                      };
                    }
                    return result;
                  });
                  return updated;
                });

                setExpandedOrders(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(tempId)) {
                    newSet.delete(tempId);
                    newSet.add(realOrderId);
                  }
                  return newSet;
                });
              }, 100);
            }

            addTaskRecord(
              tabId,
              tabName,
              fileName ? `${fileName} - 移除背景` : '移除背景',
              resultUrl,
              saveData.data?.orderId || taskId, // 优先使用数据库订单ID，否则使用taskId
              undefined,
              imageUrl,
              '成功'
            );
          } else {
            const errorText = await saveResponse.text();
            console.error(`[${title}] 保存到数据库失败:`, saveResponse.status, errorText);
            showToast('保存记录失败，但图片已生成', 'warning');
            addTaskRecord(
              tabId,
              tabName,
              fileName ? `${fileName} - 移除背景` : '移除背景',
              resultUrl,
              taskId,
              undefined,
              imageUrl,
              '成功'
            );
          }
        } else {
          console.warn(`[${title}] 未找到用户信息，不保存到数据库`);
          addTaskRecord(
            tabId,
            tabName,
            fileName ? `${fileName} - 移除背景` : '移除背景',
            resultUrl,
            taskId,
            undefined,
            imageUrl,
            '成功'
          );
        }
      } catch (saveError) {
        console.error(`[${title}] 保存到数据库时发生错误:`, saveError);
        addTaskRecord(
          tabId,
          tabName,
          fileName ? `${fileName} - 移除背景` : '移除背景',
          resultUrl,
          taskId,
          undefined,
          imageUrl,
          '成功'
        );
      }

      showToast('去除背景成功！', 'success');
    } catch (error: any) {
      console.error(`[${title}] 处理失败:`, error);

      setResults(prev =>
        prev.map(result =>
          result.id.startsWith('TEMP-') && result.status === '处理中'
            ? {
                ...result,
                status: '失败',
              }
            : result
        )
      );

      let errorMsg = error.message || '去除背景失败，请重试';

      if (errorMsg.includes('未获取到抠图结果')) {
        errorMsg = '去除背景未返回结果，可能原因：\n• 图片不符合要求（太小、格式不支持）\n• 服务繁忙或临时故障\n\n建议：更换图片后重试';
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

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      files.forEach(file => handleFileSelect(file));
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
  const downloadImage = (url: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `remove-bg-${fileName}`;
    link.click();
    showToast('下载已开始', 'success');
  };

  // 切换订单展开/收缩状态
  const toggleExpand = (orderId: string) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  // 格式化时间（相对时间，用于订单编号下面）
  const formatTime = (timestamp: string) => {
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
      return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
  };

  // 格式化完整时间（用于订单展开后底部的订单时间）
  const formatFullTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* 标题 */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">{title}</h2>
        <p className="text-white/60">{description}</p>
        {showFreeHint && (
          <>
            <p className="text-green-400 text-sm mt-1">✨ 免费功能，不消耗积分</p>
            <p className="text-white/40 text-xs mt-1">输出PNG透明格式，保持原图比例和像素尺寸</p>
          </>
        )}
      </div>

      {/* 拖拽上传区域 */}
      <div
        className={`
          relative bg-white/5 backdrop-blur-xl rounded-2xl border-2 border-dashed
          transition-all duration-300 cursor-pointer
          ${isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-white/20 hover:border-purple-500/50'}
        `}
        style={{ minHeight: '300px' }}
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
            e.target.value = '';
          }}
        />

        <div className="flex flex-col items-center justify-center h-full min-h-[300px] p-8">
          <div className="text-6xl mb-4">✂️</div>
          <p className="text-white text-xl font-semibold mb-2">拖拽图片到这里</p>
          <p className="text-white/60">或点击选择图片</p>
          <p className="text-white/40 text-sm mt-4">支持 JPG、PNG、WEBP 等常见图片格式</p>
        </div>

        {/* 预览图片 */}
        {previewImageUrl && (
          <div className="absolute inset-0 bg-black/90 rounded-2xl flex items-center justify-center">
            <img
              src={previewImageUrl}
              alt="预览"
              className="max-w-[80%] max-h-[80%] object-contain"
            />
          </div>
        )}
      </div>

      {/* 结果列表 */}
      {results.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-white mb-4">处理结果 ({results.length})</h3>
          <div className="space-y-4">
            {results.map((result) => {
              const isExpanded = expandedOrders.has(result.id);
              const displayOrderId = result.id;

              return (
                <div
                  key={result.id}
                  className="bg-white/10 backdrop-blur-xl rounded-xl border border-white/20 overflow-hidden"
                >
                  {/* 订单头部 - 可点击收缩/展开 */}
                  <div
                    className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => toggleExpand(result.id)}
                  >
                    <div className="flex items-center gap-4">
                      {/* 展开/收缩图标 */}
                      <svg
                        className={`w-5 h-5 text-purple-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>

                      {/* 订单编号 */}
                      <div>
                        <div className="flex items-center gap-2">
                          <svg className="w-3 h-3 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-white font-medium">{displayOrderId}</p>
                        </div>
                        <p className="text-white/40 text-xs mt-0.5">{formatTime(result.time)}</p>
                      </div>
                    </div>

                    {/* 状态标签 - 仅在展开时显示 */}
                    {isExpanded && (
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            result.status === '成功'
                              ? 'bg-green-500/20 text-green-400'
                              : result.status === '处理中'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {result.status}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="flex gap-4 items-center">
                        {/* 原图 */}
                        <div className="flex-1">
                          <p className="text-white/60 text-xs mb-1.5">原图</p>
                          <div
                            className="aspect-[4/3] bg-white/5 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (previewImageUrl === result.imageUrl) {
                                setPreviewImageUrl(null);
                              } else {
                                setPreviewImageUrl(result.imageUrl);
                              }
                            }}
                          >
                            <img
                              src={result.imageUrl}
                              alt="原图"
                              className="w-full h-full object-contain"
                            />
                          </div>
                        </div>

                        {/* 箭头 */}
                        <div className="flex items-center justify-center">
                          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </div>

                        {/* 抠图结果 */}
                        <div className="flex-1">
                          <p className="text-white/60 text-xs mb-1.5">抠图结果 <span className="text-[10px] text-purple-400">(透明PNG)</span></p>
                          <div
                            className="aspect-[4/3] rounded-lg overflow-hidden relative"
                            style={{
                              backgroundColor: 'transparent',
                              backgroundImage: `
                                linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
                                linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
                                linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
                                linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
                              `,
                              backgroundSize: '20px 20px',
                              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                            }}
                          >
                            {result.status === '处理中' ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-purple-500 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              </div>
                            ) : result.status === '成功' && result.resultUrl ? (
                              <img
                                src={result.resultUrl}
                                alt="抠图结果"
                                className="w-full h-full object-contain cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewImageUrl(result.resultUrl);
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-red-400 text-base">
                                处理失败
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex flex-col gap-2 justify-center">
                          {result.status === '成功' && result.resultUrl && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadImage(result.resultUrl, `remove-bg-${Date.now()}.png`);
                                }}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors"
                              >
                                下载
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewImageUrl(result.resultUrl);
                                }}
                                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors"
                              >
                                预览
                              </button>
                            </>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setResults(prev => prev.filter(r => r.id !== result.id));
                              setExpandedOrders(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(result.id);
                                return newSet;
                              });
                            }}
                            className="px-3 py-1.5 bg-white/10 hover:bg-red-600/50 text-white rounded-lg text-xs font-medium transition-colors"
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      {/* 底部信息 */}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                        <div className="flex items-center gap-6 text-white/60 text-xs">
                          <span>状态：{result.status === '成功' ? '✓ 成功' : result.status === '失败' ? '✗ 失败' : '⏳ 处理中'}</span>
                          <span>订单时间：{formatFullTime(result.time)}</span>
                          <span>格式：PNG透明</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewImageUrl && (
        <ImagePreviewModal
          imageUrl={previewImageUrl}
          onClose={() => setPreviewImageUrl(null)}
        />
      )}
    </div>
  );
}
