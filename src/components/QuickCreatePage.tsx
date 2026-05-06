'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addTaskRecord, updateTaskRecordStatus } from '@/components/TaskHistory';
import CropEditorPanel from '@/components/CropEditorPanel';
import AnnotateEditorPanel from '@/components/AnnotateEditorPanel';
import LocalEditPanel from '@/components/LocalEditPanel';
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
  folderId?: string | null;
  isFavorite?: boolean;
  createdAt: string;
};

type MaterialFilter = 'all' | 'today' | 'yesterday' | 'earlier';
type MaterialScope = 'all' | 'favorite' | 'uncategorized' | `folder:${string}`;
type GalleryActionId = 'color-extraction' | 'auto-remove-bg' | 'watermark' | 'upsampling';

type MaterialFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

type GalleryAction = {
  id: GalleryActionId;
  label: string;
  description: string;
  className: string;
  tag: string;
  preview: React.ReactNode;
};

type EditorAction = {
  id: 'edit-image' | 'annotate' | 'local-edit';
  label: string;
};

type ImageEditorState = {
  open: boolean;
  mode: 'crop' | 'annotate';
  imageUrl: string;
};

type DuplicateReviewState = {
  open: boolean;
  groups: CapturedImageRecord[][];
  selectedIds: Set<string>;
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
  { id: 'local-edit', label: '局部改图' },
];

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeDuplicateKey(image: CapturedImageRecord): string {
  const normalizeUrl = (value?: string | null, keepSearch = false) => {
    if (!value) return '';

    try {
      const url = new URL(value);
      url.hash = '';
      if (!keepSearch) {
        url.search = '';
      }
      return url.toString();
    } catch {
      return value.trim();
    }
  };

  const normalizeProductPage = (value?: string | null) => {
    if (!value) return '';

    try {
      const url = new URL(value);
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      const productId = url.searchParams.get('id') || url.searchParams.get('itemId') || url.searchParams.get('item_id');
      if (productId && (host.includes('taobao.com') || host.includes('tmall.com'))) {
        return `${host}:${productId}`;
      }

      url.hash = '';
      url.search = '';
      return url.toString();
    } catch {
      return value.trim();
    }
  };

  const originalKey = normalizeUrl(image.originalUrl);
  if (originalKey) return `original:${originalKey}`;

  const pageKey = normalizeProductPage(image.pageUrl);
  const hostKey = image.sourceHost?.trim().toLowerCase() || '';
  const imageTypeKey = image.imageType?.trim().toLowerCase() || '';

  if (pageKey && hostKey && imageTypeKey) return `page:${hostKey}|${pageKey}|${imageTypeKey}`;
  if (pageKey && imageTypeKey) return `page:${pageKey}|${imageTypeKey}`;

  return `image:${normalizeUrl(image.imageUrl)}`;
}

function getDuplicateImageGroups(images: CapturedImageRecord[]) {
  const duplicatedTargets = new Map<string, CapturedImageRecord[]>();
  for (const image of images) {
    const duplicateKey = normalizeDuplicateKey(image);
    const existing = duplicatedTargets.get(duplicateKey) || [];
    existing.push(image);
    duplicatedTargets.set(duplicateKey, existing);
  }

  return Array.from(duplicatedTargets.values()).filter((items) => items.length > 1);
}

function getDisplayImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('/plugin-capture/') || imageUrl.startsWith('/material-editor/')) {
    return `/api/material-file${imageUrl}`;
  }
  return imageUrl;
}

function getProcessingImageUrl(imageUrl: string): string {
  const displayUrl = getDisplayImageUrl(imageUrl);
  if (displayUrl.startsWith('http://') || displayUrl.startsWith('https://')) {
    return displayUrl;
  }

  if (typeof window !== 'undefined') {
    return new URL(displayUrl, window.location.origin).toString();
  }

  return displayUrl;
}

function getDownloadFileName(image: CapturedImageRecord): string {
  const type = image.imageType === 'detail' ? 'detail' : image.imageType === 'edited' ? 'edited' : 'main';
  const fallbackExtension = image.imageUrl.includes('.png') ? 'png' : image.imageUrl.includes('.webp') || image.imageUrl.includes('.web') ? 'webp' : 'jpg';
  return `zaomeng-${type}-${image.id.slice(0, 8)}.${fallbackExtension}`;
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
  const aiReferenceInputRef = useRef<HTMLInputElement>(null);
  const { user, setPoints } = useUser();
  const gallerySectionRef = useRef<HTMLDivElement>(null);
  const imageButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragDepthRef = useRef(0);
  const [capturedImages, setCapturedImages] = useState<CapturedImageRecord[]>([]);
  const [materialFolders, setMaterialFolders] = useState<MaterialFolder[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [isAiReferenceUploading, setIsAiReferenceUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [columnCount, setColumnCount] = useState(4);
  const [thumbnailSize, setThumbnailSize] = useState(290);
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [processingAction, setProcessingAction] = useState<GalleryActionId | null>(null);
  const [actionBarPosition, setActionBarPosition] = useState<{ top: number; left: number } | null>(null);
  const [showAiPromptPanel, setShowAiPromptPanel] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAspectRatio, setAiAspectRatio] = useState('auto');
  const [aiResolution, setAiResolution] = useState('2k');
  const [materialScope, setMaterialScope] = useState<MaterialScope>('all');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState('');
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [imageEditor, setImageEditor] = useState<ImageEditorState>({
    open: false,
    mode: 'crop',
    imageUrl: '',
  });
  const [localEditImageUrl, setLocalEditImageUrl] = useState('');
  const [showLocalEdit, setShowLocalEdit] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState>({
    open: false,
    groups: [],
    selectedIds: new Set(),
  });

  const selectedImageList = useMemo(() => Array.from(selectedImages), [selectedImages]);
  const thumbnailGap = thumbnailSize >= 300 ? 24 : thumbnailSize >= 240 ? 20 : 16;

  const selectedCapturedImages = useMemo(() => {
    const selectedSet = new Set(selectedImageList);
    return capturedImages.filter((image) => selectedSet.has(image.imageUrl));
  }, [capturedImages, selectedImageList]);

  const activeFolderId = materialScope.startsWith('folder:') ? materialScope.slice('folder:'.length) : null;
  const activeFolder = activeFolderId ? materialFolders.find((folder) => folder.id === activeFolderId) || null : null;

  const duplicateImageCount = useMemo(() => {
    return getDuplicateImageGroups(capturedImages).reduce((count, items) => count + items.length - 1, 0);
  }, [capturedImages]);

  const processingActionLabel = useMemo(
    () => galleryActions.find((action) => action.id === processingAction)?.label || null,
    [processingAction]
  );

  const filteredCapturedImages = useMemo(() => {
    return capturedImages.filter((image) => {
      if (materialScope === 'favorite' && !image.isFavorite) return false;
      if (materialScope === 'uncategorized' && image.folderId) return false;
      if (materialScope.startsWith('folder:') && image.folderId !== materialScope.slice('folder:'.length)) return false;
      if (materialFilter === 'all') return true;
      return getMaterialDateGroup(image.createdAt) === materialFilter;
    });
  }, [capturedImages, materialFilter, materialScope]);

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

  const loadMaterialFolders = useCallback(async () => {
    try {
      const response = await fetch('/api/material-folders', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.data)) return;
      setMaterialFolders(data.data);
    } catch (error) {
      console.error('[素材库] 加载文件夹失败:', error);
    }
  }, []);

  const createMaterialFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      showToast('请输入文件夹名称', 'error');
      return;
    }

    try {
      const response = await fetch('/api/material-folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '创建文件夹失败');
      setNewFolderName('');
      setShowNewFolderInput(false);
      await loadMaterialFolders();
      showToast('文件夹已创建', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建文件夹失败';
      showToast(message, 'error');
    }
  }, [loadMaterialFolders, newFolderName]);

  const startRenameActiveFolder = useCallback(() => {
    if (!activeFolder) return;
    setRenamingFolderId(activeFolder.id);
    setRenamingFolderName(activeFolder.name);
  }, [activeFolder]);

  const renameActiveFolder = useCallback(async () => {
    const name = renamingFolderName.trim();
    if (!renamingFolderId || !name) {
      showToast('请输入新的文件夹名称', 'error');
      return;
    }

    try {
      const response = await fetch('/api/material-folders', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renamingFolderId, name }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '重命名失败');
      setRenamingFolderId('');
      setRenamingFolderName('');
      await loadMaterialFolders();
      showToast('文件夹已重命名', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '重命名失败';
      showToast(message, 'error');
    }
  }, [loadMaterialFolders, renamingFolderId, renamingFolderName]);

  const deleteActiveFolder = useCallback(async () => {
    if (!activeFolder) return;
    const confirmed = window.confirm(`删除文件夹「${activeFolder.name}」？文件夹内素材会移到未分类，不会删除图片。`);
    if (!confirmed) return;

    try {
      const response = await fetch('/api/material-folders', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeFolder.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '删除文件夹失败');
      setMaterialScope('uncategorized');
      await loadMaterialFolders();
      await loadCapturedImages();
      showToast('文件夹已删除，素材已移到未分类', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除文件夹失败';
      showToast(message, 'error');
    }
  }, [activeFolder, loadCapturedImages, loadMaterialFolders]);

  const updateMaterials = useCallback(async (ids: string[], updates: { folderId?: string | null; isFavorite?: boolean }) => {
    if (ids.length === 0) return false;
    try {
      const response = await fetch('/api/materials/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, ...updates }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '更新素材失败');
      await loadCapturedImages();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新素材失败';
      showToast(message, 'error');
      return false;
    }
  }, [loadCapturedImages]);

  const toggleMaterialFavorite = useCallback(async (image: CapturedImageRecord) => {
    const success = await updateMaterials([image.id], { isFavorite: !image.isFavorite });
    if (success) {
      showToast(image.isFavorite ? '已取消收藏' : '已加入收藏', 'success');
    }
  }, [updateMaterials]);

  const moveSelectedMaterials = useCallback(async (targetValue: string) => {
    const ids = selectedCapturedImages.map((image) => image.id);
    if (!targetValue || ids.length === 0) return;
    const folderId = targetValue === '__uncategorized__' ? null : targetValue;
    const success = await updateMaterials(ids, { folderId });
    if (success) {
      showToast(folderId ? '已移动到文件夹' : '已移动到未分类', 'success');
    }
  }, [selectedCapturedImages, updateMaterials]);

  const validateImageFiles = useCallback((files: File[]) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const invalidFiles = files.filter((file) => !validTypes.includes(file.type));
    if (invalidFiles.length > 0) {
      showToast('请上传 JPG、PNG、WebP 或 GIF 格式的图片', 'error');
      return false;
    }

    const maxSize = 10 * 1024 * 1024;
    const oversizedFiles = files.filter((file) => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      showToast('单张图片大小不能超过 10MB', 'error');
      return false;
    }

    return true;
  }, []);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (!validateImageFiles(files)) return;

    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('createMaterial', 'true');
        if (activeFolderId) {
          formData.append('materialFolderId', activeFolderId);
        }
        const response = await fetch('/api/upload/file', { method: 'POST', credentials: 'include', body: formData });
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
  }, [activeFolderId, loadCapturedImages, validateImageFiles]);

  const uploadAiReferenceFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (!validateImageFiles(files)) return;

    setIsAiReferenceUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'ai-reference');
        const response = await fetch('/api/upload/file', { method: 'POST', credentials: 'include', body: formData });
        const data = await response.json();
        if (!response.ok || !data.success || !data.data?.url) {
          throw new Error(data.message || '参考图上传失败');
        }
        uploadedUrls.push(data.data.url);
      }

      if (uploadedUrls.length > 0) {
        setSelectedImages((prev) => {
          const next = new Set(prev);
          uploadedUrls.forEach((url) => next.add(url));
          return next;
        });
        showToast(`已添加 ${uploadedUrls.length} 张 AI 参考图`, 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考图上传失败，请重试';
      showToast(message, 'error');
    } finally {
      setIsAiReferenceUploading(false);
      if (aiReferenceInputRef.current) aiReferenceInputRef.current.value = '';
    }
  }, [validateImageFiles]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadFiles(files);
  };

  const handleAiReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadAiReferenceFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    await uploadFiles(files);
  };

  const hasDraggedFiles = useCallback((dataTransfer: DataTransfer | null) => {
    return Array.from(dataTransfer?.types || []).includes('Files');
  }, []);

  useEffect(() => {
    const handleWindowDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    };
    const handleWindowDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    };
    const handleWindowDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);

      const files = Array.from(event.dataTransfer?.files || []);
      void uploadFiles(files);
    };
    const handleWindowDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0 || event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        dragDepthRef.current = 0;
        setIsDragging(false);
      }
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
  }, [hasDraggedFiles, uploadFiles]);

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

  const downloadMaterialImage = useCallback(async (image: CapturedImageRecord) => {
    const imageUrl = getDisplayImageUrl(image.imageUrl);
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error('图片下载失败');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = getDownloadFileName(image);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('[素材库] 图片下载失败:', error);
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

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

  const openDuplicateReview = () => {
    const groups = getDuplicateImageGroups(capturedImages);
    const selectedIds = new Set(groups.flatMap((items) => items.slice(1).map((image) => image.id)));

    if (selectedIds.size === 0) {
      showToast('没有重复图片可删除', 'info');
      return;
    }

    setDuplicateReview({ open: true, groups, selectedIds });
  };

  const closeDuplicateReview = () => {
    setDuplicateReview({ open: false, groups: [], selectedIds: new Set() });
  };

  const toggleDuplicateDeleteTarget = (imageId: string) => {
    setDuplicateReview((current) => {
      const selectedIds = new Set(current.selectedIds);
      if (selectedIds.has(imageId)) {
        selectedIds.delete(imageId);
      } else {
        selectedIds.add(imageId);
      }
      return { ...current, selectedIds };
    });
  };

  const confirmDeleteDuplicateImages = async () => {
    const selectedIds = duplicateReview.selectedIds;
    if (selectedIds.size === 0) {
      showToast('请至少选择一张要删除的重复图片', 'error');
      return;
    }

    const imagesToDelete = duplicateReview.groups.flat().filter((image) => selectedIds.has(image.id));

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
      setSelectedImages((prev) => {
        const next = new Set(prev);
        imagesToDelete.forEach((image) => next.delete(image.imageUrl));
        return next;
      });
      closeDuplicateReview();
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

  const previewMaterialImage = useCallback((imageUrl: string) => {
    setPreviewImageUrl(getDisplayImageUrl(imageUrl));
  }, []);

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
    const processingImageUrl = getProcessingImageUrl(imageUrl);

    addTaskRecord('color-extraction', '彩绘提取', '手机壳彩绘提取', undefined, tempOrderId, undefined, processingImageUrl, '处理中');

    void (async () => {
      try {
        const response = await fetch('/api/color-extraction2/workflow', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, imageUrl: processingImageUrl, orderId: tempOrderId }),
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
    if (!user?.id) return;
    const tempOrderId = `AIG${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const processingImageUrl = getProcessingImageUrl(imageUrl);
    addTaskRecord('ai-generate', 'AI生图', prompt ? `AI生图：${prompt}` : 'AI生图', undefined, tempOrderId, undefined, processingImageUrl, '处理中');

    void (async () => {
      try {
        const response = await fetch('/api/image-to-image/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            imageUrl: processingImageUrl,
            prompt,
            orderId: tempOrderId,
          }),
        });

        const data = await response.json() as {
          success?: boolean;
          message?: string;
          data?: { url?: string; remainingPoints?: number };
        };

        if (!response.ok || !data.success) {
          throw new Error(data.message || `AI生图失败 (${response.status})`);
        }

        updateTaskRecordStatus(tempOrderId, '成功', data.data?.url);
        if (typeof data.data?.remainingPoints === 'number') {
          syncPoints(data.data.remainingPoints);
        }
        dispatchTaskHistoryUpdated();
        void loadCapturedImages();
      } catch (error) {
        console.error('[素材库] AI生图执行失败:', error);
        updateTaskRecordStatus(tempOrderId, '失败');
        dispatchTaskHistoryUpdated();
        showToast(error instanceof Error ? error.message : 'AI生图失败', 'error');
      }
    })();
  }, [dispatchTaskHistoryUpdated, loadCapturedImages, syncPoints, user?.id]);

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
        let submittedCount = 0;
        for (let index = 0; index < selectedImageList.length; index += 1) {
          const imageUrl = selectedImageList[index];
          const remainingCount = selectedImageList.length - index;
          const stillEnoughPoints = await ensureEnoughColorExtractionPoints(remainingCount);
          if (!stillEnoughPoints) {
            showToast('剩余积分不足，后续图片未继续提交', 'warning');
            break;
          }
          startColorExtraction(imageUrl);
          submittedCount += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
        showToast(`已提交 ${submittedCount} 张图片到彩绘提取`, 'info');
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
      showToast(`已提交 ${selectedImageList.length} 张图片到AI生图`, 'info');
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
      return;
    }

    if (action === 'local-edit') {
      setLocalEditImageUrl(selectedImageList[0]);
      setShowLocalEdit(true);
    }
  }, [selectedImageList]);

  const closeImageEditor = useCallback(() => {
    setImageEditor({ open: false, mode: 'crop', imageUrl: '' });
  }, []);

  const closeLocalEdit = useCallback(() => {
    setShowLocalEdit(false);
    setLocalEditImageUrl('');
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
        return;
      }

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE_SAVED') {
        void loadCapturedImages();
      }
    };

    window.addEventListener('message', handlePluginMessage);
    return () => window.removeEventListener('message', handlePluginMessage);
  }, [handlePluginCapture, loadCapturedImages]);

  useEffect(() => {
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
    queueMicrotask(() => {
      void loadCapturedImages();
      void loadMaterialFolders();
    });
  }, [loadCapturedImages, loadMaterialFolders]);

  useEffect(() => {
    const updateColumnCount = () => {
      const containerWidth = gallerySectionRef.current?.clientWidth || window.innerWidth - 260;
      const usableWidth = Math.max(320, containerWidth - 16);
      const nextCount = Math.max(2, Math.min(12, Math.floor(usableWidth / (thumbnailSize + thumbnailGap))));
      setColumnCount(nextCount);
    };
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, [thumbnailGap, thumbnailSize]);

  useEffect(() => {
    const stored = localStorage.getItem('material-library:thumbnail-size');
    if (!stored) return;
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      queueMicrotask(() => {
        setThumbnailSize(Math.max(170, Math.min(360, parsed)));
      });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('material-library:thumbnail-size', String(thumbnailSize));
  }, [thumbnailSize]);

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

      {showLocalEdit && localEditImageUrl && (
        <LocalEditPanel imageUrl={localEditImageUrl} onClose={closeLocalEdit} onComplete={handleEditorComplete} />
      )}

      {duplicateReview.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/68 px-4 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-5xl flex-col rounded-3xl border border-white/12 bg-[#09090b]/96 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div>
                <h3 className="text-2xl font-semibold text-white">确认删除重复图片</h3>
                <p className="mt-1 text-sm text-white/50">
                  已按来源链接和商品页归类，默认保留每组第一张；取消勾选可避免误删。
                </p>
              </div>
              <button onClick={closeDuplicateReview} className="text-white/55 transition-colors hover:text-white">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {duplicateReview.groups.map((group, groupIndex) => (
                  <section key={group.map((image) => image.id).join('-')} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-white/82">重复组 {groupIndex + 1}</h4>
                        <p className="mt-1 text-xs text-white/42">共 {group.length} 张，建议至少保留 1 张</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs text-white/45">
                        勾选即删除
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                      {group.map((image, imageIndex) => {
                        const checked = duplicateReview.selectedIds.has(image.id);
                        const displayImageUrl = getDisplayImageUrl(image.imageUrl);
                        return (
                          <button
                            key={image.id}
                            type="button"
                            onClick={() => toggleDuplicateDeleteTarget(image.id)}
                            className={`group relative overflow-hidden rounded-2xl border bg-black/25 text-left transition-all ${checked ? 'border-red-400/70 ring-2 ring-red-500/35' : 'border-white/10 hover:border-white/28'}`}
                          >
                            <div className="aspect-square w-full overflow-hidden bg-black/30">
                              <img src={displayImageUrl} alt={`重复图片 ${imageIndex + 1}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            </div>
                            <div className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/70 px-2 py-1 text-[11px] text-white/72 backdrop-blur">
                              {imageIndex === 0 ? '默认保留' : '重复项'}
                            </div>
                            <div className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${checked ? 'border-red-300 bg-red-500 text-white' : 'border-white/25 bg-black/55 text-white/45'}`}>
                              {checked && (
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <div className="space-y-1 px-3 py-3">
                              <p className="truncate text-xs text-white/75">{image.pageTitle || image.sourceHost || '素材图片'}</p>
                              <p className="text-[11px] text-white/42">{formatMaterialDateLabel(image.createdAt)} · {formatMaterialTime(image.createdAt)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
              <p className="text-sm text-white/55">将删除 {duplicateReview.selectedIds.size} 张图片</p>
              <div className="flex items-center gap-3">
                <button onClick={closeDuplicateReview} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white/72 transition-colors hover:bg-white/16 hover:text-white">
                  取消
                </button>
                <button
                  onClick={() => void confirmDeleteDuplicateImages()}
                  disabled={processingAction !== null || duplicateReview.selectedIds.size === 0}
                  className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  确认删除所选重复图
                </button>
              </div>
            </div>
          </div>
        </div>
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
      >
        <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 className="text-4xl font-semibold tracking-[-0.04em] text-white">素材库</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">统一收集、筛选和整理图片素材，选图后直接进入编辑与加工流程。</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-white/78 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition-all hover:-translate-y-0.5 hover:border-purple-300/25 hover:bg-gradient-to-r hover:from-purple-600 hover:to-blue-600 hover:text-white"
            title="上传本地素材"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/12 text-lg leading-none transition-colors group-hover:bg-white/20">+</span>
            上传素材
          </button>
        </div>

        <div className="mb-5 overflow-hidden rounded-[1.8rem] border border-white/[0.08] bg-black/28 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.2)] backdrop-blur-2xl ring-1 ring-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
              {([
                ['all', '全部', capturedImages.length],
                ['favorite', '收藏', capturedImages.filter((image) => image.isFavorite).length],
                ['uncategorized', '未分类', capturedImages.filter((image) => !image.folderId).length],
              ] as Array<[MaterialScope, string, number]>).map(([scope, label, count]) => (
                <button
                  key={scope}
                  onClick={() => setMaterialScope(scope)}
                  className={`shrink-0 rounded-full border px-3.5 py-2 text-xs transition-all ${materialScope === scope ? 'border-white/18 bg-white/16 text-white shadow-[0_8px_22px_rgba(255,255,255,0.06)]' : 'border-white/[0.07] bg-white/[0.045] text-white/48 hover:bg-white/[0.08] hover:text-white/78'}`}
                >
                  {label} <span className="ml-1 text-white/32">{count}</span>
                </button>
              ))}
              <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />
              {materialFolders.map((folder) => {
                const scope = `folder:${folder.id}` as MaterialScope;
                const count = capturedImages.filter((image) => image.folderId === folder.id).length;
                return (
                  <button
                    key={folder.id}
                    onClick={() => setMaterialScope(scope)}
                    className={`shrink-0 rounded-full border px-3.5 py-2 text-xs transition-all ${materialScope === scope ? 'border-blue-300/28 bg-blue-400/18 text-blue-50 shadow-[0_10px_26px_rgba(59,130,246,0.12)]' : 'border-white/[0.07] bg-white/[0.045] text-white/48 hover:bg-white/[0.08] hover:text-white/78'}`}
                  >
                    {folder.name} <span className="ml-1 text-white/32">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {selectedCapturedImages.length > 0 && (
                <select
                  value=""
                  onChange={(event) => {
                    void moveSelectedMaterials(event.target.value);
                  }}
                  className="h-8 rounded-full border border-white/[0.08] bg-white/[0.045] px-3 text-xs text-white/62 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus:border-blue-300/35"
                  title="移动选中素材"
                >
                  <option value="" className="bg-[#111]">移动到...</option>
                  <option value="__uncategorized__" className="bg-[#111]">未分类</option>
                  {materialFolders.map((folder) => (
                    <option key={folder.id} value={folder.id} className="bg-[#111]">{folder.name}</option>
                  ))}
                </select>
              )}
              {showNewFolderInput && (
                <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.045] p-1">
                  <input
                    value={newFolderName}
                    autoFocus
                    onChange={(event) => setNewFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void createMaterialFolder();
                      if (event.key === 'Escape') {
                        setShowNewFolderInput(false);
                        setNewFolderName('');
                      }
                    }}
                    placeholder="文件夹名称"
                    className="w-28 rounded-full border border-transparent bg-transparent px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/28 focus:border-white/10 focus:bg-black/18"
                  />
                  <button
                    onClick={() => void createMaterialFolder()}
                    className="rounded-full bg-white/10 px-2.5 py-1.5 text-xs text-white/68 transition-colors hover:bg-white/16 hover:text-white"
                  >
                    确定
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  setShowNewFolderInput((current) => !current);
                  if (showNewFolderInput) setNewFolderName('');
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-white/58 transition-colors hover:bg-white/[0.1] hover:text-white"
                title="新建文件夹"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14m7-7H5" />
                </svg>
              </button>
            </div>
          </div>

          {activeFolder && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.035] px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-blue-100">当前：{activeFolder.name}</p>
                <p className="mt-0.5 text-[11px] text-white/34">上传会自动进入此文件夹</p>
              </div>
              {renamingFolderId === activeFolder.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={renamingFolderName}
                    onChange={(event) => setRenamingFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void renameActiveFolder();
                    }}
                    className="w-36 rounded-full border border-white/10 bg-black/28 px-3 py-1.5 text-xs text-white outline-none focus:border-blue-400/45"
                  />
                  <button onClick={() => void renameActiveFolder()} className="rounded-full bg-blue-500/80 px-3 py-1.5 text-xs text-white hover:bg-blue-400">
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setRenamingFolderId('');
                      setRenamingFolderName('');
                    }}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/16 hover:text-white"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={startRenameActiveFolder} className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/58 hover:bg-white/14 hover:text-white">
                    重命名
                  </button>
                  <button onClick={() => void deleteActiveFolder()} className="rounded-full bg-red-500/10 px-3 py-1.5 text-xs text-red-100/80 hover:bg-red-500/24 hover:text-red-50">
                    删除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-white/42">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-300/70" />
            当前显示 {filteredCapturedImages.length} 张
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-white/52 lg:flex" title={`缩略图大小：${thumbnailSize}px`}>
              <span className="text-white/38">小</span>
              <input
                type="range"
                min="170"
                max="360"
                step="10"
                value={thumbnailSize}
                onChange={(event) => setThumbnailSize(Number(event.target.value))}
                className="w-28 accent-purple-400"
              />
              <span className="text-white/72">大</span>
            </label>

            {duplicateImageCount > 0 && (
              <button
                onClick={openDuplicateReview}
                disabled={processingAction !== null}
                className="rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-white/42 transition-colors hover:border-red-300/25 hover:bg-red-500/16 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除重复
              </button>
            )}

            {selectedImageList.length > 0 && (
              <button
                onClick={() => void deleteSelectedImages()}
                disabled={processingAction !== null}
                className="rounded-full border border-red-300/10 bg-red-500/10 px-3 py-2 text-xs text-red-100/72 transition-colors hover:bg-red-500/22 hover:text-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除所选
              </button>
            )}

            <label className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-white/52">
              <span>日期</span>
              <select
                value={materialFilter}
                onChange={(event) => setMaterialFilter(event.target.value as MaterialFilter)}
                className="bg-transparent text-xs text-white outline-none"
              >
                <option value="all" className="bg-[#111]">全部日期</option>
                <option value="today" className="bg-[#111]">今天</option>
                <option value="yesterday" className="bg-[#111]">昨天</option>
                <option value="earlier" className="bg-[#111]">更早</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-5 flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-white/48 w-fit">
          <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          点击卡片可加入批量操作，点右下角可预览大图
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleImageUpload}
          className="hidden"
        />

        <input
          ref={aiReferenceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleAiReferenceUpload}
          className="hidden"
        />

        {isUploading && (
          <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-center text-white/60">
            素材上传中...
          </div>
        )}

        {filteredCapturedImages.length === 0 ? (
          <div className="rounded-[2rem] border border-white/[0.08] bg-white/[0.025] p-14 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] text-white/36">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M5 20h14a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <p className="text-base font-medium text-white/70">
              {capturedImages.length === 0 ? '素材库还是空的' : '当前视图没有素材'}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/40">
              {capturedImages.length === 0
                ? '可以通过浏览器插件采集图片，也可以上传本地图片开始整理。'
                : '试试切换文件夹、收藏或日期筛选，或者清空当前筛选条件。'}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-6 rounded-full bg-white/10 px-4 py-2 text-sm text-white/72 transition-colors hover:bg-white/16 hover:text-white"
            >
              上传素材
            </button>
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

                  <div className="flex items-start justify-center" style={{ gap: `${thumbnailGap}px` }}>
                    {groupColumns.map((column, columnIndex) => (
                      <div
                        key={`${group.key}-${columnIndex}`}
                        className="min-w-0 space-y-5"
                        style={{ width: `${thumbnailSize}px`, maxWidth: `${thumbnailSize}px` }}
                      >
                        {column.map((image, index) => {
                          const displayImageUrl = getDisplayImageUrl(image.imageUrl);
                          const selected = selectedImages.has(image.imageUrl);
                          const imageFailed = failedImageUrls.has(image.imageUrl);
                          const cardIndex = columnIndex * 100 + index;
                          const accentClass = cardIndex % 7 === 0
                            ? 'before:absolute before:inset-0 before:border before:border-purple-400/20 before:rounded-[1.2rem] before:pointer-events-none'
                            : '';

                          return (
                            <div
                              key={image.id}
                              ref={(node) => {
                                imageButtonRefs.current[image.imageUrl] = node;
                              }}
                              onClick={() => toggleImageSelection(image.imageUrl)}
                              className={`group relative w-full cursor-pointer overflow-hidden rounded-[1.35rem] border transition-all ${accentClass} ${selected ? 'border-purple-500 ring-2 ring-purple-500/50 shadow-[0_0_0_1px_rgba(168,85,247,0.25),0_24px_50px_rgba(76,29,149,0.28)] -translate-y-1' : 'border-white/10 hover:border-white/30 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(15,23,42,0.35)]'}`}
                            >
                              <div className="w-full bg-black/20">
                                {imageFailed ? (
                                  <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 bg-white/[0.03] px-4 py-8 text-center text-white/45">
                                    <svg className="h-8 w-8 text-white/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M5 20h14a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1z" />
                                    </svg>
                                    <span className="text-xs">图片不可用</span>
                                  </div>
                                ) : (
                                  <img
                                    src={displayImageUrl}
                                    alt={`素材图片 ${cardIndex + 1}`}
                                    className="h-auto w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                    onLoad={(event) => {
                                      const ratio = event.currentTarget.naturalHeight / Math.max(event.currentTarget.naturalWidth, 1);
                                      setImageAspectRatios((prev) => {
                                        if (prev[image.imageUrl] === ratio) return prev;
                                        return { ...prev, [image.imageUrl]: ratio };
                                      });
                                    }}
                                    onError={() => {
                                      setFailedImageUrls((prev) => new Set(prev).add(image.imageUrl));
                                    }}
                                  />
                                )}
                              </div>
                              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/62 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                              <div className="absolute inset-x-0 bottom-0 h-24 pointer-events-none bg-gradient-to-t from-black/68 to-transparent opacity-75" />
                              {selected && (
                                <div className="absolute top-3 left-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-purple-500 text-white shadow-lg ring-4 ring-purple-500/18">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                              <div className="absolute right-3 top-3 z-20 flex flex-col gap-2 opacity-0 transition-all group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void removeUploadedImage(image);
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300/20 bg-red-500/18 text-red-50/80 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-red-500/40 hover:text-white"
                                  title="移除图片"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void toggleMaterialFavorite(image);
                                  }}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 ${image.isFavorite ? 'border-amber-200/60 bg-amber-400 text-black opacity-100' : 'border-white/15 bg-black/55 text-white/75 hover:bg-white/18 hover:text-white'}`}
                                  title={image.isFavorite ? '取消收藏' : '加入收藏'}
                                >
                                  <svg className="h-4 w-4" fill={image.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.6.6 0 011.04 0l2.2 4.459a.6.6 0 00.452.328l4.92.715a.6.6 0 01.333 1.024l-3.56 3.47a.6.6 0 00-.173.531l.84 4.9a.6.6 0 01-.87.632l-4.4-2.313a.6.6 0 00-.558 0l-4.4 2.313a.6.6 0 01-.87-.632l.84-4.9a.6.6 0 00-.173-.53l-3.56-3.471A.6.6 0 013.9 9.001l4.92-.715a.6.6 0 00.452-.328l2.208-4.459z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void downloadMaterialImage(image);
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/18 hover:text-white"
                                  title="下载图片"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                  </svg>
                                </button>
                              </div>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    previewMaterialImage(image.imageUrl);
                                  }}
                                className="absolute right-3 bottom-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/58 text-white/78 opacity-0 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/18 hover:text-white group-hover:opacity-100"
                                title="预览大图"
                              >
                                <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l-6-6m12 6l6-6M9 15l-6 6m12-6l6 6" />
                                </svg>
                              </button>
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
                            </div>
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
            <div className={`pointer-events-auto rounded-[1.7rem] border border-white/12 bg-black/82 px-4 py-4 backdrop-blur-2xl shadow-[0_18px_44px_rgba(0,0,0,0.42),0_6px_20px_rgba(88,28,135,0.2)] ring-1 ring-white/5 max-w-[92vw] transition-all ${showAiPromptPanel ? 'min-w-[760px]' : 'min-w-[500px]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <span className="whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-xs font-medium text-white/62">已选 {selectedImageList.length} 张</span>
                {processingActionLabel && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/18 px-2.5 py-1 text-xs font-medium text-purple-200 border border-purple-400/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-300 animate-pulse"></span>
                    正在提交 {processingActionLabel}
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/32">编辑</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
              </div>

              {showAiPromptPanel && (
                <div className="mt-5 mb-4 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/8 p-4">
                  <div className="flex flex-wrap items-start gap-3 mb-4">
                    <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                              {selectedImageList.slice(0, 6).map((imageUrl, index) => (
                                <div key={`${imageUrl}-${index}`} className="w-14 h-14 rounded-xl overflow-hidden border border-white/10 bg-black/20">
                                  <img src={getDisplayImageUrl(imageUrl)} alt={`已选素材 ${index + 1}`} className="w-full h-full object-cover" />
                                </div>
                              ))}
                      {selectedImageList.length > 6 && (
                        <div className="w-14 h-14 rounded-xl border border-white/10 bg-white/6 flex items-center justify-center text-xs text-white/55">
                          +{selectedImageList.length - 6}
                        </div>
                      )}
                      <button
                        onClick={() => aiReferenceInputRef.current?.click()}
                        disabled={isAiReferenceUploading}
                        className="w-14 h-14 rounded-xl border border-dashed border-white/15 bg-white/6 hover:bg-white/12 text-white/70 hover:text-white flex items-center justify-center transition-colors"
                        title="添加 AI 参考图"
                      >
                        <span className="text-2xl leading-none">{isAiReferenceUploading ? '...' : '+'}</span>
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

              <div className="mt-5 grid gap-3 border-t border-white/[0.06] pt-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/32">加工</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
          </div>
        )}
      </div>

      {previewImageUrl && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/92 px-6 py-6"
          onClick={() => setPreviewImageUrl(null)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewImageUrl(null);
            }}
            className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/10 text-2xl leading-none text-white backdrop-blur-xl transition-colors hover:bg-white/20"
            title="关闭预览"
          >
            ×
          </button>
          <img
            src={previewImageUrl}
            alt="素材大图预览"
            className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
            onClick={(event) => event.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
