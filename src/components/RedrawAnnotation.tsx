'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';

interface RedrawAnnotationProps {
  imageUrl: string;
  onClose: () => void;
  onSubmit: (data: { maskImageBase64: string; prompt: string }) => void;
  isSubmitting?: boolean;
}

interface IdentifyResponse {
  success: boolean;
  description?: string;
  candidates?: string[];
  error?: string;
}

interface SelectedRegion {
  id: string;
  naturalX: number;
  naturalY: number;
  description: string;
  candidates: string[];
  selectedCandidate: string;
  customTarget: string;
  identifyError: string;
  isIdentifying: boolean;
}

const DEFAULT_MASK_RADIUS = 96;
const REGION_HUES = [340, 20, 48, 142, 198, 258];

function getRegionColor(index: number) {
  const hue = REGION_HUES[index % REGION_HUES.length];
  return `hsl(${hue} 85% 58%)`;
}

function getRegionTarget(region: SelectedRegion) {
  return region.customTarget.trim() || region.selectedCandidate.trim() || region.description.trim();
}

function getRegionSummary(region: SelectedRegion, index: number) {
  const target = getRegionTarget(region);
  return target || `区域 ${index + 1}`;
}

function buildPrompt(regions: SelectedRegion[], instruction: string) {
  const labels = regions.map((region, index) => getRegionTarget(region) || `第${index + 1}处区域`);

  if (labels.length === 1) {
    const base = `请只修改图片中“${labels[0]}”所在的局部区域，保持其他部分不变。`;
    return instruction ? `${base}${instruction}` : `${base}按需要完成局部重绘。`;
  }

  const base = `请只修改以下局部区域：${labels.map((label) => `“${label}”`).join('、')}，保持其他部分不变。`;
  return instruction ? `${base}${instruction}` : `${base}按需要完成统一的局部重绘。`;
}

export default function RedrawAnnotation({
  imageUrl,
  onClose,
  onSubmit,
  isSubmitting = false,
}: RedrawAnnotationProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const identifyControllersRef = useRef<Record<string, AbortController>>({});

  const [imageReady, setImageReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [regions, setRegions] = useState<SelectedRegion[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [maskRadius, setMaskRadius] = useState(DEFAULT_MASK_RADIUS);
  const [submitError, setSubmitError] = useState('');

  const activeRegion = regions.find((region) => region.id === activeRegionId) || null;

  const abortAllIdentify = () => {
    Object.values(identifyControllersRef.current).forEach((controller) => controller.abort());
    identifyControllersRef.current = {};
  };

  const syncImageMetrics = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    setImageReady(true);
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });

    const rect = img.getBoundingClientRect();
    if (rect.width) {
      setDisplayScale(rect.width / img.naturalWidth);
    }
  };

  useEffect(() => {
    abortAllIdentify();
    setImageReady(false);
    setNaturalSize({ width: 0, height: 0 });
    setDisplayScale(1);
    setRegions([]);
    setActiveRegionId(null);
    setInstruction('');
    setMaskRadius(DEFAULT_MASK_RADIUS);
    setSubmitError('');
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      abortAllIdentify();
    };
  }, []);

  useEffect(() => {
    if (!regions.length) {
      if (activeRegionId) {
        setActiveRegionId(null);
      }
      return;
    }

    if (!activeRegionId || !regions.some((region) => region.id === activeRegionId)) {
      setActiveRegionId(regions[regions.length - 1].id);
    }
  }, [regions, activeRegionId]);

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
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) {
      syncImageMetrics();
    }
  }, [imageUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose]);

  const identifyRegion = async (
    regionId: string,
    naturalX: number,
    naturalY: number,
    imageWidth: number,
    imageHeight: number,
  ) => {
    const controller = new AbortController();
    identifyControllersRef.current[regionId]?.abort();
    identifyControllersRef.current[regionId] = controller;

    try {
      const response = await fetch('/api/color-extraction2/identify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl,
          clickX: naturalX,
          clickY: naturalY,
          imageWidth,
          imageHeight,
        }),
        signal: controller.signal,
      });

      const result = (await response.json()) as IdentifyResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || '识别失败，请重试');
      }

      const normalizedCandidates = Array.from(
        new Set(
          [...(result.candidates || []), result.description || '']
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, 4);

      setRegions((current) =>
        current.map((region) => {
          if (region.id !== regionId) return region;

          return {
            ...region,
            description: result.description?.trim() || normalizedCandidates[0] || '',
            candidates: normalizedCandidates,
            selectedCandidate: region.selectedCandidate || normalizedCandidates[0] || '',
            identifyError: '',
            isIdentifying: false,
          };
        }),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : '识别失败，请重试';
      setRegions((current) =>
        current.map((region) =>
          region.id === regionId
            ? {
                ...region,
                identifyError: message,
                isIdentifying: false,
              }
            : region,
        ),
      );
    } finally {
      if (identifyControllersRef.current[regionId] === controller) {
        delete identifyControllersRef.current[regionId];
      }
    }
  };

  const handleImageClick = (event: MouseEvent<HTMLImageElement>) => {
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
    setRegions((current) => [
      ...current,
      {
        id: regionId,
        naturalX,
        naturalY,
        description: '',
        candidates: [],
        selectedCandidate: '',
        customTarget: '',
        identifyError: '',
        isIdentifying: true,
      },
    ]);
    setActiveRegionId(regionId);

    void identifyRegion(regionId, naturalX, naturalY, img.naturalWidth, img.naturalHeight);
  };

  const handleRegionRemove = (regionId: string) => {
    identifyControllersRef.current[regionId]?.abort();
    delete identifyControllersRef.current[regionId];

    setRegions((current) => current.filter((region) => region.id !== regionId));
    setSubmitError('');
  };

  const handleCandidateChange = (regionId: string, value: string) => {
    setRegions((current) =>
      current.map((region) =>
        region.id === regionId
          ? {
              ...region,
              selectedCandidate: value,
            }
          : region,
      ),
    );
    setSubmitError('');
  };

  const handleCustomTargetChange = (regionId: string, value: string) => {
    setRegions((current) =>
      current.map((region) =>
        region.id === regionId
          ? {
              ...region,
              customTarget: value,
            }
          : region,
      ),
    );
    setSubmitError('');
  };

  const handleInsertTarget = () => {
    if (!activeRegion) {
      setSubmitError('请先选择一个区域');
      return;
    }

    const target = getRegionTarget(activeRegion);
    if (!target) {
      setSubmitError('请先为当前区域选择或填写目标名称');
      return;
    }

    const textarea = textareaRef.current;
    const insertText = `（${target}）`;

    if (!textarea) {
      setInstruction((current) => `${current}${insertText}`);
      return;
    }

    const start = textarea.selectionStart ?? instruction.length;
    const end = textarea.selectionEnd ?? instruction.length;
    const nextValue = `${instruction.slice(0, start)}${insertText}${instruction.slice(end)}`;

    setInstruction(nextValue);
    setSubmitError('');

    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;

      input.focus();
      const cursor = start + insertText.length;
      input.setSelectionRange(cursor, cursor);
    });
  };

  const handleSubmit = () => {
    const trimmedInstruction = instruction.trim();

    if (!regions.length) {
      setSubmitError('请先点击图片，添加需要修改的区域');
      return;
    }

    if (regions.some((region) => region.isIdentifying)) {
      setSubmitError('还有区域正在识别，请等待完成后再提交');
      return;
    }

    if (!trimmedInstruction) {
      setSubmitError('请输入修改要求');
      return;
    }

    if (!naturalSize.width || !naturalSize.height) {
      setSubmitError('图片还没有准备好，请稍后重试');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;

    const context = canvas.getContext('2d');
    if (!context) {
      setSubmitError('生成遮罩图失败，请重试');
      return;
    }

    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const naturalRadius = displayScale > 0 ? Math.max(16, Math.round(maskRadius / displayScale)) : maskRadius;
    context.fillStyle = '#ffffff';

    regions.forEach((region) => {
      context.beginPath();
      context.arc(region.naturalX, region.naturalY, naturalRadius, 0, Math.PI * 2);
      context.fill();
    });

    setSubmitError('');
    onSubmit({
      maskImageBase64: canvas.toDataURL('image/png'),
      prompt: buildPrompt(regions, trimmedInstruction),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl lg:flex-row">
        <div className="flex min-h-[320px] flex-1 flex-col bg-slate-950 text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 lg:px-6">
            <div>
              <h2 className="text-lg font-semibold">局部重绘标注</h2>
              <p className="mt-1 text-sm text-white/70">
                可连续点击多个区域。每个点会先识别目标，再在右侧下拉选择并插入到文案中。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              关闭
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 lg:p-6">
            <div className="flex min-h-full items-center justify-center">
              <div className="relative inline-block max-w-full">
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="待重绘图片"
                  onLoad={syncImageMetrics}
                  onClick={handleImageClick}
                  className="max-h-[70vh] w-auto max-w-full cursor-crosshair rounded-2xl object-contain shadow-2xl"
                />

                {imageReady && naturalSize.width > 0 ? (
                  <div className="pointer-events-none absolute inset-0">
                    {regions.map((region, index) => {
                      const isActive = region.id === activeRegionId;
                      const color = getRegionColor(index);

                      return (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() => setActiveRegionId(region.id)}
                          className="pointer-events-auto absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-semibold text-white shadow-lg transition hover:scale-105"
                          style={{
                            left: `${(region.naturalX / naturalSize.width) * 100}%`,
                            top: `${(region.naturalY / naturalSize.height) * 100}%`,
                            backgroundColor: color,
                            borderColor: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
                            boxShadow: isActive ? `0 0 0 6px ${color}33` : '0 10px 24px rgba(15, 23, 42, 0.38)',
                          }}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {!imageReady ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/55 text-sm text-white/70">
                    图片加载中...
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 px-5 py-3 text-sm text-white/70 lg:px-6">
            点击越多，生成的遮罩图会自动把多个区域合并到同一张 mask 中，再继续走现有重绘接口。
          </div>
        </div>

        <aside className="flex w-full flex-col border-l border-slate-200 bg-slate-50 lg:w-[390px]">
          <div className="flex-1 overflow-y-auto p-5">
            <section className="mb-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">已选区域</h3>
                <span className="text-xs text-slate-500">{regions.length} 个</span>
              </div>

              <div className="mt-3 space-y-2">
                {regions.length ? (
                  regions.map((region, index) => {
                    const isActive = region.id === activeRegionId;
                    const color = getRegionColor(index);

                    return (
                      <div
                        key={region.id}
                        className={`rounded-2xl border bg-white p-3 transition ${
                          isActive ? 'border-slate-900 shadow-sm' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setActiveRegionId(region.id)}
                            className="flex min-w-0 flex-1 items-start gap-3 text-left"
                          >
                            <span
                              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                              style={{ backgroundColor: color }}
                            >
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-slate-900">区域 {index + 1}</span>
                                <span className="shrink-0 text-xs text-slate-500">
                                  {region.isIdentifying ? '识别中...' : region.identifyError ? '待修正' : '已识别'}
                                </span>
                              </span>
                              <span className="mt-1 block truncate text-sm text-slate-600">
                                {region.identifyError || getRegionSummary(region, index)}
                              </span>
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRegionRemove(region.id)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                    先点击左侧图片，添加 2 处或 3 处要修改的位置。
                  </div>
                )}
              </div>
            </section>

            <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">当前区域</h3>
                <span className="text-xs text-slate-500">
                  {activeRegion ? `区域 ${regions.findIndex((region) => region.id === activeRegion.id) + 1}` : '未选择'}
                </span>
              </div>

              {activeRegion ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">候选标签</label>
                    <select
                      value={activeRegion.selectedCandidate}
                      onChange={(event) => handleCandidateChange(activeRegion.id, event.target.value)}
                      disabled={activeRegion.isIdentifying}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      <option value="">
                        {activeRegion.isIdentifying ? '识别中...' : '没有合适候选时可直接手动填写'}
                      </option>
                      {activeRegion.candidates.map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {candidate}
                        </option>
                      ))}
                    </select>
                    {activeRegion.identifyError ? (
                      <p className="mt-2 text-xs text-rose-500">{activeRegion.identifyError}</p>
                    ) : activeRegion.description ? (
                      <p className="mt-2 text-xs text-slate-500">识别结果：{activeRegion.description}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">手动修正目标</label>
                    <input
                      type="text"
                      value={activeRegion.customTarget}
                      onChange={(event) => handleCustomTargetChange(activeRegion.id, event.target.value)}
                      placeholder={activeRegion.description || '例如：可爱的小狗'}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900"
                    />
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">插入到文案</p>
                        <p className="mt-1 text-xs text-slate-500">
                          当前目标：{getRegionTarget(activeRegion) || '请先选择候选或手动填写'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleInsertTarget}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        插入
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">从左侧区域列表中选择一个标记，或先在图片上点击添加区域。</p>
              )}
            </section>

            <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
              <label className="mb-2 block text-sm font-semibold text-slate-900">修改要求</label>
              <textarea
                ref={textareaRef}
                value={instruction}
                onChange={(event) => {
                  setInstruction(event.target.value);
                  setSubmitError('');
                }}
                rows={6}
                placeholder="例如：将（可爱的小狗）改成可爱的小猫，保持背景和姿势不变。"
                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-900"
              />
              <p className="mt-2 text-xs text-slate-500">
                下拉候选和“插入”按钮都放在输入区附近，方便你先点图，再快速组织整句提示词。
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-semibold text-slate-900">遮罩半径</label>
                <span className="text-sm text-slate-500">{maskRadius}px</span>
              </div>
              <input
                type="range"
                min={48}
                max={180}
                step={4}
                value={maskRadius}
                onChange={(event) => setMaskRadius(Number(event.target.value))}
                className="mt-3 w-full"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>更精确</span>
                <span>更宽松</span>
              </div>

              {regions.length ? (
                <div className="mt-4 rounded-2xl bg-slate-950 px-3 py-3 text-xs leading-6 text-slate-100">
                  <p className="font-medium text-white/80">提交给重绘接口的指令</p>
                  <p className="mt-2">{buildPrompt(regions, instruction.trim())}</p>
                </div>
              ) : null}
            </section>
          </div>

          <div className="border-t border-slate-200 bg-white p-5">
            {submitError ? (
              <div className="mb-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{submitError}</div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? '提交中...' : '提交重绘'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}