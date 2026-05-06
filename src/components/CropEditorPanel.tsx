'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@/lib/toast';

type AspectRatio = 'free' | '1:1' | '4:5' | '16:9';
type CropHandle = 'move' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

type CropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  imageUrl: string;
  onClose: () => void;
  onComplete: (resultUrl: string) => void | Promise<void>;
};

const aspectRatios: Array<[AspectRatio, string]> = [
  ['free', '自由'],
  ['1:1', '1:1'],
  ['4:5', '4:5'],
  ['16:9', '16:9'],
];

function getRatioValue(aspectRatio: AspectRatio): number | null {
  if (aspectRatio === '1:1') return 1;
  if (aspectRatio === '4:5') return 4 / 5;
  if (aspectRatio === '16:9') return 16 / 9;
  return null;
}

function fitCropToAspectRatio(crop: CropBox, aspectRatio: AspectRatio): CropBox {
  const ratio = getRatioValue(aspectRatio);
  if (!ratio) return crop;

  const width = Math.min(crop.width, 76);
  const height = width / ratio;
  const safeHeight = Math.min(height, 76);
  const safeWidth = safeHeight * ratio;

  return {
    x: Math.max(0, Math.min(100 - safeWidth, crop.x)),
    y: Math.max(0, Math.min(100 - safeHeight, crop.y)),
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

function normalizeRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
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

export default function CropEditorPanel({ imageUrl, onClose, onComplete }: Props) {
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

  const resetCrop = useCallback(() => {
    setAspectRatio('free');
    setScale(1);
    setRotation(0);
    setFlipHorizontal(false);
    setFlipVertical(false);
    setCrop({ x: 12, y: 12, width: 76, height: 76 });
  }, []);

  const rotateImage = useCallback((delta: number) => {
    setRotation((prev) => normalizeSignedRotation(prev + delta));
    setCrop((prev) => fitCropToAspectRatio(prev, aspectRatio));
  }, [aspectRatio]);

  const updateCrop = useCallback((handle: CropHandle, deltaX: number, deltaY: number, origin: CropBox) => {
    const minSize = 10;
    const ratio = getRatioValue(aspectRatio);
    const next = { ...origin };

    if (handle === 'move') {
      next.x = Math.max(0, Math.min(100 - origin.width, origin.x + deltaX));
      next.y = Math.max(0, Math.min(100 - origin.height, origin.y + deltaY));
      setCrop(next);
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

    setCrop(clampCrop(next));
  }, [aspectRatio]);

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
    dragStateRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: crop,
    };
  }, [crop]);

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
          crop,
          rotation,
          scale,
          flipHorizontal,
          flipVertical,
          outputSize: cropPixelSize,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.url) {
        throw new Error(data.message || '裁切结果生成失败');
      }

      await onComplete(data.data.url);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '裁切结果生成失败';
      showToast(message, 'error');
    } finally {
      setIsExporting(false);
    }
  }, [crop, cropPixelSize, flipHorizontal, flipVertical, imageUrl, onClose, onComplete, rotation, scale]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
      <div className="w-full max-w-5xl rounded-3xl border border-white/12 bg-[#09090b]/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-2xl font-semibold text-white">裁切工具</h3>
            <p className="text-white/50 mt-1">支持缩放、旋转和比例裁切，拖动四边、四角或整块区域进行调整</p>
          </div>
          <button onClick={onClose} className="text-white/55 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-4">
            <div>
              <p className="text-sm text-white/55 mb-2">裁切比例</p>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setAspectRatio(key);
                      setCrop((prev) => fitCropToAspectRatio(prev, key));
                    }}
                    className={`px-3 py-2 rounded-xl text-sm transition-colors ${aspectRatio === key ? 'bg-purple-500/24 border border-purple-400/40 text-purple-200' : 'bg-white/8 border border-white/10 text-white/65 hover:bg-white/14 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 text-sm text-white/55">
                <span>画面缩放</span>
                <span>{Math.round(scale * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.01"
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 text-sm text-white/55">
                <span>旋转</span>
                <span>{Math.round(rotation)}°</span>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotation}
                onChange={(event) => setRotation(normalizeSignedRotation(Number(event.target.value)))}
                className="mb-3 w-full"
              />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => rotateImage(-90)} className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/14 hover:text-white transition-colors">
                  左转90°
                </button>
                <button onClick={() => rotateImage(180)} className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/14 hover:text-white transition-colors">
                  转180°
                </button>
                <button onClick={() => rotateImage(90)} className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/14 hover:text-white transition-colors">
                  右转90°
                </button>
                <button onClick={() => setRotation(0)} className="rounded-lg border border-white/10 bg-white/8 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/14 hover:text-white transition-colors">
                  还原
                </button>
              </div>
            </div>

            <div>
              <p className="text-sm text-white/55 mb-2">翻转</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFlipHorizontal((current) => !current)}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${flipHorizontal ? 'border-purple-400/45 bg-purple-500/22 text-purple-100' : 'border-white/10 bg-white/8 text-white/70 hover:bg-white/14 hover:text-white'}`}
                >
                  水平翻转
                </button>
                <button
                  onClick={() => setFlipVertical((current) => !current)}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${flipVertical ? 'border-purple-400/45 bg-purple-500/22 text-purple-100' : 'border-white/10 bg-white/8 text-white/70 hover:bg-white/14 hover:text-white'}`}
                >
                  垂直翻转
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/45 leading-6">
              <p>当前裁切框</p>
              <p>X: {crop.x.toFixed(1)}%</p>
              <p>Y: {crop.y.toFixed(1)}%</p>
              <p>宽: {crop.width.toFixed(1)}%</p>
              <p>高: {crop.height.toFixed(1)}%</p>
              <p>取景缩放: {Math.round(scale * 100)}%</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
              <div>
                <p className="text-sm text-white/55">输出像素</p>
                <p className="mt-1 text-xs text-white/35">按裁切框在原图中的占比计算，缩放和旋转只影响取景，不改变目标尺寸</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/8 px-3 py-2">
                  <span className="block text-xs text-white/40 mb-1">宽度</span>
                  <span className="text-lg font-semibold text-white">{cropPixelSize.width || '--'} px</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/8 px-3 py-2">
                  <span className="block text-xs text-white/40 mb-1">高度</span>
                  <span className="text-lg font-semibold text-white">{cropPixelSize.height || '--'} px</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={resetCrop} className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/16 text-white/75 transition-colors">
                重置
              </button>
              <button
                onClick={exportCroppedImage}
                disabled={isExporting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? '导出中...' : '完成并生成'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/35 p-5 flex items-center justify-center overflow-hidden min-h-[520px]">
            <div
              ref={viewportRef}
              className="relative max-h-[620px] w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/10 bg-black/40"
              style={{
                aspectRatio: previewAspectRatio,
                maxWidth: rotatedSize.width > 0 && rotatedSize.height > 0 && rotatedSize.height > rotatedSize.width ? '420px' : '620px',
              }}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="裁切中的素材"
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

              <div
                className="absolute border-2 border-fuchsia-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] cursor-move"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                }}
                onPointerDown={(event) => startDrag('move', event)}
              >
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
                    className={`absolute h-4 w-4 rounded-full bg-fuchsia-400 border border-white/40 ${className}`}
                    onPointerDown={(event) => startDrag(handle, event)}
                  />
                ))}
              </div>

              <div className="absolute inset-0 ring-1 ring-white/10 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
