'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Image, { type ImageLoaderProps, type ImageProps } from 'next/image';
import { addTaskRecord, getCachedTasks, updateTaskRecordStatus } from '@/components/TaskHistory';
import CropEditorPanel from '@/components/CropEditorPanel';
import LocalEditPanel from '@/components/LocalEditPanel';
import PointsIconLabel from '@/components/PointsIconLabel';
import { useUser } from '@/contexts/UserContext';
import { formatPointsLabel, getAiGeneratePoints, getColorExtractionPoints, getHdUpscalePoints, getOutpaintUpsamplingPoints, getSmartEditPoints } from '@/lib/pricing';
import { isSmartEditAspectRatioOption, isSmartEditResolution, type SmartEditAspectRatioOption, type SmartEditResolution } from '@/lib/smartEditSize';
import { showToast } from '@/lib/toast';
import { toUserFacingErrorFromUnknown, toUserFacingErrorMessage } from '@/lib/userFacingError';

type PluginCapturePayload = {
  imageUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
  captureMethod?: string;
};

type CapturedImageRecord = {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  originalUrl?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  sourceHost?: string | null;
  imageType?: string | null;
  folderId?: string | null;
  isFavorite?: boolean;
  createdAt: string;
};

type RawOrderRecord = {
  id: string;
  orderNumber?: string | null;
  toolPage?: string | null;
  description?: string | null;
  prompt?: string | null;
  status?: string | null;
  resultData?: unknown;
  requestParams?: unknown;
  uploadedImage?: string | null;
  thumbnailUrls?: string[] | null;
  remainingPoints?: number | null;
  createdAt?: string | number | Date | null;
  time?: string | number | Date | null;
};

type OrderResultCard = {
  id: string;
  orderId: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  createdAt: string | number | Date;
  toolLabel: string;
  statusLabel: string;
  description: string;
  orderNumber: string;
  sourceImageUrl: string | null;
  isResultImage: boolean;
  downloadFileName: string;
};

type MaterialFilter = 'all' | 'today' | 'yesterday' | 'earlier';
type MaterialScope = 'all' | 'favorite' | 'uncategorized' | `folder:${string}`;
type GalleryActionId = 'color-extraction' | 'ai-generate' | 'outpaint-upsampling' | 'hd-upscale';
type LibraryView = 'gallery' | 'orders';

type MaterialFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

type CapturedImagesPagination = {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextOffset: number;
};

type CapturedImagesResponse = {
  success?: boolean;
  data?: CapturedImageRecord[];
  error?: string;
  message?: string;
  pagination?: Partial<CapturedImagesPagination>;
};

type UploadFileResponse = {
  success?: boolean;
  message?: string;
  data?: {
    key?: string;
    url?: string;
    material?: CapturedImageRecord | null;
  };
};

type DirectUploadPolicyResponse = {
  success?: boolean;
  message?: string;
  data?: {
    host: string;
    key: string;
    accessId: string;
    policy: string;
    signature: string;
    successActionStatus: string;
    expiresAt: string;
  };
};

type PluginCaptureSavedPayload = PluginCapturePayload & {
  id?: string;
  uploadedUrl?: string;
  material?: CapturedImageRecord | null;
};

type PluginCaptureResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: PluginCaptureSavedPayload | null;
};

type MaterialUploadResult =
  | { success: true; fileName: string; url: string; material?: CapturedImageRecord | null; compressed: boolean; originalSize: number; finalSize: number }
  | { success: false; fileName: string; message: string; interrupted?: boolean };
type FailedMaterialUploadResult = Extract<MaterialUploadResult, { success: false }>;

type PreparedUploadFile = {
  file: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
};

type MaterialUploadPlaceholder = {
  id: string;
  key?: string;
  fileName: string;
  previewUrl?: string;
  status: 'preparing' | 'uploading' | 'uploaded' | 'saving' | 'recovering' | 'failed';
  message?: string;
  materialFolderId?: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoredMaterialUploadSession = {
  id: string;
  userId: string;
  total: number;
  completed: number;
  settled?: number;
  successful?: number;
  failed?: number;
  status?: 'running' | 'settled';
  materials?: CapturedImageRecord[];
  pendingDirectUploads?: StoredDirectMaterialUpload[];
  startedAt: number;
  updatedAt: number;
};

type StoredDirectMaterialUpload = {
  clientId?: string;
  key: string;
  originalFileName: string;
  materialFolderId: string | null;
  status: 'uploading' | 'uploaded' | 'saving' | 'completed';
  createdAt: number;
  updatedAt: number;
};

type GalleryAction = {
  id: GalleryActionId;
  label: string;
  description: string;
  points?: number;
  className: string;
  tag: string;
  preview: React.ReactNode;
};

type EditorAction = {
  id: 'edit-image' | 'local-edit';
  label: string;
  points?: number;
};

type ImageEditorState = {
  open: boolean;
  mode: 'crop';
  imageUrl: string;
  destination: 'gallery' | 'orders';
  orderNumber?: string;
  toolLabel?: string;
  sourceImageUrl?: string | null;
};

type DropdownOption = {
  value: string;
  label: string;
  description?: ReactNode;
};

type ImageSourceSize = {
  width: number;
  height: number;
};

type QuickCreateDropdownId = 'tool-filter' | 'material-filter' | 'ai-aspect-ratio' | 'ai-resolution' | 'move-materials';

type DuplicateReviewState = {
  open: boolean;
  groups: CapturedImageRecord[][];
  selectedIds: Set<string>;
};

const MATERIAL_PAGE_SIZE = 60;
const EMPTY_CAPTURED_IMAGES_PAGINATION: CapturedImagesPagination = {
  limit: MATERIAL_PAGE_SIZE,
  offset: 0,
  total: 0,
  hasMore: false,
  nextOffset: 0,
};

const galleryActions: GalleryAction[] = [
  {
    id: 'ai-generate',
    label: 'AI生图',
    description: '参考已选图片进行图生图创作',
    className: 'bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500',
    tag: '图生图',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <Image src="/assets/remove-background-demo.gif" alt="AI生图示例" width={128} height={140} unoptimized className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'color-extraction',
    label: '彩绘提取',
    description: '手机壳彩绘提取',
    points: getColorExtractionPoints(),
    className: 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500',
    tag: '核心功能',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <Image src="/assets/phone-case-demo.jpg" alt="彩绘提取示例" width={128} height={140} className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'outpaint-upsampling',
    label: '高清+扩图',
    description: 'AI补全四周并输出4K',
    points: getOutpaintUpsamplingPoints(),
    className: 'bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500',
    tag: '4K扩图',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <Image src="/assets/remove-watermark-demo.jpg" alt="高清+扩图示例" width={128} height={140} className="w-full h-full object-cover" />
      </div>
    ),
  },
  {
    id: 'hd-upscale',
    label: '高清放大',
    description: '保留构图细节做高清放大',
    points: getHdUpscalePoints(),
    className: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500',
    tag: '5积分',
    preview: (
      <div className="w-32 h-full min-h-[140px] rounded-lg flex items-center justify-center overflow-hidden bg-black/20">
        <Image src="/assets/remove-watermark-demo.jpg" alt="高清放大示例" width={128} height={140} className="w-full h-full object-cover" />
      </div>
    ),
  },
];

const editorActions: EditorAction[] = [
  { id: 'edit-image', label: '裁切工具' },
  { id: 'local-edit', label: '智能改图', points: getSmartEditPoints('2k') },
];

const MATERIAL_FILTER_OPTIONS: DropdownOption[] = [
  { value: 'all', label: '全部日期' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'earlier', label: '更早' },
];

const AI_ASPECT_RATIO_OPTIONS: Array<{ value: SmartEditAspectRatioOption; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: '1:1', label: '1:1' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '21:9', label: '21:9' },
];

const AI_RESOLUTION_OPTIONS: Array<{ value: SmartEditResolution; label: string; description: ReactNode }> = [
  { value: '1k', label: '1k', description: <PointsIconLabel points={getAiGeneratePoints('1k')} iconClassName="h-3 w-3" /> },
  { value: '2k', label: '2k', description: <PointsIconLabel points={getAiGeneratePoints('2k')} iconClassName="h-3 w-3" /> },
  { value: '4k', label: '4k', description: <PointsIconLabel points={getAiGeneratePoints('4k')} iconClassName="h-3 w-3" /> },
];

const UNCATEGORIZED_FOLDER_VALUE = '__uncategorized__';
const PROCESSING_ORDER_POLL_TTL_MS = 20 * 60 * 1000;
const MATERIAL_UPLOAD_CONCURRENCY = 3;
const MATERIAL_UPLOAD_TIMEOUT_MS = 180_000;
const MATERIAL_UPLOAD_COMPLETE_TIMEOUT_MS = 8_000;
const MATERIAL_UPLOAD_COMPLETE_RETRY_DELAYS_MS = [0, 1200, 2500, 5000];
const MATERIAL_UPLOAD_RECOVERY_TTL_MS = 10 * 60 * 1000;
const MATERIAL_UPLOAD_RECOVERY_MAX_ATTEMPTS = 12;
const MATERIAL_UPLOAD_COMPRESS_THRESHOLD_BYTES = 16 * 1024 * 1024;
const MATERIAL_UPLOAD_HARD_LIMIT_BYTES = 40 * 1024 * 1024;
const IMAGE_LOAD_RETRY_DELAYS_MS = [500, 1200, 2500, 5000];

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function SafeImage({ alt, ...props }: Omit<ImageProps, 'loader'>) {
  return <Image {...props} alt={alt} loader={passthroughImageLoader} unoptimized />;
}

function getActionTotalPoints(action: GalleryAction, aiResolution: SmartEditResolution, imageCount: number) {
  const points = action.id === 'ai-generate' ? getAiGeneratePoints(aiResolution) : action.points;
  if (typeof points !== 'number') return null;
  return points * Math.max(1, imageCount);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isAbortLikeError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (!(error instanceof Error)) return false;
  return /abort|aborted|cancel|cancelled|network|failed to fetch|load failed/i.test(error.message);
}

class DirectUploadCompletionError extends Error {
  key: string;
  originalError: unknown;

  constructor(key: string, originalError: unknown) {
    super(toUserFacingErrorFromUnknown(originalError, '入库确认失败'));
    this.name = 'DirectUploadCompletionError';
    this.key = key;
    this.originalError = originalError;
  }
}

function isDirectUploadCompletionError(error: unknown): error is DirectUploadCompletionError {
  return error instanceof DirectUploadCompletionError;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

function getMaterialUploadSessionKey(userId?: string) {
  return `zaomeng:material-upload:${userId || 'anonymous'}`;
}

function getFileFingerprint(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function dedupeUploadFiles(files: File[]) {
  const seen = new Set<string>();
  const deduped: File[] = [];
  for (const file of files) {
    const fingerprint = getFileFingerprint(file);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(file);
  }
  return deduped;
}

function readMaterialUploadSession(userId?: string): StoredMaterialUploadSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(getMaterialUploadSessionKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredMaterialUploadSession;
    if (!parsed || typeof parsed.startedAt !== 'number') return null;
    if (Date.now() - parsed.startedAt > MATERIAL_UPLOAD_RECOVERY_TTL_MS) {
      window.sessionStorage.removeItem(getMaterialUploadSessionKey(userId));
      return null;
    }

    return {
      ...parsed,
      completed: Number(parsed.completed ?? parsed.settled ?? 0),
      settled: Number(parsed.settled ?? parsed.completed ?? 0),
      successful: Number(parsed.successful ?? 0),
      failed: Number(parsed.failed ?? 0),
      materials: Array.isArray(parsed.materials) ? parsed.materials : [],
      pendingDirectUploads: Array.isArray(parsed.pendingDirectUploads) ? parsed.pendingDirectUploads : [],
      status: parsed.status || 'running',
    };
  } catch {
    return null;
  }
}

function writeMaterialUploadSession(session: StoredMaterialUploadSession) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(getMaterialUploadSessionKey(session.userId), JSON.stringify(session));
}

function clearMaterialUploadSession(userId?: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(getMaterialUploadSessionKey(userId));
}

function removePendingMaterialUploadFromSession(userId: string | undefined, key: string) {
  const session = readMaterialUploadSession(userId);
  if (!session) return;

  const pendingDirectUploads = (session.pendingDirectUploads || []).filter((item) => item.key !== key);
  if (pendingDirectUploads.length === 0) {
    clearMaterialUploadSession(session.userId);
    return;
  }

  writeMaterialUploadSession({
    ...session,
    pendingDirectUploads,
    updatedAt: Date.now(),
  });
}

function readStoredUserId() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === 'string' && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

function getMaterialFromPluginPayload(payload?: PluginCaptureSavedPayload | null): CapturedImageRecord | null {
  if (!payload) return null;

  if (payload.material?.id && payload.material.imageUrl && payload.material.createdAt) {
    return payload.material;
  }

  if (!payload.id || !payload.uploadedUrl) {
    return null;
  }

  return {
    id: payload.id,
    imageUrl: payload.uploadedUrl,
    originalUrl: payload.imageUrl || null,
    pageUrl: payload.pageUrl || null,
    pageTitle: payload.pageTitle || null,
    sourceHost: payload.sourceHost || null,
    imageType: payload.imageType || 'main',
    folderId: null,
    isFavorite: false,
    createdAt: new Date(payload.capturedAt || Date.now()).toISOString(),
  };
}

function getCompressedFileName(fileName: string, mimeType: string) {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return `${baseName}.${extension}`;
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function prepareImageFileForUpload(file: File): Promise<PreparedUploadFile> {
  if (
    file.size < MATERIAL_UPLOAD_COMPRESS_THRESHOLD_BYTES ||
    file.type === 'image/gif' ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  ) {
    return { file, compressed: false, originalSize: file.size, finalSize: file.size };
  }

  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片读取失败'));
    });
    image.src = objectUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context || canvas.width === 0 || canvas.height === 0) {
      return { file, compressed: false, originalSize: file.size, finalSize: file.size };
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const targetType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const quality = file.type === 'image/jpeg' ? 0.82 : 0.86;
    const compressedBlob = await canvasToBlob(canvas, targetType, quality);
    if (!compressedBlob || compressedBlob.size >= file.size * 0.95) {
      return { file, compressed: false, originalSize: file.size, finalSize: file.size };
    }

    const compressedFile = new File([compressedBlob], getCompressedFileName(file.name, targetType), {
      type: targetType,
      lastModified: file.lastModified,
    });

    return {
      file: compressedFile,
      compressed: true,
      originalSize: file.size,
      finalSize: compressedFile.size,
    };
  } catch (error) {
    console.warn('[素材上传] 图片压缩失败，使用原图上传:', error);
    return { file, compressed: false, originalSize: file.size, finalSize: file.size };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function uploadMaterialThroughServer(file: File, options: { activeFolderId: string | null; originalFileName: string }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('originalFileName', options.originalFileName);
  formData.append('createMaterial', 'true');
  if (options.activeFolderId) {
    formData.append('materialFolderId', options.activeFolderId);
  }

  const response = await fetchWithTimeout(
    '/api/upload/file',
    { method: 'POST', credentials: 'include', body: formData },
    MATERIAL_UPLOAD_TIMEOUT_MS
  );
  const data = await response.json() as UploadFileResponse;
  if (!response.ok || !data.success || !data.data?.url) {
    throw new Error(toUserFacingErrorMessage(data.message, '上传失败，请重试'));
  }

  return data.data;
}

async function completeDirectUploadMaterial(upload: {
  key: string;
  originalFileName: string;
  materialFolderId?: string | null;
}, timeoutMs = MATERIAL_UPLOAD_COMPLETE_TIMEOUT_MS) {
  const completeResponse = await fetchWithTimeout(
    '/api/upload/complete-material',
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: upload.key,
        originalFileName: upload.originalFileName,
        materialFolderId: upload.materialFolderId ?? null,
      }),
    },
    timeoutMs
  );
  const completeData = await completeResponse.json() as UploadFileResponse;
  if (!completeResponse.ok || !completeData.success || !completeData.data?.url) {
    throw new Error(toUserFacingErrorMessage(completeData.message, '素材入库失败'));
  }

  return completeData.data;
}

async function completeDirectUploadMaterialWithRetry(
  upload: {
    key: string;
    originalFileName: string;
    materialFolderId?: string | null;
  },
  options?: {
    onRetry?: (attempt: number) => void;
  }
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MATERIAL_UPLOAD_COMPLETE_RETRY_DELAYS_MS.length; attempt += 1) {
    const waitMs = MATERIAL_UPLOAD_COMPLETE_RETRY_DELAYS_MS[attempt];
    if (waitMs > 0) {
      options?.onRetry?.(attempt + 1);
      await delay(waitMs);
    }

    try {
      return await completeDirectUploadMaterial(upload);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('素材入库失败');
}

async function uploadMaterialDirectToOSS(file: File, options: {
  activeFolderId: string | null;
  clientId?: string;
  originalFileName: string;
  onPendingCreated?: (upload: StoredDirectMaterialUpload) => void;
  onPendingUploaded?: (key: string) => void;
  onPendingSaving?: (key: string) => void;
  onPendingCompleted?: (key: string) => void;
}) {
  const policyResponse = await fetchWithTimeout(
    '/api/upload/oss-policy',
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        folder: 'uploads',
      }),
    },
    30_000
  );
  const policyData = await policyResponse.json() as DirectUploadPolicyResponse;
  if (!policyResponse.ok || !policyData.success || !policyData.data) {
    throw new Error(toUserFacingErrorMessage(policyData.message, '生成上传凭证失败'));
  }
  const uploadPolicy = policyData.data;
  const pendingUpload: StoredDirectMaterialUpload = {
    clientId: options.clientId,
    key: uploadPolicy.key,
    originalFileName: options.originalFileName,
    materialFolderId: options.activeFolderId,
    status: 'uploading',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  options.onPendingCreated?.(pendingUpload);

  const formData = new FormData();
  formData.append('key', uploadPolicy.key);
  formData.append('policy', uploadPolicy.policy);
  formData.append('OSSAccessKeyId', uploadPolicy.accessId);
  formData.append('Signature', uploadPolicy.signature);
  formData.append('success_action_status', uploadPolicy.successActionStatus || '200');
  formData.append('Content-Type', file.type || 'application/octet-stream');
  formData.append('file', file);

  const uploadResponse = await fetchWithTimeout(
    uploadPolicy.host,
    { method: 'POST', body: formData },
    MATERIAL_UPLOAD_TIMEOUT_MS
  );
  if (!uploadResponse.ok) {
    throw new Error(`OSS直传失败 (${uploadResponse.status})`);
  }
  options.onPendingUploaded?.(uploadPolicy.key);
  options.onPendingSaving?.(uploadPolicy.key);

  let completedData: Awaited<ReturnType<typeof completeDirectUploadMaterial>>;
  try {
    completedData = await completeDirectUploadMaterialWithRetry(
      {
        key: uploadPolicy.key,
        originalFileName: options.originalFileName,
        materialFolderId: options.activeFolderId,
      },
      {
        onRetry: (attempt) => {
          options.onPendingSaving?.(uploadPolicy.key);
          console.warn(`[素材上传] 入库确认重试 ${attempt}:`, uploadPolicy.key);
        },
      }
    );
  } catch (error) {
    throw new DirectUploadCompletionError(uploadPolicy.key, error);
  }
  options.onPendingCompleted?.(uploadPolicy.key);

  return completedData;
}

type QuickCreateDropdownProps = {
  dropdownId: QuickCreateDropdownId;
  label?: string;
  value: string;
  options: DropdownOption[];
  placeholder?: string;
  isOpen: boolean;
  onToggle: (dropdownId: QuickCreateDropdownId) => void;
  onSelect: (value: string) => void;
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
  buttonClassName?: string;
  menuWidthClassName?: string;
  showSelectedCheck?: boolean;
};

function QuickCreateDropdown({
  dropdownId,
  label,
  value,
  options,
  placeholder,
  isOpen,
  onToggle,
  onSelect,
  align = 'left',
  direction = 'down',
  buttonClassName = '',
  menuWidthClassName = 'min-w-[160px]',
  showSelectedCheck = true,
}: QuickCreateDropdownProps) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = value ? (selectedOption?.label || value) : (placeholder || '请选择');
  const positionClassName = direction === 'up'
    ? `${align === 'right' ? 'right-0' : 'left-0'} bottom-full mb-2`
    : `${align === 'right' ? 'right-0' : 'left-0'} top-full mt-2`;

  return (
    <div className={`relative ${isOpen ? 'z-[120]' : 'z-20'}`} data-role="quick-create-dropdown">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(dropdownId);
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-white/78 shadow-[0_10px_24px_rgba(0,0,0,0.16)] transition hover:bg-white/[0.08] hover:text-white ${buttonClassName}`}
      >
        {label ? <span className="text-white/36">{label}</span> : null}
        <span className={`truncate ${value ? 'text-white/82' : 'text-white/54'}`}>{selectedLabel}</span>
        {selectedOption?.description ? <span className="hidden text-white/42 sm:inline">{selectedOption.description}</span> : null}
        <span className={`text-[10px] text-white/42 transition ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {isOpen ? (
        <div className={`absolute z-[130] ${positionClassName} ${menuWidthClassName} overflow-hidden rounded-[1rem] border border-white/12 bg-[#0d0d12]/98 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl`}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(option.value);
                }}
                className={`flex w-full items-center gap-2 rounded-[0.8rem] border px-3 py-2 text-left text-xs transition ${selected ? 'border-purple-300/24 bg-purple-500/16 text-purple-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-transparent text-white/72 hover:bg-white/[0.08] hover:text-white'}`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.description ? <span className="shrink-0 text-[11px] opacity-60">{option.description}</span> : null}
                {selected && showSelectedCheck ? <span className="text-[10px] text-purple-100">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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

function getUrlExtension(imageUrl: string): string {
  const normalized = imageUrl.toLowerCase();
  if (normalized.includes('.png')) return 'png';
  if (normalized.includes('.webp')) return 'webp';
  if (normalized.includes('.gif')) return 'gif';
  return 'jpg';
}

function getOrderDownloadFileName(orderNumber: string, toolLabel: string, imageUrl: string, index: number): string {
  const sanitizedTool = toolLabel.replace(/\s+/g, '-');
  return `${sanitizedTool || 'order'}-${orderNumber || 'result'}-${index + 1}.${getUrlExtension(imageUrl)}`;
}

function isLikelyImageUrl(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'));
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean)));
}

function extractImageUrls(value: unknown): string[] {
  if (!value) return [];

  if (isLikelyImageUrl(value)) {
    return [value];
  }

  if (typeof value === 'string') {
    try {
      return extractImageUrls(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return dedupeUrls(value.flatMap((item) => extractImageUrls(item)));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidates = [
      'imageUrl',
      'image_url',
      'result_image_url',
      'uploadedImage',
      'uploaded_image',
      'originalImageUrl',
      'url',
      'fileUrl',
      'urls',
    ];

    return dedupeUrls(candidates.flatMap((key) => extractImageUrls(record[key])));
  }

  return [];
}

function getOrderToolLabel(toolPage: string | null | undefined, description?: string | null, orderNumber?: string | null): string {
  if (toolPage === '裁切工具' || description?.includes('裁切')) {
    return '裁切工具';
  }

  if (toolPage === 'AI生图' || toolPage === 'AI生图（图生图）' || description?.includes('AI生图') || orderNumber?.startsWith('AIG')) {
    return 'AI生图';
  }

  if (toolPage === '彩绘提取' || toolPage === '彩绘提取2' || description?.includes('彩绘提取')) {
    return '彩绘提取';
  }

  if (toolPage === '智能改图' || toolPage === '局部改图' || description?.includes('智能改图') || description?.includes('局部改图') || orderNumber?.startsWith('LCL-')) {
    return '智能改图';
  }

  if (toolPage === 'AI扩图' || toolPage === '去除水印' || toolPage === '去水印' || description?.includes('去除水印') || description?.includes('AI扩图') || orderNumber?.startsWith('RW-')) {
    return 'AI扩图';
  }

  if (toolPage === '高清+扩图' || description?.includes('高清+扩图') || orderNumber?.startsWith('HDO-')) {
    return '高清+扩图';
  }

  if (toolPage === '高清+扩图2' || description?.includes('高清+扩图2') || orderNumber?.startsWith('HDO2-')) {
    return '高清+扩图2';
  }

  if (toolPage === '高清放大' || description?.includes('高清放大') || orderNumber?.startsWith('HD-')) {
    return '高清放大';
  }

  return toolPage || '其他工具';
}

function getOrderStatusLabel(status: string | null | undefined): string {
  if (status === '处理中' || status === 'pending') return '处理中';
  if (status === '失败' || status === 'failed') return '失败';
  if (status === '超时' || status === 'timeout') return '超时';
  if (status === '部分成功') return '部分成功';
  return '成功';
}

function getOrderStatusClass(statusLabel: string): string {
  if (statusLabel === '处理中') return 'border-sky-300/30 bg-sky-400/18 text-sky-100';
  if (statusLabel === '失败' || statusLabel === '超时') return 'border-red-300/30 bg-red-500/18 text-red-100';
  if (statusLabel === '部分成功') return 'border-amber-300/30 bg-amber-400/18 text-amber-50';
  return 'border-emerald-300/30 bg-emerald-400/18 text-emerald-50';
}

function parseMaterialDate(value: string | number | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T'));
  }

  return new Date(value);
}

function formatMaterialDateLabel(value: string | number | Date): string {
  const date = parseMaterialDate(value);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';

  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
}

function formatMaterialTime(value: string | number | Date): string {
  return parseMaterialDate(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMaterialUploadPlaceholderLabel(status: MaterialUploadPlaceholder['status']) {
  if (status === 'preparing') return '准备中';
  if (status === 'uploading') return '上传中';
  if (status === 'uploaded') return '入库中';
  if (status === 'saving') return '入库中';
  if (status === 'recovering') return '恢复中';
  return '上传失败';
}

function getMaterialDateGroup(value: string | number | Date): 'today' | 'yesterday' | 'earlier' {
  const date = parseMaterialDate(value);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((todayStart - targetStart) / 86400000);

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return 'earlier';
}

export default function QuickCreatePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiReferenceInputRef = useRef<HTMLInputElement>(null);
  const { user, setPoints } = useUser();
  const gallerySectionRef = useRef<HTMLDivElement>(null);
  const imageButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragDepthRef = useRef(0);
  const trackedProcessingOrdersRef = useRef<Record<string, number>>({});
  const materialRequestIdRef = useRef(0);
  const orderResultsRequestIdRef = useRef(0);
  const hasLoadedMaterialsRef = useRef(false);
  const hasLoadedOrderResultsRef = useRef(false);
  const prefetchedMaterialKeysRef = useRef<Set<string>>(new Set());
  const prefetchedMaterialPaginationRef = useRef<Map<string, CapturedImagesPagination>>(new Map());
  const prefetchingMaterialKeysRef = useRef<Set<string>>(new Set());
  const locallyInsertedMaterialIdsRef = useRef<Set<string>>(new Set());
  const requestedLatestCaptureRef = useRef(false);
  const isPageLeavingRef = useRef(false);
  const imageRetryAttemptsRef = useRef<Record<string, number>>({});
  const imageRetryTimersRef = useRef<Record<string, number>>({});
  const uploadPlaceholderObjectUrlsRef = useRef<Record<string, string>>({});
  const retryUploadFilesRef = useRef<Record<string, File>>({});
  const materialRecoveryInFlightRef = useRef(false);
  const preloadedOrderThumbnailUrlsRef = useRef<Set<string>>(new Set());
  const [capturedImages, setCapturedImages] = useState<CapturedImageRecord[]>([]);
  const [materialUploadPlaceholders, setMaterialUploadPlaceholders] = useState<MaterialUploadPlaceholder[]>([]);
  const [materialFolders, setMaterialFolders] = useState<MaterialFolder[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [libraryView, setLibraryView] = useState<LibraryView>('gallery');
  const [orderResults, setOrderResults] = useState<OrderResultCard[]>([]);
  const [hasProcessingOrders, setHasProcessingOrders] = useState(false);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [isLoadingMoreMaterials, setIsLoadingMoreMaterials] = useState(false);
  const [materialsPagination, setMaterialsPagination] = useState<CapturedImagesPagination>(EMPTY_CAPTURED_IMAGES_PAGINATION);
  const [isAiReferenceUploading, setIsAiReferenceUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [canHoverCardControls, setCanHoverCardControls] = useState(true);
  const [isCompactActionBar, setIsCompactActionBar] = useState(false);
  const [columnCount, setColumnCount] = useState(4);
  const [thumbnailSize, setThumbnailSize] = useState(290);
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [imageSourceSizes, setImageSourceSizes] = useState<Record<string, ImageSourceSize>>({});
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [imageRetryTokens, setImageRetryTokens] = useState<Record<string, number>>({});
  const [processingAction, setProcessingAction] = useState<GalleryActionId | null>(null);
  const [actionBarPosition, setActionBarPosition] = useState<{ top: number; left: number } | null>(null);
  const [showAiPromptPanel, setShowAiPromptPanel] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [deletingOrderNumber, setDeletingOrderNumber] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAspectRatio, setAiAspectRatio] = useState<SmartEditAspectRatioOption>('auto');
  const [aiResolution, setAiResolution] = useState<SmartEditResolution>('2k');
  const [materialScope, setMaterialScope] = useState<MaterialScope>('all');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [openDropdownId, setOpenDropdownId] = useState<QuickCreateDropdownId | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState('');
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [imageEditor, setImageEditor] = useState<ImageEditorState>({
    open: false,
    mode: 'crop',
    imageUrl: '',
    destination: 'gallery',
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

  const aiGenerateTotalPoints = useMemo(
    () => getAiGeneratePoints(aiResolution) * Math.max(1, selectedImageList.length),
    [aiResolution, selectedImageList.length]
  );

  const availableOrderTools = useMemo(() => {
    return Array.from(new Set(orderResults.map((item) => item.toolLabel))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [orderResults]);

  const toolFilterOptions = useMemo<DropdownOption[]>(() => {
    return [{ value: 'all', label: '全部工具' }, ...availableOrderTools.map((tool) => ({ value: tool, label: tool }))];
  }, [availableOrderTools]);

  const moveMaterialOptions = useMemo<DropdownOption[]>(() => {
    return [
      { value: UNCATEGORIZED_FOLDER_VALUE, label: '未分类' },
      ...materialFolders.map((folder) => ({ value: folder.id, label: folder.name })),
    ];
  }, [materialFolders]);

  const filteredCapturedImages = useMemo(() => {
    return capturedImages.filter((image) => {
      if (materialFilter !== 'all' && getMaterialDateGroup(image.createdAt) !== materialFilter) return false;
      if (materialScope === 'favorite') return Boolean(image.isFavorite);
      if (materialScope === 'uncategorized') return !image.folderId;
      if (activeFolderId) return image.folderId === activeFolderId;
      return true;
    });
  }, [activeFolderId, capturedImages, materialFilter, materialScope]);

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

  const filteredOrderResults = useMemo(() => {
    return orderResults.filter((item) => {
      if (toolFilter !== 'all' && item.toolLabel !== toolFilter) return false;
      if (materialFilter === 'all') return true;
      return getMaterialDateGroup(item.createdAt) === materialFilter;
    });
  }, [materialFilter, orderResults, toolFilter]);

  const groupedOrderResults = useMemo(() => {
    const groupMap = new Map<'today' | 'yesterday' | 'earlier', OrderResultCard[]>();
    for (const image of filteredOrderResults) {
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
  }, [filteredOrderResults]);

  const galleryLoadedCount = filteredCapturedImages.length;
  const galleryTotalCount = materialsPagination.total;
  const isGalleryEmpty = galleryLoadedCount === 0;
  const visibleMaterialUploadPlaceholders = useMemo(() => {
    if (libraryView !== 'gallery' || materialScope === 'favorite') return [];
    return materialUploadPlaceholders.filter((item) => {
      if (activeFolderId) return item.materialFolderId === activeFolderId;
      if (materialScope === 'uncategorized') return !item.materialFolderId;
      return true;
    });
  }, [activeFolderId, libraryView, materialScope, materialUploadPlaceholders]);
  const hasMaterialUploadPlaceholders = visibleMaterialUploadPlaceholders.length > 0;
  const isLibraryEmpty = libraryView === 'gallery'
    ? isGalleryEmpty && !isLoadingMaterials && !hasMaterialUploadPlaceholders
    : filteredOrderResults.length === 0;

  useEffect(() => {
    const markPageLeaving = () => {
      isPageLeavingRef.current = true;
    };
    const markPageActive = () => {
      isPageLeavingRef.current = false;
    };

    window.addEventListener('pagehide', markPageLeaving);
    window.addEventListener('beforeunload', markPageLeaving);
    window.addEventListener('pageshow', markPageActive);
    return () => {
      window.removeEventListener('pagehide', markPageLeaving);
      window.removeEventListener('beforeunload', markPageLeaving);
      window.removeEventListener('pageshow', markPageActive);
    };
  }, []);

  useEffect(() => {
    const timers = imageRetryTimersRef.current;
    return () => {
      Object.values(timers).forEach((timerId) => window.clearTimeout(timerId));
      imageRetryTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const objectUrls = uploadPlaceholderObjectUrlsRef.current;
    return () => {
      Object.values(objectUrls).forEach((url) => URL.revokeObjectURL(url));
      uploadPlaceholderObjectUrlsRef.current = {};
    };
  }, []);

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

  const toggleDropdown = useCallback((dropdownId: QuickCreateDropdownId) => {
    setOpenDropdownId((current) => current === dropdownId ? null : dropdownId);
  }, []);

  const closeDropdowns = useCallback(() => {
    setOpenDropdownId(null);
  }, []);

  const recordImageMetrics = useCallback((imageUrl: string, width: number, height: number) => {
    if (!(width > 0) || !(height > 0)) return;

    const ratio = height / width;
    setImageAspectRatios((prev) => {
      if (prev[imageUrl] === ratio) return prev;
      return { ...prev, [imageUrl]: ratio };
    });
    setImageSourceSizes((prev) => {
      const current = prev[imageUrl];
      if (current?.width === width && current.height === height) return prev;
      return { ...prev, [imageUrl]: { width, height } };
    });
  }, []);

  const clearImageRetryState = useCallback((imageUrl: string) => {
    const timerId = imageRetryTimersRef.current[imageUrl];
    if (timerId) {
      window.clearTimeout(timerId);
      delete imageRetryTimersRef.current[imageUrl];
    }
    delete imageRetryAttemptsRef.current[imageUrl];
    setFailedImageUrls((prev) => {
      if (!prev.has(imageUrl)) return prev;
      const next = new Set(prev);
      next.delete(imageUrl);
      return next;
    });
  }, []);

  const scheduleImageRetry = useCallback((imageUrl: string) => {
    if (imageRetryTimersRef.current[imageUrl]) return;

    const attempt = imageRetryAttemptsRef.current[imageUrl] || 0;
    const delay = IMAGE_LOAD_RETRY_DELAYS_MS[attempt];
    if (typeof delay !== 'number') {
      setFailedImageUrls((prev) => {
        if (prev.has(imageUrl)) return prev;
        return new Set(prev).add(imageUrl);
      });
      return;
    }

    imageRetryAttemptsRef.current[imageUrl] = attempt + 1;
    imageRetryTimersRef.current[imageUrl] = window.setTimeout(() => {
      delete imageRetryTimersRef.current[imageUrl];
      setImageRetryTokens((prev) => ({
        ...prev,
        [imageUrl]: (prev[imageUrl] || 0) + 1,
      }));
    }, delay);
  }, []);

  const upsertMaterialUploadPlaceholder = useCallback((placeholder: MaterialUploadPlaceholder) => {
    setMaterialUploadPlaceholders((prev) => {
      const next = [
        placeholder,
        ...prev.filter((item) => item.id !== placeholder.id && (!placeholder.key || item.key !== placeholder.key)),
      ];
      return next.sort((left, right) => right.createdAt - left.createdAt);
    });
  }, []);

  const updateMaterialUploadPlaceholder = useCallback((clientId: string, updates: Partial<MaterialUploadPlaceholder>) => {
    setMaterialUploadPlaceholders((prev) => prev.map((item) => (
      item.id === clientId || (updates.key && item.key === updates.key)
        ? { ...item, ...updates, updatedAt: Date.now() }
        : item
    )));
  }, []);

  const removeMaterialUploadPlaceholder = useCallback((clientIdOrKey: string) => {
    setMaterialUploadPlaceholders((prev) => prev.filter((item) => {
      const shouldRemove = item.id === clientIdOrKey || item.key === clientIdOrKey;
      if (shouldRemove && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        delete uploadPlaceholderObjectUrlsRef.current[item.id];
      }
      if (shouldRemove) {
        delete retryUploadFilesRef.current[item.id];
      }
      return !shouldRemove;
    }));
  }, []);

  const markMaterialUploadPlaceholderFailed = useCallback((clientId: string, message: string) => {
    updateMaterialUploadPlaceholder(clientId, { status: 'failed', message });
  }, [updateMaterialUploadPlaceholder]);

  const loadCapturedImages = useCallback(async (options?: { offset?: number; append?: boolean; preserveCurrent?: boolean }) => {
    const offset = options?.offset ?? 0;
    const append = options?.append === true;
    const preserveCurrent = options?.preserveCurrent === true;
    const requestId = materialRequestIdRef.current + 1;
    materialRequestIdRef.current = requestId;

    if (!user?.id) {
      hasLoadedMaterialsRef.current = false;
      prefetchedMaterialKeysRef.current.clear();
      prefetchedMaterialPaginationRef.current.clear();
      prefetchingMaterialKeysRef.current.clear();
      setCapturedImages([]);
      setMaterialsPagination(EMPTY_CAPTURED_IMAGES_PAGINATION);
      setIsLoadingMaterials(false);
      setIsLoadingMoreMaterials(false);
      return;
    }

    if (append) {
      setIsLoadingMoreMaterials(true);
    } else if (!preserveCurrent) {
      setIsLoadingMaterials(true);
      setCapturedImages([]);
      setMaterialsPagination(EMPTY_CAPTURED_IMAGES_PAGINATION);
    }

    try {
      const params = new URLSearchParams({
        limit: String(MATERIAL_PAGE_SIZE),
        offset: String(offset),
        scope: materialScope,
        date: materialFilter,
        timezoneOffset: String(new Date().getTimezoneOffset()),
      });
      const response = await fetch(`/api/plugin/captured-images?${params.toString()}`, { credentials: 'include' });
      const data = await response.json() as CapturedImagesResponse;
      if (!response.ok || !data.success || !Array.isArray(data.data)) {
        throw new Error(toUserFacingErrorMessage(data.error || data.message, '素材库加载失败'));
      }

      if (requestId !== materialRequestIdRef.current) return;

      const pagination = data.pagination;
      const nextPagination: CapturedImagesPagination = {
        limit: Number(pagination?.limit ?? MATERIAL_PAGE_SIZE),
        offset: Number(pagination?.offset ?? offset),
        total: Number(pagination?.total ?? data.data.length),
        hasMore: Boolean(pagination?.hasMore),
        nextOffset: Number(pagination?.nextOffset ?? offset + data.data.length),
      };

      hasLoadedMaterialsRef.current = true;
      prefetchedMaterialKeysRef.current.add(`${materialScope}:${materialFilter}`);
      prefetchedMaterialPaginationRef.current.set(`${materialScope}:${materialFilter}`, nextPagination);
      setMaterialsPagination(nextPagination);
      setCapturedImages((prev) => {
        const nextData = data.data || [];
        if (!append) {
          if (!preserveCurrent) {
            return nextData;
          }

          const nextById = new Map(prev.map((image) => [image.id, image]));
          for (const image of nextData) {
            nextById.set(image.id, image);
          }

          return Array.from(nextById.values()).sort(
            (left, right) => parseMaterialDate(right.createdAt).getTime() - parseMaterialDate(left.createdAt).getTime()
          );
        }

        const existingIds = new Set(prev.map((image) => image.id));
        return [...prev, ...nextData.filter((image) => !existingIds.has(image.id))];
      });
    } catch (error) {
      console.error('[素材库] 加载失败:', error);
    } finally {
      if (requestId === materialRequestIdRef.current) {
        setIsLoadingMaterials(false);
        setIsLoadingMoreMaterials(false);
      }
    }
  }, [materialFilter, materialScope, user?.id]);

  const loadMoreCapturedImages = useCallback(async () => {
    if (isLoadingMaterials || isLoadingMoreMaterials || !materialsPagination.hasMore) return;
    await loadCapturedImages({ offset: materialsPagination.nextOffset, append: true });
  }, [isLoadingMaterials, isLoadingMoreMaterials, loadCapturedImages, materialsPagination.hasMore, materialsPagination.nextOffset]);

  const materialMatchesCurrentView = useCallback((material: CapturedImageRecord) => {
    if (materialFilter !== 'all' && getMaterialDateGroup(material.createdAt) !== materialFilter) {
      return false;
    }

    if (materialScope === 'favorite') {
      return Boolean(material.isFavorite);
    }

    if (materialScope === 'uncategorized') {
      return !material.folderId;
    }

    if (activeFolderId) {
      return material.folderId === activeFolderId;
    }

    return true;
  }, [activeFolderId, materialFilter, materialScope]);

  const mergeCapturedImages = useCallback((materials: CapturedImageRecord[]) => {
    if (materials.length === 0) return;
    setCapturedImages((prev) => {
      const nextById = new Map(prev.map((image) => [image.id, image]));
      for (const material of materials) {
        nextById.set(material.id, material);
      }

      return Array.from(nextById.values()).sort(
        (left, right) => parseMaterialDate(right.createdAt).getTime() - parseMaterialDate(left.createdAt).getTime()
      );
    });
  }, []);

  const prefetchMaterialScope = useCallback(async (scope: MaterialScope) => {
    if (!user?.id) return;

    const key = `${scope}:${materialFilter}`;
    if (prefetchedMaterialKeysRef.current.has(key) || prefetchingMaterialKeysRef.current.has(key)) return;
    prefetchingMaterialKeysRef.current.add(key);

    try {
      const params = new URLSearchParams({
        limit: String(MATERIAL_PAGE_SIZE),
        offset: '0',
        scope,
        date: materialFilter,
        timezoneOffset: String(new Date().getTimezoneOffset()),
      });
      const response = await fetch(`/api/plugin/captured-images?${params.toString()}`, { credentials: 'include' });
      const data = await response.json() as CapturedImagesResponse;
      if (!response.ok || !data.success || !Array.isArray(data.data)) return;
      const pagination = data.pagination;
      const nextPagination: CapturedImagesPagination = {
        limit: Number(pagination?.limit ?? MATERIAL_PAGE_SIZE),
        offset: Number(pagination?.offset ?? 0),
        total: Number(pagination?.total ?? data.data.length),
        hasMore: Boolean(pagination?.hasMore),
        nextOffset: Number(pagination?.nextOffset ?? data.data.length),
      };
      prefetchedMaterialKeysRef.current.add(key);
      prefetchedMaterialPaginationRef.current.set(key, nextPagination);
      mergeCapturedImages(data.data);
    } catch (error) {
      console.warn('[素材库] 预取素材失败:', error);
    } finally {
      prefetchingMaterialKeysRef.current.delete(key);
    }
  }, [materialFilter, mergeCapturedImages, user?.id]);

  const handleMaterialScopeChange = useCallback((scope: MaterialScope) => {
    if (scope === materialScope) return;
    setMaterialScope(scope);
    if (scope === 'favorite') {
      void prefetchMaterialScope(scope);
    }
  }, [materialScope, prefetchMaterialScope]);

  const prependUploadedMaterials = useCallback((materials: CapturedImageRecord[]) => {
    const visibleMaterials = materials.filter(materialMatchesCurrentView);
    if (visibleMaterials.length === 0) return;
    const newVisibleMaterials = visibleMaterials.filter((material) => !locallyInsertedMaterialIdsRef.current.has(material.id));
    for (const material of newVisibleMaterials) {
      locallyInsertedMaterialIdsRef.current.add(material.id);
    }
    for (const material of visibleMaterials) {
      clearImageRetryState(material.imageUrl);
    }

    materialRequestIdRef.current += 1;
    setIsLoadingMaterials(false);
    setIsLoadingMoreMaterials(false);

    setCapturedImages((prev) => {
      const nextById = new Map<string, CapturedImageRecord>();
      for (const material of visibleMaterials) {
        nextById.set(material.id, material);
      }
      for (const material of prev) {
        if (!nextById.has(material.id)) {
          nextById.set(material.id, material);
        }
      }

      return Array.from(nextById.values()).sort(
        (left, right) => parseMaterialDate(right.createdAt).getTime() - parseMaterialDate(left.createdAt).getTime()
      );
    });

    setMaterialsPagination((prev) => {
      if (newVisibleMaterials.length === 0) return prev;
      return {
        ...prev,
        total: prev.total + newVisibleMaterials.length,
        nextOffset: prev.nextOffset + newVisibleMaterials.length,
      };
    });
  }, [clearImageRetryState, materialMatchesCurrentView]);

  const reduceMaterialsPagination = useCallback((deletedCount: number) => {
    if (deletedCount <= 0) return;
    setMaterialsPagination((prev) => {
      const total = Math.max(0, prev.total - deletedCount);
      const nextOffset = Math.max(0, prev.nextOffset - deletedCount);
      return { ...prev, total, nextOffset, hasMore: nextOffset < total };
    });
  }, []);

  const loadOrderResults = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = orderResultsRequestIdRef.current + 1;
    orderResultsRequestIdRef.current = requestId;

    if (!user?.id) {
      setOrderResults([]);
      setHasProcessingOrders(false);
      hasLoadedOrderResultsRef.current = false;
      preloadedOrderThumbnailUrlsRef.current.clear();
      trackedProcessingOrdersRef.current = {};
      return;
    }

    try {
      const response = await fetch('/api/task/orders?limit=160', { credentials: 'include' });
      const data = await response.json() as { success?: boolean; message?: string; data?: RawOrderRecord[] };
      if (!response.ok || !data.success || !Array.isArray(data.data)) {
        throw new Error(toUserFacingErrorMessage(data.message, '刷新订单记录失败，请重试'));
      }
      if (requestId !== orderResultsRequestIdRef.current) return;

      const now = Date.now();
      const orderByNumber = new Map(data.data.map((item) => [item.orderNumber || item.id, item]));
      const nextTrackedProcessingOrders = Object.fromEntries(Object.entries(trackedProcessingOrdersRef.current).filter(([orderNumber, startedAt]) => {
        if (now - startedAt > PROCESSING_ORDER_POLL_TTL_MS) return false;
        const matchedOrder = orderByNumber.get(orderNumber);
        return !matchedOrder || getOrderStatusLabel(matchedOrder.status) === '处理中';
      }));
      const hasTrackedProcessingOrders = Object.keys(nextTrackedProcessingOrders).length > 0;
      trackedProcessingOrdersRef.current = nextTrackedProcessingOrders;

      const hasProcessingOrdersNow = data.data.some((item) => getOrderStatusLabel(item.status) === '处理中');
      setHasProcessingOrders(hasProcessingOrdersNow || hasTrackedProcessingOrders);
      const latestSettledOrder = hasProcessingOrdersNow
        ? null
        : data.data.find((item) => getOrderStatusLabel(item.status) !== '处理中' && typeof item.remainingPoints === 'number');
      if (latestSettledOrder && typeof latestSettledOrder.remainingPoints === 'number') {
        syncPoints(latestSettledOrder.remainingPoints);
      }

      const cards = data.data.flatMap((item) => {
        const resultImages = extractImageUrls(item.resultData);
        const sourceImages = dedupeUrls([
          ...extractImageUrls(item.requestParams),
          ...extractImageUrls(item.uploadedImage),
        ]);
        const toolLabel = getOrderToolLabel(item.toolPage, item.description, item.orderNumber);
        const statusLabel = getOrderStatusLabel(item.status);
        const createdAt = item.createdAt || item.time || new Date().toISOString();
        const orderNumber = item.orderNumber || item.id;

        if ((statusLabel !== '成功' && statusLabel !== '部分成功') || resultImages.length === 0) {
          return [];
        }

        const description = `${toolLabel}结果`;

        return resultImages.map((imageUrl, index) => ({
          id: `${item.id}-${index}`,
          orderId: orderNumber,
          imageUrl,
          thumbnailUrl: Array.isArray(item.thumbnailUrls) ? item.thumbnailUrls[index] || null : null,
          createdAt,
          toolLabel,
          statusLabel,
          description,
          orderNumber,
          sourceImageUrl: sourceImages[0] || null,
          isResultImage: true,
          downloadFileName: getOrderDownloadFileName(orderNumber, toolLabel, imageUrl, index),
        }));
      });

      cards.sort((left, right) => parseMaterialDate(right.createdAt).getTime() - parseMaterialDate(left.createdAt).getTime());

      setOrderResults(cards);
      hasLoadedOrderResultsRef.current = true;
    } catch (error) {
      console.error('[订单库] 加载失败:', error);
      setHasProcessingOrders(false);
      if (!options?.silent) {
        showToast(toUserFacingErrorFromUnknown(error, '刷新订单记录失败，请重试'), 'error');
      }
    }
  }, [syncPoints, user?.id]);

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
      if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '创建文件夹失败，请重试'));
      setNewFolderName('');
      setShowNewFolderInput(false);
      await loadMaterialFolders();
      showToast('文件夹已创建', 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '创建文件夹失败，请重试'), 'error');
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
      if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '重命名失败，请重试'));
      setRenamingFolderId('');
      setRenamingFolderName('');
      await loadMaterialFolders();
      showToast('文件夹已重命名', 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '重命名失败，请重试'), 'error');
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
      if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '删除文件夹失败，请重试'));
      setMaterialScope('uncategorized');
      await loadMaterialFolders();
      showToast('文件夹已删除，素材已移到未分类', 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '删除文件夹失败，请重试'), 'error');
    }
  }, [activeFolder, loadMaterialFolders]);

  const clearSelectionState = useCallback(() => {
    setSelectedImages(new Set());
    setShowAiPromptPanel(false);
    setAiPrompt('');
    setAiAspectRatio('auto');
    setAiResolution('2k');
  }, []);

  const updateMaterials = useCallback(async (ids: string[], updates: { folderId?: string | null; isFavorite?: boolean }) => {
    if (ids.length === 0) return false;
    const idSet = new Set(ids);
    const affectedMaterials = capturedImages.filter((image) => idSet.has(image.id));
    const visibleDelta = affectedMaterials.reduce((delta, image) => {
      const nextImage = { ...image, ...updates };
      const wasVisible = materialMatchesCurrentView(image);
      const willBeVisible = materialMatchesCurrentView(nextImage);
      if (wasVisible === willBeVisible) return delta;
      return delta + (willBeVisible ? 1 : -1);
    }, 0);

    try {
      const response = await fetch('/api/materials/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, ...updates }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '更新素材失败，请重试'));

      setCapturedImages((prev) => prev.map((image) => {
        if (!idSet.has(image.id)) return image;
        return { ...image, ...updates };
      }));
      if (visibleDelta !== 0) {
        setMaterialsPagination((prev) => ({
          ...prev,
          total: Math.max(0, prev.total + visibleDelta),
        }));
      }
      if (typeof updates.isFavorite === 'boolean') {
        prefetchedMaterialKeysRef.current.delete(`favorite:${materialFilter}`);
        prefetchedMaterialPaginationRef.current.delete(`favorite:${materialFilter}`);
      }
      return true;
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '更新素材失败，请重试'), 'error');
      return false;
    }
  }, [capturedImages, materialFilter, materialMatchesCurrentView]);

  const toggleMaterialFavorite = useCallback(async (image: CapturedImageRecord) => {
    const success = await updateMaterials([image.id], { isFavorite: !image.isFavorite });
    if (success) {
      showToast(image.isFavorite ? '已取消收藏' : '已加入收藏', 'success');
    }
  }, [updateMaterials]);

  const moveSelectedMaterials = useCallback(async (targetValue: string) => {
    const ids = selectedCapturedImages.map((image) => image.id);
    if (!targetValue || ids.length === 0) return;
    const folderId = targetValue === UNCATEGORIZED_FOLDER_VALUE ? null : targetValue;
    const success = await updateMaterials(ids, { folderId });
    if (success) {
      clearSelectionState();
      showToast(folderId ? '已移动到文件夹' : '已移动到未分类', 'success');
    }
  }, [clearSelectionState, selectedCapturedImages, updateMaterials]);

  const validateImageFiles = useCallback((files: File[]) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const invalidFiles = files.filter((file) => !validTypes.includes(file.type));
    if (invalidFiles.length > 0) {
      showToast('请上传 JPG、PNG、WebP 或 GIF 格式的图片', 'error');
      return false;
    }

    const maxSize = MATERIAL_UPLOAD_HARD_LIMIT_BYTES;
    const oversizedFiles = files.filter((file) => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      showToast('单张图片大小不能超过 40MB', 'error');
      return false;
    }

    return true;
  }, []);

  const uploadFiles = useCallback(async (files: File[]) => {
    const selectedUploadFiles = dedupeUploadFiles(files);
    if (selectedUploadFiles.length === 0) return;
    if (selectedUploadFiles.length < files.length) {
      showToast(`已自动跳过 ${files.length - selectedUploadFiles.length} 张重复选择的图片`, 'info');
    }
    if (!validateImageFiles(selectedUploadFiles)) return;

    let settledCount = 0;
    let successfulCount = 0;
    let failedCount = 0;
    const uploadedMaterials: CapturedImageRecord[] = [];
    let pendingDirectUploads: StoredDirectMaterialUpload[] = [];
    const sessionUserId = user?.id || readStoredUserId() || 'anonymous';
    const uploadSession: StoredMaterialUploadSession = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId: sessionUserId,
      total: selectedUploadFiles.length,
      completed: 0,
      settled: 0,
      successful: 0,
      failed: 0,
      status: 'running',
      materials: [],
      pendingDirectUploads: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const writeCurrentUploadSession = (status: StoredMaterialUploadSession['status'] = 'running') => {
      writeMaterialUploadSession({
        ...uploadSession,
        completed: settledCount,
        settled: settledCount,
        successful: successfulCount,
        failed: failedCount,
        status,
        materials: uploadedMaterials.slice(0, 80),
        pendingDirectUploads: pendingDirectUploads.filter((item) => item.status !== 'completed').slice(0, 80),
        updatedAt: Date.now(),
      });
    };
    const upsertPendingDirectUpload = (upload: StoredDirectMaterialUpload) => {
      pendingDirectUploads = [
        upload,
        ...pendingDirectUploads.filter((item) => item.key !== upload.key),
      ];
      writeCurrentUploadSession();
    };
    const updatePendingDirectUpload = (key: string, status: StoredDirectMaterialUpload['status']) => {
      pendingDirectUploads = pendingDirectUploads.map((item) => (
        item.key === key ? { ...item, status, updatedAt: Date.now() } : item
      ));
      writeCurrentUploadSession();
    };

    writeCurrentUploadSession();

    try {
      const uploadOne = async (file: File, fileIndex: number): Promise<MaterialUploadResult> => {
        let shouldMarkSettled = true;
        const clientId = `${uploadSession.id}-${fileIndex}`;
        let previewUrl = '';
        try {
          previewUrl = URL.createObjectURL(file);
          uploadPlaceholderObjectUrlsRef.current[clientId] = previewUrl;
        } catch {
          previewUrl = '';
        }
        retryUploadFilesRef.current[clientId] = file;
        upsertMaterialUploadPlaceholder({
          id: clientId,
          fileName: file.name,
          previewUrl,
          status: 'preparing',
          materialFolderId: activeFolderId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const prepared = await prepareImageFileForUpload(file);
        updateMaterialUploadPlaceholder(clientId, {
          status: 'uploading',
          message: prepared.compressed ? '已压缩，正在上传' : '正在上传',
        });

        try {
          let uploadData: NonNullable<UploadFileResponse['data']>;
          try {
            uploadData = await uploadMaterialDirectToOSS(prepared.file, {
              activeFolderId,
              clientId,
              originalFileName: file.name,
              onPendingCreated: (upload) => {
                upsertPendingDirectUpload(upload);
                updateMaterialUploadPlaceholder(clientId, { key: upload.key, status: 'uploading', message: '正在上传到 OSS' });
              },
              onPendingUploaded: (key) => {
                updatePendingDirectUpload(key, 'uploaded');
                updateMaterialUploadPlaceholder(clientId, { key, status: 'uploaded', message: '上传完成，正在入库' });
              },
              onPendingSaving: (key) => {
                updatePendingDirectUpload(key, 'saving');
                updateMaterialUploadPlaceholder(clientId, { key, status: 'saving', message: '正在写入图库' });
              },
              onPendingCompleted: (key) => {
                updatePendingDirectUpload(key, 'completed');
                removeMaterialUploadPlaceholder(clientId);
              },
            });
          } catch (directError) {
            if (isPageLeavingRef.current) {
              throw directError;
            }

            if (isDirectUploadCompletionError(directError)) {
              updatePendingDirectUpload(directError.key, 'saving');
              markMaterialUploadPlaceholderFailed(
                clientId,
                '图片已上传，入库确认暂未完成，可点重试'
              );
              failedCount += 1;
              return {
                success: false,
                fileName: file.name,
                message: '图片已上传，入库确认暂未完成，可点重试',
              };
            }

            console.warn('[素材上传] OSS 直传失败，回退到服务端上传:', directError);
            updateMaterialUploadPlaceholder(clientId, { status: 'saving', message: '正在兼容保存' });
            uploadData = await uploadMaterialThroughServer(prepared.file, {
              activeFolderId,
              originalFileName: file.name,
            });
          }

          const result: MaterialUploadResult = {
            success: true,
            fileName: file.name,
            url: uploadData.url || '',
            material: uploadData.material ?? null,
            compressed: prepared.compressed,
            originalSize: prepared.originalSize,
            finalSize: prepared.finalSize,
          };

          if (uploadData.material) {
            uploadedMaterials.unshift(uploadData.material);
            removeMaterialUploadPlaceholder(clientId);
            prependUploadedMaterials([uploadData.material]);
          }

          successfulCount += 1;
          return result;
        } catch (error) {
          const isAbortError = isAbortLikeError(error);
          if (isPageLeavingRef.current) {
            shouldMarkSettled = false;
            updateMaterialUploadPlaceholder(clientId, {
              status: 'recovering',
              message: '刷新后继续核对',
            });
            return {
              success: false,
              fileName: file.name,
              message: '页面刷新中，正在重新核对上传结果',
              interrupted: true,
            };
          }

          failedCount += 1;
          markMaterialUploadPlaceholderFailed(
            clientId,
            isAbortError ? '上传超时' : toUserFacingErrorFromUnknown(error, '上传失败')
          );
          return {
            success: false,
            fileName: file.name,
            message: isAbortError ? '上传超时，请稍后重试' : toUserFacingErrorFromUnknown(error, '上传失败，请重试'),
          };
        } finally {
          if (shouldMarkSettled) {
            settledCount += 1;
          }
          writeCurrentUploadSession();
        }
      };

      const results = await runWithConcurrency(selectedUploadFiles, MATERIAL_UPLOAD_CONCURRENCY, uploadOne);
      const successfulUploads = results.filter((result) => result.success);
      const failedUploads = results.filter((result): result is FailedMaterialUploadResult => !result.success && !result.interrupted);
      const interruptedUploads = results.filter((result): result is FailedMaterialUploadResult => !result.success && Boolean(result.interrupted));

      if (successfulUploads.length > 0) {
        await loadCapturedImages({ preserveCurrent: true });
        const compressedCount = successfulUploads.filter((result) => result.success && result.compressed).length;
        showToast(`成功加入 ${successfulUploads.length} 张图片到素材库`, 'success');
        if (compressedCount > 0) {
          showToast(`${compressedCount} 张大图已在不改变尺寸的情况下压缩后上传`, 'info');
        }
        if (failedUploads.length > 0) {
          showToast(`${failedUploads.length} 张上传失败：${failedUploads[0].message}`, 'error');
        }
      } else if (interruptedUploads.length > 0) {
        showToast('页面刷新中断了上传显示，正在重新核对素材库', 'info');
      } else {
        showToast(failedUploads[0]?.message || '上传失败，请重试', 'error');
      }
    } finally {
      const hasPendingDirectUploads = pendingDirectUploads.some((item) => item.status !== 'completed');
      const finalStatus: StoredMaterialUploadSession['status'] = settledCount >= selectedUploadFiles.length && !hasPendingDirectUploads ? 'settled' : 'running';
      writeCurrentUploadSession(finalStatus);
      if (finalStatus === 'settled') {
        window.setTimeout(() => clearMaterialUploadSession(sessionUserId), 15000);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [activeFolderId, loadCapturedImages, markMaterialUploadPlaceholderFailed, prependUploadedMaterials, removeMaterialUploadPlaceholder, updateMaterialUploadPlaceholder, upsertMaterialUploadPlaceholder, user?.id, validateImageFiles]);

  const retryMaterialUploadPlaceholder = useCallback(async (placeholder: MaterialUploadPlaceholder) => {
    if (placeholder.key) {
      updateMaterialUploadPlaceholder(placeholder.id, {
        status: 'recovering',
        message: '正在重新确认入库',
      });

      try {
        const completedData = await completeDirectUploadMaterialWithRetry(
          {
            key: placeholder.key,
            originalFileName: placeholder.fileName,
            materialFolderId: placeholder.materialFolderId,
          },
          {
            onRetry: (attempt) => {
              updateMaterialUploadPlaceholder(placeholder.id, {
                status: 'recovering',
                message: `正在重试入库 ${attempt}`,
              });
            },
          }
        );

        if (completedData.material) {
          prependUploadedMaterials([completedData.material]);
        }
        removePendingMaterialUploadFromSession(user?.id || readStoredUserId() || 'anonymous', placeholder.key);
        removeMaterialUploadPlaceholder(placeholder.id);
        showToast('素材已加入图库', 'success');
      } catch (error) {
        markMaterialUploadPlaceholderFailed(
          placeholder.id,
          toUserFacingErrorFromUnknown(error, '入库确认仍未完成，可稍后再试')
        );
      }
      return;
    }

    const retryFile = retryUploadFilesRef.current[placeholder.id];
    if (retryFile) {
      removeMaterialUploadPlaceholder(placeholder.id);
      await uploadFiles([retryFile]);
      return;
    }

    showToast('请重新选择这张图片上传', 'info');
    fileInputRef.current?.click();
  }, [markMaterialUploadPlaceholderFailed, prependUploadedMaterials, removeMaterialUploadPlaceholder, updateMaterialUploadPlaceholder, uploadFiles, user?.id]);

  const uploadAiReferenceFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (!validateImageFiles(files)) return;

    setIsAiReferenceUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const prepared = await prepareImageFileForUpload(file);
        const formData = new FormData();
        formData.append('file', prepared.file);
        formData.append('originalFileName', file.name);
        formData.append('folder', 'ai-reference');
        const response = await fetch('/api/upload/file', { method: 'POST', credentials: 'include', body: formData });
        const data = await response.json();
        if (!response.ok || !data.success || !data.data?.url) {
          throw new Error(toUserFacingErrorMessage(data.message, '参考图上传失败，请重试'));
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
      showToast(toUserFacingErrorFromUnknown(error, '参考图上传失败，请重试'), 'error');
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
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => {
      setCanHoverCardControls(mediaQuery.matches);
    };

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsCompactActionBar(mediaQuery.matches);
    };

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
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
      if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '删除失败，请重试'));
      setCapturedImages((prev) => prev.filter((item) => item.id !== image.id));
      reduceMaterialsPagination(1);
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '删除失败，请重试'), 'error');
      return;
    }

    setSelectedImages((prev) => {
      const next = new Set(prev);
      next.delete(image.imageUrl);
      return next;
    });
  };

  const downloadImageByUrl = useCallback(async (imageUrl: string, fileName: string) => {
    const displayImageUrl = getDisplayImageUrl(imageUrl);
    try {
      const signedResponse = await fetch(`/api/image/download-url?url=${encodeURIComponent(displayImageUrl)}&filename=${encodeURIComponent(fileName)}`, { credentials: 'include' });
      if (signedResponse.ok) {
        const signedResult = await signedResponse.json().catch(() => null) as { success?: boolean; data?: { downloadUrl?: string } } | null;
        if (signedResult?.success && signedResult.data?.downloadUrl) {
          const link = document.createElement('a');
          link.href = signedResult.data.downloadUrl;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          return;
        }
      }

      const response = await fetch(displayImageUrl);
      if (!response.ok) {
        throw new Error('图片下载失败');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('[素材库] 图片下载失败:', error);
      window.open(displayImageUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const downloadMaterialImage = useCallback(async (image: CapturedImageRecord) => {
    await downloadImageByUrl(image.imageUrl, getDownloadFileName(image));
  }, [downloadImageByUrl]);

  const downloadOrderImage = useCallback(async (image: OrderResultCard) => {
    await downloadImageByUrl(image.imageUrl, image.downloadFileName);
  }, [downloadImageByUrl]);

  const deleteOrderRecord = useCallback(async (image: OrderResultCard) => {
    if (image.statusLabel === '处理中') {
      showToast('处理中订单暂时不能删除', 'error');
      return;
    }

    const confirmed = window.confirm('确定要删除这条订单记录吗？此操作不可恢复。');
    if (!confirmed) {
      return;
    }

    try {
      setDeletingOrderNumber(image.orderNumber);
      const response = await fetch('/api/user/transactions/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: image.orderNumber }),
      });

      const data = await response.json().catch(() => ({} as { success?: boolean; message?: string }));
      if (!response.ok || data.success === false) {
        throw new Error(toUserFacingErrorMessage(data.message, '删除失败，请重试'));
      }

      setOrderResults((prev) => prev.filter((item) => item.orderNumber !== image.orderNumber));
      setSelectedImages((prev) => {
        const next = new Set(prev);
        next.delete(image.imageUrl);
        return next;
      });
      dispatchTaskHistoryUpdated();
      showToast('删除成功', 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '删除失败，请重试'), 'error');
    } finally {
      setDeletingOrderNumber(null);
    }
  }, [dispatchTaskHistoryUpdated]);

  const deleteSelectedImages = async () => {
    if (selectedImageList.length === 0) {
      showToast(libraryView === 'gallery' ? '请先选择要删除的图片' : '请先选择要删除的订单记录', 'error');
      return;
    }

    if (libraryView === 'orders') {
      const selectedSet = new Set(selectedImageList);
      const selectedOrders = Array.from(
        new Map(
          orderResults
            .filter((image) => selectedSet.has(image.imageUrl) && image.statusLabel !== '处理中')
            .map((image) => [image.orderNumber, image])
        ).values()
      );

      if (selectedOrders.length === 0) {
        showToast('请选择可删除的订单记录', 'error');
        return;
      }

      const confirmed = window.confirm(`确定要删除所选 ${selectedOrders.length} 条订单记录吗？此操作不可恢复。`);
      if (!confirmed) return;

      try {
        for (const order of selectedOrders) {
          setDeletingOrderNumber(order.orderNumber);
          const response = await fetch('/api/user/transactions/delete', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNumber: order.orderNumber }),
          });
          const data = await response.json().catch(() => ({} as { success?: boolean; message?: string }));
          if (!response.ok || data.success === false) {
            throw new Error(toUserFacingErrorMessage(data.message, '删除失败，请重试'));
          }
        }

        const deletedOrderNumbers = new Set(selectedOrders.map((order) => order.orderNumber));
        setOrderResults((prev) => prev.filter((item) => !deletedOrderNumbers.has(item.orderNumber)));
        clearSelectionState();
        dispatchTaskHistoryUpdated();
        showToast(`已删除 ${selectedOrders.length} 条订单记录`, 'success');
      } catch (error) {
        showToast(toUserFacingErrorFromUnknown(error, '删除失败，请重试'), 'error');
        void loadOrderResults({ silent: true });
      } finally {
        setDeletingOrderNumber(null);
      }
      return;
    }

    const deletedImageUrls: string[] = [];

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
        const data = await response.json().catch(() => ({} as { success?: boolean; error?: string; message?: string }));
        if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error || data.message, '删除失败，请重试'));
        deletedImageUrls.push(imageUrl);
      }

      const deletedImageUrlSet = new Set(deletedImageUrls);
      setCapturedImages((prev) => prev.filter((image) => !deletedImageUrlSet.has(image.imageUrl)));
      reduceMaterialsPagination(deletedImageUrls.length);
      clearSelectionState();
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '删除失败，请重试'), 'error');
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
        if (!response.ok || !data.success) throw new Error(toUserFacingErrorMessage(data.error, '删除重复图片失败，请重试'));
      }

      const duplicateIdSet = new Set(imagesToDelete.map((image) => image.id));
      setCapturedImages((prev) => prev.filter((image) => !duplicateIdSet.has(image.id)));
      reduceMaterialsPagination(imagesToDelete.length);
      setSelectedImages((prev) => {
        const next = new Set(prev);
        imagesToDelete.forEach((image) => next.delete(image.imageUrl));
        return next;
      });
      closeDuplicateReview();
      showToast(`已删除 ${imagesToDelete.length} 张重复图片`, 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '删除重复图片失败，请重试'), 'error');
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

      const data = await response.json() as PluginCaptureResponse;
      const material = getMaterialFromPluginPayload(data.data);
      if (!response.ok || !data.success || (!data.data?.uploadedUrl && !material?.imageUrl)) {
        throw new Error(toUserFacingErrorMessage(data.error || data.message, '插件采图失败，请重试'));
      }

      if (material) {
        prependUploadedMaterials([material]);
      }
      void loadCapturedImages({ preserveCurrent: true });
      showToast('插件采图成功，图片已加入素材库', 'success');
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, '插件采图失败，请重试'), 'error');
    }
  }, [loadCapturedImages, prependUploadedMaterials]);

  const ensureUserReady = useCallback(() => {
    if (!user?.id) {
      showToast('请先登录后再执行功能', 'error');
      return false;
    }
    return true;
  }, [user?.id]);

  const ensureEnoughPoints = useCallback(async (requiredPoints: number) => {
    if (!user?.id) return false;
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
      console.error('[素材库] 校验积分失败:', error);
      if ((user.points || 0) < requiredPoints) {
        showToast(`积分不足，当前 ${user.points || 0}，需要 ${requiredPoints}`, 'error');
        return false;
      }
      return true;
    }
  }, [syncPoints, user?.id, user?.points]);

  const ensureEnoughColorExtractionPoints = useCallback((imageCount: number) => {
    return ensureEnoughPoints(getColorExtractionPoints() * imageCount);
  }, [ensureEnoughPoints]);

  const startColorExtraction = useCallback(async (imageUrl: string) => {
    if (!user?.id) return false;
    const tempOrderId = `ORD${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const processingImageUrl = getProcessingImageUrl(imageUrl);

    addTaskRecord(
      'color-extraction',
      '彩绘提取',
      '手机壳彩绘提取',
      undefined,
      tempOrderId,
      undefined,
      processingImageUrl,
      '处理中'
    );

    try {
      const response = await fetch('/api/color-extraction/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, imageUrl: processingImageUrl, orderId: tempOrderId }),
      });

      const data = await response.json() as {
        success?: boolean;
        message?: string;
        data?: { imageUrl?: string; orderId?: string; remainingPoints?: number };
      };

      if (!response.ok || !data.success) {
        throw new Error(toUserFacingErrorMessage(data.message, '彩绘提取失败，请重试'));
      }

      const queuedOrderId = data.data?.orderId?.trim();
      if (queuedOrderId && !data.data?.imageUrl) {
        trackedProcessingOrdersRef.current = { ...trackedProcessingOrdersRef.current, [queuedOrderId]: Date.now() };
        setHasProcessingOrders(true);
        if (typeof data.data?.remainingPoints === 'number') syncPoints(data.data.remainingPoints);
        dispatchTaskHistoryUpdated();
        return true;
      }

      updateTaskRecordStatus(tempOrderId, '成功', data.data?.imageUrl);
      if (typeof data.data?.remainingPoints === 'number') syncPoints(data.data.remainingPoints);
      dispatchTaskHistoryUpdated();
      return true;
    } catch (error) {
      console.error('[素材库] 彩绘提取执行失败:', error);
      updateTaskRecordStatus(tempOrderId, '失败');
      dispatchTaskHistoryUpdated();
      return false;
    }
  }, [dispatchTaskHistoryUpdated, syncPoints, user?.id]);

  const startOutpaintUpsampling = useCallback(async (imageUrl: string) => {
    if (!user?.id) return false;
    try {
      const response = await fetch('/api/outpaint-upsampling/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, imageUrl }),
      });
      const data = await response.json().catch(() => ({} as {
        success?: boolean;
        message?: string;
        data?: { orderId?: string; remainingPoints?: number };
      }));
      if (!response.ok) {
        const errorMessage = toUserFacingErrorMessage(data.message || '暂时未能完成处理，请稍后重试', '暂时未能完成处理，请稍后重试');
        throw new Error(errorMessage);
      }

      if (typeof data.data?.remainingPoints === 'number') {
        syncPoints(data.data.remainingPoints);
      }
      const orderId = data.data?.orderId?.trim();
      if (orderId) {
        trackedProcessingOrdersRef.current = { ...trackedProcessingOrdersRef.current, [orderId]: Date.now() };
        setHasProcessingOrders(true);
      }
      dispatchTaskHistoryUpdated();
      dispatchTaskHistoryUpdated(500);
      return true;
    } catch (error) {
      console.error('[素材库] 高清+扩图执行失败:', error);
      dispatchTaskHistoryUpdated();
      showToast(toUserFacingErrorFromUnknown(error, '暂时未能完成处理，请稍后重试'), 'error');
      return false;
    }
  }, [dispatchTaskHistoryUpdated, syncPoints, user?.id]);

  const startHdUpscale = useCallback(async (imageUrl: string) => {
    if (!user?.id) return false;
    try {
      const response = await fetch('/api/hd-upscale/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, imageUrl }),
      });
      const data = await response.json().catch(() => ({} as {
        success?: boolean;
        message?: string;
        data?: { orderId?: string; remainingPoints?: number };
      }));
      if (!response.ok) {
        const errorMessage = toUserFacingErrorMessage(data.message || '暂时未能完成处理，请稍后重试', '暂时未能完成处理，请稍后重试');
        throw new Error(errorMessage);
      }

      if (typeof data.data?.remainingPoints === 'number') {
        syncPoints(data.data.remainingPoints);
      }
      const orderId = data.data?.orderId?.trim();
      if (orderId) {
        trackedProcessingOrdersRef.current = { ...trackedProcessingOrdersRef.current, [orderId]: Date.now() };
        setHasProcessingOrders(true);
      }
      dispatchTaskHistoryUpdated();
      dispatchTaskHistoryUpdated(500);
      return true;
    } catch (error) {
      console.error('[素材库] 高清放大执行失败:', error);
      dispatchTaskHistoryUpdated();
      showToast(toUserFacingErrorFromUnknown(error, '暂时未能完成处理，请稍后重试'), 'error');
      return false;
    }
  }, [dispatchTaskHistoryUpdated, syncPoints, user?.id]);

  const startAiGenerate = useCallback((imageUrl: string, prompt: string, options: {
    aspectRatio: SmartEditAspectRatioOption;
    resolution: SmartEditResolution;
    sourceSize?: ImageSourceSize;
  }) => {
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
            aspectRatio: options.aspectRatio,
            resolution: options.resolution,
            sourceSize: options.sourceSize,
            orderId: tempOrderId,
          }),
        });

        const data = await response.json() as {
          success?: boolean;
          message?: string;
          data?: { url?: string; remainingPoints?: number };
        };

        if (!response.ok || !data.success) {
          throw new Error(toUserFacingErrorMessage(data.message, '暂时未能完成处理，请稍后重试'));
        }

        updateTaskRecordStatus(tempOrderId, '成功', data.data?.url);
        if (typeof data.data?.remainingPoints === 'number') {
          syncPoints(data.data.remainingPoints);
        }
        dispatchTaskHistoryUpdated();
        void loadOrderResults();
      } catch (error) {
        console.error('[素材库] AI生图执行失败:', error);
        updateTaskRecordStatus(tempOrderId, '失败');
        dispatchTaskHistoryUpdated();
        showToast(toUserFacingErrorFromUnknown(error, '暂时未能完成处理，请稍后重试'), 'error');
      }
    })();
  }, [dispatchTaskHistoryUpdated, loadOrderResults, syncPoints, user?.id]);

  const handleRunAction = useCallback(async (actionId: GalleryActionId) => {
    if (!ensureUserReady()) return;
    if (selectedImageList.length === 0) {
      showToast('请先在素材库中选择图片', 'error');
      return;
    }

    if (actionId === 'ai-generate') {
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
          submittedCount += 1;
          startColorExtraction(imageUrl);
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
        showToast(`已提交 ${submittedCount} 张图片到彩绘提取`, 'info');
      }

      if (actionId === 'outpaint-upsampling') {
        const hasEnoughPoints = await ensureEnoughPoints(getOutpaintUpsamplingPoints() * selectedImageList.length);
        if (!hasEnoughPoints) return;
        let submittedCount = 0;
        for (const imageUrl of selectedImageList) {
          if (await startOutpaintUpsampling(imageUrl)) {
            submittedCount += 1;
          }
        }
        showToast(`已提交 ${submittedCount} 张图片到高清+扩图`, 'info');
      }

      if (actionId === 'hd-upscale') {
        const hasEnoughPoints = await ensureEnoughPoints(getHdUpscalePoints() * selectedImageList.length);
        if (!hasEnoughPoints) return;
        let submittedCount = 0;
        for (const imageUrl of selectedImageList) {
          if (await startHdUpscale(imageUrl)) {
            submittedCount += 1;
          }
        }
        showToast(`已提交 ${submittedCount} 张图片到高清放大`, 'info');
      }

      clearSelectionState();
    } finally {
      setProcessingAction(null);
    }
  }, [clearSelectionState, ensureEnoughColorExtractionPoints, ensureEnoughPoints, ensureUserReady, selectedImageList, startColorExtraction, startHdUpscale, startOutpaintUpsampling]);

  const submitAiGenerate = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      showToast('请输入AI生图提示词', 'error');
      return;
    }

    const hasEnoughPoints = await ensureEnoughPoints(aiGenerateTotalPoints);
    if (!hasEnoughPoints) return;

    setShowAiPromptPanel(false);
    setProcessingAction('ai-generate');
    try {
      selectedImageList.forEach((imageUrl) => {
        startAiGenerate(imageUrl, prompt, {
          aspectRatio: aiAspectRatio,
          resolution: aiResolution,
          sourceSize: imageSourceSizes[imageUrl],
        });
      });
      showToast(`已提交 ${selectedImageList.length} 张图片到AI生图`, 'info');
      clearSelectionState();
    } finally {
      setProcessingAction(null);
    }
  }, [aiAspectRatio, aiGenerateTotalPoints, aiPrompt, aiResolution, clearSelectionState, ensureEnoughPoints, imageSourceSizes, selectedImageList, startAiGenerate]);

  const handleEditorAction = useCallback((action: EditorAction['id']) => {
    if (selectedImageList.length !== 1) {
      showToast('编辑类功能一次只能选择 1 张图片', 'error');
      return;
    }

    const selectedImageUrl = selectedImageList[0];
    if (failedImageUrls.has(selectedImageUrl)) {
      showToast('图片不可用，请重新上传后再编辑', 'error');
      return;
    }

    const selectedOrder = libraryView === 'orders'
      ? orderResults.find((item) => item.imageUrl === selectedImageUrl)
      : null;

    if (action === 'edit-image') {
      setImageEditor({
        open: true,
        mode: 'crop',
        imageUrl: selectedImageUrl,
        destination: selectedOrder ? 'orders' : 'gallery',
        orderNumber: selectedOrder?.orderNumber,
        toolLabel: selectedOrder?.toolLabel,
        sourceImageUrl: selectedOrder?.sourceImageUrl || null,
      });
      return;
    }

    if (action === 'local-edit') {
      setLocalEditImageUrl(selectedImageUrl);
      setShowLocalEdit(true);
    }
  }, [failedImageUrls, libraryView, orderResults, selectedImageList]);

  const closeImageEditor = useCallback(() => {
    setImageEditor({ open: false, mode: 'crop', imageUrl: '', destination: 'gallery' });
  }, []);

  const closeLocalEdit = useCallback(() => {
    setShowLocalEdit(false);
    setLocalEditImageUrl('');
  }, []);

  const handleEditorComplete = useCallback((resultUrl: string) => {
    void resultUrl;
    if (imageEditor.destination === 'orders') {
      void loadOrderResults();
      showToast('裁切结果已加入订单记录', 'success');
      return;
    }

    void loadCapturedImages();
    showToast('编辑后的素材已加入素材库', 'success');
  }, [imageEditor.destination, loadCapturedImages, loadOrderResults]);

  const handleLocalEditComplete = useCallback((resultUrl: string, meta?: { orderId?: string; status?: string; remainingPoints?: number }) => {
    const orderId = meta?.orderId?.trim();
    clearSelectionState();
    if (typeof meta?.remainingPoints === 'number') {
      syncPoints(meta.remainingPoints);
    }
    if (orderId) {
      addTaskRecord('smart-edit', '智能改图', '智能改图处理中', undefined, orderId, undefined, localEditImageUrl, '处理中');
      trackedProcessingOrdersRef.current = { ...trackedProcessingOrdersRef.current, [orderId]: Date.now() };
      setHasProcessingOrders(true);
    }
    dispatchTaskHistoryUpdated();
    void loadOrderResults();
    window.setTimeout(() => {
      void loadOrderResults({ silent: true });
    }, 1500);
    if (meta?.status === '处理中' || orderId) {
      showToast('智能改图已提交生成，可在历史侧栏查看进度', 'success');
      return;
    }
    handleEditorComplete(resultUrl);
  }, [clearSelectionState, dispatchTaskHistoryUpdated, handleEditorComplete, loadOrderResults, localEditImageUrl, syncPoints]);

  const handleMasonryBlankClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (selectedImageList.length === 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('[data-selection-card="true"]')) return;
    clearSelectionState();
  }, [clearSelectionState, selectedImageList.length]);

  useEffect(() => {
    const handlePluginMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: (PluginCaptureSavedPayload & { error?: string }) | null;
      };
      if (data?.source !== 'zaomeng-extension') return;
      if (data.type === 'ZAOMENG_EXTENSION_READY' && !requestedLatestCaptureRef.current) {
        requestedLatestCaptureRef.current = true;
        window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_REQUEST_LATEST_CAPTURE' }, window.location.origin);
        return;
      }

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE' && data.payload) {
        void handlePluginCapture(data.payload);
        return;
      }

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE_SAVED' || data.type === 'ZAOMENG_LATEST_CAPTURE') {
        const material = getMaterialFromPluginPayload(data.payload);
        if (material) {
          prependUploadedMaterials([material]);
          if (data.type === 'ZAOMENG_CAPTURE_IMAGE_SAVED') {
            showToast('插件采图成功，图片已加入素材库', 'success');
          }
        }
        void loadCapturedImages({ preserveCurrent: true });
        return;
      }

      if (data.type === 'ZAOMENG_CAPTURE_IMAGE_FAILED') {
        const message = data.payload?.error || '插件采图失败，请确认已登录后重试';
        showToast(toUserFacingErrorMessage(message, '插件采图失败，请重试'), 'error');
      }
    };

    window.addEventListener('message', handlePluginMessage);
    return () => window.removeEventListener('message', handlePluginMessage);
  }, [handlePluginCapture, loadCapturedImages, prependUploadedMaterials]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-role="quick-create-dropdown"]')) return;
      closeDropdowns();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdowns();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDropdowns]);

  useEffect(() => {
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
    queueMicrotask(() => {
      void loadMaterialFolders();
    });
  }, [loadMaterialFolders]);

  useEffect(() => {
    if (!user?.id) return;

    const storedUserId = readStoredUserId();
    const session = readMaterialUploadSession(user.id)
      || (storedUserId && storedUserId !== user.id ? readMaterialUploadSession(storedUserId) : null)
      || readMaterialUploadSession('anonymous');
    if (!session) return;
    const sessionUserId = session.userId || user.id;

    const recoveredMaterials = Array.isArray(session.materials) ? session.materials : [];
    let pendingDirectUploads = (Array.isArray(session.pendingDirectUploads) ? session.pendingDirectUploads : [])
      .filter((item) => item.key && item.status !== 'completed');

    if (recoveredMaterials.length > 0) {
      prependUploadedMaterials(recoveredMaterials);
    }

    for (const pendingUpload of pendingDirectUploads) {
      upsertMaterialUploadPlaceholder({
        id: pendingUpload.clientId || pendingUpload.key,
        key: pendingUpload.key,
        fileName: pendingUpload.originalFileName,
        status: pendingUpload.status === 'uploaded' || pendingUpload.status === 'saving' ? 'recovering' : 'uploading',
        message: pendingUpload.status === 'uploading' ? '刷新前正在上传' : '正在恢复入库',
        materialFolderId: pendingUpload.materialFolderId,
        createdAt: pendingUpload.createdAt,
        updatedAt: pendingUpload.updatedAt,
      });
    }

    const reconcilePendingDirectUploads = async () => {
      if (materialRecoveryInFlightRef.current) return;
      materialRecoveryInFlightRef.current = true;

      try {
        if (pendingDirectUploads.length === 0) {
          clearMaterialUploadSession(sessionUserId);
          return;
        }

        const recoveredPendingMaterials: CapturedImageRecord[] = [];
        const stillPendingUploads: StoredDirectMaterialUpload[] = [];
        for (const pendingUpload of pendingDirectUploads) {
          try {
            const completedData = await completeDirectUploadMaterialWithRetry(
              {
                key: pendingUpload.key,
                originalFileName: pendingUpload.originalFileName,
                materialFolderId: pendingUpload.materialFolderId,
              },
              {
                onRetry: (attempt) => {
                  updateMaterialUploadPlaceholder(pendingUpload.clientId || pendingUpload.key, {
                    status: 'recovering',
                    message: `正在恢复入库 ${attempt}`,
                  });
                },
              }
            );
            if (completedData.material) {
              recoveredPendingMaterials.push(completedData.material);
              removeMaterialUploadPlaceholder(pendingUpload.clientId || pendingUpload.key);
            }
          } catch {
            updateMaterialUploadPlaceholder(pendingUpload.clientId || pendingUpload.key, {
              status: 'recovering',
              message: '等待 OSS 完成',
            });
            stillPendingUploads.push({ ...pendingUpload, updatedAt: Date.now() });
          }
        }

        pendingDirectUploads = stillPendingUploads;
        if (recoveredPendingMaterials.length > 0) {
          prependUploadedMaterials(recoveredPendingMaterials);
        }

        if (stillPendingUploads.length > 0) {
          writeMaterialUploadSession({
            ...session,
            userId: sessionUserId,
            pendingDirectUploads: stillPendingUploads,
            updatedAt: Date.now(),
          });
        } else {
          clearMaterialUploadSession(sessionUserId);
        }

        await loadCapturedImages({ preserveCurrent: true });
      } finally {
        materialRecoveryInFlightRef.current = false;
      }
    };

    void reconcilePendingDirectUploads();

    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      void reconcilePendingDirectUploads();
      if (attempts >= MATERIAL_UPLOAD_RECOVERY_MAX_ATTEMPTS || (pendingDirectUploads.length === 0 && session.status === 'settled')) {
        window.clearInterval(intervalId);
        if (pendingDirectUploads.length > 0) {
          const retryablePendingUploads = pendingDirectUploads.filter((item) => item.status === 'uploaded' || item.status === 'saving');
          if (retryablePendingUploads.length > 0) {
            writeMaterialUploadSession({
              ...session,
              userId: sessionUserId,
              pendingDirectUploads: retryablePendingUploads,
              updatedAt: Date.now(),
            });
          } else {
            clearMaterialUploadSession(sessionUserId);
          }

          for (const pendingUpload of pendingDirectUploads) {
            markMaterialUploadPlaceholderFailed(
              pendingUpload.clientId || pendingUpload.key,
              pendingUpload.status === 'uploaded' || pendingUpload.status === 'saving'
                ? '入库确认未完成，可点重试'
                : '刷新中断了上传，请重新上传'
            );
          }
        } else {
          clearMaterialUploadSession(sessionUserId);
        }
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [loadCapturedImages, markMaterialUploadPlaceholderFailed, prependUploadedMaterials, removeMaterialUploadPlaceholder, updateMaterialUploadPlaceholder, upsertMaterialUploadPlaceholder, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const cachedProcessingTasks = getCachedTasks()
      .filter((task) => task.status === '处理中' && task.orderId)
      .slice(0, 20);
    if (cachedProcessingTasks.length === 0) return;

    trackedProcessingOrdersRef.current = {
      ...trackedProcessingOrdersRef.current,
      ...Object.fromEntries(cachedProcessingTasks.map((task) => [task.orderId as string, task.time || Date.now()])),
    };
    setHasProcessingOrders(true);
    void loadOrderResults({ silent: true });
  }, [loadOrderResults, user?.id]);

  useEffect(() => {
    if (!user?.id || hasLoadedOrderResultsRef.current) return;
    const timerId = window.setTimeout(() => {
      void loadOrderResults({ silent: true });
    }, 500);
    return () => window.clearTimeout(timerId);
  }, [loadOrderResults, user?.id]);

  useEffect(() => {
    clearSelectionState();
    const materialViewKey = `${materialScope}:${materialFilter}`;
    const cachedPagination = prefetchedMaterialPaginationRef.current.get(materialViewKey);
    if (hasLoadedMaterialsRef.current && cachedPagination) {
      setMaterialsPagination(cachedPagination);
      return;
    }
    void loadCapturedImages({ preserveCurrent: hasLoadedMaterialsRef.current });
  }, [clearSelectionState, loadCapturedImages, materialFilter, materialScope]);

  useEffect(() => {
    if (!user?.id || materialFilter !== 'all' || !hasLoadedMaterialsRef.current) return;
    void prefetchMaterialScope('favorite');
  }, [capturedImages.length, materialFilter, prefetchMaterialScope, user?.id]);

  useEffect(() => {
    const handleTaskUpdate = () => {
      void loadOrderResults();
    };

    window.addEventListener('taskHistoryUpdated', handleTaskUpdate);
    return () => window.removeEventListener('taskHistoryUpdated', handleTaskUpdate);
  }, [loadOrderResults]);

  useEffect(() => {
    if (orderResults.length === 0) return;

    const urls = orderResults
      .map((image) => getDisplayImageUrl(image.thumbnailUrl || image.imageUrl))
      .filter((url) => url && !preloadedOrderThumbnailUrlsRef.current.has(url))
      .slice(0, 80);

    for (const url of urls) {
      preloadedOrderThumbnailUrlsRef.current.add(url);
      const img = new window.Image();
      img.decoding = 'async';
      img.src = url;
    }
  }, [orderResults]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    if (!hasProcessingOrders) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadOrderResults({ silent: true });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [hasProcessingOrders, loadOrderResults, user?.id]);

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
      if (isCompactActionBar || !container || selectedImageList.length === 0) {
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

      const preferredCenterX = (bounds.left + bounds.right) / 2;
      const expectedPanelWidth = Math.min(
        window.innerWidth - 24,
        showAiPromptPanel ? 760 : 500
      );
      const minCenterX = expectedPanelWidth / 2 + 12;
      const maxCenterX = window.innerWidth - expectedPanelWidth / 2 - 12;
      const clampedCenterX = Math.min(Math.max(preferredCenterX, minCenterX), Math.max(minCenterX, maxCenterX));
      const expectedPanelHeight = showAiPromptPanel ? 520 : 220;
      const preferredTop = bounds.bottom + 16;
      const maxTop = Math.max(12, window.innerHeight - expectedPanelHeight - 12);
      const top = Math.min(Math.max(preferredTop, 12), maxTop);
      const centerX = clampedCenterX;
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
  }, [isCompactActionBar, selectedImageList, showAiPromptPanel]);

  return (
    <div className={`flex-1 px-6 py-8 overflow-y-auto ${isCompactActionBar && selectedImageList.length > 0 ? 'pb-40' : ''}`}>
      {imageEditor.open && imageEditor.mode === 'crop' && (
        <CropEditorPanel
          imageUrl={imageEditor.imageUrl}
          destination={imageEditor.destination}
          orderNumber={imageEditor.orderNumber}
          toolLabel={imageEditor.toolLabel}
          sourceImageUrl={imageEditor.sourceImageUrl}
          onClose={closeImageEditor}
          onComplete={handleEditorComplete}
        />
      )}

      {showLocalEdit && localEditImageUrl && (
        <LocalEditPanel imageUrl={localEditImageUrl} onClose={closeLocalEdit} onComplete={handleLocalEditComplete} />
      )}

      {duplicateReview.open && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/68 px-4 backdrop-blur-sm">
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
                              <div className="relative h-full w-full">
                                <SafeImage
                                  src={displayImageUrl}
                                  alt={`重复图片 ${imageIndex + 1}`}
                                  fill
                                  sizes="(max-width: 1024px) 50vw, 20vw"
                                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                />
                              </div>
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
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.045] p-1">
            {([
              ['gallery', '图库'],
              ['orders', '订单'],
            ] as Array<[LibraryView, string]>).map(([view, label]) => (
              <button
                key={view}
                onClick={() => {
                  if (view === libraryView) return;
                  clearSelectionState();
                  closeDropdowns();
                  setLibraryView(view);
                  if (view === 'orders' && !hasLoadedOrderResultsRef.current) {
                    void loadOrderResults();
                  }
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${libraryView === view ? 'bg-white/16 text-white shadow-[0_8px_22px_rgba(255,255,255,0.06)]' : 'text-white/48 hover:text-white/78'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (libraryView === 'gallery') {
                fileInputRef.current?.click();
                return;
              }
              void loadOrderResults();
            }}
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-white/78 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition-all hover:-translate-y-0.5 hover:border-purple-300/25 hover:bg-gradient-to-r hover:from-purple-600 hover:to-blue-600 hover:text-white"
            title={libraryView === 'gallery' ? '上传本地素材' : '刷新订单记录'}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/12 text-lg leading-none transition-colors group-hover:bg-white/20">{libraryView === 'gallery' ? '+' : '↻'}</span>
            {libraryView === 'gallery' ? '上传素材' : '刷新订单'}
          </button>
        </div>

        <div className="relative z-10 mb-5 rounded-[1.8rem] border border-white/[0.08] bg-black/28 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.2)] backdrop-blur-2xl ring-1 ring-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={`flex min-w-0 flex-1 items-center gap-2 pb-1 ${libraryView === 'gallery' ? 'overflow-x-auto' : 'overflow-visible'}`}>
              {libraryView === 'gallery' ? (
                <>
                  {([
                    ['all', '全部'],
                    ['favorite', '收藏'],
                    ['uncategorized', '未分类'],
                  ] as Array<[MaterialScope, string]>).map(([scope, label]) => (
                    <button
                      type="button"
                      key={scope}
                      onClick={() => handleMaterialScopeChange(scope)}
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-xs transition-all ${materialScope === scope ? 'border-white/18 bg-white/16 text-white shadow-[0_8px_22px_rgba(255,255,255,0.06)]' : 'border-white/[0.07] bg-white/[0.045] text-white/48 hover:bg-white/[0.08] hover:text-white/78'}`}
                    >
                      {label}{materialScope === scope && galleryTotalCount > 0 ? <span className="ml-1 text-white/32">{galleryTotalCount}</span> : null}
                    </button>
                  ))}
                  <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />
                  {materialFolders.map((folder) => {
                    const scope = `folder:${folder.id}` as MaterialScope;
                    return (
                      <button
                        type="button"
                        key={folder.id}
                        onClick={() => handleMaterialScopeChange(scope)}
                        className={`shrink-0 rounded-full border px-3.5 py-2 text-xs transition-all ${materialScope === scope ? 'border-blue-300/28 bg-blue-400/18 text-blue-50 shadow-[0_10px_26px_rgba(59,130,246,0.12)]' : 'border-white/[0.07] bg-white/[0.045] text-white/48 hover:bg-white/[0.08] hover:text-white/78'}`}
                      >
                        {folder.name}{materialScope === scope && galleryTotalCount > 0 ? <span className="ml-1 text-white/32">{galleryTotalCount}</span> : null}
                      </button>
                    );
                  })}
                </>
              ) : (
                <QuickCreateDropdown
                  dropdownId="tool-filter"
                  label={undefined}
                  value={toolFilter}
                  options={toolFilterOptions}
                  isOpen={openDropdownId === 'tool-filter'}
                  onToggle={toggleDropdown}
                  onSelect={(value) => {
                    setToolFilter(value);
                    closeDropdowns();
                  }}
                  menuWidthClassName="min-w-[180px]"
                />
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {libraryView === 'gallery' && selectedCapturedImages.length > 0 && (
                <QuickCreateDropdown
                  dropdownId="move-materials"
                  value=""
                  placeholder="移动到..."
                  options={moveMaterialOptions}
                  isOpen={openDropdownId === 'move-materials'}
                  onToggle={toggleDropdown}
                  onSelect={(value) => {
                    closeDropdowns();
                    void moveSelectedMaterials(value);
                  }}
                  buttonClassName="h-8 px-3 text-white/62 shadow-none hover:text-white"
                  menuWidthClassName="min-w-[168px]"
                  showSelectedCheck={false}
                />
              )}
              {libraryView === 'gallery' && showNewFolderInput && (
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
              {libraryView === 'gallery' && (
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
              )}
            </div>
          </div>

          {libraryView === 'gallery' && activeFolder && (
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
            {libraryView === 'gallery'
              ? `当前显示 ${galleryLoadedCount}${galleryTotalCount > galleryLoadedCount ? ` / ${galleryTotalCount}` : ''} 张`
              : `当前显示 ${filteredOrderResults.length} 条`}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="hidden items-center gap-2 rounded-full bg-white/[0.025] px-2.5 py-1.5 text-[11px] text-white/38 transition hover:bg-white/[0.05] hover:text-white/58 lg:flex" title={`缩略图大小：${thumbnailSize}px`}>
              <svg className="h-3.5 w-3.5 text-white/32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />
              </svg>
              <span className="select-none text-white/34">小</span>
              <input
                type="range"
                min="170"
                max="360"
                step="10"
                value={thumbnailSize}
                onChange={(event) => setThumbnailSize(Number(event.target.value))}
                className="zaomeng-subtle-range w-20"
              />
              <span className="select-none text-white/34">大</span>
            </label>

            {libraryView === 'gallery' && duplicateImageCount > 0 && (
              <button
                onClick={openDuplicateReview}
                disabled={processingAction !== null}
                className="rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-white/42 transition-colors hover:border-red-300/25 hover:bg-red-500/16 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除已加载重复
              </button>
            )}

            {selectedImageList.length > 0 && (
              <button
                onClick={() => void deleteSelectedImages()}
                disabled={processingAction !== null || deletingOrderNumber !== null}
                className="rounded-full border border-red-300/10 bg-red-500/10 px-3 py-2 text-xs text-red-100/72 transition-colors hover:bg-red-500/22 hover:text-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除所选
              </button>
            )}

              <QuickCreateDropdown
                dropdownId="material-filter"
                label="日期"
                value={materialFilter}
                options={MATERIAL_FILTER_OPTIONS}
                isOpen={openDropdownId === 'material-filter'}
                onToggle={toggleDropdown}
                onSelect={(value) => {
                  setMaterialFilter(value as MaterialFilter);
                  closeDropdowns();
                }}
              />
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

        <input
          ref={aiReferenceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleAiReferenceUpload}
          className="hidden"
        />

        {libraryView === 'gallery' && isLoadingMaterials && capturedImages.length === 0 ? (
          <div className="rounded-[2rem] border border-white/[0.08] bg-white/[0.025] p-14 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-purple-300/80" />
            <p className="text-base font-medium text-white/70">素材加载中...</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/40">正在按当前文件夹和日期筛选加载第一页素材。</p>
          </div>
        ) : isLibraryEmpty ? (
          <div className="rounded-[2rem] border border-white/[0.08] bg-white/[0.025] p-14 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] text-white/36">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M5 20h14a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <p className="text-base font-medium text-white/70">
              {libraryView === 'gallery'
                ? (galleryTotalCount === 0 && materialScope === 'all' && materialFilter === 'all' ? '素材库还是空的' : '当前视图没有素材')
                : '当前筛选下没有订单记录'}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/40">
              {libraryView === 'gallery'
                ? (galleryTotalCount === 0 && materialScope === 'all' && materialFilter === 'all'
                  ? '可以通过浏览器插件采集图片，也可以上传本地图片开始整理。'
                  : '试试切换文件夹、收藏或日期筛选，或者清空当前筛选条件。')
                : '可以切换筛选条件，或点击右上角刷新订单记录。'}
            </p>
            {libraryView === 'gallery' && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-6 rounded-full bg-white/10 px-4 py-2 text-sm text-white/72 transition-colors hover:bg-white/16 hover:text-white"
              >
                上传素材
              </button>
            )}
          </div>
        ) : (
          <div className="mb-8 space-y-10">
            {hasMaterialUploadPlaceholders && (
              <section>
                <div className="mb-5 flex items-center gap-3">
                  <h3 className="text-xl font-semibold text-white">正在加入素材库</h3>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/45">
                    {visibleMaterialUploadPlaceholders.length} 张
                  </span>
                </div>

                <div className="flex items-start justify-center" style={{ gap: `${thumbnailGap}px` }}>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <div
                      key={`upload-placeholder-${columnIndex}`}
                      className="min-w-0 space-y-5"
                      style={{ width: `${thumbnailSize}px`, maxWidth: `${thumbnailSize}px` }}
                    >
                      {visibleMaterialUploadPlaceholders
                        .filter((_, index) => index % columnCount === columnIndex)
                        .map((placeholder) => {
                          const isFailed = placeholder.status === 'failed';
                          return (
                            <div
                              key={placeholder.id}
                              data-selection-card="true"
                              className={`relative w-full overflow-hidden rounded-[1.35rem] border bg-black/24 ${isFailed ? 'border-red-300/28' : 'border-white/10'}`}
                            >
                              <div className="relative aspect-square w-full overflow-hidden bg-white/[0.035]">
                                {placeholder.previewUrl ? (
                                  <img
                                    src={placeholder.previewUrl}
                                    alt={placeholder.fileName}
                                    className={`h-full w-full object-cover ${isFailed ? 'opacity-45' : 'opacity-64'}`}
                                  />
                                ) : (
                                  <div className="h-full w-full bg-[linear-gradient(115deg,rgba(255,255,255,0.04),rgba(255,255,255,0.11),rgba(255,255,255,0.04))] bg-[length:220%_100%] animate-[zaomeng-upload-shimmer_1.3s_ease-in-out_infinite]" />
                                )}
                                {!isFailed && (
                                  <div className="absolute inset-0 bg-black/18 backdrop-blur-[1px]" />
                                )}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  {isFailed ? (
                                    <div className="rounded-full border border-red-200/22 bg-red-500/18 px-3 py-1.5 text-xs font-medium text-red-50/86">
                                      上传失败
                                    </div>
                                  ) : (
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/14 bg-black/36 backdrop-blur-md">
                                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/18 border-t-white/78" />
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="space-y-1 px-3 py-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-xs font-medium ${isFailed ? 'text-red-100/80' : 'text-white/72'}`}>
                                    {getMaterialUploadPlaceholderLabel(placeholder.status)}
                                  </span>
                                  <span className="text-[11px] text-white/34">
                                    {formatMaterialTime(placeholder.createdAt)}
                                  </span>
                                </div>
                                <p className="truncate text-xs text-white/38" title={placeholder.fileName}>
                                  {placeholder.message || placeholder.fileName}
                                </p>
                                {isFailed && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void retryMaterialUploadPlaceholder(placeholder);
                                    }}
                                    className="mt-2 w-full rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/76 transition-colors hover:border-white/22 hover:bg-white/[0.12] hover:text-white"
                                  >
                                    {placeholder.key ? '重试入库' : '重新上传'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(libraryView === 'gallery' ? groupedMaterials : groupedOrderResults).map((group) => {
              const groupColumns = (() => {
                const columns = Array.from({ length: columnCount }, () => ({
                  items: [] as Array<CapturedImageRecord | OrderResultCard>,
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
                      {group.items.length} {libraryView === 'gallery' ? '张素材' : '条记录'}
                    </span>
                  </div>

                  <div className="flex items-start justify-center" onClick={handleMasonryBlankClick} style={{ gap: `${thumbnailGap}px` }}>
                    {groupColumns.map((column, columnIndex) => (
                      <div
                        key={`${group.key}-${columnIndex}`}
                        className="min-w-0 space-y-5"
                        style={{ width: `${thumbnailSize}px`, maxWidth: `${thumbnailSize}px` }}
                      >
                        {column.map((image, index) => {
                          const displayImageUrl = getDisplayImageUrl(image.imageUrl);
                          const displayThumbnailUrl = getDisplayImageUrl(image.thumbnailUrl || image.imageUrl);
                          const selected = selectedImages.has(image.imageUrl);
                          const imageFailed = failedImageUrls.has(image.imageUrl);
                          const cardIndex = columnIndex * 100 + index;
                          const isOrderCard = 'orderNumber' in image;
                          const isSelectable = !isOrderCard || image.isResultImage;
                          const canDeleteOrder = isOrderCard && image.statusLabel !== '处理中';
                          const orderStatusClass = isOrderCard ? getOrderStatusClass(image.statusLabel) : '';
                          const imageRatio = imageAspectRatios[image.imageUrl] ?? 1;
                          const compactCardControls = thumbnailSize < 240 || thumbnailSize * imageRatio < 180;
                          const cardControlSizeClass = compactCardControls ? 'h-7 w-7' : 'h-8 w-8';
                          const cardControlIconClass = compactCardControls ? 'h-3.5 w-3.5' : 'h-4 w-4';
                          const cardControlWrapClass = compactCardControls
                            ? 'right-2 top-2 max-w-[calc(100%-1rem)] flex-row flex-wrap justify-end gap-1.5'
                            : 'right-3 top-3 flex-col gap-2';
                          const actionControlsVisibilityClass = canHoverCardControls
                            ? 'opacity-0 transition-all group-hover:opacity-100'
                            : selected
                              ? 'opacity-100 transition-all'
                              : 'pointer-events-none opacity-0 transition-all';
                          const idleCardClass = isSelectable
                            ? 'border-white/10 hover:border-white/30 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(15,23,42,0.35)]'
                            : 'border-white/10';
                          const accentClass = cardIndex % 7 === 0
                            ? 'before:absolute before:inset-0 before:border before:border-purple-400/20 before:rounded-[1.2rem] before:pointer-events-none'
                            : '';

                          return (
                            <div
                              key={image.id}
                              data-selection-card="true"
                              ref={(node) => {
                                imageButtonRefs.current[image.imageUrl] = node;
                              }}
                              onClick={() => {
                                if (!isSelectable) return;
                                toggleImageSelection(image.imageUrl);
                              }}
                              className={`group relative w-full overflow-hidden rounded-[1.35rem] border transition-all ${accentClass} ${isSelectable ? 'cursor-pointer' : 'cursor-default'} ${selected ? 'border-purple-500 ring-2 ring-purple-500/50 shadow-[0_0_0_1px_rgba(168,85,247,0.25),0_24px_50px_rgba(76,29,149,0.28)] -translate-y-1' : idleCardClass}`}
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
                                  <div
                                    className="relative w-full overflow-hidden"
                                    style={{ aspectRatio: `${1 / imageRatio}` }}
                                  >
                                    <SafeImage
                                      key={`${image.imageUrl}-${imageRetryTokens[image.imageUrl] || 0}`}
                                      src={displayThumbnailUrl}
                                      alt={`素材图片 ${cardIndex + 1}`}
                                      fill
                                      sizes={`(max-width: 768px) 50vw, ${thumbnailSize}px`}
                                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                      onLoad={(event) => {
                                        clearImageRetryState(image.imageUrl);
                                        recordImageMetrics(image.imageUrl, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                                      }}
                                      onError={() => {
                                        scheduleImageRetry(image.imageUrl);
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/62 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                              <div className="absolute inset-x-0 bottom-0 h-24 pointer-events-none bg-gradient-to-t from-black/68 to-transparent opacity-75" />
                              {isOrderCard && (
                                <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-11.5rem)] flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-white/16 bg-black/58 px-2.5 py-1 text-[11px] font-medium text-white/86 backdrop-blur-md">
                                    {image.toolLabel}
                                  </span>
                                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${orderStatusClass}`}>
                                    {image.statusLabel}
                                  </span>
                                </div>
                              )}
                              {selected && isSelectable && (
                                <div className={`absolute z-10 flex h-7 w-7 items-center justify-center rounded-full bg-purple-500 text-white shadow-lg ring-4 ring-purple-500/18 ${isOrderCard ? 'left-3 top-12' : 'left-3 top-3'}`}>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                               <div className={`absolute z-20 flex ${cardControlWrapClass} ${actionControlsVisibilityClass}`}>
                                {isOrderCard && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void deleteOrderRecord(image);
                                    }}
                                    disabled={!canDeleteOrder || deletingOrderNumber === image.orderNumber}
                                    className={`inline-flex ${cardControlSizeClass} items-center justify-center rounded-full border border-red-300/20 bg-red-500/18 text-red-50/80 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-red-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40`}
                                    title={canDeleteOrder ? '删除订单记录' : '处理中订单不能删除'}
                                  >
                                    <svg className={cardControlIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                                {!isOrderCard && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void removeUploadedImage(image);
                                      }}
                                      className={`inline-flex ${cardControlSizeClass} items-center justify-center rounded-full border border-red-300/20 bg-red-500/18 text-red-50/80 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-red-500/40 hover:text-white`}
                                      title="删除图片"
                                    >
                                      <svg className={cardControlIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void toggleMaterialFavorite(image);
                                      }}
                                      className={`inline-flex ${cardControlSizeClass} items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 ${image.isFavorite ? 'border-amber-200/60 bg-amber-400 text-black opacity-100' : 'border-white/15 bg-black/55 text-white/75 hover:bg-white/18 hover:text-white'}`}
                                      title={image.isFavorite ? '取消收藏' : '加入收藏'}
                                    >
                                      <svg className={cardControlIconClass} fill={image.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.6.6 0 011.04 0l2.2 4.459a.6.6 0 00.452.328l4.92.715a.6.6 0 01.333 1.024l-3.56 3.47a.6.6 0 00-.173.531l.84 4.9a.6.6 0 01-.87.632l-4.4-2.313a.6.6 0 00-.558 0l-4.4 2.313a.6.6 0 01-.87-.632l.84-4.9a.6.6 0 00-.173-.53l-3.56-3.471A.6.6 0 013.9 9.001l4.92-.715a.6.6 0 00.452-.328l2.208-4.459z" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                                {(!isOrderCard || image.isResultImage) && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (isOrderCard) {
                                        void downloadOrderImage(image);
                                        return;
                                      }
                                      void downloadMaterialImage(image);
                                    }}
                                    className={`inline-flex ${cardControlSizeClass} items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/18 hover:text-white`}
                                    title="下载图片"
                                  >
                                    <svg className={cardControlIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                    </svg>
                                  </button>
                                )}
                                {(!isOrderCard || image.isResultImage) && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      previewMaterialImage(image.imageUrl);
                                    }}
                                    className={`inline-flex ${cardControlSizeClass} items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 shadow-lg backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/18 hover:text-white`}
                                    title="查看大图"
                                  >
                                    <svg className={cardControlIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l-6-6m12 6l6-6M9 15l-6 6m12-6l6 6" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              <div className="absolute left-3 bottom-3 text-left opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-[11px] tracking-[0.18em] uppercase text-white/55">{isOrderCard ? 'Order' : 'Material'}</p>
                                <p className="text-sm text-white/85 mt-1">{isOrderCard ? image.description : `素材 ${cardIndex + 1}`}</p>
                                <p className="text-[11px] text-white/50 mt-1">
                                  {formatMaterialDateLabel(image.createdAt)}
                                  <span className="mx-1 text-white/35">·</span>
                                  {formatMaterialTime(image.createdAt)}
                                  {isOrderCard
                                    ? ` · ${image.orderNumber}${image.sourceImageUrl ? ' · 有参考图' : ''}`
                                    : `${(image.imageType || 'main') ? ` · ${(image.imageType || 'main') === 'detail' ? '明细图' : '主图'}` : ''}${image.sourceHost ? ` · ${image.sourceHost}` : ''}`}
                                </p>
                                {isOrderCard && (
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/42">
                                    <span>{image.toolLabel}</span>
                                    <span className="text-white/25">/</span>
                                    <span>{image.statusLabel}</span>
                                    {!image.isResultImage && image.sourceImageUrl && (
                                      <>
                                        <span className="text-white/25">/</span>
                                        <span>等待结果图</span>
                                      </>
                                    )}
                                  </div>
                                )}
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

        {libraryView === 'gallery' && !isLoadingMaterials && !isLibraryEmpty && materialsPagination.hasMore && (
          <div className="mb-10 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMoreCapturedImages()}
              disabled={isLoadingMoreMaterials}
              className="rounded-full border border-white/[0.1] bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-white/66 transition-all hover:-translate-y-0.5 hover:border-purple-300/25 hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingMoreMaterials ? '加载中...' : `加载更多（${galleryLoadedCount}/${galleryTotalCount}）`}
            </button>
          </div>
        )}

        {selectedImageList.length > 0 && (actionBarPosition || isCompactActionBar) && (
          <div
            data-role="selection-action-bar"
            className={`pointer-events-none transition-all duration-150 ${isCompactActionBar ? 'fixed inset-x-3 bottom-4 z-40' : 'fixed z-40'}`}
            style={isCompactActionBar || !actionBarPosition ? undefined : {
              top: actionBarPosition.top,
              left: actionBarPosition.left,
              transform: 'translateX(-50%)',
            }}
          >
            {!isCompactActionBar && (
              <div className="pointer-events-none absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-l border-t border-white/12 bg-black/78 backdrop-blur-2xl" />
            )}
            <div className={`pointer-events-auto rounded-[1.7rem] border border-white/12 bg-black/82 backdrop-blur-2xl shadow-[0_18px_44px_rgba(0,0,0,0.42),0_6px_20px_rgba(88,28,135,0.2)] ring-1 ring-white/5 transition-all ${isCompactActionBar ? 'max-h-[72vh] w-full overflow-y-auto px-3 py-3' : `max-w-[calc(100vw-24px)] px-4 py-4 ${showAiPromptPanel ? 'w-[min(760px,calc(100vw-24px))]' : 'w-[min(500px,calc(100vw-24px))]'}`}`}>
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
                  <span className="text-[11px] text-white/32">单选编辑</span>
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
                      title={action.points ? `默认 2k 预计扣除 ${formatPointsLabel(action.points)}` : undefined}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span>{action.label}</span>
                        {action.points ? (
                          <span className="rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                            <PointsIconLabel points={action.points} iconClassName="h-3 w-3" />
                          </span>
                        ) : null}
                      </span>
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
                                <div key={`${imageUrl}-${index}`} className="relative h-14 w-14 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                                  <SafeImage
                                    key={`${imageUrl}-${imageRetryTokens[imageUrl] || 0}`}
                                    src={getDisplayImageUrl(imageUrl)}
                                    alt={`已选素材 ${index + 1}`}
                                    fill
                                    sizes="56px"
                                    className="object-cover"
                                    onLoad={(event) => {
                                      clearImageRetryState(imageUrl);
                                      recordImageMetrics(imageUrl, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                                    }}
                                    onError={() => {
                                      scheduleImageRetry(imageUrl);
                                    }}
                                  />
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
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        void submitAiGenerate();
                      }}
                      placeholder="请输入 AI 生图提示词"
                      className="w-full min-h-[108px] rounded-2xl border border-white/12 bg-white/6 px-4 py-3 pb-14 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/35"
                    />

                    <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <QuickCreateDropdown
                          dropdownId="ai-aspect-ratio"
                          label="比例"
                          value={aiAspectRatio}
                          options={AI_ASPECT_RATIO_OPTIONS}
                          isOpen={openDropdownId === 'ai-aspect-ratio'}
                          onToggle={toggleDropdown}
                          onSelect={(value) => {
                            if (isSmartEditAspectRatioOption(value)) {
                              setAiAspectRatio(value);
                            }
                            closeDropdowns();
                          }}
                          direction="up"
                          buttonClassName="rounded-xl bg-black/35 px-3 py-2 text-sm shadow-none"
                          menuWidthClassName="min-w-[148px]"
                        />

                        <QuickCreateDropdown
                          dropdownId="ai-resolution"
                          label="清晰度"
                          value={aiResolution}
                          options={AI_RESOLUTION_OPTIONS}
                          isOpen={openDropdownId === 'ai-resolution'}
                          onToggle={toggleDropdown}
                          onSelect={(value) => {
                            if (isSmartEditResolution(value)) {
                              setAiResolution(value);
                            }
                            closeDropdowns();
                          }}
                          direction="up"
                          buttonClassName="rounded-xl bg-black/35 px-3 py-2 text-sm shadow-none"
                          menuWidthClassName="min-w-[160px]"
                        />
                      </div>

                      <button
                        onClick={submitAiGenerate}
                        disabled={processingAction !== null}
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {processingAction === 'ai-generate' ? '提交中...' : (
                          <span className="inline-flex items-center gap-1.5">
                            <span>开始AI生图</span>
                            <span className="text-white/50">·</span>
                            <PointsIconLabel points={aiGenerateTotalPoints} iconClassName="h-3.5 w-3.5" />
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-3 border-t border-white/[0.06] pt-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white/32">多选编辑</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {galleryActions.map((action) => {
                    const totalPoints = getActionTotalPoints(action, aiResolution, selectedImageList.length);
                    return (
                      <button
                        key={action.id}
                        onClick={() => {
                          if (action.id === 'ai-generate') {
                            closeDropdowns();
                            setShowAiPromptPanel((current) => !current);
                            return;
                          }
                          void handleRunAction(action.id);
                        }}
                        disabled={processingAction !== null}
                        className={`min-w-[88px] px-3.5 py-2 rounded-full text-sm font-medium transition-all bg-white/9 text-white/82 hover:-translate-y-0.5 hover:bg-gradient-to-r hover:from-purple-600 hover:to-blue-600 hover:text-white hover:shadow-[0_10px_24px_rgba(109,40,217,0.28)] disabled:cursor-not-allowed ${processingAction !== null && processingAction !== action.id ? 'opacity-35' : 'disabled:opacity-50'} ${showAiPromptPanel && action.id === 'ai-generate' ? 'ring-2 ring-fuchsia-400/60 bg-fuchsia-500/16 text-white' : ''}`}
                        title={totalPoints ? `本次预计扣除 ${formatPointsLabel(totalPoints)}` : undefined}
                      >
                        {processingAction === action.id ? '提交中...' : (
                          <span className="inline-flex items-center gap-1.5">
                            <span>{action.label}</span>
                            {totalPoints ? (
                              <span className="rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                                <PointsIconLabel points={totalPoints} iconClassName="h-3 w-3" />
                              </span>
                            ) : null}
                          </span>
                        )}
                      </button>
                    );
                  })}
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
          <div className="relative flex h-[90vh] w-[92vw] max-w-[92vw] items-center justify-center" onClick={() => setPreviewImageUrl(null)}>
            <SafeImage
              src={previewImageUrl}
              alt="素材大图预览"
              fill
              sizes="92vw"
              className="pointer-events-none rounded-2xl object-contain shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
