'use client';

import { useCallback, useRef, useState } from 'react';

type Props = {
  imageUrl: string;
  onClose: () => void;
  onComplete: (resultUrl: string) => void;
};

export default function AnnotateEditorPanel({ imageUrl, onClose, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [brushColor, setBrushColor] = useState('#ff4d6d');
  const [brushSize, setBrushSize] = useState(6);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const clearAnnotation = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [brushColor, brushSize]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing]);

  const handlePointerUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const exportAnnotatedImage = useCallback(async () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    setIsExporting(true);

    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = image.naturalWidth;
      exportCanvas.height = image.naturalHeight;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法创建导出画布');
      }

      ctx.drawImage(image, 0, 0, exportCanvas.width, exportCanvas.height);
      ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);

      const dataUrl = exportCanvas.toDataURL('image/png');
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: dataUrl,
          folder: 'material-annotate',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.url) {
        throw new Error(data.message || '标注结果上传失败');
      }

      onComplete(data.data.url);
      onClose();
    } finally {
      setIsExporting(false);
    }
  }, [onClose, onComplete]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
      <div className="w-full max-w-5xl rounded-3xl border border-white/12 bg-[#09090b]/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-2xl font-semibold text-white">画笔标注</h3>
            <p className="text-white/50 mt-1">前端直接标注，支持颜色、粗细和清空</p>
          </div>
          <button onClick={onClose} className="text-white/55 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-4">
            <div>
              <p className="text-sm text-white/55 mb-2">画笔颜色</p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brushColor}
                  onChange={(event) => setBrushColor(event.target.value)}
                  className="h-10 w-14 rounded-lg border border-white/10 bg-transparent"
                />
                <span className="text-sm text-white/55">{brushColor}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 text-sm text-white/55">
                <span>画笔粗细</span>
                <span>{brushSize}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="30"
                step="1"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="w-full"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={clearAnnotation} className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/16 text-white/75 transition-colors">
                清空标注
              </button>
              <button
                onClick={exportAnnotatedImage}
                disabled={isExporting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? '导出中...' : '完成并生成'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/35 p-5 flex items-center justify-center overflow-hidden min-h-[520px]">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 w-full h-full min-h-[440px]">
              <img ref={imageRef} src={imageUrl} alt="标注中的素材" className="absolute inset-0 h-full w-full object-cover" />
              <canvas
                ref={canvasRef}
                width={1200}
                height={1200}
                className="absolute inset-0 h-full w-full"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
