'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@/lib/toast';

type LocalEditMode = 'brush' | 'tag';

type TagRegion = {
  id: string;
  naturalX: number;
  naturalY: number;
  description: string;
  candidates: string[];
  selectedCandidate: string;
  customTarget: string;
  identifyError: string;
  isIdentifying: boolean;
};

type AgentResult = {
  summary?: string;
  prompt?: string;
  negativePrompt?: string;
  source?: string;
};

type Props = {
  imageUrl: string;
  onClose: () => void;
  onComplete: (resultUrl: string) => void | Promise<void>;
};

function buildBrushPrompt(userPrompt: string) {
  const text = userPrompt.trim();
  return text
    ? `请仅修改遮罩区域内的内容，保持其余区域不变。${text}`
    : '请仅修改遮罩区域内的内容，保持其余区域不变，边缘自然融合，风格与光影保持一致。';
}

function getRegionTarget(region: TagRegion) {
  return region.customTarget.trim() || region.selectedCandidate.trim() || region.description.trim();
}

function buildTagInstruction(regions: TagRegion[], userPrompt: string) {
  const labels = regions.map((region, index) => getRegionTarget(region) || `区域${index + 1}`);
  const base = labels.length === 1
    ? `请仅修改图片中“${labels[0]}”所在的局部区域，保持其他部分不变。`
    : `请仅修改以下局部区域：${labels.map((label) => `“${label}”`).join('、')}，保持其他部分不变。`;
  return userPrompt.trim() ? `${base}${userPrompt.trim()}` : `${base}边缘自然融合，风格与光影保持一致。`;
}

export default function LocalEditPanel({ imageUrl, onClose, onComplete }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement>(null);
  const brushLayerRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const identifyControllersRef = useRef<Record<string, AbortController>>({});

  const [mode, setMode] = useState<LocalEditMode>('brush');
  const [imageReady, setImageReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [brushSize, setBrushSize] = useState(36);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [brushMaskSegments, setBrushMaskSegments] = useState<Array<{ x: number; y: number; r: number }>>([]);
  const [tagRegions, setTagRegions] = useState<TagRegion[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [agentSummary, setAgentSummary] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentNegativePrompt, setAgentNegativePrompt] = useState('');
  const [agentSource, setAgentSource] = useState('');
  const [isResolvingPrompt, setIsResolvingPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const activeRegion = useMemo(() => {
    if (!tagRegions.length) return null;
    return tagRegions.find((region) => region.id === activeRegionId) || tagRegions[tagRegions.length - 1] || null;
  }, [activeRegionId, tagRegions]);

  const syncImageMetrics = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    setImageReady(true);
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });

    const rect = img.getBoundingClientRect();
    if (rect.width) {
      setDisplayScale(rect.width / img.naturalWidth);
    }

    const brushCanvas = brushCanvasRef.current;
    const brushLayer = brushLayerRef.current;
    if (brushCanvas && brushLayer) {
      brushCanvas.width = img.naturalWidth;
      brushCanvas.height = img.naturalHeight;
      brushLayer.width = img.naturalWidth;
      brushLayer.height = img.naturalHeight;
    }
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) {
      syncImageMetrics();
    }
  }, [imageUrl, syncImageMetrics]);

  useEffect(() => {
    const updateScale = () => {
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      const rect = img.getBoundingClientRect();
      if (rect.width) {
        setDisplayScale(rect.width / img.naturalWidth);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [imageReady, imageUrl, naturalSize.width]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose]);

  useEffect(() => {
    return () => {
      Object.values(identifyControllersRef.current).forEach((controller) => controller.abort());
      identifyControllersRef.current = {};
    };
  }, []);

  const clearBrushMask = useCallback(() => {
    setBrushMaskSegments([]);
    const ctx = brushCanvasRef.current?.getContext('2d');
    if (ctx && brushCanvasRef.current) {
      ctx.clearRect(0, 0, brushCanvasRef.current.width, brushCanvasRef.current.height);
    }
  }, []);

  const redrawBrushLayer = useCallback((segments: Array<{ x: number; y: number; r: number }>) => {
    const canvas = brushLayerRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    segments.forEach((segment) => {
      ctx.beginPath();
      ctx.arc(segment.x, segment.y, segment.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  useEffect(() => {
    redrawBrushLayer(brushMaskSegments);
  }, [brushMaskSegments, redrawBrushLayer]);

  const handleBrushPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = brushCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageReady || isSubmitting) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const naturalX = (offsetX / rect.width) * canvas.width;
    const naturalY = (offsetY / rect.height) * canvas.height;
    const radius = displayScale > 0 ? Math.max(8, brushSize / displayScale) : brushSize;

    setBrushMaskSegments((current) => [...current, { x: naturalX, y: naturalY, r: radius }]);
  }, [brushSize, displayScale, imageReady, isSubmitting]);

  const handleBrushDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setIsDrawing(true);
    handleBrushPointer(event);
  }, [handleBrushPointer]);

  const handleBrushMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    handleBrushPointer(event);
  }, [handleBrushPointer, isDrawing]);

  const handleBrushUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleBrushCanvasClick = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isErasing || !brushMaskSegments.length) return;

    const canvas = brushCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const naturalX = (offsetX / rect.width) * canvas.width;
    const naturalY = (offsetY / rect.height) * canvas.height;

    const next = brushMaskSegments.filter((segment) => {
      const dx = segment.x - naturalX;
      const dy = segment.y - naturalY;
      return Math.sqrt(dx * dx + dy * dy) > segment.r;
    });

    setBrushMaskSegments(next);
    setIsErasing(false);
  }, [brushMaskSegments, isErasing]);

  const identifyRegion = useCallback(async (regionId: string, naturalX: number, naturalY: number, imageWidth: number, imageHeight: number) => {
    const controller = new AbortController();
    identifyControllersRef.current[regionId]?.abort();
    identifyControllersRef.current[regionId] = controller;

    try {
      const response = await fetch('/api/color-extraction2/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, clickX: naturalX, clickY: naturalY, imageWidth, imageHeight }),
        signal: controller.signal,
      });

      const result = await response.json() as { success?: boolean; description?: string; candidates?: string[]; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '识别失败，请重试');
      }

      const normalizedCandidates = Array.from(new Set([...(result.candidates || []), result.description || ''].map((item) => item.trim()).filter(Boolean))).slice(0, 4);

      setTagRegions((current) => current.map((region) => region.id === regionId ? {
        ...region,
        description: result.description?.trim() || normalizedCandidates[0] || '',
        candidates: normalizedCandidates,
        selectedCandidate: region.selectedCandidate || normalizedCandidates[0] || '',
        identifyError: '',
        isIdentifying: false,
      } : region));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '识别失败，请重试';
      setTagRegions((current) => current.map((region) => region.id === regionId ? { ...region, identifyError: message, isIdentifying: false } : region));
    } finally {
      if (identifyControllersRef.current[regionId] === controller) {
        delete identifyControllersRef.current[regionId];
      }
    }
  }, [imageUrl]);

  const handleTagImageClick = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !imageReady || isSubmitting || !img.naturalWidth || !img.naturalHeight) return;

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const naturalX = Math.round((offsetX / rect.width) * img.naturalWidth);
    const naturalY = Math.round((offsetY / rect.height) * img.naturalHeight);
    const regionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setSubmitError('');
    setTagRegions((current) => [...current, { id: regionId, naturalX, naturalY, description: '', candidates: [], selectedCandidate: '', customTarget: '', identifyError: '', isIdentifying: true }]);
    setActiveRegionId(regionId);
    void identifyRegion(regionId, naturalX, naturalY, img.naturalWidth, img.naturalHeight);
  }, [identifyRegion, imageReady, isSubmitting]);

  const handleSubmit = useCallback(async () => {
    setSubmitError('');

    if (!imgRef.current?.naturalWidth || !imgRef.current?.naturalHeight) {
      setSubmitError('图片还没有准备好，请稍后重试');
      return;
    }

    let finalPrompt = '';
    let negativePrompt = '';

    if (mode === 'brush') {
      if (brushMaskSegments.length === 0) {
        setSubmitError('请先用画笔涂抹要修改的区域');
        return;
      }

      const agentBody = {
        imageUrl,
        mode: 'brush' as const,
        instruction,
        regions: [],
      };

      setIsResolvingPrompt(true);
      try {
        const response = await fetch('/api/material-editor/compose-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(agentBody),
        });

        const result = await response.json() as { success?: boolean; data?: AgentResult; message?: string };
        const agent = result.data || {};
        setAgentSummary(agent.summary || '局部改图');
        setAgentPrompt(agent.prompt || buildBrushPrompt(instruction));
        setAgentNegativePrompt(agent.negativePrompt || '不要改动未选区域。');
        setAgentSource(agent.source || 'fallback');
        finalPrompt = agent.prompt || buildBrushPrompt(instruction);
        negativePrompt = agent.negativePrompt || '不要改动未选区域。';
      } catch {
        finalPrompt = buildBrushPrompt(instruction);
        negativePrompt = '不要改动未选区域。';
        setAgentSummary('局部改图');
        setAgentPrompt(finalPrompt);
        setAgentNegativePrompt(negativePrompt);
        setAgentSource('fallback');
      } finally {
        setIsResolvingPrompt(false);
      }
    } else {
      if (tagRegions.length === 0) {
        setSubmitError('请先点击图片添加局部目标');
        return;
      }

      if (tagRegions.some((region) => region.isIdentifying)) {
        setSubmitError('还有区域正在识别，请等待完成后再提交');
        return;
      }

      const promptText = instruction.trim();
      const agentBody = {
        imageUrl,
        mode: 'tag' as const,
        instruction: promptText,
        regions: tagRegions,
      };

      setIsResolvingPrompt(true);
      try {
        const response = await fetch('/api/material-editor/compose-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(agentBody),
        });

        const result = await response.json() as { success?: boolean; data?: AgentResult; message?: string };
        const agent = result.data || {};
        setAgentSummary(agent.summary || '局部改图');
        setAgentPrompt(agent.prompt || buildTagInstruction(tagRegions, promptText));
        setAgentNegativePrompt(agent.negativePrompt || '不要改动未选区域。');
        setAgentSource(agent.source || 'fallback');
        finalPrompt = agent.prompt || buildTagInstruction(tagRegions, promptText);
        negativePrompt = agent.negativePrompt || '不要改动未选区域。';
      } catch {
        finalPrompt = buildTagInstruction(tagRegions, promptText);
        negativePrompt = '不要改动未选区域。';
        setAgentSummary('局部改图');
        setAgentPrompt(finalPrompt);
        setAgentNegativePrompt(negativePrompt);
        setAgentSource('fallback');
      } finally {
        setIsResolvingPrompt(false);
      }
    }

    setIsSubmitting(true);
    try {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = naturalSize.width;
      maskCanvas.height = naturalSize.height;
      const ctx = maskCanvas.getContext('2d');
      if (!ctx) throw new Error('生成遮罩失败');

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      ctx.fillStyle = '#ffffff';

      if (mode === 'brush') {
        brushMaskSegments.forEach((segment) => {
          ctx.beginPath();
          ctx.arc(segment.x, segment.y, segment.r, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        const radius = displayScale > 0 ? Math.max(24, Math.round(brushSize / displayScale)) : brushSize;
        tagRegions.forEach((region) => {
          ctx.beginPath();
          ctx.arc(region.naturalX, region.naturalY, radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      const response = await fetch('/api/material-editor', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'redraw',
          imageUrl,
          maskImageBase64: maskCanvas.toDataURL('image/png'),
          prompt: `${finalPrompt}\n${negativePrompt ? `\n负面约束：${negativePrompt}` : ''}`.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success || !data.data?.url) {
        throw new Error(data.message || '局部改图失败');
      }

      await onComplete(data.data.url);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '局部改图失败';
      setSubmitError(message);
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [brushMaskSegments, brushSize, displayScale, imageUrl, instruction, mode, naturalSize.height, naturalSize.width, onClose, onComplete, tagRegions]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/82 px-4 py-4 backdrop-blur-sm">
      <div className="flex h-[92vh] w-full max-w-[1780px] overflow-hidden rounded-[1.85rem] border border-white/12 bg-[#09090b]/96 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="flex min-w-0 flex-1 flex-col bg-black/15 text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">局部改图</h2>
              <p className="mt-1 text-sm text-white/50">画笔 / 标签 双模式，Agent 会把你的意图整理成更精准的局部改图提示词。</p>
            </div>
            <button onClick={onClose} disabled={isSubmitting} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/10 text-2xl leading-none text-white backdrop-blur-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50" title="关闭">×</button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            <div className="flex h-full min-h-[520px] items-center justify-center rounded-[1.65rem] border border-white/10 bg-black/25 p-4">
              <div className="relative inline-block max-h-[80vh] max-w-full overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/40 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="局部改图素材"
                  onLoad={syncImageMetrics}
                  onClick={mode === 'tag' ? handleTagImageClick : undefined}
                  className="max-h-[80vh] w-auto max-w-full object-contain"
                />

                <canvas
                  ref={brushLayerRef}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  style={{ opacity: mode === 'brush' ? 0.8 : 0 }}
                />

                <canvas
                  ref={brushCanvasRef}
                  className={`absolute inset-0 h-full w-full ${mode === 'brush' ? 'cursor-crosshair' : 'pointer-events-none opacity-0'}`}
                  onPointerDown={mode === 'brush' ? handleBrushDown : undefined}
                  onPointerMove={mode === 'brush' ? handleBrushMove : undefined}
                  onPointerUp={mode === 'brush' ? handleBrushUp : undefined}
                  onPointerLeave={mode === 'brush' ? handleBrushUp : undefined}
                  onClick={mode === 'brush' ? handleBrushCanvasClick : undefined}
                />

                {imageReady && mode === 'tag' && naturalSize.width > 0 ? (
                  <div className="pointer-events-none absolute inset-0">
                    {tagRegions.map((region, index) => {
                      const isActive = region.id === activeRegionId;
                      return (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() => setActiveRegionId(region.id)}
                          className="pointer-events-auto absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-semibold text-white shadow-lg transition hover:scale-105"
                          style={{
                            left: `${(region.naturalX / naturalSize.width) * 100}%`,
                            top: `${(region.naturalY / naturalSize.height) * 100}%`,
                            backgroundColor: isActive ? '#a855f7' : '#2563eb',
                            borderColor: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
                          }}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="flex w-full max-w-[420px] flex-col border-l border-white/10 bg-black/40 backdrop-blur-2xl">
          <div className="flex-1 overflow-y-auto p-5 history-scrollbar">
            <div className="space-y-4">
              <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/32">模式</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('brush')} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium transition ${mode === 'brush' ? 'bg-white/16 text-white ring-1 ring-white/20' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'}`}>画笔模式</button>
                  <button type="button" onClick={() => setMode('tag')} className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium transition ${mode === 'tag' ? 'bg-white/16 text-white ring-1 ring-white/20' : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'}`}>标签模式</button>
                </div>
              </section>

              {mode === 'brush' ? (
                <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/32">画笔</span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="mb-3 flex items-center justify-between text-sm text-white/55">
                    <span>画笔大小</span>
                    <span>{brushSize}px</span>
                  </div>
                  <input type="range" min="12" max="96" step="2" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="w-full accent-fuchsia-400" />
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={clearBrushMask} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/70 transition hover:bg-white/[0.1] hover:text-white">清空</button>
                    <button type="button" onClick={() => setIsErasing(true)} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/70 transition hover:bg-white/[0.1] hover:text-white">橡皮擦</button>
                  </div>
                </section>
              ) : (
                <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/32">选区</span>
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="text-[11px] text-white/35">{tagRegions.length} 个</span>
                  </div>
                  <div className="space-y-2">
                    {tagRegions.length ? tagRegions.map((region, index) => (
                      <div key={region.id} className={`rounded-2xl border px-3 py-3 transition ${region.id === activeRegionId ? 'border-white/20 bg-white/[0.08]' : 'border-white/10 bg-white/[0.035]'}`}>
                        <div className="flex items-start gap-3">
                          <button type="button" onClick={() => setActiveRegionId(region.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fuchsia-500 text-xs font-semibold text-white">{index + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-white/90">区域 {index + 1}</span>
                                <span className="shrink-0 text-[11px] text-white/35">{region.isIdentifying ? '识别中...' : region.identifyError ? '待修正' : '已识别'}</span>
                              </span>
                              <span className="mt-1 block truncate text-xs text-white/45">{region.identifyError || getRegionTarget(region) || '点击图像添加标签'}</span>
                            </span>
                          </button>
                          <button type="button" onClick={() => setTagRegions((current) => current.filter((item) => item.id !== region.id))} className="rounded-lg px-2 py-1 text-xs text-white/40 transition hover:bg-white/[0.08] hover:text-white/80">删除</button>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-5 text-sm text-white/40">点击左侧图片，添加一个或多个目标。</div>
                    )}
                  </div>
                </section>
              )}

              <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/32">提示词</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <textarea ref={textareaRef} value={instruction} onChange={(event) => { setInstruction(event.target.value); setSubmitError(''); }} rows={6} placeholder="例如：把这只狗改成猫，保持姿势和背景不变。" className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-white/20" />
              </section>

              <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/32">Agent</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <div className="space-y-3 text-sm text-white/70">
                  <div>
                    <p className="text-[11px] text-white/32">摘要</p>
                    <p className="mt-1 leading-6 text-white/78">{agentSummary || '等待生成'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-white/32">最终提示词</p>
                    <p className="mt-1 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/30 p-3 leading-6 text-white/76">{agentPrompt || (mode === 'brush' ? buildBrushPrompt(instruction) : buildTagInstruction(tagRegions, instruction))}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-white/32">负面约束</p>
                    <p className="mt-1 rounded-2xl border border-white/10 bg-black/30 p-3 leading-6 text-white/76">{agentNegativePrompt || '不要改动未选区域。'}</p>
                  </div>
                  <div className="text-[11px] text-white/28">来源：{agentSource || '待生成'}</div>
                </div>
              </section>
            </div>
          </div>

          <div className="border-t border-white/10 bg-black/50 p-4">
            {submitError ? <div className="mb-3 rounded-2xl border border-red-400/20 bg-red-500/12 px-3 py-2 text-sm text-red-100">{submitError}</div> : null}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white/78 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isResolvingPrompt} className="flex-1 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:from-purple-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? '提交中...' : isResolvingPrompt ? 'Agent 生成中...' : '提交局部改图'}</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
