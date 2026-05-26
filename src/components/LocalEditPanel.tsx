'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Image, { type ImageLoaderProps } from 'next/image';
import PointsIconLabel from '@/components/PointsIconLabel';
import { useUser } from '@/contexts/UserContext';
import { getSmartEditPoints } from '@/lib/pricing';
import { showToast } from '@/lib/toast';
import { DEFAULT_SMART_EDIT_SIZE_OPTION, SMART_EDIT_SIZE_OPTIONS, formatSmartEditSizeLabel, getSmartEditOutputSize, type SmartEditAspectRatioOption, type SmartEditResolution } from '@/lib/smartEditSize';
import { toUserFacingErrorFromUnknown, toUserFacingErrorMessage } from '@/lib/userFacingError';

type TagRegion = {
  id: string;
  naturalX: number;
  naturalY: number;
  maskRadius?: number;
  description: string;
  candidates: string[];
  selectedCandidate: string;
  confirmedCandidate: string;
  customTarget: string;
  identifyError: string;
  isIdentifying: boolean;
  hasEditorToken: boolean;
};

type BrushMaskSegment = {
  x: number;
  y: number;
  r: number;
  strokeId: string;
  color: string;
};

type ApiJsonObject = Record<string, unknown>;

type IdentifyResponse = {
  success?: boolean;
  description?: string;
  candidates?: string[];
  error?: string;
};

type MaterialEditorResponse = {
  success?: boolean;
  message?: string;
  data?: {
    orderId?: string;
    status?: string;
    url?: string;
    remainingPoints?: number;
  };
};

type LocalEditCompleteMeta = {
  orderId?: string;
  status?: string;
  remainingPoints?: number;
};

type ToolMode = 'brush' | 'tag';

type Props = {
  imageUrl: string;
  onClose: () => void;
  onComplete: (resultUrl: string, meta?: LocalEditCompleteMeta) => void | Promise<void>;
};

const TAG_REGION_COLORS = ['#a855f7', '#2563eb', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6'];
const BRUSH_SIZE_PRESETS = [16, 32, 56, 84];
const BRUSH_COLOR_OPTIONS = [
  { label: '洋红', value: '#ec4899' },
  { label: '紫色', value: '#a855f7' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '青色', value: '#14b8a6' },
  { label: '橙色', value: '#f97316' },
];
const SMART_EDIT_RESOLUTION_OPTIONS: Array<{ value: SmartEditResolution; label: string; description: string; points: number }> = [
  { value: '1k', label: '1k', description: '快速预览', points: getSmartEditPoints('1k') },
  { value: '2k', label: '2k', description: '推荐', points: getSmartEditPoints('2k') },
  { value: '4k', label: '4k', description: '最终出图', points: getSmartEditPoints('4k') },
];

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function getRegionColor(index: number) {
  return TAG_REGION_COLORS[index % TAG_REGION_COLORS.length];
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getRegionTarget(region: TagRegion) {
  return region.customTarget.trim() || region.confirmedCandidate.trim() || region.selectedCandidate.trim() || region.description.trim();
}

function isGifImageUrl(url: string) {
  return /\.gif(?:$|[?#])/i.test(url);
}

async function parseJsonApiResponse<T extends ApiJsonObject>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

export default function LocalEditPanel({ imageUrl, onClose, onComplete }: Props) {
  const { user, setPoints } = useUser();
  const sessionToken = useId().replace(/:/g, '');
  const panelRef = useRef<HTMLDivElement>(null);
  const imageViewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement>(null);
  const brushLayerRef = useRef<HTMLCanvasElement>(null);
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const identifyControllersRef = useRef<Record<string, AbortController>>({});
  const sessionIdRef = useRef(`smart-edit-${sessionToken}`);
  const handleRegionRemoveRef = useRef<(regionId: string) => void>(() => undefined);
  const applyRegionLabelRef = useRef<(regionId: string, value: string) => void>(() => undefined);
  const applyCustomRegionLabelRef = useRef<(regionId: string, value: string) => void>(() => undefined);
  const draggingRegionIdRef = useRef<string | null>(null);
  const regionDragGestureRef = useRef<{ regionId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const submitInFlightRef = useRef(false);
  const drawGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    strokeId: string;
    moved: boolean;
  } | null>(null);

  const [imageReady, setImageReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [displayScale, setDisplayScale] = useState(1);
  const [activeTool, setActiveTool] = useState<ToolMode>('brush');
  const [brushSize, setBrushSize] = useState(36);
  const [brushColor, setBrushColor] = useState(BRUSH_COLOR_OPTIONS[0].value);
  const [isBrushColorMenuOpen, setIsBrushColorMenuOpen] = useState(false);
  const [isAspectRatioMenuOpen, setIsAspectRatioMenuOpen] = useState(false);
  const [isResolutionMenuOpen, setIsResolutionMenuOpen] = useState(false);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushMaskSegments, setBrushMaskSegments] = useState<BrushMaskSegment[]>([]);
  const [tagRegions, setTagRegions] = useState<TagRegion[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [isResolvingPrompt, setIsResolvingPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [draggingRegionId, setDraggingRegionId] = useState<string | null>(null);
  const [outputSize, setOutputSize] = useState<SmartEditAspectRatioOption>(DEFAULT_SMART_EDIT_SIZE_OPTION);
  const [outputResolution, setOutputResolution] = useState<SmartEditResolution>('2k');

  const resolvedActiveRegionId = useMemo(() => {
    if (!tagRegions.length) return null;
    if (activeRegionId && tagRegions.some((region) => region.id === activeRegionId)) {
      return activeRegionId;
    }
    return tagRegions[tagRegions.length - 1]?.id || null;
  }, [activeRegionId, tagRegions]);

  const activeRegion = useMemo(() => {
    if (!tagRegions.length || !resolvedActiveRegionId) return null;
    return tagRegions.find((region) => region.id === resolvedActiveRegionId) || null;
  }, [resolvedActiveRegionId, tagRegions]);

  const brushStrokeCount = useMemo(() => {
    return new Set(brushMaskSegments.map((segment) => segment.strokeId)).size;
  }, [brushMaskSegments]);

  const selectedBrushColor = useMemo(() => {
    return BRUSH_COLOR_OPTIONS.find((option) => option.value === brushColor) || BRUSH_COLOR_OPTIONS[0];
  }, [brushColor]);

  const syncPromptFromEditor = useCallback(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;

    const serializeNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.dataset.role === 'tag-token') {
          return element.dataset.value || '';
        }

        return Array.from(element.childNodes).map(serializeNode).join('');
      }

      return '';
    };

    setInstruction(serializeNode(editor).replace(/\u00a0/g, ' '));
    setSubmitError('');
  }, []);

  const saveEditorSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const editor = promptEditorRef.current;
    if (!editor || !editor.contains(range.commonAncestorContainer)) return;

    savedSelectionRef.current = range.cloneRange();
  }, []);

  const forEachSessionTagTokenMenu = useCallback((callback: (menu: HTMLElement) => void) => {
    if (typeof document === 'undefined') return;

    document.querySelectorAll<HTMLElement>('[data-role="tag-token-menu"]').forEach((menu) => {
      if (menu.dataset.smartEditSessionId !== sessionIdRef.current) return;
      callback(menu);
    });
  }, []);

  const closeAllTagTokenMenus = useCallback(() => {
    forEachSessionTagTokenMenu((menu) => {
      menu.dataset.open = 'false';
      menu.classList.add('hidden');
    });
  }, [forEachSessionTagTokenMenu]);

  const removeTagTokenMenus = useCallback((regionId?: string) => {
    forEachSessionTagTokenMenu((menu) => {
      if (regionId && menu.dataset.regionId !== regionId) return;
      menu.remove();
    });
  }, [forEachSessionTagTokenMenu]);

  const closeBrushColorMenu = useCallback(() => {
    setIsBrushColorMenuOpen(false);
  }, []);

  const closeAspectRatioMenu = useCallback(() => {
    setIsAspectRatioMenuOpen(false);
  }, []);

  const closeResolutionMenu = useCallback(() => {
    setIsResolutionMenuOpen(false);
  }, []);

  const resolvedOutputSize = useMemo(() => {
    return getSmartEditOutputSize(outputSize, outputResolution, naturalSize);
  }, [naturalSize, outputResolution, outputSize]);

  const selectedResolutionOption = useMemo(() => {
    return SMART_EDIT_RESOLUTION_OPTIONS.find((option) => option.value === outputResolution) || SMART_EDIT_RESOLUTION_OPTIONS[1];
  }, [outputResolution]);

  const submitPoints = useMemo(() => {
    return getSmartEditPoints(outputResolution);
  }, [outputResolution]);

  const syncPoints = useCallback((points: number) => {
    setPoints(points);
    window.dispatchEvent(new CustomEvent('userPointsChanged', { detail: { points } }));
  }, [setPoints]);

  const ensureEnoughSubmitPoints = useCallback(async () => {
    if (!user?.id) {
      const message = '请先登录后再生成编辑素材';
      setSubmitError(message);
      showToast(message, 'error');
      return false;
    }

    try {
      const response = await fetch('/api/user/profile', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        if ((user.points || 0) < submitPoints) {
          const message = `积分不足，当前 ${user.points || 0}，需要 ${submitPoints}`;
          setSubmitError(message);
          showToast(message, 'error');
          return false;
        }
        return true;
      }

      const data = await response.json() as { success?: boolean; data?: { points?: number } };
      const currentPoints = data.success ? (data.data?.points || 0) : (user.points || 0);
      syncPoints(currentPoints);

      if (currentPoints < submitPoints) {
        const message = `积分不足，当前 ${currentPoints}，需要 ${submitPoints}`;
        setSubmitError(message);
        showToast(message, 'error');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[LocalEditPanel] 校验积分失败:', error);
      if ((user.points || 0) < submitPoints) {
        const message = `积分不足，当前 ${user.points || 0}，需要 ${submitPoints}`;
        setSubmitError(message);
        showToast(message, 'error');
        return false;
      }
      return true;
    }
  }, [submitPoints, syncPoints, user?.id, user?.points]);

  const promptPlaceholder = activeTool === 'tag'
    ? '例如：把标记目标改成米老鼠，保持动作、背景和光影不变；多个标记可以分别说明。'
    : '例如：把涂抹范围里的图案改成米老鼠，其他区域保持不变。';

  const isGifImage = useMemo(() => isGifImageUrl(imageUrl), [imageUrl]);

  const removeRegionTokensFromEditor = useCallback((regionId: string, options?: { keepPlaceholder?: boolean }) => {
    const editor = promptEditorRef.current;
    if (!editor) return;

    const keepPlaceholder = options?.keepPlaceholder === true;
    let placeholder = keepPlaceholder
      ? editor.querySelector<HTMLElement>(`[data-role="tag-token-placeholder"][data-region-id="${regionId}"]`)
      : null;

    if (!keepPlaceholder) {
      editor.querySelectorAll<HTMLElement>(`[data-role="tag-token-placeholder"][data-region-id="${regionId}"]`).forEach((node) => {
        node.parentNode?.removeChild(node);
      });
    }

    editor.querySelectorAll<HTMLElement>(`[data-role="tag-token"][data-region-id="${regionId}"]`).forEach((token) => {
      if (keepPlaceholder && !placeholder) {
        placeholder = document.createElement('span');
        placeholder.dataset.role = 'tag-token-placeholder';
        placeholder.dataset.regionId = regionId;
        placeholder.contentEditable = 'false';
        placeholder.className = 'inline-block h-0 w-0 overflow-hidden align-middle';
        token.parentNode?.insertBefore(placeholder, token);
      }

      const nextSibling = token.nextSibling;
      if (nextSibling?.nodeType === Node.TEXT_NODE && nextSibling.textContent?.startsWith(' ')) {
        nextSibling.textContent = nextSibling.textContent.slice(1);
        if (!nextSibling.textContent) {
          nextSibling.parentNode?.removeChild(nextSibling);
        }
      }

      token.parentNode?.removeChild(token);
    });

    removeTagTokenMenus(regionId);

    syncPromptFromEditor();
  }, [removeTagTokenMenus, syncPromptFromEditor]);

  const placeEditorSelection = useCallback((range: Range | null) => {
    const editor = promptEditorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    if (range) {
      try {
        if (editor.contains(range.commonAncestorContainer)) {
          selection.addRange(range);
          return;
        }
      } catch {
        // Fall through to a safe caret reset when the saved range references removed nodes.
      }
    } else {
      const nextRange = document.createRange();
      nextRange.selectNodeContents(editor);
      nextRange.collapse(false);
      selection.addRange(nextRange);
      savedSelectionRef.current = nextRange.cloneRange();
      return;
    }

    const nextRange = document.createRange();
    nextRange.selectNodeContents(editor);
    nextRange.collapse(false);
    selection.addRange(nextRange);
    savedSelectionRef.current = nextRange.cloneRange();
  }, []);

  const createTagTokenElement = useCallback((region: TagRegion, index: number, label: string) => {
    const safeIndex = index >= 0 ? index : 0;
    removeTagTokenMenus(region.id);

    const token = document.createElement('span');
    token.dataset.role = 'tag-token';
    token.dataset.regionId = region.id;
    token.dataset.value = label;
    token.contentEditable = 'false';
    token.className = 'group relative mx-0.5 inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/[0.10] px-2 py-1 align-middle text-sm text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]';

    const thumb = document.createElement('span');
    thumb.className = 'h-5 w-5 shrink-0 rounded-md border border-white/12 bg-cover bg-no-repeat';
    thumb.style.backgroundImage = `url("${imageUrl}")`;
    if (naturalSize.width > 0 && naturalSize.height > 0) {
      thumb.style.backgroundSize = `${Math.max(44, Math.round((naturalSize.width / naturalSize.height) * 28))}px 28px`;
      thumb.style.backgroundPosition = `${(region.naturalX / naturalSize.width) * 100}% ${(region.naturalY / naturalSize.height) * 100}%`;
    } else {
      thumb.style.backgroundPosition = 'center';
      thumb.style.backgroundSize = 'cover';
    }

    const badge = document.createElement('span');
    badge.className = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white';
    badge.style.backgroundColor = getRegionColor(safeIndex);
    badge.textContent = String(safeIndex + 1);

    const labelButton = document.createElement('button');
    labelButton.type = 'button';
    labelButton.dataset.role = 'tag-token-toggle';
    labelButton.className = 'flex min-w-0 items-center gap-1.5 rounded-full text-left outline-none transition';

    const labelText = document.createElement('span');
    labelText.dataset.role = 'tag-token-label';
    labelText.className = 'max-w-[140px] truncate';
    labelText.textContent = label;

    const chevron = document.createElement('span');
    chevron.className = 'shrink-0 text-[10px] text-white/55';
    chevron.textContent = '▾';

    labelButton.append(labelText, chevron);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.dataset.role = 'tag-token-delete';
    deleteButton.className = 'ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white/60 transition hover:bg-white/15 hover:text-white';
    deleteButton.textContent = '×';

    const menu = document.createElement('div');
    menu.dataset.role = 'tag-token-menu';
    menu.dataset.open = 'false';
    menu.dataset.regionId = region.id;
    menu.dataset.smartEditSessionId = sessionIdRef.current;
    menu.className = 'fixed z-[10000] hidden min-w-[180px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-white/14 bg-[#0b0b12] p-1 shadow-[0_24px_60px_rgba(0,0,0,0.5)]';
    menu.addEventListener('pointerdown', (event) => event.stopPropagation());
    menu.addEventListener('click', (event) => event.stopPropagation());

    const options = Array.from(new Set([
      ...region.candidates.map((candidate) => candidate.trim()).filter(Boolean),
      label,
    ]));

    options.forEach((option) => {
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white';

      const optionBadge = document.createElement('span');
      optionBadge.className = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white';
      optionBadge.style.backgroundColor = getRegionColor(safeIndex);
      optionBadge.textContent = String(safeIndex + 1);

      const optionText = document.createElement('span');
      optionText.className = 'min-w-0 flex-1 truncate';
      optionText.textContent = option;

      optionButton.append(optionBadge, optionText);
      optionButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeAllTagTokenMenus();
        applyRegionLabelRef.current(region.id, option);
      });

      menu.appendChild(optionButton);
    });

    const customSection = document.createElement('div');
    customSection.className = 'mt-1 rounded-xl border border-dashed border-white/12 bg-white/[0.03] p-2';

    const customLabel = document.createElement('div');
    customLabel.className = 'mb-1.5 text-[11px] text-white/42';
    customLabel.textContent = '自定义输入';

    const customRow = document.createElement('div');
    customRow.className = 'flex items-center gap-1.5';

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.value = region.customTarget || '';
    customInput.placeholder = '输入标记名称';
    customInput.className = 'min-w-0 flex-1 rounded-lg border border-white/10 bg-black/28 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/28 focus:border-fuchsia-300/45 focus:bg-black/38';

    const applyCustomInput = () => {
      const customValue = customInput.value.trim();
      if (!customValue) {
        customInput.focus();
        return;
      }
      closeAllTagTokenMenus();
      applyCustomRegionLabelRef.current(region.id, customValue);
    };

    customInput.addEventListener('pointerdown', (event) => event.stopPropagation());
    customInput.addEventListener('click', (event) => event.stopPropagation());
    customInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        applyCustomInput();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAllTagTokenMenus();
      }
    });

    const customApplyButton = document.createElement('button');
    customApplyButton.type = 'button';
    customApplyButton.className = 'rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/74 transition hover:bg-white/18 hover:text-white';
    customApplyButton.textContent = '应用';
    customApplyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyCustomInput();
    });

    customRow.append(customInput, customApplyButton);
    customSection.append(customLabel, customRow);
    menu.appendChild(customSection);

    const placeMenu = () => {
      const tokenRect = token.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 8;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, tokenRect.left),
        Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding)
      );
      const openAbove = window.innerHeight - tokenRect.bottom < menuRect.height + margin + viewportPadding
        && tokenRect.top > window.innerHeight - tokenRect.bottom;
      const nextTop = openAbove
        ? tokenRect.top - menuRect.height - margin
        : tokenRect.bottom + margin;
      const top = Math.min(
        Math.max(viewportPadding, nextTop),
        Math.max(viewportPadding, window.innerHeight - menuRect.height - viewportPadding)
      );

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };

    const toggleMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = menu.dataset.open === 'true';
      closeAllTagTokenMenus();
      if (!isOpen) {
        menu.dataset.open = 'true';
        menu.style.visibility = 'hidden';
        menu.classList.remove('hidden');
        placeMenu();
        menu.style.visibility = '';
      }
    };

    labelButton.addEventListener('click', toggleMenu);

    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleRegionRemoveRef.current(region.id);
    });

    document.body.appendChild(menu);
    token.append(thumb, badge, labelButton, deleteButton);
    return token;
  }, [closeAllTagTokenMenus, imageUrl, naturalSize.height, naturalSize.width, removeTagTokenMenus]);

  const insertTagTokenIntoEditor = useCallback((region: TagRegion, label: string, options?: { tokenIndex?: number; append?: boolean }) => {
    const editor = promptEditorRef.current;
    if (!editor) {
      setInstruction((current) => `${current}${label}`);
      return;
    }

    const tokenIndex = options?.tokenIndex ?? tagRegions.findIndex((item) => item.id === region.id);
    const token = createTagTokenElement(region, tokenIndex, label);
    const existingToken = editor.querySelector<HTMLElement>(`[data-role="tag-token"][data-region-id="${region.id}"]`);
    if (existingToken) {
      existingToken.replaceWith(token);
      syncPromptFromEditor();
      requestAnimationFrame(() => placeEditorSelection(savedSelectionRef.current));
      return;
    }

    const placeholder = editor.querySelector<HTMLElement>(`[data-role="tag-token-placeholder"][data-region-id="${region.id}"]`);
    if (placeholder) {
      const spacer = document.createTextNode(' ');
      placeholder.replaceWith(token, spacer);

      syncPromptFromEditor();
      return;
    }

    const spacer = document.createTextNode(' ');

    if (options?.append) {
      editor.append(token, spacer);
      syncPromptFromEditor();
      return;
    }

    const range = savedSelectionRef.current;
    if (range && editor.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      range.deleteContents();
      range.insertNode(spacer);
      range.insertNode(token);
      range.setStartAfter(spacer);
      range.setEndAfter(spacer);
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedSelectionRef.current = range.cloneRange();
    } else {
      editor.append(token, spacer);
      const selection = window.getSelection();
      const nextRange = document.createRange();
      nextRange.setStartAfter(spacer);
      nextRange.setEndAfter(spacer);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
      savedSelectionRef.current = nextRange.cloneRange();
    }

    syncPromptFromEditor();
    requestAnimationFrame(() => placeEditorSelection(savedSelectionRef.current));
  }, [createTagTokenElement, placeEditorSelection, syncPromptFromEditor, tagRegions]);

  const handlePromptEditorInput = useCallback(() => {
    syncPromptFromEditor();
  }, [syncPromptFromEditor]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const panel = panelRef.current;
      const editor = promptEditorRef.current;
      if (!target) return;
      const isTagTokenMenuTarget = target instanceof Element && Boolean(target.closest('[data-role="tag-token-menu"]'));
      if (editor && !editor.contains(target) && !isTagTokenMenuTarget) {
        closeAllTagTokenMenus();
      }
      if (!(target instanceof Element) || !target.closest('[data-role="brush-color-menu"]')) {
        closeBrushColorMenu();
      }
      if (!(target instanceof Element) || !target.closest('[data-role="aspect-ratio-menu"]')) {
        closeAspectRatioMenu();
      }
      if (!(target instanceof Element) || !target.closest('[data-role="resolution-menu"]')) {
        closeResolutionMenu();
      }
      if (panel && !panel.contains(target) && !isTagTokenMenuTarget) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeAllTagTokenMenus, closeAspectRatioMenu, closeBrushColorMenu, closeResolutionMenu, onClose]);

  useEffect(() => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    if (editor.textContent?.trim()) return;
    if (!instruction.trim()) return;

    editor.textContent = instruction;
  }, [instruction]);

  const syncImageMetrics = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    setImageReady(true);
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    let nextCanvasSize = { width: img.clientWidth || img.naturalWidth, height: img.clientHeight || img.naturalHeight };

    const viewport = imageViewportRef.current;
    const viewportWidth = viewport?.clientWidth || 0;
    const viewportHeight = viewport?.clientHeight || 0;

    if (viewportWidth > 0 && viewportHeight > 0) {
      const naturalRatio = img.naturalWidth / img.naturalHeight;
      const viewportRatio = viewportWidth / viewportHeight;
      const nextDisplaySize = naturalRatio > viewportRatio
        ? { width: viewportWidth, height: viewportWidth / naturalRatio }
        : { width: viewportHeight * naturalRatio, height: viewportHeight };

      setDisplaySize(nextDisplaySize);
      setDisplayScale(nextDisplaySize.width / img.naturalWidth);
      nextCanvasSize = nextDisplaySize;
    } else {
      const rect = img.getBoundingClientRect();
      if (rect.width && rect.height) {
        setDisplaySize({ width: rect.width, height: rect.height });
        setDisplayScale(rect.width / img.naturalWidth);
        nextCanvasSize = { width: rect.width, height: rect.height };
      }
    }

    const brushCanvas = brushCanvasRef.current;
    const brushLayer = brushLayerRef.current;
    if (brushCanvas && brushLayer) {
      const canvasWidth = Math.max(1, Math.round(nextCanvasSize.width));
      const canvasHeight = Math.max(1, Math.round(nextCanvasSize.height));
      brushCanvas.width = canvasWidth;
      brushCanvas.height = canvasHeight;
      brushLayer.width = canvasWidth;
      brushLayer.height = canvasHeight;
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
      syncImageMetrics();
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [imageReady, imageUrl, naturalSize.width, syncImageMetrics]);

  useEffect(() => {
    const viewport = imageViewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() => {
      syncImageMetrics();
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncImageMetrics]);

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
      removeTagTokenMenus();
      Object.values(identifyControllersRef.current).forEach((controller) => controller.abort());
      identifyControllersRef.current = {};
    };
  }, [removeTagTokenMenus]);

  useEffect(() => {
    if (!imageUrl) return;

    const controller = new AbortController();

    void fetch('/api/smart-edit/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prewarm', imageUrl, sessionId: sessionIdRef.current }),
      signal: controller.signal,
    }).catch((error) => {
      if (controller.signal.aborted) return;
      console.warn('[LocalEditPanel] 预热识别资源失败:', error);
    });

    return () => controller.abort();
  }, [imageUrl]);

  const clearBrushMask = useCallback(() => {
    setBrushMaskSegments([]);
    const ctx = brushCanvasRef.current?.getContext('2d');
    if (ctx && brushCanvasRef.current) {
      ctx.clearRect(0, 0, brushCanvasRef.current.width, brushCanvasRef.current.height);
    }
  }, []);

  const clearAllTagRegions = useCallback(() => {
    Object.values(identifyControllersRef.current).forEach((controller) => controller.abort());
    identifyControllersRef.current = {};
    closeAllTagTokenMenus();

    const editor = promptEditorRef.current;
    if (editor) {
      editor.querySelectorAll<HTMLElement>('[data-role="tag-token"], [data-role="tag-token-placeholder"]').forEach((node) => {
        const nextSibling = node.nextSibling;
        if (nextSibling?.nodeType === Node.TEXT_NODE && nextSibling.textContent?.startsWith(' ')) {
          nextSibling.textContent = nextSibling.textContent.slice(1);
          if (!nextSibling.textContent) {
            nextSibling.parentNode?.removeChild(nextSibling);
          }
        }
        node.parentNode?.removeChild(node);
      });
      syncPromptFromEditor();
    }

    draggingRegionIdRef.current = null;
    regionDragGestureRef.current = null;
    setDraggingRegionId(null);
    setActiveRegionId(null);
    setTagRegions([]);
  }, [closeAllTagTokenMenus, syncPromptFromEditor]);

  const handleToolChange = useCallback((nextTool: ToolMode) => {
    if (nextTool === activeTool) return;

    setSubmitError('');
    setBrushCursor(null);
    setIsDrawing(false);
    drawGestureRef.current = null;
    closeBrushColorMenu();
    closeAspectRatioMenu();
    closeResolutionMenu();

    if (nextTool === 'brush') {
      clearAllTagRegions();
    } else {
      clearBrushMask();
    }

    setActiveTool(nextTool);
  }, [activeTool, clearAllTagRegions, clearBrushMask, closeAspectRatioMenu, closeBrushColorMenu, closeResolutionMenu]);

  const undoLastBrushStroke = useCallback(() => {
    setBrushMaskSegments((current) => {
      const lastStrokeId = current.at(-1)?.strokeId;
      if (!lastStrokeId) return current;
      return current.filter((segment) => segment.strokeId !== lastStrokeId);
    });
  }, []);

  const redrawBrushLayer = useCallback((segments: BrushMaskSegment[]) => {
    const canvas = brushLayerRef.current;
    if (!canvas || naturalSize.width <= 0 || naturalSize.height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = canvas.width / naturalSize.width;
    const scaleY = canvas.height / naturalSize.height;
    const radiusScale = Math.max(scaleX, scaleY);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    segments.forEach((segment) => {
      ctx.fillStyle = withAlpha(segment.color, 0.88);
      ctx.beginPath();
      ctx.arc(segment.x * scaleX, segment.y * scaleY, segment.r * radiusScale, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [naturalSize.height, naturalSize.width]);

  useEffect(() => {
    redrawBrushLayer(brushMaskSegments);
  }, [brushMaskSegments, displaySize.height, displaySize.width, redrawBrushLayer]);

  const handleBrushPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = brushCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageReady || isSubmitting) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const naturalX = (offsetX / rect.width) * img.naturalWidth;
    const naturalY = (offsetY / rect.height) * img.naturalHeight;
    const radius = displayScale > 0 ? Math.max(8, brushSize / displayScale) : brushSize;

    const strokeId = drawGestureRef.current?.strokeId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setBrushMaskSegments((current) => [...current, { x: naturalX, y: naturalY, r: radius, strokeId, color: brushColor }]);
  }, [brushColor, brushSize, displayScale, imageReady, isSubmitting]);

  const handleBrushDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const canvas = brushCanvasRef.current;
    if (canvas && activeTool === 'brush') {
      const rect = canvas.getBoundingClientRect();
      setBrushCursor({
        x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
        y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
      });
    }

    drawGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      strokeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      moved: false,
    };

    setIsDrawing(true);
    if (activeTool === 'brush') {
      handleBrushPointer(event);
    }
  }, [activeTool, handleBrushPointer]);

  const handleBrushMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = brushCanvasRef.current;
    if (canvas && activeTool === 'brush') {
      const rect = canvas.getBoundingClientRect();
      setBrushCursor({
        x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
        y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
      });
    } else if (activeTool !== 'brush') {
      setBrushCursor(null);
    }

    const gesture = drawGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (!gesture.moved) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.hypot(dx, dy) > 6) {
        gesture.moved = true;
      }
    }

    if (!isDrawing) return;
    if (activeTool !== 'brush') return;
    handleBrushPointer(event);
  }, [activeTool, handleBrushPointer, isDrawing]);

  const identifyRegion = useCallback(async (regionId: string, naturalX: number, naturalY: number, imageWidth: number, imageHeight: number, options?: { forceRefresh?: boolean }) => {
    const controller = new AbortController();
    identifyControllersRef.current[regionId]?.abort();
    identifyControllersRef.current[regionId] = controller;

    try {
      const response = await fetch('/api/smart-edit/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, clickX: naturalX, clickY: naturalY, imageWidth, imageHeight, forceRefresh: options?.forceRefresh === true, sessionId: sessionIdRef.current }),
        signal: controller.signal,
      });

      const result = await parseJsonApiResponse<IdentifyResponse>(response, '识别失败，请重试');
      if (!response.ok || !result.success) {
        throw new Error(toUserFacingErrorMessage(result.error, '识别失败，请重试'));
      }

      if (identifyControllersRef.current[regionId] !== controller) {
        return;
      }

      const normalizedCandidates = Array.from(new Set([...(result.candidates || []), result.description || ''].map((item) => item.trim()).filter(Boolean))).slice(0, 4);
      const initialLabel = normalizedCandidates[0] || result.description?.trim() || '';
      let tokenIndex = 0;
      let regionStillExists = false;
      const nextRegion: TagRegion = {
        id: regionId,
        naturalX,
        naturalY,
        description: result.description?.trim() || initialLabel,
        candidates: normalizedCandidates,
        selectedCandidate: initialLabel,
        confirmedCandidate: initialLabel,
        customTarget: '',
        identifyError: '',
        isIdentifying: false,
        hasEditorToken: true,
      };

      setTagRegions((current) => {
        const next = current.map((region) => region.id === regionId ? {
          ...region,
          description: nextRegion.description,
          candidates: nextRegion.candidates,
          selectedCandidate: region.selectedCandidate || nextRegion.selectedCandidate,
          confirmedCandidate: region.confirmedCandidate || nextRegion.confirmedCandidate,
          identifyError: '',
          isIdentifying: false,
          hasEditorToken: initialLabel ? true : region.hasEditorToken,
        } : region);
        tokenIndex = next.findIndex((region) => region.id === regionId);
        regionStillExists = tokenIndex >= 0;
        return next;
      });

      if (initialLabel && regionStillExists && identifyControllersRef.current[regionId] === controller) {
        insertTagTokenIntoEditor(nextRegion, initialLabel, { tokenIndex, append: true });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = toUserFacingErrorFromUnknown(error, '识别失败，请重试');
      setTagRegions((current) => current.map((region) => region.id === regionId ? { ...region, identifyError: message, isIdentifying: false } : region));
    } finally {
      if (identifyControllersRef.current[regionId] === controller) {
        delete identifyControllersRef.current[regionId];
      }
    }
  }, [imageUrl, insertTagTokenIntoEditor]);

  const getNaturalPointFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img?.naturalWidth || !img?.naturalHeight) return null;

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const offsetY = Math.min(Math.max(clientY - rect.top, 0), rect.height);

    return {
      naturalX: Math.round((offsetX / rect.width) * img.naturalWidth),
      naturalY: Math.round((offsetY / rect.height) * img.naturalHeight),
      imageWidth: img.naturalWidth,
      imageHeight: img.naturalHeight,
    };
  }, []);

  const addTagRegionFromPointer = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !imageReady || isSubmitting || !img.naturalWidth || !img.naturalHeight) return;

    const point = getNaturalPointFromClientPoint(clientX, clientY);
    if (!point) return;

    const { naturalX, naturalY, imageWidth, imageHeight } = point;
    const regionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setSubmitError('');
    setTagRegions((current) => [...current, { id: regionId, naturalX, naturalY, description: '', candidates: [], selectedCandidate: '', confirmedCandidate: '', customTarget: '', identifyError: '', isIdentifying: true, hasEditorToken: false }]);
    setActiveRegionId(regionId);
    void identifyRegion(regionId, naturalX, naturalY, imageWidth, imageHeight);
  }, [getNaturalPointFromClientPoint, identifyRegion, imageReady, isSubmitting]);

  const handleBrushUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = drawGestureRef.current;
    if (gesture && gesture.pointerId === event.pointerId && !gesture.moved && activeTool === 'tag') {
      setBrushMaskSegments((current) => current.filter((segment) => segment.strokeId !== gesture.strokeId));
      addTagRegionFromPointer(event.clientX, event.clientY);
    }

    drawGestureRef.current = null;
    setIsDrawing(false);
  }, [activeTool, addTagRegionFromPointer]);

  const handleBrushLeave = useCallback(() => {
    drawGestureRef.current = null;
    setBrushCursor(null);
    setIsDrawing(false);
  }, []);

  const handleRegionRemove = useCallback((regionId: string) => {
    identifyControllersRef.current[regionId]?.abort();
    delete identifyControllersRef.current[regionId];

    setTagRegions((current) => current.filter((region) => region.id !== regionId));
    removeRegionTokensFromEditor(regionId);
    setSubmitError('');
  }, [removeRegionTokensFromEditor]);

  const updateRegionPositionFromPointer = useCallback((regionId: string, clientX: number, clientY: number) => {
    const point = getNaturalPointFromClientPoint(clientX, clientY);
    if (!point) return;

    const { naturalX, naturalY } = point;

    setTagRegions((current) => current.map((region) => region.id === regionId ? {
      ...region,
      naturalX,
      naturalY,
      identifyError: '',
    } : region));
  }, [getNaturalPointFromClientPoint]);

  const handleCandidateSelect = useCallback((regionId: string, value: string) => {
    const region = tagRegions.find((item) => item.id === regionId) || null;
    const target = value.trim() || region?.description.trim() || '';
    const nextCustomTarget = value.trim() ? '' : (region?.customTarget || '');

    const nextRegion = region ? {
      ...region,
      selectedCandidate: value,
      confirmedCandidate: value,
      customTarget: nextCustomTarget,
      hasEditorToken: true,
    } : null;

    setTagRegions((current) => current.map((item) => item.id === regionId ? {
      ...item,
      selectedCandidate: value,
      confirmedCandidate: value,
      customTarget: value.trim() ? '' : item.customTarget,
      hasEditorToken: true,
    } : item));
    setSubmitError('');

    if (nextRegion && target) {
      insertTagTokenIntoEditor(nextRegion, target, { tokenIndex: tagRegions.findIndex((item) => item.id === regionId) });
    }
  }, [insertTagTokenIntoEditor, tagRegions]);

  const handleCustomCandidateSubmit = useCallback((regionId: string, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;

    const region = tagRegions.find((item) => item.id === regionId) || null;
    const nextRegion = region ? {
      ...region,
      candidates: [value, ...region.candidates.filter((candidate) => candidate.trim() !== value)].slice(0, 4),
      selectedCandidate: value,
      confirmedCandidate: value,
      customTarget: value,
      description: region.description || value,
      hasEditorToken: true,
    } : null;

    setTagRegions((current) => current.map((item) => item.id === regionId ? {
      ...item,
      candidates: [value, ...item.candidates.filter((candidate) => candidate.trim() !== value)].slice(0, 4),
      selectedCandidate: value,
      confirmedCandidate: value,
      customTarget: value,
      description: item.description || value,
      identifyError: '',
      hasEditorToken: true,
    } : item));
    setSubmitError('');

    if (nextRegion) {
      insertTagTokenIntoEditor(nextRegion, value, { tokenIndex: tagRegions.findIndex((item) => item.id === regionId) });
    }
  }, [insertTagTokenIntoEditor, tagRegions]);

  useEffect(() => {
    handleRegionRemoveRef.current = handleRegionRemove;
  }, [handleRegionRemove]);

  useEffect(() => {
    applyRegionLabelRef.current = (regionId: string, value: string) => {
      handleCandidateSelect(regionId, value);
    };
  }, [handleCandidateSelect]);

  useEffect(() => {
    applyCustomRegionLabelRef.current = (regionId: string, value: string) => {
      handleCustomCandidateSubmit(regionId, value);
    };
  }, [handleCustomCandidateSubmit]);

  const handleRetryIdentify = useCallback((region: TagRegion | null) => {
    const img = imgRef.current;
    if (!region || !img?.naturalWidth || !img?.naturalHeight) return;

    removeRegionTokensFromEditor(region.id, { keepPlaceholder: true });
    setTagRegions((current) => current.map((item) => item.id === region.id ? {
      ...item,
      description: '',
      candidates: [],
      selectedCandidate: '',
      confirmedCandidate: '',
      customTarget: '',
      identifyError: '',
      isIdentifying: true,
    } : item));

    void identifyRegion(region.id, region.naturalX, region.naturalY, img.naturalWidth, img.naturalHeight, { forceRefresh: true });
  }, [identifyRegion, removeRegionTokensFromEditor]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = regionDragGestureRef.current;
      if (!gesture) return;

      if (!gesture.moved) {
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (Math.hypot(dx, dy) <= 6) return;
        gesture.moved = true;
      }

      updateRegionPositionFromPointer(gesture.regionId, event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const regionId = draggingRegionIdRef.current;
      const gesture = regionDragGestureRef.current;
      const shouldReidentify = gesture?.moved === true;

      draggingRegionIdRef.current = null;
      regionDragGestureRef.current = null;
      setDraggingRegionId(null);

      if (!regionId || !shouldReidentify) return;

      const point = getNaturalPointFromClientPoint(event.clientX, event.clientY);
      if (!point) return;

      removeRegionTokensFromEditor(regionId, { keepPlaceholder: true });

      setTagRegions((current) => current.map((item) => item.id === regionId ? {
        ...item,
        naturalX: point.naturalX,
        naturalY: point.naturalY,
        description: '',
        candidates: [],
        selectedCandidate: '',
        confirmedCandidate: '',
        customTarget: '',
        identifyError: '',
        isIdentifying: true,
      } : item));

      void identifyRegion(regionId, point.naturalX, point.naturalY, point.imageWidth, point.imageHeight, { forceRefresh: true });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [getNaturalPointFromClientPoint, identifyRegion, removeRegionTokensFromEditor, updateRegionPositionFromPointer]);

  const handleSubmit = useCallback(async () => {
    if (submitInFlightRef.current || isSubmitting || isResolvingPrompt) {
      return;
    }

    setSubmitError('');
    const submitMode = activeTool;
    const submitRegions = submitMode === 'tag' ? tagRegions : [];
    const submitBrushSegments = submitMode === 'brush' ? brushMaskSegments : [];
    const hasTagRegions = submitRegions.length > 0;
    const hasBrushMask = submitBrushSegments.length > 0;

    if (!imgRef.current?.naturalWidth || !imgRef.current?.naturalHeight) {
      setSubmitError('图片还没有准备好，请稍后重试');
      return;
    }

    if (!hasBrushMask && !hasTagRegions) {
      setSubmitError(activeTool === 'tag' ? '请先点击图片添加标记点位' : '请先用画笔涂抹要修改的区域');
      return;
    }

    if (submitRegions.some((region) => region.isIdentifying)) {
      setSubmitError('还有区域正在识别，请等待完成后再提交');
      return;
    }

    if (submitMode === 'tag' && submitRegions.some((region) => region.identifyError.trim())) {
      setSubmitError('有标记识别失败，请拖动点位重试或删除后再提交');
      return;
    }

    if (submitMode === 'tag' && submitRegions.some((region) => !getRegionTarget(region))) {
      setSubmitError('有标记尚未确认，请先选择候选后再提交');
      return;
    }

    const promptText = instruction.trim();
    if (!promptText) {
      setSubmitError(activeTool === 'tag' && hasTagRegions ? '请先选择标记，并补充前后文案' : '请先填写你希望如何修改该区域');
      return;
    }

    const hasEnoughPoints = await ensureEnoughSubmitPoints();
    if (!hasEnoughPoints) return;

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setIsResolvingPrompt(true);
    let completedResultUrl = '';
    let completedMeta: LocalEditCompleteMeta | undefined;

    try {
      const formData = new FormData();
      formData.append('action', 'redraw');
      formData.append('imageUrl', imageUrl);
      formData.append('aspectRatio', outputSize);
      formData.append('outputSize', JSON.stringify({
        width: resolvedOutputSize.width,
        height: resolvedOutputSize.height,
      }));
      formData.append('resolution', outputResolution);
      formData.append('sourceSize', JSON.stringify(naturalSize));
      formData.append('sessionId', sessionIdRef.current);
      formData.append('mode', submitMode);
      formData.append('regions', JSON.stringify(submitRegions));
      formData.append('brushSegments', JSON.stringify(submitBrushSegments));
      formData.append('prompt', promptText);

      const response = await fetch('/api/material-editor', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await parseJsonApiResponse<MaterialEditorResponse>(response, '暂时未能完成处理，请稍后重试');
      if (!response.ok || !data.success || (!data.data?.url && !data.data?.orderId)) {
        throw new Error(toUserFacingErrorMessage(data.message, '暂时未能完成处理，请稍后重试'));
      }

      completedResultUrl = data.data.url || '';
      completedMeta = {
        orderId: data.data.orderId,
        status: data.data.status,
        remainingPoints: data.data.remainingPoints,
      };
    } catch (error) {
      const message = toUserFacingErrorFromUnknown(error, '暂时未能完成处理，请稍后重试');
      setSubmitError(message);
      showToast(message, 'error');
    } finally {
      submitInFlightRef.current = false;
      setIsResolvingPrompt(false);
      setIsSubmitting(false);
    }

    if (completedResultUrl || completedMeta?.orderId) {
      Promise.resolve()
        .then(() => onComplete(completedResultUrl, completedMeta))
        .catch((error) => {
          console.error('[LocalEditPanel] 完成后刷新素材库失败:', error);
          showToast('任务已提交，但订单记录刷新稍慢，请稍后查看', 'info');
        });
      onClose();
    }
  }, [activeTool, brushMaskSegments, ensureEnoughSubmitPoints, imageUrl, instruction, isResolvingPrompt, isSubmitting, naturalSize, onClose, onComplete, outputResolution, outputSize, resolvedOutputSize, tagRegions]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/72 px-4 py-4 backdrop-blur-[2px]">
      <div ref={panelRef} className="flex h-[92vh] w-full max-w-[1320px] overflow-hidden bg-transparent sm:h-[92vh]">
        <div className="flex min-w-0 flex-1 flex-col bg-transparent text-white">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <h2 className="text-base font-medium tracking-[-0.02em] text-white/92">智能改图</h2>
              <p className="mt-0.5 text-[11px] text-white/34">先选择工具，再用画笔圈选修改范围或用标记定位目标区域。</p>
            </div>
            <button onClick={onClose} disabled={isSubmitting} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xl leading-none text-white/80 transition-colors hover:bg-black/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" title="关闭">×</button>
          </div>

          <div className="flex-1 overflow-hidden p-2">
            <div className="grid h-full min-h-[520px] grid-rows-[minmax(0,1fr)_auto] gap-2 p-0">
              <div className="min-h-0 overflow-hidden px-1 pb-2">
                <div ref={imageViewportRef} className="flex h-full w-full items-center justify-center overflow-hidden">
                  <div
                    className="relative z-10 shrink-0 overflow-visible leading-none"
                    style={displaySize.width > 0 && displaySize.height > 0 ? {
                      width: `${displaySize.width}px`,
                      height: `${displaySize.height}px`,
                    } : undefined}
                  >
                    <Image
                      ref={imgRef}
                      src={imageUrl}
                      alt="智能改图素材"
                      fill
                      sizes="100vw"
                      loader={passthroughImageLoader}
                      unoptimized
                      onLoad={syncImageMetrics}
                      className="block h-full w-full object-contain"
                    />

                    <canvas
                      ref={brushLayerRef}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      style={{ opacity: activeTool === 'brush' ? 0.8 : 0 }}
                    />

                    {activeTool === 'brush' && brushCursor && displaySize.width > 0 && displaySize.height > 0 ? (
                      <div
                        className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                        style={{
                          left: `${brushCursor.x}px`,
                          top: `${brushCursor.y}px`,
                          width: `${brushSize}px`,
                          height: `${brushSize}px`,
                          borderColor: withAlpha(brushColor, 0.9),
                          backgroundColor: withAlpha(brushColor, 0.12),
                          boxShadow: `0 0 0 1px ${withAlpha('#ffffff', 0.16)}`,
                        }}
                      />
                    ) : null}

                    <canvas
                      ref={brushCanvasRef}
                      className={`absolute inset-0 h-full w-full ${activeTool === 'tag' ? 'cursor-copy' : 'cursor-none'}`}
                      onPointerDown={handleBrushDown}
                      onPointerMove={handleBrushMove}
                      onPointerUp={handleBrushUp}
                      onPointerLeave={handleBrushLeave}
                    />

                    {activeTool === 'tag' && imageReady && naturalSize.width > 0 ? (
                     <div
                       className="pointer-events-none absolute inset-0 z-20 overflow-visible"
                     >
                    {tagRegions.map((region, index) => {
                      const isActive = region.id === resolvedActiveRegionId;
                      const isConfirmed = Boolean(region.confirmedCandidate);
                      const isDragging = draggingRegionId === region.id;
                      const hasError = Boolean(region.identifyError);
                      const color = getRegionColor(index);
                      const pointLeft = `${(region.naturalX / naturalSize.width) * 100}%`;
                      const pointTop = `${(region.naturalY / naturalSize.height) * 100}%`;
                       const rangeDiameter = isActive ? 48 : 38;
                      return (
                        <Fragment key={region.id}>
                          <div
                            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
                            style={{
                              left: pointLeft,
                              top: pointTop,
                              width: `${rangeDiameter}px`,
                              height: `${rangeDiameter}px`,
                              borderColor: isActive ? `${color}cc` : `${color}66`,
                              backgroundColor: `${color}${isActive ? '16' : '0d'}`,
                              boxShadow: isActive ? `0 0 0 1px ${color}33, inset 0 0 28px ${color}18` : undefined,
                            }}
                          />
                          <button
                            type="button"
                            data-role="tag-point-button"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                draggingRegionIdRef.current = region.id;
                                regionDragGestureRef.current = {
                                  regionId: region.id,
                                  startX: event.clientX,
                                  startY: event.clientY,
                                  moved: false,
                                };
                                setDraggingRegionId(region.id);
                                setActiveRegionId(region.id);
                              }}
                             onClick={(event) => {
                               event.stopPropagation();
                               setActiveRegionId(region.id);
                             }}
                          className={`pointer-events-auto absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(0,0,0,0.2)] transition ${isDragging ? 'scale-110 cursor-grabbing' : 'hover:scale-105 cursor-grab'} ${isConfirmed ? '' : 'bg-black/40 backdrop-blur-[2px]'}`}
                                style={{
                                left: pointLeft,
                                top: pointTop,
                                backgroundColor: color,
                                borderColor: hasError ? '#fca5a5' : isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
                                boxShadow: hasError ? '0 0 0 6px rgba(239,68,68,0.18)' : isActive ? `0 0 0 6px ${color}33` : `0 0 0 4px ${color}1f`,
                                opacity: region.isIdentifying ? 0.88 : 1,
                              }}
                          >
                            {region.isIdentifying ? (
                              <span className="pointer-events-none absolute inset-[-6px] rounded-full border border-white/30" />
                            ) : !isConfirmed ? (
                              <span
                                className="pointer-events-none absolute inset-[-8px] rounded-full animate-ping"
                                style={{ backgroundColor: `${color}55` }}
                              />
                            ) : null}
                            <span className={`relative z-10 ${!isConfirmed ? 'text-white' : 'text-white'}`}>
                            {index + 1}
                            </span>
                          </button>
                        </Fragment>
                      );
                    })}

                    {activeRegion ? (
                      <div
                        data-role="tag-overlay-popup"
                        className="pointer-events-auto absolute w-[248px] max-w-[70vw] rounded-[1rem] border border-white/10 bg-black/52 p-2.5 text-left shadow-[0_14px_32px_rgba(0,0,0,0.26)] backdrop-blur-xl"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        style={(() => {
                          const xRatio = activeRegion.naturalX / naturalSize.width;
                          const yRatio = activeRegion.naturalY / naturalSize.height;
                          const left = xRatio < 0.18 ? '0%' : xRatio > 0.82 ? '100%' : `${xRatio * 100}%`;
                          const top = `${yRatio * 100}%`;
                          const translateX = xRatio < 0.18 ? '0%' : xRatio > 0.82 ? '-100%' : '-50%';
                          const translateY = yRatio < 0.22 ? '18px' : 'calc(-100% - 18px)';

                          return {
                            left,
                            top,
                            transform: `translate(${translateX}, ${translateY})`,
                          };
                        })()}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] tracking-[0.08em] text-white/32">可选标记</p>
                            <p className="mt-1 text-[13px] leading-5 text-white/68">
                              {activeRegion.isIdentifying
                                ? draggingRegionId === activeRegion.id
                                  ? '已移动点位，正在重新识别...'
                                  : '正在识别点击位置...'
                                : activeRegion.identifyError
                                  ? activeRegion.identifyError
                                  : activeRegion.confirmedCandidate
                                    ? activeRegion.description || '点位已添加'
                                    : `已定位到该区域${activeRegion.description ? `，建议：${activeRegion.description}` : ''}`}
                            </p>
                            {activeRegion.identifyError ? (
                              <p className="mt-1 text-[11px] text-red-200/80">可拖动点位后重试，或从输入框标记下拉中自定义。</p>
                            ) : activeRegion.isIdentifying ? (
                              <p className="mt-1 text-[11px] text-white/34">识别中可继续操作其他点位。</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!activeRegion.isIdentifying ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRetryIdentify(activeRegion);
                                }}
                                className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/56 transition hover:bg-white/8 hover:text-white"
                              >
                                重试
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRegionRemove(activeRegion.id);
                              }}
                              className="rounded-full border border-red-300/18 px-2.5 py-1 text-[11px] text-red-100/70 transition hover:bg-red-500/14 hover:text-red-50"
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {activeRegion.isIdentifying ? (
                            <span className="rounded-full border border-white/8 bg-white/[0.06] px-3 py-1.5 text-xs text-white/68">识别中...</span>
                          ) : activeRegion.candidates.length ? (
                            activeRegion.candidates.map((candidate) => {
                              const selected = candidate === activeRegion.selectedCandidate;
                              return (
                                <button
                                  key={candidate}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCandidateSelect(activeRegion.id, candidate);
                                  }}
                                  className={`rounded-full border px-3 py-1.5 text-xs transition ${selected ? 'border-purple-300/24 bg-purple-500/16 text-purple-50' : 'border-white/8 bg-white/[0.04] text-white/74 hover:bg-white/[0.10]'}`}
                                >
                                  {candidate}
                                </button>
                              );
                            })
                          ) : (
                            <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-white/52">没有候选，请重试识别</span>
                          )}
                        </div>

                      </div>
                    ) : null}
                    </div>
                  ) : null}
                  </div>
                </div>
              </div>

              <div className="relative z-10 mx-auto w-full max-w-4xl shrink-0 px-1 pb-2">
                <div className="rounded-[1.6rem] border border-white/12 bg-[#111118]/92 px-3 py-4 shadow-[0_22px_56px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:px-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <button
                      type="button"
                      onClick={() => handleToolChange('brush')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${activeTool === 'brush' ? 'bg-white text-slate-950 shadow-[0_8px_22px_rgba(255,255,255,0.12)]' : 'text-white/60 hover:text-white/85'}`}
                    >
                      画笔
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToolChange('tag')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${activeTool === 'tag' ? 'bg-white text-slate-950 shadow-[0_8px_22px_rgba(255,255,255,0.12)]' : 'text-white/60 hover:text-white/85'}`}
                    >
                      标记
                    </button>
                  </div>
                  {activeTool === 'brush' ? (
                    <button type="button" onClick={undoLastBrushStroke} disabled={brushStrokeCount === 0} className="rounded-full bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35">撤销上一步</button>
                  ) : null}
                </div>

                <div className="mb-2 text-[11px] text-white/34">{activeTool === 'tag' ? '当前为标记模式：点选目标，AI 根据识别结果和你的文字精准修改；适合不想涂抹范围的对象替换。' : '当前为画笔模式：涂哪里改哪里，适合精细局部；颜色仅用于区分操作层，不影响最终出图。'} 提交后可在订单记录查看进度。</div>
                {isGifImage ? (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-white/42">
                    <span className="rounded-full border border-amber-300/20 bg-amber-500/12 px-2.5 py-1 text-amber-100/78">GIF 按静态首帧处理</span>
                  </div>
                ) : null}

                <div className="relative rounded-[1.25rem] border border-white/10 bg-[#0d0d12] transition focus-within:ring-2 focus-within:ring-fuchsia-500/30">
                  <div
                    ref={promptEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handlePromptEditorInput}
                    onKeyUp={saveEditorSelection}
                    onMouseUp={saveEditorSelection}
                    onBlur={saveEditorSelection}
                    data-placeholder={promptPlaceholder}
                    className="min-h-[108px] whitespace-pre-wrap break-words px-4 py-3.5 pb-24 text-[15px] leading-7 text-white outline-none empty:before:pointer-events-none empty:before:text-white/30 empty:before:content-[attr(data-placeholder)]"
                  />

                  <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-white/52">
                      <div className="relative" data-role="aspect-ratio-menu">
                        <button
                          type="button"
                          onClick={() => setIsAspectRatioMenuOpen((current) => !current)}
                          className="flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/[0.08]"
                        >
                          <span>{outputSize === 'auto' ? `自动：${resolvedOutputSize.resolvedAspectRatio}` : (formatSmartEditSizeLabel(outputSize) || '1:1')}</span>
                          <span className="hidden text-white/42 sm:inline">/</span>
                          <span className="hidden text-white/52 sm:inline">{SMART_EDIT_SIZE_OPTIONS.find((option) => option.value === outputSize)?.description || '比例'}</span>
                          <span className={`text-[10px] text-white/45 transition ${isAspectRatioMenuOpen ? 'rotate-180' : ''}`}>▾</span>
                        </button>

                        {isAspectRatioMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[180px] max-w-[72vw] overflow-hidden rounded-[1rem] border border-white/12 bg-[#0d0d12]/98 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:min-w-[220px]">
                            {SMART_EDIT_SIZE_OPTIONS.map((option) => {
                              const selected = option.value === outputSize;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    setOutputSize(option.value);
                                    setIsAspectRatioMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-3 rounded-[0.8rem] border px-3 py-2 text-left transition ${selected ? 'border-purple-300/24 bg-purple-500/16 text-purple-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-transparent text-white/72 hover:bg-white/[0.08] hover:text-white'}`}
                                  title={option.description}
                                >
                                  <span className="min-w-[40px] text-sm font-medium">{option.label}</span>
                                  <span className="flex-1 text-xs opacity-70">{option.description}</span>
                                  {selected ? <span className="text-[10px] text-purple-100">✓</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="relative" data-role="resolution-menu">
                        <button
                          type="button"
                          onClick={() => setIsResolutionMenuOpen((current) => !current)}
                          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/[0.08]"
                        >
                          <span>{outputResolution}</span>
                          <span className="hidden items-center gap-1.5 text-white/48 sm:inline-flex">
                            <span>{selectedResolutionOption.description}</span>
                            <span className="text-white/30">·</span>
                            <PointsIconLabel points={selectedResolutionOption.points} iconClassName="h-3 w-3" />
                          </span>
                          <span className={`text-[10px] text-white/45 transition ${isResolutionMenuOpen ? 'rotate-180' : ''}`}>▾</span>
                        </button>

                        {isResolutionMenuOpen ? (
                          <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[188px] overflow-hidden rounded-[1rem] border border-white/12 bg-[#0d0d12]/98 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                            {SMART_EDIT_RESOLUTION_OPTIONS.map((option) => {
                              const selected = option.value === outputResolution;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    setOutputResolution(option.value);
                                    setIsResolutionMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-2 rounded-[0.8rem] border px-3 py-2 text-left text-xs transition ${selected ? 'border-purple-300/24 bg-purple-500/16 text-purple-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-transparent text-white/72 hover:bg-white/[0.08] hover:text-white'}`}
                                >
                                  <span className="w-8 shrink-0 font-medium">{option.label}</span>
                                  <span className="flex-1 opacity-70">{option.description}</span>
                                  <PointsIconLabel points={option.points} className="shrink-0 opacity-70" iconClassName="h-3 w-3" />
                                  {selected ? <span className="text-[10px] text-purple-100">✓</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isResolvingPrompt} className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-[0_10px_24px_rgba(168,85,247,0.24)] transition hover:from-fuchsia-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? '提交中...' : (
                      <span className="inline-flex items-center gap-1.5">
                        <span>提交生成</span>
                        <span className="text-white/50">·</span>
                        <PointsIconLabel points={submitPoints} iconClassName="h-3.5 w-3.5" />
                      </span>
                    )}</button>
                  </div>
                </div>

                {submitError ? (
                  <div className="mt-2.5 rounded-xl border border-red-300/18 bg-red-500/10 px-3 py-2 text-xs text-red-100/82">{submitError}</div>
                ) : null}

                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  {activeTool === 'brush' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/48">画笔颜色</span>
                        <div className="relative" data-role="brush-color-menu">
                          <button
                            type="button"
                            onClick={() => setIsBrushColorMenuOpen((current) => !current)}
                            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/[0.08]"
                          >
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedBrushColor.value }} />
                            <span>{selectedBrushColor.label}</span>
                            <span className={`text-[10px] text-white/45 transition ${isBrushColorMenuOpen ? 'rotate-180' : ''}`}>▾</span>
                          </button>

                          {isBrushColorMenuOpen ? (
                            <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[132px] overflow-hidden rounded-[1rem] border border-white/12 bg-[#0d0d12]/98 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                              {BRUSH_COLOR_OPTIONS.map((option) => {
                                const selected = option.value === brushColor;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      setBrushColor(option.value);
                                      setIsBrushColorMenuOpen(false);
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-[0.8rem] border px-3 py-2 text-left text-xs transition ${selected ? 'border-purple-300/24 bg-purple-500/16 text-purple-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-transparent text-white/72 hover:bg-white/[0.08] hover:text-white'}`}
                                  >
                                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.value }} />
                                    <span className="flex-1">{option.label}</span>
                                    {selected ? <span className="text-[10px] text-purple-100">✓</span> : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex min-w-[320px] flex-1 flex-wrap items-center gap-2">
                        <span className="text-xs text-white/48">画笔大小</span>
                        <input type="range" min="12" max="96" step="2" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="min-w-[160px] flex-1 accent-fuchsia-400" />
                        <span className="w-11 text-right text-xs text-white/42">{brushSize}px</span>
                        <div className="flex items-center gap-1">
                          {BRUSH_SIZE_PRESETS.map((size) => (
                            <button key={size} type="button" onClick={() => setBrushSize(size)} className={`rounded-lg border px-2 py-1 text-[11px] transition ${brushSize === size ? 'border-fuchsia-300/45 bg-fuchsia-500/18 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white/75'}`}>{size}</button>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={clearBrushMask} className="rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs text-white/68 transition hover:bg-white/[0.1] hover:text-white">清空涂抹</button>
                    </>
                  ) : null}
                  {activeTool === 'tag' ? (
                    <div className="flex min-w-[320px] flex-1 flex-wrap items-center gap-2">
                      <span className="text-xs text-white/48">标记提示</span>
                      <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-white/62">单击目标添加标记，拖动点位可重新识别；提交时靠识别结果和文字控制改图。</span>
                    </div>
                  ) : null}
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
