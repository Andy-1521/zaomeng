'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { uploadImage } from '@/lib/imageUploader';
import { downloadImage } from '@/lib/imageDownloader';
import { showToast } from '@/lib/toast';
import { addTaskRecord, updateTaskRecordOrderId, updateTaskRecordStatus } from '@/components/TaskHistory';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface RemoveBackgroundResult {
  id: string;
  imageUrl: string;
  resultUrl: string;
  status: string;
  time: string;
}

export default function AutoRemoveBackgroundPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [results, setResults] = useState<RemoveBackgroundResult[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const firstOrderIdRef = useRef<string | null>(null);

  const STORAGE_KEY = 'auto-remove-bg-results';
  const hasLoadedRef = useRef(false);

  // 从localStorage加载处理结果
  useEffect(() => {
    console.log('[智能抠图] 组件加载，从localStorage读取数据');
    console.log('[智能抠图] hasLoadedRef:', hasLoadedRef.current);

    if (!hasLoadedRef.current) {
      const savedResults = localStorage.getItem(STORAGE_KEY);
      console.log('[智能抠图] localStorage数据:', savedResults);
      if (savedResults) {
        try {
          const parsed = JSON.parse(savedResults);
          console.log('[智能抠图] 解析后的数据:', parsed);
          console.log('[智能抠图] 数据数量:', parsed.length);
          setResults(parsed);
          hasLoadedRef.current = true;
        } catch (error) {
          console.error('[智能抠图] 加载保存结果失败:', error);
        }
      } else {
        console.log('[智能抠图] localStorage中没有数据');
        hasLoadedRef.current = true;
      }
    }
  }, []);

  // 保存结果到localStorage
  useEffect(() => {
    console.log('[智能抠图] 保存数据到localStorage，当前结果数量:', results.length);
    console.log('[智能抠图] results:', results);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }, [results]);

  // 处理文件选择
  const handleFileSelect = async (file: File) => {
    console.log('[智能抠图] handleFileSelect 开始，当前results数量:', results.length);

    if (!file.type.startsWith('image/')) {
      showToast('请上传图片文件', 'error');
      return;
    }

    try {
      // 上传图片到对象存储
      showToast('正在上传图片...', 'info');
      const imageUrl = await uploadImage(file);
      console.log('[智能抠图] 图片上传成功:', imageUrl);

      // 调用智能抠图API
      await removeBackground(imageUrl, file.name);
    } catch (error: any) {
      console.error('[智能抠图] 处理失败:', error);
      showToast(error.message || '智能抠图失败，请重试', 'error');
    }

    console.log('[智能抠图] handleFileSelect 结束，当前results数量:', results.length);
  };

  // 智能抠图
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

      // 立即添加到历史记录（处理中状态）
      addTaskRecord(
        'auto-remove-bg',
        '智能抠图',
        fileName ? `${fileName} - 智能抠图` : '智能抠图',
        undefined, // 处理中时没有结果URL
        tempId, // orderId
        undefined, // duration
        imageUrl, // uploadedImage (原图)
        '处理中'
      );

      console.log('[智能抠图] 开始调用 Workflow API...');

      const response = await fetch('/api/auto-remove-background/workflow', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: imageUrl,
        }),
      });

      console.log('[智能抠图] API响应状态:', response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = '智能抠图失败';
        try {
          const responseText = await response.text();
          console.error('[智能抠图] 错误响应体:', responseText);

          try {
            const errorData = JSON.parse(responseText);
            if (errorData.message) {
              errorMessage = errorData.message;
            } else if (errorData.debug?.error) {
              errorMessage = errorData.debug.error;
            }
          } catch (e) {
            // 不是JSON格式
            errorMessage = `请求失败 (${response.status} ${response.statusText})`;
          }
        } catch (readError) {
          errorMessage = `请求失败 (${response.status} ${response.statusText})`;
        }

        throw new Error(errorMessage);
      }

      // 处理流式响应
      console.log('[智能抠图] 开始处理流式响应...');

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let resultUrl = '';
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[智能抠图] 流式响应完成');
          break;
        }

        // 解码数据
        buffer += decoder.decode(value, { stream: true });
        console.log('[智能抠图] 接收到数据:', buffer.length, 'bytes');

        // 解析 SSE 格式数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一行（可能不完整）

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          // 解析 event 字段
          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
            console.log('[智能抠图] Event:', currentEvent);
            continue;
          }

          // 解析 data 字段
          if (line.startsWith('data:')) {
            try {
              const data = line.substring(5).trim();
              if (data === '[DONE]') {
                console.log('[智能抠图] 流式响应结束');
                break;
              }

              const parsed = JSON.parse(data);
              console.log('[智能抠图] 解析到的数据:', parsed);

              // 处理 Message 事件（Coze Workflow 的输出）
              if (currentEvent === 'Message' && parsed.content) {
                try {
                  // content 是一个 JSON 字符串，需要再次解析
                  const contentData = typeof parsed.content === 'string'
                    ? JSON.parse(parsed.content)
                    : parsed.content;

                  console.log('[智能抠图] Content 数据:', contentData);

                  // 从 content 中提取 output
                  if (contentData.output) {
                    // 检查是否为空字符串
                    if (contentData.output === '') {
                      console.warn('[智能抠图] ⚠️ Workflow 返回空 output');
                      console.warn('[智能抠图] 可能的原因:');
                      console.warn('1. 图片不符合 Workflow 要求（太小、格式不支持、内容不清晰等）');
                      console.warn('2. Workflow 内部 AI 模型执行失败');
                      console.warn('3. Workflow 频率限制或临时故障');
                      continue; // 继续等待后续事件
                    }

                    // output 可能是字符串（URL）、数组或对象
                    if (Array.isArray(contentData.output) && contentData.output.length > 0) {
                      // 如果是数组，取第一个元素的 image_url 或 url
                      const firstItem = contentData.output[0];
                      resultUrl = firstItem.image_url || firstItem.url || (typeof firstItem === 'string' ? firstItem : '');
                      console.log('[智能抠图] 从数组中提取结果 URL:', resultUrl);
                    } else if (typeof contentData.output === 'string') {
                      // 如果是字符串 URL
                      if (contentData.output.startsWith('http://') || contentData.output.startsWith('https://')) {
                        resultUrl = contentData.output;
                        console.log('[智能抠图] 从字符串中提取结果 URL:', resultUrl);
                      } else {
                        console.warn('[智能抠图] output 不是有效的 URL:', contentData.output);
                      }
                    } else if (contentData.output.image_url) {
                      // 如果是对象，提取 image_url 或 url
                      resultUrl = contentData.output.image_url || contentData.output.url;
                      console.log('[智能抠图] 从对象中提取结果 URL:', resultUrl);
                    }
                  }
                } catch (contentParseError) {
                  console.error('[智能抠图] 解析 content 失败:', contentParseError);
                }
              }

              // 解析错误信息
              if (parsed.error) {
                throw new Error(parsed.error.message || 'Workflow 执行失败');
              }
            } catch (parseError) {
              console.error('[智能抠图] 解析 SSE 数据失败:', parseError);
            }
          }
        }
      }

      // 检查是否获取到结果 URL
      if (!resultUrl) {
        console.error('[智能抠图] ❌ 未获取到抠图结果');
        console.error('[智能抠图] 可能的原因:');
        console.error('1. Coze Workflow 配置不正确或执行失败');
        console.error('2. Workflow 输出参数名不是 "output"');
        console.error('3. Workflow 没有生成图片（可能是因为输入图片格式或内容问题）');
        console.error('4. Workflow 超时或被中断');
        console.error('[智能抠图] 建议检查 Coze Workflow 的 debug_url 获取详细错误信息');
        throw new Error('未获取到抠图结果，请检查 Workflow 配置');
      }

      console.log('[智能抠图] 最终结果 URL:', resultUrl);

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

          const saveResponse = await fetch('/api/auto-remove-background/save', {
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
            console.log('[智能抠图] 保存到数据库成功:', saveData);
            console.log('[智能抠图] saveData.data:', saveData.data);

            // 更新订单 ID 为真实的数据库订单号
            if (saveData.data?.orderId) {
              const realOrderId = saveData.data.orderId;
              console.log('[智能抠图] ✓ 准备更新订单 ID:', tempId, '->', realOrderId);

              // 使用 setTimeout 确保 setResults 在下一个事件循环中执行
              setTimeout(() => {
                setResults(prev => {
                  console.log('[智能抠图] 当前 results 数量:', prev.length);
                  const updated = prev.map(result => {
                    if (result.id === tempId) {
                      console.log('[智能抠图] ✓ 找到匹配订单，更新 ID:', tempId, '->', realOrderId);
                      return {
                        ...result,
                        id: realOrderId, // 更新为真实订单号
                      };
                    }
                    return result;
                  });
                  console.log('[智能抠图] 更新后 results 数量:', updated.length);
                  return updated;
                });

                // 更新展开状态中的订单 ID
                setExpandedOrders(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(tempId)) {
                    console.log('[智能抠图] ✓ 更新展开状态:', tempId, '->', realOrderId);
                    newSet.delete(tempId);
                    newSet.add(realOrderId);
                  }
                  return newSet;
                });
              }, 100);
            } else {
              console.error('[智能抠图] ✗ saveData.data.orderId 不存在:', saveData);
            }

            // 更新历史记录：将临时orderId更新为真实orderId
            if (saveData.data?.orderId) {
              updateTaskRecordOrderId(tempId, saveData.data.orderId);
            }

            // 更新历史记录状态
            updateTaskRecordStatus(saveData.data?.orderId || tempId, '成功', resultUrl);
          } else {
            const errorText = await saveResponse.text();
            console.error('[智能抠图] 保存到数据库失败:', saveResponse.status, errorText);
            showToast('保存记录失败，但图片已生成', 'warning');

            // 保存失败，只更新状态（不更新orderId）
            updateTaskRecordStatus(tempId, '成功', resultUrl);
          }
        } else {
          console.warn('[智能抠图] 未找到用户信息，不保存到数据库');

          // 未保存到数据库，只更新状态（不更新orderId）
          updateTaskRecordStatus(tempId, '成功', resultUrl);
        }
      } catch (saveError) {
        console.error('[智能抠图] 保存到数据库时发生错误:', saveError);

        // 保存异常，只更新状态（不更新orderId）
        updateTaskRecordStatus(tempId, '成功', resultUrl);
      }

      showToast('智能抠图成功！', 'success');
    } catch (error: any) {
      console.error('[智能抠图] 处理失败:', error);

      // 更新结果为失败
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

      // 优化错误提示
      let errorMsg = error.message || '智能抠图失败，请重试';

      if (errorMsg.includes('未获取到抠图结果')) {
        errorMsg = '智能抠图未返回结果，可能原因：\n• 图片不符合要求（太小、格式不支持）\n• 服务繁忙或临时故障\n\n建议：更换图片后重试';
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
      // 处理所有拖拽的文件
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
  const handleDownload = async (url: string, fileName: string) => {
    try {
      await downloadImage(url, fileName);
      showToast('下载已开始', 'success');
    } catch (error: any) {
      showToast(error.message || '下载失败，请重试', 'error');
    }
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
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
      {/* 标题 */}
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold text-white mb-2">智能抠图</h2>
        <p className="text-white/60 text-lg">自动识别并移除图片背景，一键生成透明PNG</p>
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
                    <img
                      src={result.imageUrl}
                      alt="原图"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-white font-medium mb-1">
                      订单号：{result.id}
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
                      </div>
                      {/* 结果图 */}
                      <div>
                        <p className="text-white/60 text-sm mb-2">抠图结果 <span className="text-xs text-purple-400">(透明PNG)</span></p>
                        <div
                          className="rounded-lg overflow-hidden relative cursor-pointer"
                          style={{
                            backgroundColor: 'transparent',
                            backgroundImage: `
                              linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
                              linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
                              linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
                              linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)
                            `,
                            backgroundSize: '20px 20px',
                            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                          }}
                          onClick={() => setPreviewImageUrl(result.resultUrl)}
                        >
                          <img
                            src={result.resultUrl}
                            alt="抠图结果"
                            className="w-full h-auto"
                          />
                        </div>
                      </div>
                      {/* 下载按钮 */}
                      <div className="col-span-2">
                        <button
                          onClick={() => handleDownload(result.resultUrl, `remove-bg-${result.id}.png`)}
                          className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                        >
                          下载抠图结果
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

      {/* 预览弹窗 */}
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
