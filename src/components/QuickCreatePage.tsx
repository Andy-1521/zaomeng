'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/lib/toast';
import AutoRemoveBackgroundPage from '@/components/AutoRemoveBackgroundPage';
import RemoveWatermarkPage from '@/components/RemoveWatermarkPage';
import ImageUpsamplingPage from '@/components/ImageUpsamplingPage';
import ColorExtraction2Page from '@/components/ColorExtraction2Page';

type PluginCapturePayload = {
  imageUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
};

type CapturedImageRecord = {
  id: string;
  imageUrl: string;
  originalUrl?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  sourceHost?: string | null;
  imageType?: string | null;
  createdAt: string;
};

type ProcessingAction = 'color-extraction' | 'auto-remove-bg' | 'watermark' | 'upsampling';

interface QuickCreatePageProps {
  defaultView?: 'capture-library' | 'quick-create';
}

interface ModuleCard {
  id: ProcessingAction;
  name: string;
  description: string;
  tag?: string;
  icon: React.ReactNode;
}

const RemoveBackgroundIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img src="/assets/remove-background-demo.gif" alt="自动抠图示例" className="w-full h-full object-cover" />
  </div>
);

const RemoveWatermarkIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img src="/assets/remove-watermark-demo.jpg" alt="去除水印示例" className="w-full h-full object-cover" />
  </div>
);

const ImageUpsamplingIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img src="/assets/high-quality-upsampling.gif" alt="高清放大示例" className="w-full h-full object-cover" />
  </div>
);

const ColorExtractionIcon = () => (
  <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
    <img src="/assets/phone-case-demo.jpg" alt="彩绘提取示例" className="w-full h-full object-cover" />
  </div>
);

const actionLabelMap: Record<ProcessingAction, string> = {
  'color-extraction': '彩绘提取',
  'auto-remove-bg': '智能抠图',
  watermark: '去除水印',
  upsampling: '高清放大',
};

const moduleCards: ModuleCard[] = [
  {
    id: 'auto-remove-bg',
    name: '智能抠图',
    description: '智能识别主体抠出',
    icon: <RemoveBackgroundIcon />,
    tag: '免费功能',
  },
  {
    id: 'watermark',
    name: '去除水印',
    description: '快速去除图片水印',
    icon: <RemoveWatermarkIcon />,
    tag: '限时免费',
  },
  {
    id: 'upsampling',
    name: '高清放大',
    description: 'AI智能放大图片',
    icon: <ImageUpsamplingIcon />,
    tag: '限时免费',
  },
  {
    id: 'color-extraction',
    name: '彩绘提取',
    description: '进入彩绘提取页面处理图片',
    icon: <ColorExtractionIcon />,
    tag: '核心功能',
  },
];

export default function QuickCreatePage({ defaultView = 'quick-create' }: QuickCreatePageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gallerySectionRef = useRef<HTMLDivElement>(null);
  const imageButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [capturedImages, setCapturedImages] = useState<CapturedImageRecord[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showAutoRemoveBackground, setShowAutoRemoveBackground] = useState(false);
  const [showRemoveWatermark, setShowRemoveWatermark] = useState(false);
  const [showImageUpsampling, setShowImageUpsampling] = useState(false);
  const [showColorExtraction, setShowColorExtraction] = useState(false);
  const [actionBarPosition, setActionBarPosition] = useState<{ top: number; left: number } | null>(null);

  const isCaptureLibraryView = defaultView === 'capture-library';
  const selectedImageList = Array.from(selectedImages);

  const loadCapturedImages = useCallback(async () => {
    try {
      const response = await fetch('/api/plugin/captured-images', {
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.data)) {
        return;
      }
      setCapturedImages(data.data);
    } catch (error) {
      console.error('[采集图库] 加载失败:', error);
    }
  }, []);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const invalidFiles = files.filter((file) => !validTypes.includes(file.type));
    if (invalidFiles.length > 0) {
      showToast('请上传 JPG、PNG、WebP 或 GIF 格式的图片', 'error');
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    const oversizedFiles = files.filter((file) => file.size > maxSize);
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
        await loadCapturedImages();
        showToast(`成功加入 ${uploadedUrls.length} 张图片到采集图库`, 'success');
      } else {
        showToast('上传失败，请重试', 'error');
      }
    } catch {
      showToast('上传失败，请重试', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    await uploadFiles(files);
  };

  const removeUploadedImage = async (image: CapturedImageRecord) => {
    try {
      const response = await fetch('/api/plugin/captured-images', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: image.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '删除失败');
      }

      setCapturedImages((prev) => prev.filter((item) => item.id !== image.id));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除失败';
      showToast(errorMessage, 'error');
      return;
    }

    setSelectedImages((prev) => {
      const next = new Set(prev);
      next.delete(image.imageUrl);
      return next;
    });
  };

  const deleteSelectedImages = async () => {
    if (selectedImageList.length === 0) {
      showToast('请先选择要删除的图片', 'error');
      return;
    }

    try {
      for (const imageUrl of selectedImageList) {
        const target = capturedImages.find((image) => image.imageUrl === imageUrl)
        if (!target) {
          continue
        }

        const response = await fetch('/api/plugin/captured-images', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: target.id }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '删除失败');
        }
      }

      setCapturedImages((prev) => prev.filter((image) => !selectedImages.has(image.imageUrl)))
      setSelectedImages(new Set());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除失败';
      showToast(errorMessage, 'error');
    }
  };

  const toggleImageSelection = (url: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const detectExtension = useCallback(() => {
    const timeout = window.setTimeout(() => {
      showToast('未检测到插件，请确认插件已安装并刷新当前网站页面', 'error');
    }, 1500);

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string };
      if (data?.source !== 'zaomeng-extension' || data.type !== 'ZAOMENG_EXTENSION_READY') return;

      clearTimeout(timeout);
      showToast('插件已连接，可前往淘宝/天猫页面悬浮采图', 'success');
      window.removeEventListener('message', handler);
    };

    window.addEventListener('message', handler);
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
  }, []);

  const handlePluginCapture = useCallback(async (payload: PluginCapturePayload | null) => {
    if (!payload?.imageUrl) {
      return;
    }

    try {
      const response = await fetch('/api/plugin/capture-image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.uploadedUrl) {
        throw new Error(data.error || data.message || '插件采图失败');
      }

      await loadCapturedImages();
      showToast('插件采图成功，图片已加入采集图库', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '插件采图失败';
      showToast(errorMessage, 'error');
    }
  }, []);

  useEffect(() => {
    const handlePluginMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; payload?: PluginCapturePayload | null };
      if (data?.source !== 'zaomeng-extension') return;

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE' && data.payload) {
        void handlePluginCapture(data.payload);
      }
    };

    window.addEventListener('message', handlePluginMessage);
    return () => window.removeEventListener('message', handlePluginMessage);
  }, [handlePluginCapture]);

  useEffect(() => {
    if (isCaptureLibraryView) {
      window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
      queueMicrotask(() => {
        void loadCapturedImages();
      });
    }
  }, [isCaptureLibraryView, loadCapturedImages]);

  useEffect(() => {
    const updateActionBarPosition = () => {
      const container = gallerySectionRef.current;
      if (!container || selectedImageList.length === 0) {
        setActionBarPosition(null);
        return;
      }

      const selectedRects = selectedImageList
        .map((url) => imageButtonRefs.current[url]?.getBoundingClientRect() || null)
        .filter((rect): rect is DOMRect => rect !== null);

      if (selectedRects.length === 0) {
        setActionBarPosition(null);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const bounds = selectedRects.reduce(
        (acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          right: Math.max(acc.right, rect.right),
          top: Math.min(acc.top, rect.top),
          bottom: Math.max(acc.bottom, rect.bottom),
        }),
        {
          left: selectedRects[0].left,
          right: selectedRects[0].right,
          top: selectedRects[0].top,
          bottom: selectedRects[0].bottom,
        }
      );

      const centerX = (bounds.left + bounds.right) / 2 - containerRect.left;
      const top = bounds.bottom - containerRect.top + 16;

      setActionBarPosition({
        left: centerX,
        top,
      });
    };

    const frame = window.requestAnimationFrame(updateActionBarPosition);
    window.addEventListener('resize', updateActionBarPosition);
    window.addEventListener('scroll', updateActionBarPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateActionBarPosition);
      window.removeEventListener('scroll', updateActionBarPosition, true);
    };
  }, [selectedImageList]);

  const openActionPage = (action: ProcessingAction) => {
    if (capturedImages.length === 0 || selectedImageList.length === 0) {
      showToast('请先在图库中选择图片', 'error');
      return;
    }

    sessionStorage.setItem('capture-library:selected-images', JSON.stringify(selectedImageList));

    if (action === 'color-extraction') {
      setShowColorExtraction(true);
      return;
    }
    if (action === 'auto-remove-bg') {
      setShowAutoRemoveBackground(true);
      return;
    }
    if (action === 'watermark') {
      setShowRemoveWatermark(true);
      return;
    }
    if (action === 'upsampling') {
      setShowImageUpsampling(true);
    }
  };

  const handleGenerate = (card: ModuleCard) => {
    openActionPage(card.id);
  };

  const renderBackButton = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      <span>{label}</span>
    </button>
  );

  const renderCaptureLibrary = () => (
    <div
      ref={gallerySectionRef}
      className={`relative max-w-6xl mx-auto transition-all ${isDragging ? 'scale-[0.995]' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white">采集图库</h2>
          <p className="text-white/55 mt-2">通过插件采图或右上角上传图片，把素材统一收进图库</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-11 h-11 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white flex items-center justify-center hover:opacity-90 transition-opacity"
          title="上传本地图片"
        >
          <span className="text-2xl leading-none">+</span>
        </button>
      </div>

      {isDragging && (
        <div className="mb-6 rounded-3xl border-2 border-dashed border-purple-500 bg-purple-500/10 p-6 text-center text-white/80">
          松开鼠标即可把图片加入采集图库
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={handleImageUpload}
        className="hidden"
      />

      {isUploading && (
        <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-center text-white/60">
          上传中...
        </div>
      )}

        {capturedImages.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center text-white/45">
            还没有图片进入图库，通过插件采集图片，或点击右上角上传图片
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6">
            {capturedImages.map((image, index) => {
              const selected = selectedImages.has(image.imageUrl);
              return (
                <button
                  key={index}
                  ref={(node) => {
                    imageButtonRefs.current[image.imageUrl] = node;
                  }}
                  type="button"
                  onClick={() => toggleImageSelection(image.imageUrl)}
                  className={`group relative aspect-square overflow-hidden rounded-2xl border transition-all ${selected ? 'border-purple-500 ring-2 ring-purple-500/50' : 'border-white/10 hover:border-white/30'}`}
                >
                <img src={image.imageUrl} alt={`图库图片 ${index + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeUploadedImage(image);
                  }}
                  className="absolute top-2 right-2 w-7 h-7 bg-red-500/80 hover:bg-red-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="移除图片"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {selected && (
                  <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white shadow-lg">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
          </div>
        )}

      {selectedImageList.length > 0 && (
        <div className="mb-6 flex justify-end">
          <button
            onClick={() => void deleteSelectedImages()}
            className="px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white/65 text-xs transition-colors"
          >
            删除所选
          </button>
        </div>
      )}

      {selectedImageList.length > 0 && actionBarPosition && (
        <div
          className="pointer-events-none absolute z-30 transition-all duration-150"
          style={{
            top: actionBarPosition.top + 10,
            left: actionBarPosition.left,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-2 backdrop-blur-xl shadow-2xl">
            <span className="whitespace-nowrap text-xs text-white/65">已选 {selectedImageList.length} 张</span>
            {moduleCards.map((card) => (
              <button
                key={card.id}
                onClick={() => openActionPage(card.id)}
                className="min-w-[88px] px-3 py-2 rounded-full text-sm font-medium transition-all bg-white/10 text-white/80 hover:bg-gradient-to-r hover:from-purple-600 hover:to-blue-600 hover:text-white"
              >
                {actionLabelMap[card.id]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderQuickCreateGrid = () => (
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-bold text-white mb-4">快速制作</h2>
        <p className="text-white/60 text-lg">选择一个处理模块，进入对应页面</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {moduleCards.map((card) => (
          <div
            key={card.id}
            className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 hover:border-purple-500/50 transition-all cursor-pointer group"
            onClick={() => handleGenerate(card)}
          >
            <div className="flex gap-4 h-full">
              <div className="flex-shrink-0">{card.icon}</div>
              <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                <div>
                  <h3 className="text-2xl font-semibold text-white group-hover:text-purple-400 transition-colors mb-2">
                    {card.name}
                  </h3>
                  <p className="text-base text-white/60">{card.description}</p>
                  {card.tag && <p className="text-sm text-yellow-400 mt-1">{card.tag}</p>}
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleGenerate(card);
                  }}
                  className="w-full py-2 rounded-lg font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                >
                  立即进入
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (showAutoRemoveBackground) {
    return (
      <div className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="relative">
          {renderBackButton('返回快速制作', () => setShowAutoRemoveBackground(false))}
          <AutoRemoveBackgroundPage />
        </div>
      </div>
    );
  }

  if (showRemoveWatermark) {
    return (
      <div className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="relative">
          {renderBackButton('返回快速制作', () => setShowRemoveWatermark(false))}
          <RemoveWatermarkPage />
        </div>
      </div>
    );
  }

  if (showImageUpsampling) {
    return (
      <div className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="relative">
          {renderBackButton('返回快速制作', () => setShowImageUpsampling(false))}
          <ImageUpsamplingPage />
        </div>
      </div>
    );
  }

  if (showColorExtraction) {
    return (
      <div className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="relative">
          {renderBackButton('返回快速制作', () => setShowColorExtraction(false))}
          <ColorExtraction2Page />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      {isCaptureLibraryView ? renderCaptureLibrary() : renderQuickCreateGrid()}
    </div>
  );
}
