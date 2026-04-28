'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/lib/toast';
import AutoRemoveBackgroundPage from '@/components/AutoRemoveBackgroundPage';
import RemoveWatermarkPage from '@/components/RemoveWatermarkPage';
import ImageUpsamplingPage from '@/components/ImageUpsamplingPage';

type PluginCapturePayload = {
  imageUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
};

// 自动抠图图标组件
const RemoveBackgroundIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img
      src="/assets/remove-background-demo.gif"
      alt="自动抠图示例"
      className="w-full h-full object-cover"
    />
  </div>
);

// 去除水印图标组件
const RemoveWatermarkIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img
      src="/assets/remove-watermark-demo.jpg"
      alt="去除水印示例"
      className="w-full h-full object-cover"
    />
  </div>
);

// 高清放大图标组件
const ImageUpsamplingIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img
      src="/assets/high-quality-upsampling.gif"
      alt="高清放大示例"
      className="w-full h-full object-cover"
    />
  </div>
);

// 模板提取图标组件
const TemplateExtractionIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img
      src="/assets/template-extraction-demo.jpg"
      alt="模板提取示例"
      className="w-full h-full object-cover"
    />
  </div>
);

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
  isInDevelopment?: boolean;
}

export default function QuickCreatePage() {
  const [showAutoRemoveBackground, setShowAutoRemoveBackground] = useState(false);
  const [showRemoveWatermark, setShowRemoveWatermark] = useState(false);
  const [showImageUpsampling, setShowImageUpsampling] = useState(false);
  const [showTemplateExtraction, setShowTemplateExtraction] = useState(false);

  // 模板提取的状态
  const [extractMode, setExtractMode] = useState<'link' | 'upload'>('upload');
  const [platform, setPlatform] = useState<'taobao' | 'pinduoduo'>('taobao');
  const [templateUrl, setTemplateUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  // 图片上传的状态
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedUploadImages, setSelectedUploadImages] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExtensionInstalled, setIsExtensionInstalled] = useState(false);
  const [isPluginCapturing, setIsPluginCapturing] = useState(false);
  const [pluginStatus, setPluginStatus] = useState('未检测到插件');

  const templates: Template[] = [
    {
      id: '1',
      name: '智能抠图',
      description: '智能识别主体抠出',
      icon: <RemoveBackgroundIcon />,
      prompt: '智能抠图，使用平台AI插件识别主体并移除背景',
    },
    {
      id: '2',
      name: '去除水印',
      description: '快速去除图片水印',
      icon: <RemoveWatermarkIcon />,
      prompt: '去除水印，使用RunningHub AI识别并移除水印',
    },
    {
      id: '3',
      name: '高清放大',
      description: 'AI智能放大图片',
      icon: <ImageUpsamplingIcon />,
      prompt: '高清放大图片，提升清晰度和细节',
    },
    {
      id: '4',
      name: '模板提取',
      description: '提取商品主图进行编辑',
      icon: <TemplateExtractionIcon />,
      prompt: '模板提取，输入链接或上传图片提取模板设计',
    },
    {
      id: '5',
      name: '宠物写真',
      description: '可爱的宠物形象设计',
      icon: '🐱',
      prompt: '可爱的猫咪，毛茸茸，大眼睛，温馨的室内环境',
      isInDevelopment: true,
    },
    {
      id: '6',
      name: '动漫风格',
      description: '将照片转换为动漫风格',
      icon: '🎨',
      prompt: '动漫风格转换，二次元效果',
      isInDevelopment: true,
    },
  ];

  const handleGenerate = async (template: Template) => {
    if (template.id === '1') {
      setShowAutoRemoveBackground(true);
      return;
    }
    if (template.id === '2') {
      setShowRemoveWatermark(true);
      return;
    }
    if (template.id === '3') {
      setShowImageUpsampling(true);
      return;
    }
    if (template.id === '4') {
      setShowTemplateExtraction(true);
      return;
    }
    showToast('该功能正在开发中，敬请期待！', 'info');
  };

  // 提取模板
  const handleExtractTemplate = async () => {
    if (!templateUrl.trim()) {
      showToast('请输入链接', 'error');
      return;
    }
    try {
      new URL(templateUrl);
    } catch {
      showToast('请输入有效的链接', 'error');
      return;
    }

    setIsExtracting(true);
    setExtractedImages([]);
    setSelectedImages(new Set());

    try {
      const response = await fetch('/api/template/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: templateUrl, platform }),
      });

      const data = await response.json();

      if (data.success) {
        setExtractedImages(data.images);
        showToast(data.message || `成功提取 ${data.images?.length || 0} 张主图`, 'success');
      } else if (data.needLogin || data.error?.includes('登录') || data.error?.includes('login')) {
        showToast('该商品需要登录才能查看，请尝试直接上传商品主图', 'error');
      } else if (data.error?.includes('风控') || data.error?.includes('拦截') || data.title?.includes('Access denied')) {
        showToast('该商品链接当前被平台风控拦截，建议直接上传商品主图', 'error');
      } else {
        showToast(data.error || '提取失败，请稍后重试', 'error');
      }
    } catch {
      showToast('提取失败，请稍后重试', 'error');
    } finally {
      setIsExtracting(false);
    }
  };

  // 处理图片上传
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 检查文件类型
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const invalidFiles = Array.from(files).filter(file => !validTypes.includes(file.type));
    if (invalidFiles.length > 0) {
      showToast('请上传 JPG、PNG、WebP 或 GIF 格式的图片', 'error');
      return;
    }

    // 检查文件大小（最大 10MB）
    const maxSize = 10 * 1024 * 1024;
    const oversizedFiles = Array.from(files).filter(file => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      showToast('单张图片大小不能超过 10MB', 'error');
      return;
    }

    setIsUploading(true);

    try {
      const uploadedUrls: string[] = [];

      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload/file', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (data.success && data.data?.url) {
          uploadedUrls.push(data.data.url);
        }
      }

      if (uploadedUrls.length > 0) {
        setUploadedImages(prev => [...prev, ...uploadedUrls]);
        showToast(`成功上传 ${uploadedUrls.length} 张图片`, 'success');
      } else {
        showToast('上传失败，请重试', 'error');
      }
    } catch {
      showToast('上传失败，请重试', 'error');
    } finally {
      setIsUploading(false);
      // 清空文件输入
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 触发文件选择
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // 删除上传的图片
  const removeUploadedImage = (url: string) => {
    setUploadedImages(prev => prev.filter(u => u !== url));
    setSelectedUploadImages(prev => {
      const newSet = new Set(prev);
      newSet.delete(url);
      return newSet;
    });
  };

  // 切换上传图片选中状态
  const toggleUploadImageSelection = (url: string) => {
    const newSelected = new Set(selectedUploadImages);
    if (newSelected.has(url)) {
      newSelected.delete(url);
    } else {
      newSelected.add(url);
    }
    setSelectedUploadImages(newSelected);
  };

  // 全选/取消全选上传图片
  const toggleUploadSelectAll = () => {
    if (selectedUploadImages.size === uploadedImages.length) {
      setSelectedUploadImages(new Set());
    } else {
      setSelectedUploadImages(new Set(uploadedImages));
    }
  };

  // 确认选择上传的图片
  const handleConfirmUploadSelection = () => {
    if (selectedUploadImages.size === 0) {
      showToast('请至少选择一张图片', 'error');
      return;
    }
    showToast(`已选择 ${selectedUploadImages.size} 张图片，可前往历史记录查看`, 'success');
    // TODO: 保存选中的图片到历史记录
  };

  // 切换图片选中状态（链接提取）
  const toggleImageSelection = (imageUrl: string) => {
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageUrl)) {
      newSelected.delete(imageUrl);
    } else {
      newSelected.add(imageUrl);
    }
    setSelectedImages(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedImages.size === extractedImages.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(extractedImages));
    }
  };

  // 确认选择
  const handleConfirmSelection = () => {
    if (selectedImages.size === 0) {
      showToast('请至少选择一张图片', 'error');
      return;
    }
    showToast(`已选择 ${selectedImages.size} 张图片，可前往历史记录查看`, 'success');
    // TODO: 保存选中的图片到历史记录
  };

  // 重置模板提取状态
  const resetTemplateExtraction = () => {
    setShowTemplateExtraction(false);
    setExtractMode('upload');
    setPlatform('taobao');
    setTemplateUrl('');
    setExtractedImages([]);
    setSelectedImages(new Set());
    setUploadedImages([]);
    setSelectedUploadImages(new Set());
    setPluginStatus(isExtensionInstalled ? '插件已连接' : '未检测到插件');
  };

  const installGuide = [
    '打开 chrome://extensions/',
    '开启右上角开发者模式',
    '点击“加载已解压的扩展程序”',
    '选择 browser-extension/zaomeng-capture 目录',
  ];

  const detectExtension = useCallback(() => {
    setPluginStatus('正在检测插件...');
    setIsExtensionInstalled(false);

    const timeout = window.setTimeout(() => {
      setPluginStatus('未检测到插件，请确认插件已安装并刷新当前网站页面');
    }, 1500);

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string };
      if (data?.source !== 'zaomeng-extension' || data.type !== 'ZAOMENG_EXTENSION_READY') return;

      clearTimeout(timeout);
      setIsExtensionInstalled(true);
      setPluginStatus('插件已连接，可前往淘宝/天猫页面悬浮采图');
      window.removeEventListener('message', handler);
    };

    window.addEventListener('message', handler);
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
  }, []);

  const handlePluginCapture = useCallback(async (payload: PluginCapturePayload | null) => {
    if (!payload?.imageUrl) {
      return;
    }

    setIsPluginCapturing(true);
    setPluginStatus('正在接收插件采集图片...');

    try {
      const response = await fetch('/api/plugin/capture-image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.uploadedUrl) {
        throw new Error(data.error || data.message || '插件采集失败');
      }

      setUploadedImages((prev) => {
        if (prev.includes(data.data.uploadedUrl)) {
          return prev;
        }
        return [data.data.uploadedUrl, ...prev];
      });

      setPluginStatus('插件采集成功，图片已进入当前账号，可在下方继续选择');
      showToast('插件采集成功，图片已加入当前账号', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '插件采集失败';
      setPluginStatus(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsPluginCapturing(false);
    }
  }, []);

  useEffect(() => {
    const handlePluginMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; payload?: PluginCapturePayload | null };
      if (data?.source !== 'zaomeng-extension') return;

      if (data.type === 'ZAOMENG_EXTENSION_READY') {
        setIsExtensionInstalled(true);
        setPluginStatus('插件已连接，可前往淘宝/天猫页面悬浮采图');
      }

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE') {
        if (data.payload) {
          void handlePluginCapture(data.payload || null);
        }
      }

      if (data.type === 'ZAOMENG_LATEST_CAPTURE') {
        const payload = data.payload || null;
        if (payload?.imageUrl) {
          setPluginStatus('插件已连接，可继续采集商品图片');
        }
      }
    };

    window.addEventListener('message', handlePluginMessage);
    return () => window.removeEventListener('message', handlePluginMessage);
  }, [handlePluginCapture]);

  useEffect(() => {
    if (showTemplateExtraction) {
      window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
    }
  }, [showTemplateExtraction]);

  const renderCapturedImages = () => {
    if (uploadedImages.length === 0) {
      return null;
    }

    return (
      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">
            已采集/上传 ({uploadedImages.length}张)
          </h3>
          <button
            onClick={toggleUploadSelectAll}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
          >
            {selectedUploadImages.size === uploadedImages.length ? '取消全选' : '全选'}
          </button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
          {uploadedImages.map((url, index) => (
            <div
              key={index}
              onClick={() => toggleUploadImageSelection(url)}
              className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${
                selectedUploadImages.has(url)
                  ? 'border-purple-500 ring-2 ring-purple-500/50'
                  : 'border-transparent hover:border-white/30'
              }`}
            >
              <img
                src={url}
                alt={`采集图片 ${index + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeUploadedImage(url);
                }}
                className="absolute top-1 left-1 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {selectedUploadImages.has(url) && (
                <div className="absolute top-1 right-1 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleConfirmUploadSelection}
          disabled={selectedUploadImages.size === 0}
          className={`w-full py-3 rounded-lg font-medium transition-all ${
            selectedUploadImages.size === 0
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
          }`}
        >
          确认选择 ({selectedUploadImages.size}张)
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      {showAutoRemoveBackground ? (
        <div className="relative">
          <button
            onClick={() => setShowAutoRemoveBackground(false)}
            className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回模板列表</span>
          </button>
          <AutoRemoveBackgroundPage />
        </div>
      ) : showRemoveWatermark ? (
        <div className="relative">
          <button
            onClick={() => setShowRemoveWatermark(false)}
            className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回模板列表</span>
          </button>
          <RemoveWatermarkPage />
        </div>
      ) : showImageUpsampling ? (
        <div className="relative">
          <button
            onClick={() => setShowImageUpsampling(false)}
            className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回模板列表</span>
          </button>
          <ImageUpsamplingPage />
        </div>
      ) : showTemplateExtraction ? (
        <div className="relative">
          <button
            onClick={resetTemplateExtraction}
            className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>返回模板列表</span>
          </button>

          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-white mb-3">模板提取</h2>
              <p className="text-white/60">提取商品主图或上传本地图片</p>
            </div>

            {/* 模式切换 Tab */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setExtractMode('upload')}
                className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                  extractMode === 'upload'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:border-purple-500/50 hover:text-white'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                本地上传
              </button>
              <button
                onClick={() => setExtractMode('link')}
                className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                  extractMode === 'link'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:border-purple-500/50 hover:text-white'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                链接提取
              </button>
            </div>

            {/* 本地上传模式 */}
            {extractMode === 'upload' && (
              <div>
                {/* 上传区域 */}
                <div
                  onClick={triggerFileInput}
                  className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 mb-6 cursor-pointer hover:bg-white/15 transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <div className="text-center">
                    {isUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-500 border-t-transparent mx-auto mb-4" />
                        <p className="text-white/60">上传中...</p>
                      </>
                    ) : (
                      <>
                        <svg className="w-12 h-12 mx-auto mb-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-white/80 mb-2">点击或拖拽图片到此处上传</p>
                        <p className="text-white/40 text-sm">支持 JPG、PNG、WebP、GIF，最大 10MB</p>
                      </>
                    )}
                  </div>
                </div>

                {renderCapturedImages()}
              </div>
            )}

            {/* 链接提取模式 */}
            {extractMode === 'link' && (
              <div>
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 mb-6">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-white">浏览器采图助手</h3>
                      <p className="text-white/50 text-sm mt-1">推荐用于淘宝/天猫页面 hover 采图，稳定性高于直接链接提取</p>
                    </div>
                    <button
                      onClick={detectExtension}
                      className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                    >
                      检测插件
                    </button>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 mb-4">
                    <p className="text-sm text-white/80 mb-2">安装步骤</p>
                    <ol className="space-y-1 text-sm text-white/50 list-decimal pl-5">
                      {installGuide.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <p className="text-xs text-yellow-400/90 mt-3">
                      插件目录：`browser-extension/zaomeng-capture`
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div>
                      <p className="text-sm text-white/80">当前状态</p>
                      <p className="text-sm text-white/50 mt-1">{pluginStatus}</p>
                    </div>
                    <div className={`text-xs px-3 py-1.5 rounded-full ${isExtensionInstalled ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {isPluginCapturing ? '采集中...' : isExtensionInstalled ? '已连接' : '未连接'}
                    </div>
                  </div>
                </div>

                {/* 平台选择 */}
                <div className="mb-6">
                  <label className="block text-white/80 text-sm font-medium mb-3">
                    选择平台
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setPlatform('taobao')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                        platform === 'taobao'
                          ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                          : 'bg-white/5 border border-white/10 text-white/60 hover:border-orange-500/50 hover:text-white'
                      }`}
                    >
                      淘宝/天猫
                    </button>
                    <button
                      onClick={() => setPlatform('pinduoduo')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                        platform === 'pinduoduo'
                          ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white'
                          : 'bg-white/5 border border-white/10 text-white/60 hover:border-yellow-500/50 hover:text-white'
                      }`}
                    >
                      拼多多
                    </button>
                  </div>
                </div>

                {/* URL输入 */}
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 mb-6">
                  <div className="mb-4">
                    <label className="block text-white/80 text-sm font-medium mb-3">
                      商品链接
                    </label>
                    <input
                      type="url"
                      value={templateUrl}
                      onChange={(e) => setTemplateUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExtractTemplate()}
                      placeholder={`请输入${platform === 'taobao' ? '淘宝或天猫' : '拼多多'}商品链接`}
                      className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>

                  <button
                    onClick={handleExtractTemplate}
                    disabled={isExtracting}
                    className={`w-full py-3 rounded-lg font-medium transition-all ${
                      isExtracting
                        ? 'bg-white/10 text-white/40 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
                    }`}
                  >
                    {isExtracting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        提取中，请稍候...
                      </span>
                    ) : '提取图片'}
                  </button>

                  {/* 提示信息 */}
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <p className="text-yellow-400 text-sm">
                      提示：部分商品可能需要登录才能提取，建议直接上传商品图片
                    </p>
                  </div>
                </div>

                {/* 提取结果 */}
                {extractedImages.length > 0 && (
                  <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-white">
                        提取结果 ({extractedImages.length}张)
                      </h3>
                      <button
                        onClick={toggleSelectAll}
                        className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        {selectedImages.size === extractedImages.length ? '取消全选' : '全选'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mb-6">
                      {extractedImages.map((imageUrl, index) => (
                        <div
                          key={index}
                          onClick={() => toggleImageSelection(imageUrl)}
                          className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                            selectedImages.has(imageUrl)
                              ? 'border-purple-500 ring-2 ring-purple-500/50'
                              : 'border-transparent hover:border-white/30'
                          }`}
                        >
                          <img
                            src={imageUrl}
                            alt={`提取图片 ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {selectedImages.has(imageUrl) && (
                            <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleConfirmSelection}
                      disabled={selectedImages.size === 0}
                      className={`w-full py-3 rounded-lg font-medium transition-all ${
                        selectedImages.size === 0
                          ? 'bg-white/10 text-white/40 cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
                      }`}
                    >
                      确认选择 ({selectedImages.size}张)
                    </button>
                  </div>
                )}

                {/* 加载中状态 */}
                {isExtracting && (
                  <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-500 border-t-transparent mx-auto mb-4" />
                    <p className="text-white/60">正在提取商品图片...</p>
                  </div>
                )}

                {renderCapturedImages()}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">快速制作</h2>
            <p className="text-white/60 text-lg">选择一个模板，快速生成精美的图片</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* 智能抠图 */}
            <div
              className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 hover:border-purple-500/50 transition-all cursor-pointer group"
              onClick={() => handleGenerate(templates[0])}
            >
              <div className="flex gap-4 h-full">
                <div className="flex-shrink-0">
                  <RemoveBackgroundIcon />
                </div>
                <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="text-2xl font-semibold text-white group-hover:text-purple-400 transition-colors mb-2">
                      {templates[0].name}
                    </h3>
                    <p className="text-base text-white/60">
                      {templates[0].description}
                    </p>
                    <p className="text-sm text-green-400 mt-1">
                      免费功能
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate(templates[0]);
                    }}
                    className="w-full py-2 rounded-lg font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                  >
                    立即进入
                  </button>
                </div>
              </div>
            </div>

            {/* 去除水印 */}
            <div
              className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 hover:border-purple-500/50 transition-all cursor-pointer group"
              onClick={() => handleGenerate(templates[1])}
            >
              <div className="flex gap-4 h-full">
                <div className="flex-shrink-0">
                  <RemoveWatermarkIcon />
                </div>
                <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="text-2xl font-semibold text-white group-hover:text-purple-400 transition-colors mb-2">
                      {templates[1].name}
                    </h3>
                    <p className="text-base text-white/60">
                      {templates[1].description}
                    </p>
                    <p className="text-sm text-green-400 mt-1">
                      限时免费
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate(templates[1]);
                    }}
                    className="w-full py-2 rounded-lg font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                  >
                    立即进入
                  </button>
                </div>
              </div>
            </div>

            {/* 高清放大 */}
            <div
              className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 hover:border-purple-500/50 transition-all cursor-pointer group"
              onClick={() => handleGenerate(templates[2])}
            >
              <div className="flex gap-4 h-full">
                <div className="flex-shrink-0">
                  <ImageUpsamplingIcon />
                </div>
                <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="text-2xl font-semibold text-white group-hover:text-purple-400 transition-colors mb-2">
                      {templates[2].name}
                    </h3>
                    <p className="text-base text-white/60">
                      {templates[2].description}
                    </p>
                    <p className="text-sm text-green-400 mt-1">
                      限时免费
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate(templates[2]);
                    }}
                    className="w-full py-2 rounded-lg font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                  >
                    立即进入
                  </button>
                </div>
              </div>
            </div>

            {/* 模板提取 */}
            <div
              className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 hover:border-purple-500/50 transition-all cursor-pointer group"
              onClick={() => handleGenerate(templates[3])}
            >
              <div className="flex gap-4 h-full">
                <div className="flex-shrink-0">
                  <TemplateExtractionIcon />
                </div>
                <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="text-2xl font-semibold text-white group-hover:text-purple-400 transition-colors mb-2">
                      {templates[3].name}
                    </h3>
                    <p className="text-base text-white/60">
                      {templates[3].description}
                    </p>
                    <p className="text-sm text-yellow-400 mt-1">
                      支持上传和链接提取
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerate(templates[3]);
                    }}
                    className="w-full py-2 rounded-lg font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                  >
                    立即进入
                  </button>
                </div>
              </div>
            </div>

            {/* 待开发模板 */}
            {templates.slice(4).map((template) => (
              <div
                key={template.id}
                className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 opacity-60"
              >
                <div className="flex gap-4 h-full">
                  <div className="flex-shrink-0">
                    <div className="w-32 h-full min-h-[140px] rounded-lg bg-white/10 flex items-center justify-center animate-pulse">
                      <span className="text-4xl">{template.icon}</span>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                    <div>
                      <h3 className="text-2xl font-semibold text-white/40 mb-2">
                        待开发...
                      </h3>
                      <p className="text-base text-white/30">
                        敬请期待
                      </p>
                    </div>
                    <button
                      disabled
                      className="w-full py-2 rounded-lg font-medium bg-white/5 text-white/30 cursor-not-allowed"
                    >
                      待开发
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 p-6 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10">
            <h3 className="text-xl font-semibold text-white mb-4">使用提示</h3>
            <ul className="text-white/60 space-y-2">
              <li>选择合适的模板可以快速获得高质量的图片</li>
              <li>每次生成会消耗相应
                <span className="inline-flex items-center gap-1 mx-1">
                  <img src="/points-icon.png" alt="积分" className="w-3 h-3" />
                  积分
                </span>
                ，请合理使用
              </li>
              <li>生成的图片会自动保存到您的作品集</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
