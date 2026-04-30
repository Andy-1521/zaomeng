'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addTaskRecord, updateTaskRecordStatus } from '@/components/TaskHistory';
import CropEditorPanel from '@/components/CropEditorPanel';
import AnnotateEditorPanel from '@/components/AnnotateEditorPanel';
import { useUser } from '@/contexts/UserContext';
import { showToast } from '@/lib/toast';

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

type MaterialFilter = 'all' | 'today' | 'yesterday' | 'earlier';
type GalleryActionId = 'color-extraction' | 'auto-remove-bg' | 'watermark' | 'upsampling';

type GalleryAction = {
  id: GalleryActionId;
  label: string;
  description: string;
  className: string;
  tag: string;
  preview: React.ReactNode;
};

type EditorAction = {
  id: 'edit-image' | 'annotate';
  label: string;
};

type ImageEditorState = {
  open: boolean;
  mode: 'crop' | 'annotate';
  imageUrl: string;
};

type JsonObject = Record<string, unknown>;

const galleryActions: GalleryAction[] = [
  {
    id: 'auto-remove-bg',
    label: 'AI生图',
    description: '参考已选图片进行图生图创作',
    className: 'bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500',
    tag: '图生图',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <img src="/assets/remove-background-demo.gif" alt="AI生图示例" className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'color-extraction',
    label: '彩绘提取',
    description: '手机壳彩绘提取',
    className: 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500',
    tag: '核心功能',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <img src="/assets/phone-case-demo.jpg" alt="彩绘提取示例" className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'watermark',
    label: '去除水印',
    description: '清理图片水印',
    className: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500',
    tag: '限时免费',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <img src="/assets/remove-watermark-demo.jpg" alt="去除水印示例" className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'upsampling',
    label: '高清放大',
    description: '增强清晰度和细节',
    className: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500',
    tag: '限时免费',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <img src="/assets/high-quality-upsampling.gif" alt="高清放大示例" className="w-full h-full object-cover" />
      </div>
    ),
  },
];

const editorActions: EditorAction[] = [
  { id: 'edit-image', label: '裁切工具' },
  { id: 'annotate', label: '画笔标注' },
];

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeDuplicateKey(image: CapturedImageRecord): string {
  const normalizeUrl = (value?: string | null) => {
    if (!value) return '';

    try {
      const url = new URL(value);
      url.hash = '';
      return url.toString();
    } catch {
      return value.trim();
    }
  };

  const originalKey = normalizeUrl(image.originalUrl);
  if (originalKey) return `original:${originalKey}`;

  const pageKey = normalizeUrl(image.pageUrl);
  const hostKey = image.sourceHost?.trim().toLowerCase() || '';
  const imageTypeKey = image.imageType?.trim().toLowerCase() || '';

  if (pageKey && hostKey && imageTypeKey) return `page:${hostKey}|${pageKey}|${imageTypeKey}`;
  if (pageKey && imageTypeKey) return `page:${pageKey}|${imageTypeKey}`;

  return `image:${normalizeUrl(image.imageUrl)}`;
}

function parseMaterialDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T'));
  }
  return new Date(value);
}

function formatMaterialDateLabel(value: string): string {
  const date = parseMaterialDate(value);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';

  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
}

function formatMaterialTime(value: string): string {
  return parseMaterialDate(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMaterialDateGroup(value: string): 'today' | 'yesterday' | 'earlier' {
  const date = parseMaterialDate(value);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'earlier';
}

async function parseErrorResponse(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallbackMessage;
    try {
      const parsed = JSON.parse(text) as JsonObject;
      return getString(parsed.message) || fallbackMessage;
    } catch {
      return text.length < 200 ? text : fallbackMessage;
    }
  } catch {
    return fallbackMessage;
  }
}

export default function QuickCreatePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, setPoints } = useUser();
  const gallerySectionRef = useRef<HTMLDivElement>(null);
  const imageButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [capturedImages, setCapturedImages] = useState<CapturedImageRecord[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [columnCount, setColumnCount] = useState(4);
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [processingAction, setProcessingAction] = useState<GalleryActionId | null>(null);
  const [actionBarPosition, setActionBarPosition] = useState<{ top: number; left: number } | null>(null);
  const [showAiPromptPanel, setShowAiPromptPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAspectRatio, setAiAspectRatio] = useState('auto');
  const [aiResolution, setAiResolution] = useState('2k');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [imageEditor, setImageEditor] = useState<ImageEditorState>({
    open: false,
    mode: 'crop',
    imageUrl: '',
  });

  const selectedImageList = useMemo(() => Array.from(selectedImages), [selectedImages]);

  const duplicateImageCount = useMemo(() => {
    const duplicatedTargets = new Map<string, number>();
    for (const image of capturedImages) {
      const duplicateKey = normalizeDuplicateKey(image);
      duplicatedTargets.set(duplicateKey, (duplicatedTargets.get(duplicateKey) || 0) + 1);
    }

    return Array.from(duplicatedTargets.values()).reduce((count, current) => {
      if (current <= 1) return count;
      return count + current - 1;
    }, 0);
  }, [capturedImages]);

  const processingActionLabel = useMemo(
    () => galleryActions.find((action) => action.id === processingAction)?.label || null,
    [processingAction]
  );

  const filteredCapturedImages = useMemo(() => {
    return capturedImages.filter((image) => {
      if (materialFilter === 'all') return true;
      return getMaterialDateGroup(image.createdAt) === materialFilter;
    });
  }, [capturedImages, materialFilter]);

  const groupedMaterials = useMemo(() => {
    const groupMap = new Map<'today' | 'yesterday' | 'earlier', CapturedImageRecord[]>();
    for (const image of filteredCapturedImages) {
      const key = getMaterialDateGroup(image.createdAt);
      const current = groupMap.get(key) || [];
      current.push(image);
      groupMap.set(key, current);
    }

    return [
      { key: 'today' as const, label: '今天', items: groupMap.get('today') || [] },
      { key: 'yesterday' as const, label: '昨天', items: groupMap.get('yesterday') || [] },
      { key: 'earlier' as const, label: '更早', items: groupMap.get('earlier') || [] },
    ].filter((group) => group.items.length > 0);
  }, [filteredCapturedImages]);

  const dispatchTaskHistoryUpdated = useCallback((delay = 0) => {
    const dispatch = () => window.dispatchEvent(new Event('taskHistoryUpdated'));
    if (delay > 0) {
      window.setTimeout(dispatch, delay);
      return;
    }
    dispatch();
  }, []);

  const syncPoints = useCallback((points: number) => {
    setPoints(points);
    window.dispatchEvent(new CustomEvent('userPointsChanged', { detail: { points } }));
  }, [setPoints]);

  const loadCapturedImages = useCallback(async () => {
    try {
      const response = await fetch('/api/plugin/captured-images', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.data)) return;
      setCapturedImages(data.data);
    } catch (error) {
      console.error('[素材库] 加载失败:', error);
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
        const response = await fetch('/api/upload/file', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success && data.data?.url) {
          uploadedUrls.push(data.data.url);
        }
      }

      if (uploadedUrls.length > 0) {
        await loadCapturedImages();
        showToast(`成功加入 ${uploadedUrls.length} 张图片到素材库`, 'success');
      } else {
        showToast('上传失败，请重试', 'error');
      }
    } catch {
      showToast('上传失败，请重试', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadCapturedImages]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    await uploadFiles(files);
  };

  useEffect(() => {
    const handleWindowDragEnter = (event: DragEvent) => {
      event.preventDefault();
      if ((event.dataTransfer?.types || []).includes('Files')) setIsDragging(true);
    };
    const handleWindowDragOver = (event: DragEvent) => {
      event.preventDefault();
      if ((event.dataTransfer?.types || []).includes('Files')) setIsDragging(true);
    };
    const handleWindowDrop = () => setIsDragging(false);
    const handleWindowDragLeave = (event: DragEvent) => {
      if (event.clientX === 0 && event.clientY === 0) setIsDragging(false);
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('dragleave', handleWindowDragLeave);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('dragleave', handleWindowDragLeave);
    };
  }, [uploadFiles]);

  const removeUploadedImage = async (image: CapturedImageRecord) => {
    try {
      const response = await fetch('/api/plugin/captured-images', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: image.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '删除失败');
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
        const target = capturedImages.find((image) => image.imageUrl === imageUrl);
        if (!target) continue;

        const response = await fetch('/api/plugin/captured-images', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: target.id }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '删除失败');
      }

      setCapturedImages((prev) => prev.filter((image) => !selectedImages.has(image.imageUrl)));
      setSelectedImages(new Set());
      setShowAiPromptPanel(false);
      setAiPrompt('');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除失败';
      showToast(errorMessage, 'error');
    }
  };

  const deleteDuplicateImages = async () => {
    const duplicatedTargets = new Map<string, CapturedImageRecord[]>();
    for (const image of capturedImages) {
      const duplicateKey = normalizeDuplicateKey(image);
      const existing = duplicatedTargets.get(duplicateKey) || [];
      existing.push(image);
      duplicatedTargets.set(duplicateKey, existing);
    }

    const imagesToDelete = Array.from(duplicatedTargets.values())
      .filter((items) => items.length > 1)
      .flatMap((items) => items.slice(1));

    if (imagesToDelete.length === 0) {
      showToast('没有重复图片可删除', 'info');
      return;
    }

    try {
      for (const image of imagesToDelete) {
        const response = await fetch('/api/plugin/captured-images', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: image.id }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '删除重复图片失败');
      }

      const duplicateIdSet = new Set(imagesToDelete.map((image) => image.id));
      setCapturedImages((prev) => prev.filter((image) => !duplicateIdSet.has(image.id)));
      showToast(`已删除 ${imagesToDelete.length} 张重复图片`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除重复图片失败';
      showToast(errorMessage, 'error');
    }
  };

  const toggleImageSelection = (url: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
        if (next.size === 0) {
          setShowAiPromptPanel(false);
          setAiPrompt('');
          setAiAspectRatio('auto');
          setAiResolution('2k');
        }
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handlePluginCapture = useCallback(async (payload: PluginCapturePayload | null) => {
    if (!payload?.imageUrl) return;
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
      showToast('插件采图成功，图片已加入素材库', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '插件采图失败';
      showToast(errorMessage, 'error');
    }
  }, [loadCapturedImages]);

  const ensureUserReady = useCallback(() => {
    if (!user?.id) {
      showToast('请先登录后再执行功能', 'error');
      return false;
    }
    return true;
  }, [user?.id]);

  const ensureEnoughColorExtractionPoints = useCallback(async (imageCount: number) => {
    if (!user?.id) return false;
    const requiredPoints = 30 * imageCount;
    try {
      const response = await fetch(`/api/user/profile?userId=${encodeURIComponent(user.id)}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        if ((user.points || 0) < requiredPoints) {
          showToast(`积分不足，当前 ${user.points || 0}，需要 ${requiredPoints}`, 'error');
          return false;
        }
        return true;
      }

      const data = await response.json() as { success?: boolean; data?: { points?: number } };
      const currentPoints = data.success ? (data.data?.points || 0) : (user.points || 0);
      syncPoints(currentPoints);

      if (currentPoints < requiredPoints) {
        showToast(`积分不足，当前 ${currentPoints}，需要 ${requiredPoints}`, 'error');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[素材库] 校验彩绘提取积分失败:', error);
      if ((user.points || 0) < requiredPoints) {
        showToast(`积分不足，当前 ${user.points || 0}，需要 ${requiredPoints}`, 'error');
        return false;
      }
      return true;
    }
  }, [syncPoints, user?.id, user?.points]);

  const startColorExtraction = useCallback((imageUrl: string) => {
    if (!user?.id) return;
    const tempOrderId = `ORD${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    addTaskRecord('color-extraction', '彩绘提取', '手机壳彩绘提取', undefined, tempOrderId, undefined, imageUrl, '处理中');

    void (async () => {
      try {
        const response = await fetch('/api/color-extraction2/workflow', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, imageUrl, orderId: tempOrderId }),
        });

        const data = await response.json() as {
          success?: boolean;
          message?: string;
          data?: { imageUrl?: string; remainingPoints?: number };
        };

        if (!response.ok || !data.success) throw new Error(data.message || '彩绘提取失败');

        updateTaskRecordStatus(tempOrderId, '成功', data.data?.imageUrl);
        if (typeof data.data?.remainingPoints === 'number') syncPoints(data.data.remainingPoints);
        dispatchTaskHistoryUpdated();
      } catch (error) {
        console.error('[素材库] 彩绘提取执行失败:', error);
        updateTaskRecordStatus(tempOrderId, '失败');
        dispatchTaskHistoryUpdated();
      }
    })();
  }, [dispatchTaskHistoryUpdated, syncPoints, user?.id]);

  const startRemoveWatermark = useCallback((imageUrl: string) => {
    if (!user?.id) return;
    void (async () => {
      try {
        const response = await fetch('/api/remove-watermark/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, imageUrl }),
        });
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, '去除水印失败');
          throw new Error(errorMessage);
        }
        dispatchTaskHistoryUpdated();
      } catch (error) {
        console.error('[素材库] 去除水印执行失败:', error);
        dispatchTaskHistoryUpdated();
      }
    })();
    dispatchTaskHistoryUpdated(500);
  }, [dispatchTaskHistoryUpdated, user?.id]);

  const startUpsampling = useCallback((imageUrl: string) => {
    if (!user?.id) return;
    void (async () => {
      try {
        const response = await fetch('/api/image-upsampling/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, imageUrl }),
        });
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, '高清放大失败');
          throw new Error(errorMessage);
        }
        dispatchTaskHistoryUpdated();
      } catch (error) {
        console.error('[素材库] 高清放大执行失败:', error);
        dispatchTaskHistoryUpdated();
      }
    })();
    dispatchTaskHistoryUpdated(500);
  }, [dispatchTaskHistoryUpdated, user?.id]);

  const startAiGenerate = useCallback((imageUrl: string, prompt: string) => {
    const tempOrderId = `TEMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    addTaskRecord('auto-remove-bg', 'AI生图', prompt ? `AI生图：${prompt}` : 'AI生图', undefined, tempOrderId, undefined, imageUrl, '处理中');
    window.setTimeout(() => {
      updateTaskRecordStatus(tempOrderId, '失败');
      dispatchTaskHistoryUpdated();
    }, 1200);
  }, [dispatchTaskHistoryUpdated]);

  const handleRunAction = useCallback(async (actionId: GalleryActionId) => {
    if (!ensureUserReady()) return;
    if (selectedImageList.length === 0) {
      showToast('请先在素材库中选择图片', 'error');
      return;
    }

    if (actionId === 'auto-remove-bg') {
      setShowAiPromptPanel((current) => !current);
      return;
    }

    setProcessingAction(actionId);
    try {
      if (actionId === 'color-extraction') {
        const hasEnoughPoints = await ensureEnoughColorExtractionPoints(selectedImageList.length);
        if (!hasEnoughPoints) return;
        selectedImageList.forEach((imageUrl) => startColorExtraction(imageUrl));
        showToast(`已提交 ${selectedImageList.length} 张图片到彩绘提取`, 'info');
      }

      if (actionId === 'watermark') {
        selectedImageList.forEach((imageUrl) => startRemoveWatermark(imageUrl));
        showToast(`已提交 ${selectedImageList.length} 张图片到去除水印`, 'info');
      }

      if (actionId === 'upsampling') {
        selectedImageList.forEach((imageUrl) => startUpsampling(imageUrl));
        showToast(`已提交 ${selectedImageList.length} 张图片到高清放大`, 'info');
      }

      setSelectedImages(new Set());
    } finally {
      setProcessingAction(null);
    }
  }, [ensureEnoughColorExtractionPoints, ensureUserReady, selectedImageList, startColorExtraction, startRemoveWatermark, startUpsampling]);

  const submitAiGenerate = useCallback(() => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      showToast('请输入AI生图提示词', 'error');
      return;
    }

    setShowAiPromptPanel(false);
    setProcessingAction('auto-remove-bg');
    try {
      selectedImageList.forEach((imageUrl) => {
        startAiGenerate(imageUrl, `${prompt} [比例:${aiAspectRatio} 分辨率:${aiResolution}]`);
      });
      showToast('AI生图前端交互已完成，等待你后续提供正式接口后接入', 'info');
      setSelectedImages(new Set());
      setAiPrompt('');
      setAiAspectRatio('auto');
      setAiResolution('2k');
    } finally {
      setProcessingAction(null);
    }
  }, [aiAspectRatio, aiPrompt, aiResolution, selectedImageList, startAiGenerate]);

  const handleEditorAction = useCallback((action: EditorAction['id']) => {
    if (selectedImageList.length !== 1) {
      showToast('编辑类功能一次只能选择 1 张图片', 'error');
      return;
    }

    if (action === 'edit-image') {
      setImageEditor({ open: true, mode: 'crop', imageUrl: selectedImageList[0] });
      return;
    }

    if (action === 'annotate') {
      setImageEditor({ open: true, mode: 'annotate', imageUrl: selectedImageList[0] });
    }
  }, [selectedImageList]);

  const closeImageEditor = useCallback(() => {
    setImageEditor({ open: false, mode: 'crop', imageUrl: '' });
  }, []);

  const handleEditorComplete = useCallback(async () => {
    await loadCapturedImages();
    showToast('编辑后的素材已加入素材库', 'success');
  }, [loadCapturedImages]);

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
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
    queueMicrotask(() => {
      void loadCapturedImages();
    });
  }, [loadCapturedImages]);

  useEffect(() => {
    const updateColumnCount = () => {
      const width = window.innerWidth;
      if (width >= 1800) return setColumnCount(6);
      if (width >= 1500) return setColumnCount(5);
      if (width >= 1180) return setColumnCount(4);
      if (width >= 820) return setColumnCount(3);
      setColumnCount(2);
    };
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

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
      setActionBarPosition({ left: centerX, top });
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

  return (
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      {imageEditor.open && imageEditor.mode === 'crop' && (
        <CropEditorPanel imageUrl={imageEditor.imageUrl} onClose={closeImageEditor} onComplete={handleEditorComplete} />
      )}

      {imageEditor.open && imageEditor.mode === 'annotate' && (
        <AnnotateEditorPanel imageUrl={imageEditor.imageUrl} onClose={closeImageEditor} onComplete={handleEditorComplete} />
      )}

      {isDragging && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            void handleDrop(event);
          }}
        >
          <div className="absolute inset-8 rounded-[2rem] border-2 border-dashed border-purple-400 bg-purple-500/10 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-white/10 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-2xl font-semibold">松开鼠标即可上传到素材库</p>
              <p className="mt-2 text-white/65">现在整个页面都支持直接拖入本地图片素材</p>
            </div>
          </div>
        </div>
      )}

      <div
        ref={gallerySectionRef}
        className={`relative max-w-[92vw] 2xl:max-w-[1780px] mx-auto transition-all ${isDragging ? 'scale-[0.995]' : ''}`}
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
            <h2 className="text-3xl font-bold text-white">素材库</h2>
            <p className="text-white/55 mt-2">这里统一收集、整理和筛选图片素材，选图后直接执行功能，处理进度和结果统一在右侧历史记录查看</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-11 h-11 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white flex items-center justify-center hover:opacity-90 transition-opacity"
            title="上传本地素材"
          >
            <span className="text-2xl leading-none">+</span>
          </button>
        </div>

        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="text-sm text-white/45">共 {filteredCapturedImages.length} 张素材</div>

          <div className="flex items-center gap-3">
            {duplicateImageCount > 0 && (
              <button
                onClick={() => void deleteDuplicateImages()}
                disabled={processingAction !== null}
                className="px-3 py-2 rounded-full bg-white/10 hover:bg-red-500/85 text-white/65 hover:text-white text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                删除重复
              </button>
            )}

            {selectedImageList.length > 0 && (
              <button
                onClick={() => void deleteSelectedImages()}
                disabled={processingAction !== null}
                className="px-3 py-2 rounded-full bg-white/10 hover:bg-red-500/85 text-white/65 hover:text-white text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                删除所选
              </button>
            )}

            <label className="flex items-center gap-2 text-sm text-white/60">
              <span>按日期筛选</span>
              <select
                value={materialFilter}
                onChange={(event) => setMaterialFilter(event.target.value as MaterialFilter)}
                className="rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/40"
              >
                <option value="all" className="bg-[#111]">全部日期</option>
                <option value="today" className="bg-[#111]">今天</option>
                <option value="yesterday" className="bg-[#111]">昨天</option>
                <option value="earlier" className="bg-[#111]">更早</option>
              </select>
            </label>
          </div>
        </div>

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
            素材上传中...
          </div>
        )}

        {filteredCapturedImages.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center text-white/45">
            {capturedImages.length === 0
              ? '素材库里还没有图片素材，可以通过插件采集图片，或点击右上角上传本地图片'
              : '当前筛选条件下没有匹配的素材'}
          </div>
        ) : (
          <div className="mb-8 space-y-10">
            {groupedMaterials.map((group) => {
              const groupColumns = (() => {
                const columns = Array.from({ length: columnCount }, () => ({
                  items: [] as CapturedImageRecord[],
                  heightScore: 0,
                }));

                for (const image of group.items) {
                  const ratio = imageAspectRatios[image.imageUrl] ?? 1;
                  let targetIndex = 0;

                  for (let i = 1; i < columns.length; i += 1) {
                    if (columns[i].heightScore < columns[targetIndex].heightScore) {
                      targetIndex = i;
                    }
                  }

                  columns[targetIndex].items.push(image);
                  columns[targetIndex].heightScore += ratio;
                }

                return columns.map((column) => column.items);
              })();

              return (
                <section key={group.key}>
                  <div className="flex items-center gap-3 mb-5">
                    <h3 className="text-xl font-semibold text-white">{group.label}</h3>
                    <span className="text-xs text-white/45 rounded-full border border-white/10 px-2.5 py-1 bg-white/[0.04]">
                      {group.items.length} 张素材
                    </span>
                  </div>

                  <div className="flex items-start justify-center gap-5 xl:gap-6">
                    {groupColumns.map((column, columnIndex) => (
                      <div key={`${group.key}-${columnIndex}`} className="flex-1 min-w-0 max-w-[290px] space-y-5">
                        {column.map((image, index) => {
                          const selected = selectedImages.has(image.imageUrl);
                          const cardIndex = columnIndex * 100 + index;
                          const accentClass = cardIndex % 7 === 0
                            ? 'before:absolute before:inset-0 before:border before:border-purple-400/20 before:rounded-[1.2rem] before:pointer-events-none'
                            : '';

                          return (
                            <button
                              key={image.id}
                              ref={(node) => {
                                imageButtonRefs.current[image.imageUrl] = node;
                              }}
                              type="button"
                              onClick={() => toggleImageSelection(image.imageUrl)}
                              className={`group relative block w-full overflow-hidden rounded-[1.35rem] border transition-all ${accentClass} ${selected ? 'border-purple-500 ring-2 ring-purple-500/50 shadow-[0_0_0_1px_rgba(168,85,247,0.25),0_24px_50px_rgba(76,29,149,0.28)] -translate-y-1' : 'border-white/10 hover:border-white/30 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(15,23,42,0.35)]'}`}
                            >
                              <div className="w-full bg-black/20">
                                <img
                                  src={image.imageUrl}
                                  alt={`素材图片 ${cardIndex + 1}`}
                                  className="h-auto w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                  onLoad={(event) => {
                                    const ratio = event.currentTarget.naturalHeight / Math.max(event.currentTarget.naturalWidth, 1);
                                    setImageAspectRatios((prev) => {
                                      if (prev[image.imageUrl] === ratio) return prev;
                                      return { ...prev, [image.imageUrl]: ratio };
                                    });
                                  }}
                                />
                              </div>
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent opacity-70" />
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void removeUploadedImage(image);
                                }}
                                className="absolute top-3 right-3 w-7 h-7 bg-red-500/80 hover:bg-red-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title="移除图片"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                              {selected && (
                                <div className="absolute top-3 left-3 w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white shadow-lg">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                              <div className="absolute left-3 bottom-3 text-left opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-[11px] tracking-[0.18em] uppercase text-white/55">Material</p>
                                <p className="text-sm text-white/85 mt-1">素材 {cardIndex + 1}</p>
                                <p className="text-[11px] text-white/50 mt-1">
                                  {formatMaterialDateLabel(image.createdAt)}
                                  <span className="mx-1 text-white/35">·</span>
                                  {formatMaterialTime(image.createdAt)}
                                  {(image.imageType || 'main') ? ` · ${(image.imageType || 'main') === 'detail' ? '明细图' : '主图'}` : ''}
                                  {image.sourceHost ? ` · ${image.sourceHost}` : ''}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {selectedImageList.length > 0 && actionBarPosition && (
          <div
            className="pointer-events-none absolute z-30 transition-all duration-150"
            style={{
              top: actionBarPosition.top + 6,
              left: actionBarPosition.left,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="pointer-events-none absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-l border-t border-white/12 bg-black/78 backdrop-blur-2xl" />
            <div className={`pointer-events-auto rounded-[1.6rem] border border-white/12 bg-black/78 px-4 py-4 backdrop-blur-2xl shadow-[0_18px_40px_rgba(0,0,0,0.38),0_6px_18px_rgba(88,28,135,0.24)] ring-1 ring-white/5 max-w-[92vw] transition-all ${showAiPromptPanel ? 'min-w-[760px]' : 'min-w-[420px]'}`}>
              <div className="flex items-center justify-between gap-4">
                <span className="whitespace-nowrap text-xs font-medium text-white/68">已选 {selectedImageList.length} 张</span>
                {processingActionLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/18 px-2.5 py-1 text-xs font-medium text-purple-200 border border-purple-400/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-300 animate-pulse"></span>
                    正在提交 {processingActionLabel}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {editorActions.map((action) => {
                  const disabled = selectedImageList.length !== 1 || processingAction !== null;
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleEditorAction(action.id)}
                      disabled={disabled}
                      className={`px-3.5 py-2 rounded-full text-sm font-medium transition-all ${disabled ? 'bg-white/6 text-white/30 cursor-not-allowed' : 'bg-white/9 text-white/78 hover:-translate-y-0.5 hover:bg-white/16 hover:text-white'}`}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </div>

              {showAiPromptPanel && (
                <div className="mt-5 mb-4 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/8 p-4">
                  <div className="flex flex-wrap items-start gap-3 mb-4">
                    <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                      {selectedImageList.slice(0, 6).map((imageUrl, index) => (
                        <div key={`${imageUrl}-${index}`} className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 bg-black/20">
                          <img src={imageUrl} alt={`已选素材 ${index + 1}`} className="w-full h-full object-cover" />
                        </div>
                      ))}
                      {selectedImageList.length > 6 && (
                        <div className="w-14 h-14 rounded-xl border border-white/10 bg-white/6 flex items-center justify-center text-xs text-white/55">
                          +{selectedImageList.length - 6}
                        </div>
                      )}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-14 h-14 rounded-xl border border-dashed border-white/15 bg-white/6 hover:bg-white/12 text-white/70 hover:text-white flex items-center justify-center transition-colors"
                        title="继续上传素材"
                      >
                        <span className="text-2xl leading-none">+</span>
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <textarea
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      placeholder="请输入 AI 生图提示词"
                      className="w-full min-h-[108px] rounded-2xl border border-white/12 bg-white/6 px-4 py-3 pb-14 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/35"
                    />

                    <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={aiAspectRatio}
                          onChange={(event) => setAiAspectRatio(event.target.value)}
                          className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40"
                        >
                          <option value="auto" className="bg-[#111]">自动</option>
                          <option value="1:1" className="bg-[#111]">1:1</option>
                          <option value="2:3" className="bg-[#111]">2:3</option>
                          <option value="3:2" className="bg-[#111]">3:2</option>
                          <option value="3:4" className="bg-[#111]">3:4</option>
                          <option value="4:3" className="bg-[#111]">4:3</option>
                          <option value="4:5" className="bg-[#111]">4:5</option>
                          <option value="5:4" className="bg-[#111]">5:4</option>
                          <option value="9:16" className="bg-[#111]">9:16</option>
                          <option value="16:9" className="bg-[#111]">16:9</option>
                          <option value="21:9" className="bg-[#111]">21:9</option>
                        </select>

                        <select
                          value={aiResolution}
                          onChange={(event) => setAiResolution(event.target.value)}
                          className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40"
                        >
                          <option value="1k" className="bg-[#111]">1k</option>
                          <option value="2k" className="bg-[#111]">2k</option>
                          <option value="4k" className="bg-[#111]">4k</option>
                        </select>
                      </div>

                      <button
                        onClick={submitAiGenerate}
                        disabled={processingAction !== null}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        开始AI生图
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {galleryActions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => {
                      if (action.id === 'auto-remove-bg') {
                        setShowAiPromptPanel((current) => !current);
                        return;
                      }
                      void handleRunAction(action.id);
                    }}
                    disabled={processingAction !== null}
                    className={`min-w-[88px] px-3.5 py-2 rounded-full text-sm font-medium transition-all bg-white/9 text-white/82 hover:-translate-y-0.5 hover:bg-gradient-to-r hover:from-purple-600 hover:to-blue-600 hover:text-white hover:shadow-[0_10px_24px_rgba(109,40,217,0.28)] disabled:cursor-not-allowed ${processingAction !== null && processingAction !== action.id ? 'opacity-35' : 'disabled:opacity-50'} ${showAiPromptPanel && action.id === 'auto-remove-bg' ? 'ring-2 ring-fuchsia-400/60 bg-fuchsia-500/16 text-white' : ''}`}
                  >
                    {processingAction === action.id ? '提交中...' : action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
