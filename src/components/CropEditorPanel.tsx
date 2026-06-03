'use client';

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image, { type ImageLoaderProps, type ImageProps } from 'next/image';
import { showToast } from '@/lib/toast';
import { toUserFacingErrorFromUnknown, toUserFacingErrorMessage } from '@/lib/userFacingError';

type AspectRatio = 'free' | 'original' | '1:1' | '3:4' | '4:3' | '4:5' | '9:16' | '16:9';
type CropHandle = 'move' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type OutputSizeMode = 'crop' | 'custom';

type CropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  imageUrl: string;
  destination?: 'gallery' | 'orders';
  orderNumber?: string;
  toolLabel?: string;
  sourceImageUrl?: string | null;
  onClose: () => void;
  onComplete: (resultUrl: string) => void | Promise<void>;
};

const aspectRatios: Array<[AspectRatio, string]> = [
  ['free', '自由'],
  ['original', '原图'],
  ['1:1', '1:1'],
  ['3:4', '3:4'],
  ['4:3', '4:3'],
  ['4:5', '4:5'],
  ['9:16', '9:16'],
  ['16:9', '16:9'],
];

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;
const CROP_SNAP_THRESHOLD = 0.8;

const SafeImage = forwardRef<HTMLImageElement, Omit<ImageProps, 'loader'>>(function SafeImage({ alt, ...props }, ref) {
  return <Image {...props} alt={alt} ref={ref} loader={passthroughImageLoader} unoptimized />;
});

function getRatioValue(aspectRatio: AspectRatio, naturalSize?: { width: number; height: number }): number | null {
  if (aspectRatio === 'original') {
    return naturalSize && naturalSize.width > 0 && naturalSize.height > 0 ? naturalSize.width / naturalSize.height : null;
  }
  if (aspectRatio === '1:1') return 1;
  if (aspectRatio === '3:4') return 3 / 4;
  if (aspectRatio === '4:3') return 4 / 3;
  if (aspectRatio === '4:5') return 4 / 5;
  if (aspectRatio === '9:16') return 9 / 16;
  if (aspectRatio === '16:9') return 16 / 9;
  return null;
}

function fitCropToAspectRatio(crop: CropBox, aspectRatio: AspectRatio, naturalSize?: { width: number; height: number }): CropBox {
  const ratio = getRatioValue(aspectRatio, naturalSize);
  if (!ratio) return crop;

  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let safeWidth = Math.min(crop.width, 88);
  let safeHeight = safeWidth / ratio;

  if (safeHeight > 88) {
    safeHeight = 88;
    safeWidth = safeHeight * ratio;
  }

  if (safeWidth > 100) {
    safeWidth = 100;
    safeHeight = safeWidth / ratio;
  }

  if (safeHeight > 100) {
    safeHeight = 100;
    safeWidth = safeHeight * ratio;
  }

  return {
    x: Math.max(0, Math.min(100 - safeWidth, centerX - safeWidth / 2)),
    y: Math.max(0, Math.min(100 - safeHeight, centerY - safeHeight / 2)),
    width: safeWidth,
    height: safeHeight,
  };
}

function clampCrop(crop: CropBox): CropBox {
  const width = Math.max(1, Math.min(100, crop.width));
  const height = Math.max(1, Math.min(100, crop.height));
  return {
    x: Math.max(0, Math.min(100 - width, crop.x)),
    y: Math.max(0, Math.min(100 - height, crop.y)),
    width,
    height,
  };
}

function snapValue(value: number, targets: number[], threshold = CROP_SNAP_THRESHOLD) {
  const target = targets.find((item) => Math.abs(value - item) <= threshold);
  return typeof target === 'number' ? target : value;
}

function snapCropToGuides(crop: CropBox): CropBox {
  const clamped = clampCrop(crop);
  const centerX = clamped.x + clamped.width / 2;
  const centerY = clamped.y + clamped.height / 2;
  let nextX = clamped.x;
  let nextY = clamped.y;

  const snappedLeft = snapValue(clamped.x, [0]);
  if (snappedLeft !== clamped.x) {
    nextX = snappedLeft;
  }

  const snappedRight = snapValue(clamped.x + clamped.width, [100]);
  if (snappedRight !== clamped.x + clamped.width) {
    nextX = snappedRight - clamped.width;
  }

  const snappedCenterX = snapValue(centerX, [50]);
  if (snappedCenterX !== centerX) {
    nextX = snappedCenterX - clamped.width / 2;
  }

  const snappedTop = snapValue(clamped.y, [0]);
  if (snappedTop !== clamped.y) {
    nextY = snappedTop;
  }

  const snappedBottom = snapValue(clamped.y + clamped.height, [100]);
  if (snappedBottom !== clamped.y + clamped.height) {
    nextY = snappedBottom - clamped.height;
  }

  const snappedCenterY = snapValue(centerY, [50]);
  if (snappedCenterY !== centerY) {
    nextY = snappedCenterY - clamped.height / 2;
  }

  return clampCrop({ ...clamped, x: nextX, y: nextY });
}

function normalizeSignedRotation(rotation: number) {
  const normalized = ((rotation + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function getRotatedBoundingSize(size: { width: number; height: number }, rotation: number) {
  if (size.width <= 0 || size.height <= 0) {
    return { width: 0, height: 0 };
  }

  const radians = (Math.abs(normalizeSignedRotation(rotation)) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

export default function CropEditorPanel({ imageUrl, destination = 'gallery', orderNumber, toolLabel, sourceImageUrl, onClose, onComplete }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStateRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    origin: CropBox;
  } | null>(null);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('free');
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 12, y: 12, width: 76, height: 76 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [outputSizeMode, setOutputSizeMode] = useState<OutputSizeMode>('crop');
  const [customOutputWidth, setCustomOutputWidth] = useState('');
  const [customOutputHeight, setCustomOutputHeight] = useState('');
  const [lockOutputRatio, setLockOutputRatio] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  const rotatedSize = useMemo(() => {
    return getRotatedBoundingSize(naturalSize, rotation);
  }, [naturalSize, rotation]);

  const previewAspectRatio = rotatedSize.width > 0 && rotatedSize.height > 0
    ? `${rotatedSize.width} / ${rotatedSize.height}`
    : '1 / 1';

  const rotatedImageStyle = useMemo(() => {
    const widthPercent = rotatedSize.width > 0 ? (naturalSize.width / rotatedSize.width) * 100 : 100;
    const heightPercent = rotatedSize.height > 0 ? (naturalSize.height / rotatedSize.height) * 100 : 100;
    const baseTransform = [
      'translate(-50%, -50%)',
      `rotate(${rotation}deg)`,
      `scale(${scale})`,
      `scaleX(${flipHorizontal ? -1 : 1})`,
      `scaleY(${flipVertical ? -1 : 1})`,
    ].join(' ');

    return {
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      transform: baseTransform,
    };
  }, [flipHorizontal, flipVertical, naturalSize.height, naturalSize.width, rotatedSize.height, rotatedSize.width, rotation, scale]);

  const cropPixelSize = useMemo(() => {
    if (naturalSize.width <= 0 || naturalSize.height <= 0) {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.max(1, Math.round((crop.width / 100) * naturalSize.width)),
      height: Math.max(1, Math.round((crop.height / 100) * naturalSize.height)),
    };
  }, [crop.height, crop.width, naturalSize.height, naturalSize.width]);

  const resolvedOutputSize = useMemo(() => {
    if (outputSizeMode === 'custom') {
      const width = Number(customOutputWidth);
      const height = Number(customOutputHeight);
      const hasWidth = Number.isFinite(width) && width > 0;
      const hasHeight = Number.isFinite(height) && height > 0;

      if (hasWidth && hasHeight) {
        return {
          width: Math.round(width),
          height: Math.round(height),
          isCustom: true,
        };
      }
    }

    return {
      width: cropPixelSize.width,
      height: cropPixelSize.height,
      isCustom: false,
    };
  }, [cropPixelSize.height, cropPixelSize.width, customOutputHeight, customOutputWidth, outputSizeMode]);

  const cropIsCentered = useMemo(() => {
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    return Math.abs(centerX - 50) <= 0.4 && Math.abs(centerY - 50) <= 0.4;
  }, [crop.height, crop.width, crop.x, crop.y]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  const resetCrop = useCallback(() => {
    markDirty();
    setAspectRatio('free');
    setScale(1);
    setRotation(0);
    setFlipHorizontal(false);
    setFlipVertical(false);
    setCrop({ x: 12, y: 12, width: 76, height: 76 });
    setOutputSizeMode('crop');
    setCustomOutputWidth('');
    setCustomOutputHeight('');
    setLockOutputRatio(true);
  }, [markDirty]);

  const rotateImage = useCallback((delta: number) => {
    markDirty();
    setRotation((prev) => normalizeSignedRotation(prev + delta));
    setCrop((prev) => fitCropToAspectRatio(prev, aspectRatio, naturalSize));
  }, [aspectRatio, markDirty, naturalSize]);

  const centerCrop = useCallback(() => {
    markDirty();
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, (100 - prev.width) / 2),
      y: Math.max(0, (100 - prev.height) / 2),
    }));
  }, [markDirty]);

  const closeWithConfirm = useCallback(() => {
    if (isDirty && !isExporting && !window.confirm('放弃本次裁切修改吗？')) {
      return;
    }
    onClose();
  }, [isDirty, isExporting, onClose]);

  const updateCustomOutputWidth = useCallback((value: string) => {
    const sanitized = value.replace(/[^\d]/g, '');
    markDirty();
    setCustomOutputWidth(sanitized);
    if (!lockOutputRatio || cropPixelSize.width <= 0 || cropPixelSize.height <= 0) return;
    const width = Number(sanitized);
    if (!Number.isFinite(width) || width <= 0) return;
    setCustomOutputHeight(String(Math.max(1, Math.round((width * cropPixelSize.height) / cropPixelSize.width))));
  }, [cropPixelSize.height, cropPixelSize.width, lockOutputRatio, markDirty]);

  const updateCustomOutputHeight = useCallback((value: string) => {
    const sanitized = value.replace(/[^\d]/g, '');
    markDirty();
    setCustomOutputHeight(sanitized);
    if (!lockOutputRatio || cropPixelSize.width <= 0 || cropPixelSize.height <= 0) return;
    const height = Number(sanitized);
    if (!Number.isFinite(height) || height <= 0) return;
    setCustomOutputWidth(String(Math.max(1, Math.round((height * cropPixelSize.width) / cropPixelSize.height))));
  }, [cropPixelSize.height, cropPixelSize.width, lockOutputRatio, markDirty]);

  const updateCrop = useCallback((handle: CropHandle, deltaX: number, deltaY: number, origin: CropBox) => {
    const minSize = 10;
    const ratio = getRatioValue(aspectRatio, naturalSize);
    const next = { ...origin };

    if (handle === 'move') {
      next.x = Math.max(0, Math.min(100 - origin.width, origin.x + deltaX));
      next.y = Math.max(0, Math.min(100 - origin.height, origin.y + deltaY));
      setCrop(snapCropToGuides(next));
      return;
    }

    if (handle.includes('left')) {
      const nextX = Math.max(0, Math.min(origin.x + origin.width - minSize, origin.x + deltaX));
      next.width = origin.width + (origin.x - nextX);
      next.x = nextX;
    }

    if (handle.includes('right')) {
      next.width = Math.max(minSize, Math.min(100 - origin.x, origin.width + deltaX));
    }

    if (handle.includes('top')) {
      const nextY = Math.max(0, Math.min(origin.y + origin.height - minSize, origin.y + deltaY));
      next.height = origin.height + (origin.y - nextY);
      next.y = nextY;
    }

    if (handle.includes('bottom')) {
      next.height = Math.max(minSize, Math.min(100 - origin.y, origin.height + deltaY));
    }

    if (ratio) {
      if (handle === 'left' || handle === 'right' || handle.includes('left') || handle.includes('right')) {
        next.height = next.width / ratio;
      } else {
        next.width = next.height * ratio;
      }

      if (next.width > 100 - next.x) {
        next.width = 100 - next.x;
        next.height = next.width / ratio;
      }
      if (next.height > 100 - next.y) {
        next.height = 100 - next.y;
        next.width = next.height * ratio;
      }
    }

    setCrop(snapCropToGuides(next));
  }, [aspectRatio, naturalSize]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      const viewport = viewportRef.current;
      if (!dragState || !viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const deltaX = ((event.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - dragState.startY) / rect.height) * 100;
      updateCrop(dragState.handle, deltaX, deltaY, dragState.origin);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDraggingCrop(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [updateCrop]);

  const startDrag = useCallback((handle: CropHandle, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    markDirty();
    setIsDraggingCrop(true);
    dragStateRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: crop,
    };
  }, [crop, markDirty]);

  const handleCropKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const movementByKey: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const movement = movementByKey[event.key];
    if (!movement) return;

    event.preventDefault();
    const step = event.shiftKey ? 2 : 0.5;
    markDirty();
    setCrop((prev) => snapCropToGuides({
      ...prev,
      x: prev.x + movement[0] * step,
      y: prev.y + movement[1] * step,
    }));
  }, [markDirty]);

  const exportCroppedImage = useCallback(async () => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) {
      showToast('图片还没有加载完成，请稍后再试', 'error');
      return;
    }

    setIsExporting(true);

    try {
      const response = await fetch('/api/material-editor', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'crop',
          imageUrl,
          destination,
          orderNumber,
          toolLabel,
          sourceImageUrl,
          crop,
          rotation,
          scale,
          flipHorizontal,
          flipVertical,
          outputSize: {
            width: resolvedOutputSize.width,
            height: resolvedOutputSize.height,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.url) {
        throw new Error(toUserFacingErrorMessage(data.message, '暂时未能完成处理，请稍后重试'));
      }

      await onComplete(data.data.url);
      onClose();
    } catch (error) {
      const message = toUserFacingErrorFromUnknown(error, '暂时未能完成处理，请稍后重试');
      showToast(message, 'error');
    } finally {
      setIsExporting(false);
    }
  }, [crop, destination, flipHorizontal, flipVertical, imageUrl, onClose, onComplete, orderNumber, resolvedOutputSize.height, resolvedOutputSize.width, rotation, scale, sourceImageUrl, toolLabel]);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-[#030306]/88 px-4 py-4 backdrop-blur-md">
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#08080d]/98 shadow-[0_28px_90px_rgba(0,0,0,0.58)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-white">裁切工具</h3>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/50">
                {destination === 'orders' ? '保存到订单记录' : '保存到素材库'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/40">
              <span>{naturalSize.width || '--'} x {naturalSize.height || '--'} px</span>
              <span>裁切 {cropPixelSize.width || '--'} x {cropPixelSize.height || '--'} px</span>
              <span>导出 {resolvedOutputSize.width || '--'} x {resolvedOutputSize.height || '--'} px</span>
            </div>
          </div>
          <button
            onClick={closeWithConfirm}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white"
            title="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-y-auto md:min-h-0 md:grid-cols-[280px_minmax(0,1fr)] md:overflow-hidden">
          <aside className="border-b border-white/10 bg-white/[0.025] px-3 py-3 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="space-y-3">
              <section className="rounded-2xl border border-white/10 bg-black/22 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-white/78">比例</p>
                  <button
                    onClick={centerCrop}
                    className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white"
                  >
                    居中
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {aspectRatios.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => {
                        markDirty();
                        setAspectRatio(key);
                        setCrop((prev) => fitCropToAspectRatio(prev, key, naturalSize));
                      }}
                      className={`h-8 rounded-xl border text-sm transition-colors ${aspectRatio === key ? 'border-fuchsia-300/50 bg-fuchsia-400/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.06] text-white/62 hover:bg-white/[0.12] hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/22 p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-white/78">缩放</span>
                  <span className="text-white/42">{Math.round(scale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.01"
                  value={scale}
                  onChange={(event) => {
                    markDirty();
                    setScale(Number(event.target.value));
                  }}
                  className="w-full accent-fuchsia-400"
                />
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/22 p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-white/78">旋转</span>
                  <span className="text-white/42">{Math.round(rotation)}°</span>
                </div>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={rotation}
                  onChange={(event) => {
                    markDirty();
                    setRotation(normalizeSignedRotation(Number(event.target.value)));
                  }}
                  className="mb-3 w-full accent-fuchsia-400"
                />
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['左90', () => rotateImage(-90)],
                    ['180', () => rotateImage(180)],
                    ['右90', () => rotateImage(90)],
                    ['归零', () => {
                      markDirty();
                      setRotation(0);
                    }],
                  ].map(([label, action]) => (
                    <button
                      key={String(label)}
                      onClick={action as () => void}
                      className="h-8 rounded-lg border border-white/10 bg-white/[0.06] text-xs text-white/62 transition-colors hover:bg-white/[0.12] hover:text-white"
                    >
                      {String(label)}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/22 p-3">
                <p className="mb-3 text-sm font-medium text-white/78">翻转</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      markDirty();
                      setFlipHorizontal((current) => !current);
                    }}
                    className={`h-9 rounded-xl border text-sm transition-colors ${flipHorizontal ? 'border-fuchsia-300/50 bg-fuchsia-400/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.06] text-white/62 hover:bg-white/[0.12] hover:text-white'}`}
                  >
                    水平
                  </button>
                  <button
                    onClick={() => {
                      markDirty();
                      setFlipVertical((current) => !current);
                    }}
                    className={`h-9 rounded-xl border text-sm transition-colors ${flipVertical ? 'border-fuchsia-300/50 bg-fuchsia-400/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.06] text-white/62 hover:bg-white/[0.12] hover:text-white'}`}
                  >
                    垂直
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-black/22 p-3">
                <p className="mb-3 text-sm font-medium text-white/78">输出</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      markDirty();
                      setOutputSizeMode('crop');
                    }}
                    className={`min-h-9 rounded-xl border px-2 text-sm leading-tight transition-colors ${outputSizeMode === 'crop' ? 'border-fuchsia-300/50 bg-fuchsia-400/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.06] text-white/62 hover:bg-white/[0.12] hover:text-white'}`}
                  >
                    跟随裁切
                  </button>
                  <button
                    onClick={() => {
                      markDirty();
                      setOutputSizeMode('custom');
                      if (!customOutputWidth) setCustomOutputWidth(String(cropPixelSize.width || ''));
                      if (!customOutputHeight) setCustomOutputHeight(String(cropPixelSize.height || ''));
                    }}
                    className={`min-h-9 rounded-xl border px-2 text-sm leading-tight transition-colors ${outputSizeMode === 'custom' ? 'border-fuchsia-300/50 bg-fuchsia-400/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.06] text-white/62 hover:bg-white/[0.12] hover:text-white'}`}
                  >
                    指定尺寸
                  </button>
                </div>

                {outputSizeMode === 'custom' && (
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        markDirty();
                        setLockOutputRatio((current) => !current);
                      }}
                      className={`inline-flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${lockOutputRatio ? 'border-fuchsia-300/35 bg-fuchsia-400/14 text-fuchsia-100' : 'border-white/10 bg-white/[0.055] text-white/55 hover:bg-white/[0.1] hover:text-white/75'}`}
                    >
                      <span>锁定宽高比例</span>
                      <span>{lockOutputRatio ? '开' : '关'}</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                        <span className="mb-1 block text-xs text-white/35">宽 px</span>
                        <input
                          type="number"
                          min="1"
                          max="12000"
                          inputMode="numeric"
                          value={customOutputWidth}
                          onChange={(event) => updateCustomOutputWidth(event.target.value)}
                          className="w-full bg-transparent text-base font-semibold text-white outline-none"
                          placeholder={String(cropPixelSize.width || '')}
                        />
                      </label>
                      <label className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                        <span className="mb-1 block text-xs text-white/35">高 px</span>
                        <input
                          type="number"
                          min="1"
                          max="12000"
                          inputMode="numeric"
                          value={customOutputHeight}
                          onChange={(event) => updateCustomOutputHeight(event.target.value)}
                          className="w-full bg-transparent text-base font-semibold text-white outline-none"
                          placeholder={String(cropPixelSize.height || '')}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </aside>

          <div className="relative min-h-[360px] overflow-hidden bg-[#050507] md:min-h-[520px]">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:26px_26px]" />
            <div className="relative flex h-full min-h-[360px] items-center justify-center p-5 md:min-h-[520px] lg:p-8">
              <div className="relative flex h-full w-full items-center justify-center rounded-[1.35rem] border border-white/12 bg-[#0d0d14]/84 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_22px_70px_rgba(0,0,0,0.34)]">
                <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-medium text-white/45 backdrop-blur">
                  图片画板
                </div>
                <div className="relative flex h-full w-full max-h-full max-w-full items-center justify-center rounded-[1.15rem] border border-white/12 bg-[#111119] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.36)]">
                  <div className="pointer-events-none absolute inset-3 rounded-xl border border-white/10 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.32)]" />
                  <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/48 px-2.5 py-1 text-[10px] text-white/38 backdrop-blur">
                    图片边界
                  </div>
                <div
                  ref={viewportRef}
                    className="relative max-h-[420px] w-full max-w-[680px] overflow-hidden rounded-xl border border-white/25 bg-black/72 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_18px_40px_rgba(0,0,0,0.42)] md:max-h-[min(650px,calc(100vh-240px))]"
                  style={{
                    aspectRatio: previewAspectRatio,
                    maxWidth: rotatedSize.width > 0 && rotatedSize.height > 0 && rotatedSize.height > rotatedSize.width ? '430px' : '680px',
                  }}
                >
                  <SafeImage
                    ref={imageRef}
                    src={imageUrl}
                    alt="裁切中的素材"
                    width={naturalSize.width || 1200}
                    height={naturalSize.height || 1200}
                    className="absolute left-1/2 top-1/2 object-fill"
                    onLoad={(event) => {
                      setNaturalSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      });
                    }}
                    style={{
                      ...rotatedImageStyle,
                      transformOrigin: 'center center',
                    }}
                  />

                  <div className="pointer-events-none absolute inset-0">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-cyan-200/22" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-200/22" />
                  </div>

                  <div
                    className={`absolute cursor-move border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-200/70 ${isDraggingCrop ? 'border-white' : 'border-fuchsia-300'}`}
                    style={{
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      width: `${crop.width}%`,
                      height: `${crop.height}%`,
                    }}
                    tabIndex={0}
                    aria-label="裁切框，可用方向键微调位置，按住 Shift 可大步移动"
                    onKeyDown={handleCropKeyDown}
                    onPointerDown={(event) => startDrag('move', event)}
                  >
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }).map((_, index) => (
                        <span key={index} className="border border-white/16" />
                      ))}
                    </div>
                    <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-black/30 bg-black/62 px-2 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">
                      {cropPixelSize.width || '--'} x {cropPixelSize.height || '--'} px
                    </div>
                    {([
                      ['top-left', 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
                      ['top', 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'],
                      ['top-right', 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
                      ['right', 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
                      ['bottom-right', 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
                      ['bottom', 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize'],
                      ['bottom-left', 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
                      ['left', 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
                    ] as Array<[CropHandle, string]>).map(([handle, className]) => (
                      <span
                        key={handle}
                        className={`absolute h-4 w-4 rounded-full border border-white/65 bg-fuchsia-300 shadow-[0_0_0_3px_rgba(0,0,0,0.26)] ${className}`}
                        onPointerDown={(event) => startDrag(handle, event)}
                      />
                    ))}
                  </div>

                  <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#0b0b12]/96 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">X {crop.x.toFixed(1)}%</span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">Y {crop.y.toFixed(1)}%</span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">缩放 {Math.round(scale * 100)}%</span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">旋转 {Math.round(rotation)}°</span>
            <span className={`rounded-full border px-3 py-1.5 ${cropIsCentered ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100/80' : 'border-white/10 bg-white/[0.05] text-white/45'}`}>
              {cropIsCentered ? '已居中' : '未居中'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={resetCrop}
              className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              重置
            </button>
            <button
              onClick={closeWithConfirm}
              className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              取消
            </button>
            <button
              onClick={exportCroppedImage}
              disabled={isExporting}
              className="min-w-[132px] rounded-xl bg-gradient-to-r from-fuchsia-500 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(59,130,246,0.24)] transition-all hover:from-fuchsia-400 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? '正在保存...' : '保存裁切图'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
