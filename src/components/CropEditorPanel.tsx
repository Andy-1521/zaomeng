'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  onComplete: (resultUrl: string) => void;
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
  const [crop, setCrop] = useState<CropBox>({ x: 12, y: 12, width: 76, height: 76 });
  const [outputWidth, setOutputWidth] = useState(1200);
  const [outputHeight, setOutputHeight] = useState(1200);
  const [isExporting, setIsExporting] = useState(false);

  const resetCrop = useCallback(() => {
    setAspectRatio('free');
    setScale(1);
    setCrop({ x: 12, y: 12, width: 76, height: 76 });
  }, []);

  useEffect(() => {
    const ratio = getRatioValue(aspectRatio);
    if (!ratio) {
      return;
    }

    setCrop((prev) => {
      const width = Math.min(prev.width, 76);
      const height = width / ratio;
      const safeHeight = Math.min(height, 76);
      const safeWidth = safeHeight * ratio;

      return {
        x: Math.max(0, Math.min(100 - safeWidth, prev.x)),
        y: Math.max(0, Math.min(100 - safeHeight, prev.y)),
        width: safeWidth,
        height: safeHeight,
      };
    });
  }, [aspectRatio]);

  useEffect(() => {
    const ratio = getRatioValue(aspectRatio);
    if (!ratio) {
      return;
    }

    setOutputHeight(Math.max(1, Math.round(outputWidth / ratio)));
  }, [aspectRatio, outputWidth]);

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

      next.width = Math.min(next.width, 100 - next.x);
      next.height = Math.min(next.height, 100 - next.y);
    }

    setCrop(next);
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
      return;
    }

    setIsExporting(true);

    try {
      const sourceX = (crop.x / 100) * image.naturalWidth;
      const sourceY = (crop.y / 100) * image.naturalHeight;
      const sourceWidth = (crop.width / 100) * image.naturalWidth;
      const sourceHeight = (crop.height / 100) * image.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法创建裁切画布');
      }

      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );

      const dataUrl = canvas.toDataURL('image/png');
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: dataUrl,
          folder: 'material-editor',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.url) {
        throw new Error(data.message || '裁切结果上传失败');
      }

      onComplete(data.data.url);
      onClose();
    } finally {
      setIsExporting(false);
    }
  }, [crop, onClose, onComplete, outputHeight, outputWidth]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
      <div className="w-full max-w-5xl rounded-3xl border border-white/12 bg-[#09090b]/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-2xl font-semibold text-white">裁切工具</h3>
            <p className="text-white/50 mt-1">拖动裁切框的四边、四角或整块区域进行调整</p>
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
                    onClick={() => setAspectRatio(key)}
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

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/45 leading-6">
              <p>当前裁切框</p>
              <p>X: {crop.x.toFixed(1)}%</p>
              <p>Y: {crop.y.toFixed(1)}%</p>
              <p>宽: {crop.width.toFixed(1)}%</p>
              <p>高: {crop.height.toFixed(1)}%</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
              <p className="text-sm text-white/55">输出像素</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-white/55">
                  <span className="block mb-2">宽度</span>
                  <input
                    type="number"
                    min="1"
                    value={outputWidth}
                    onChange={(event) => setOutputWidth(Math.max(1, Number(event.target.value) || 1))}
                    className="w-full rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-white outline-none focus:border-purple-400/40"
                  />
                </label>
                <label className="text-sm text-white/55">
                  <span className="block mb-2">高度</span>
                  <input
                    type="number"
                    min="1"
                    value={outputHeight}
                    onChange={(event) => setOutputHeight(Math.max(1, Number(event.target.value) || 1))}
                    className="w-full rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-white outline-none focus:border-purple-400/40"
                  />
                </label>
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
              className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 ${aspectRatio === '1:1' ? 'aspect-square w-full max-w-[520px]' : aspectRatio === '4:5' ? 'aspect-[4/5] w-full max-w-[420px]' : aspectRatio === '16:9' ? 'aspect-video w-full max-w-[620px]' : 'w-full h-full min-h-[440px]'}`}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt="裁切中的素材"
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  transform: `scale(${scale})`,
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
