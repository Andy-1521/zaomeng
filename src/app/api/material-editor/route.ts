import { after, NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { composePromptFromImage } from '@/lib/materialEditorPrompt';
import { capturedImageManager } from '@/storage/database';
import { transactionManager, userManager } from '@/storage/database';
import { isImageEditTimeoutError, runPsydoImageEditWithMetaFromPreparedBuffer } from '@/lib/psydoImageEdits';
import { getSmartEditPoints } from '@/lib/pricing';
import { DEFAULT_SMART_EDIT_SIZE_OPTION, resolveSmartEditAspectRatio } from '@/lib/smartEditSize';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

const MAX_MASK_IMAGE_BYTES = 10 * 1024 * 1024;
const SMART_EDIT_SOURCE_MAX_EDGE = 1536;
const SMART_EDIT_IMAGE_EDIT_TIMEOUT_MS = 300000;

export const runtime = 'nodejs';
export const maxDuration = 300;

type CropPayload = {
  action?: 'crop';
  imageUrl?: string;
  destination?: 'gallery' | 'orders';
  orderNumber?: string;
  toolLabel?: string;
  sourceImageUrl?: string | null;
  rotation?: number;
  scale?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  outputSize?: {
    width?: number;
    height?: number;
  };
  crop?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

type AnnotatePayload = {
  action?: 'annotate';
  imageUrl?: string;
  annotationData?: string;
};

type RedrawPayload = {
  action?: 'redraw';
  imageUrl?: string;
  aspectRatio?: string;
  resolution?: '1k' | '2k' | '4k';
  outputSize?: {
    width?: number;
    height?: number;
  };
  sourceSize?: {
    width?: number;
    height?: number;
  };
  sessionId?: string;
  maskImageBase64?: string;
  prompt?: string;
  mode?: 'brush' | 'tag';
  regions?: Array<{
    id?: string;
    type?: 'brush' | 'tag';
    naturalX?: number;
    naturalY?: number;
    description?: string;
    candidates?: string[];
    selectedCandidate?: string;
    customTarget?: string;
  }>;
  brushSegments?: Array<{
    x?: number;
    y?: number;
    r?: number;
  }>;
  tagMaskRadius?: number;
};

type RetryRedrawPayload = {
  action?: 'retry-redraw';
  orderId?: string;
};

type EditorPayload = CropPayload | AnnotatePayload | RedrawPayload | RetryRedrawPayload;

type ParsedEditorPayload = {
  body: EditorPayload;
  maskImageBuffer?: Buffer;
};

class MaterialEditorBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialEditorBadRequestError';
  }
}

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return null;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof MaterialEditorBadRequestError) {
    return error.message;
  }

  if (isImageEditTimeoutError(error)) {
    return '处理时间较长，请稍后重试';
  }

  return '暂时未能完成处理，请稍后重试';
}

function getErrorStatus(error: unknown) {
  if (error instanceof MaterialEditorBadRequestError) {
    return 400;
  }

  return isImageEditTimeoutError(error) ? 504 : 500;
}

function getFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

function parseFormJsonValue<T>(formData: FormData, name: string): T | undefined {
  const value = getFormString(formData, name);
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new MaterialEditorBadRequestError('提交参数格式不正确');
  }
}

function normalizeRedrawResolution(value: string | undefined): RedrawPayload['resolution'] {
  return value === '1k' || value === '2k' || value === '4k' ? value : undefined;
}

function getRedrawResolution(body: RedrawPayload) {
  return body.resolution || '2k';
}

function getRedrawRequiredPoints(body: RedrawPayload) {
  return getSmartEditPoints(getRedrawResolution(body));
}

function normalizeRedrawMode(value: string | undefined): RedrawPayload['mode'] {
  return value === 'tag' ? 'tag' : 'brush';
}

function normalizePositiveNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function normalizeRedrawBrushSegments(value: RedrawPayload['brushSegments']) {
  if (!Array.isArray(value)) return [];

  return value
    .map((segment) => ({
      x: normalizePositiveNumber(segment.x),
      y: normalizePositiveNumber(segment.y),
      r: normalizePositiveNumber(segment.r),
    }))
    .filter((segment): segment is { x: number; y: number; r: number } => {
      return typeof segment.x === 'number' && typeof segment.y === 'number' && typeof segment.r === 'number' && segment.r > 0;
    });
}

function normalizeTagMaskRadius(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(8, Math.min(600, Math.round(value)));
}

function parseMultipartMaskFile(formData: FormData) {
  const value = formData.get('maskImage');
  if (!value || typeof value === 'string') {
    return null;
  }

  if (value.size > MAX_MASK_IMAGE_BYTES) {
    throw new MaterialEditorBadRequestError('修改范围数据过大，请缩小选择区域后重试');
  }

  if (value.type && value.type !== 'image/png') {
    throw new MaterialEditorBadRequestError('修改范围数据格式不正确');
  }

  return value;
}

async function parseEditorPayload(request: NextRequest): Promise<ParsedEditorPayload> {
  const contentType = request.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return { body: await request.json() as EditorPayload };
  }

  const formData = await request.formData();
  const action = getFormString(formData, 'action');
  if (action !== 'redraw') {
    throw new MaterialEditorBadRequestError('未知编辑动作');
  }

  const mode = normalizeRedrawMode(getFormString(formData, 'mode'));
  const maskFile = mode === 'brush' ? parseMultipartMaskFile(formData) : null;
  const maskImageBuffer = maskFile ? Buffer.from(await maskFile.arrayBuffer()) : undefined;
  const parsedRegions = parseFormJsonValue<RedrawPayload['regions']>(formData, 'regions');
  const parsedBrushSegments = parseFormJsonValue<RedrawPayload['brushSegments']>(formData, 'brushSegments');

  return {
    body: {
      action: 'redraw',
      imageUrl: getFormString(formData, 'imageUrl'),
      aspectRatio: getFormString(formData, 'aspectRatio'),
      resolution: normalizeRedrawResolution(getFormString(formData, 'resolution')),
      outputSize: parseFormJsonValue<RedrawPayload['outputSize']>(formData, 'outputSize'),
      sourceSize: parseFormJsonValue<RedrawPayload['sourceSize']>(formData, 'sourceSize'),
      sessionId: getFormString(formData, 'sessionId'),
      prompt: getFormString(formData, 'prompt'),
      mode,
      regions: Array.isArray(parsedRegions) ? parsedRegions : [],
      brushSegments: normalizeRedrawBrushSegments(parsedBrushSegments),
      tagMaskRadius: normalizeTagMaskRadius(Number(getFormString(formData, 'tagMaskRadius'))),
    },
    maskImageBuffer,
  };
}

function normalizeRotation(rotation: unknown) {
  if (typeof rotation !== 'number' || !Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function normalizeScale(scale: unknown) {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return 1;
  return Math.max(0.5, Math.min(2, scale));
}

function normalizeOutputDimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(12000, Math.round(value)));
}

function normalizeSourceDimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(100000, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getSourceResizeOptions(width: number, height: number) {
  const largestEdge = Math.max(width, height);
  if (largestEdge <= SMART_EDIT_SOURCE_MAX_EDGE) {
    return null;
  }

  return {
    width: width >= height ? SMART_EDIT_SOURCE_MAX_EDGE : undefined,
    height: height > width ? SMART_EDIT_SOURCE_MAX_EDGE : undefined,
    fit: 'inside' as const,
    withoutEnlargement: true,
  };
}

function getCropNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function getContainedCropArea(
  crop: { x?: number; y?: number; width?: number; height?: number },
  canvasWidth: number,
  canvasHeight: number,
  scale: number
) {
  const visibleWidth = canvasWidth / scale;
  const visibleHeight = canvasHeight / scale;
  const cropX = getCropNumber(crop.x, 0);
  const cropY = getCropNumber(crop.y, 0);
  const cropWidth = Math.max(1, getCropNumber(crop.width, 100));
  const cropHeight = Math.max(1, getCropNumber(crop.height, 100));
  const visibleLeft = (canvasWidth - visibleWidth) / 2;
  const visibleTop = (canvasHeight - visibleHeight) / 2;

  return {
    left: Math.max(0, Math.min(canvasWidth - 1, Math.round(visibleLeft + (cropX / 100) * visibleWidth))),
    top: Math.max(0, Math.min(canvasHeight - 1, Math.round(visibleTop + (cropY / 100) * visibleHeight))),
    width: Math.max(1, Math.round((cropWidth / 100) * visibleWidth)),
    height: Math.max(1, Math.round((cropHeight / 100) * visibleHeight)),
  };
}

function resolveImageUrl(imageUrl: string, origin: string) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, origin).toString();
  }
  return imageUrl;
}

async function downloadImageBuffer(imageUrl: string, origin: string): Promise<Buffer> {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 30000,
    maxBytes: 30 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: origin,
  });
  return image.buffer;
}

function parsePngDataUrl(dataUrl: string): Buffer {
  const matched = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!matched) {
    throw new Error('标注画布格式不正确');
  }
  return Buffer.from(matched[1], 'base64');
}

function getBase64ImageData(data: string) {
  const pngDataUrl = data.match(/^data:image\/png;base64,(.+)$/);
  if (pngDataUrl) return pngDataUrl[1];
  if (/^data:/i.test(data)) return null;
  return data;
}

function estimateBase64DecodedBytes(data: string) {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function decodeMaskImageBase64(data: string) {
  const base64Data = getBase64ImageData(data);
  if (!base64Data) {
    throw new MaterialEditorBadRequestError('修改范围数据格式不正确');
  }

  if (estimateBase64DecodedBytes(base64Data) > MAX_MASK_IMAGE_BYTES) {
    throw new MaterialEditorBadRequestError('修改范围数据过大，请缩小选择区域后重试');
  }

  return Buffer.from(base64Data, 'base64');
}

async function validateMaskImageBuffer(maskImageBuffer: Buffer) {
  if (maskImageBuffer.byteLength <= 0) {
    throw new MaterialEditorBadRequestError('缺少修改范围');
  }

  if (maskImageBuffer.byteLength > MAX_MASK_IMAGE_BYTES) {
    throw new MaterialEditorBadRequestError('修改范围数据过大，请缩小选择区域后重试');
  }

  try {
    const metadata = await sharp(maskImageBuffer).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
      throw new MaterialEditorBadRequestError('修改范围数据格式不正确');
    }
  } catch (error) {
    if (error instanceof MaterialEditorBadRequestError) {
      throw error;
    }

    throw new MaterialEditorBadRequestError('修改范围数据格式不正确');
  }
}

async function normalizeMaskImageBuffer(maskImageBuffer: Buffer, width: number, height: number) {
  await validateMaskImageBuffer(maskImageBuffer);
  return sharp(maskImageBuffer)
    .resize({ width, height, fit: 'fill' })
    .png()
    .toBuffer();
}

async function prepareSourceImageForSmartEdit(imageUrl: string, origin: string) {
  const sourceBuffer = await downloadImageBuffer(resolveImageUrl(imageUrl, origin), origin);
  let image = sharp(sourceBuffer).rotate();
  const sourceMetadata = await image.metadata();
  const sourceWidth = sourceMetadata.width || 0;
  const sourceHeight = sourceMetadata.height || 0;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('无法读取原图尺寸');
  }

  const resizeOptions = getSourceResizeOptions(sourceWidth, sourceHeight);
  if (resizeOptions) {
    image = image.resize(resizeOptions);
  }

  const buffer = await image.png().toBuffer();
  const preparedMetadata = await sharp(buffer).metadata();
  const width = preparedMetadata.width || sourceWidth;
  const height = preparedMetadata.height || sourceHeight;

  return {
    buffer,
    width,
    height,
    sourceWidth,
    sourceHeight,
    wasResized: Boolean(resizeOptions),
  };
}

async function createMaskImageBufferFromSelection(body: RedrawPayload, width: number, height: number) {
  const mode = body.mode === 'tag' ? 'tag' : 'brush';
  const sourceWidth = normalizeSourceDimension(body.sourceSize?.width) || width;
  const sourceHeight = normalizeSourceDimension(body.sourceSize?.height) || height;
  const scaleX = width / sourceWidth;
  const scaleY = height / sourceHeight;
  const circleScale = Math.max(scaleX, scaleY);
  const maskSvgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="black"/>`];

  if (mode === 'brush') {
    const segments = normalizeRedrawBrushSegments(body.brushSegments);
    if (segments.length === 0) {
      return null;
    }

    segments.forEach((segment) => {
      const cx = clampNumber(segment.x * scaleX, 0, width);
      const cy = clampNumber(segment.y * scaleY, 0, height);
      const r = clampNumber(segment.r * circleScale, 1, Math.max(width, height));
      maskSvgParts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="white"/>`);
    });
  } else {
    const regions = Array.isArray(body.regions) ? body.regions : [];
    const radius = normalizeTagMaskRadius(body.tagMaskRadius) || 96;
    const scaledRadius = clampNumber(radius * circleScale, 1, Math.max(width, height));
    const tagRegions = regions.filter((region) => typeof region.naturalX === 'number' && typeof region.naturalY === 'number');
    if (tagRegions.length === 0) {
      return null;
    }

    tagRegions.forEach((region) => {
      const cx = clampNumber((region.naturalX || 0) * scaleX, 0, width);
      const cy = clampNumber((region.naturalY || 0) * scaleY, 0, height);
      maskSvgParts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${scaledRadius.toFixed(2)}" fill="white"/>`);
    });
  }

  maskSvgParts.push('</svg>');
  return sharp(Buffer.from(maskSvgParts.join(''))).png().toBuffer();
}

async function resolveRedrawMaskImageBuffer(body: RedrawPayload, width: number, height: number, maskImageBuffer?: Buffer) {
  if (maskImageBuffer) {
    return normalizeMaskImageBuffer(maskImageBuffer, width, height);
  }

  if (body.maskImageBase64) {
    return normalizeMaskImageBuffer(decodeMaskImageBase64(body.maskImageBase64), width, height);
  }

  return createMaskImageBufferFromSelection(body, width, height);
}

async function persistEditedImage(buffer: Buffer, userId: string, action: 'crop' | 'annotate') {
  const extension = action === 'crop' ? 'jpg' : 'png';
  const contentType = action === 'crop' ? 'image/jpeg' : 'image/png';
  const fileName = `material-editor/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}-${action}.${extension}`;

  return uploadToCozeStorage(buffer, fileName, contentType);
}

async function createMaterialRecord(userId: string, imageUrl: string, action: 'crop' | 'annotate' | 'redraw') {
  return capturedImageManager.createCapturedImage({
    userId,
    imageUrl,
    originalUrl: null,
    pageUrl: null,
    pageTitle: action === 'crop' ? '裁切工具生成' : action === 'annotate' ? '画笔标注生成' : '智能改图生成',
    sourceHost: 'material-editor',
    imageType: 'edited',
  });
}

async function createOrderRecord(
  userId: string,
  imageUrl: string,
  payload: {
    toolPage: string;
    description: string;
    uploadedImage: string;
    sourceImageUrl?: string | null;
  },
) {
  const user = await userManager.getUserById(userId);
  if (!user) {
    throw new Error('用户不存在');
  }

  const orderNumber = transactionManager.generateOrderNumber();
  await transactionManager.createTransaction({
    userId,
    orderNumber,
    toolPage: payload.toolPage,
    description: payload.description,
    points: 0,
    actualPoints: 0,
    remainingPoints: user.points || 0,
    status: '成功',
    requestParams: JSON.stringify({
      imageUrl: payload.uploadedImage,
      uploadedImage: payload.uploadedImage,
      sourceImageUrl: payload.sourceImageUrl || payload.uploadedImage,
    }),
    resultData: imageUrl,
    uploadedImage: payload.sourceImageUrl || payload.uploadedImage,
  });

  return { orderNumber };
}

function sanitizeRegionsForRequest(regions: RedrawPayload['regions']) {
  if (!Array.isArray(regions)) return [];

  return regions.map((region, index) => ({
    id: region.id || `region-${index + 1}`,
    type: region.type || 'tag',
    naturalX: typeof region.naturalX === 'number' ? region.naturalX : null,
    naturalY: typeof region.naturalY === 'number' ? region.naturalY : null,
    description: region.description || '',
    selectedCandidate: region.selectedCandidate || '',
    customTarget: region.customTarget || '',
    candidates: Array.isArray(region.candidates) ? region.candidates.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6) : [],
  }));
}

function getRedrawMode(body: RedrawPayload) {
  return body.mode === 'tag' ? 'tag' : 'brush';
}

function getSmartEditImageQuality(resolution: RedrawPayload['resolution']) {
  return resolution === '4k' ? 'high' : 'medium';
}

function getSmartEditImageEditRequest(resolvedAspectRatio: string): { aspectRatio?: string; size?: string } {
  if (resolvedAspectRatio === '9:16') {
    return { size: '1024x1792' };
  }

  return { aspectRatio: resolvedAspectRatio };
}

function getRedrawSelectionError(body: RedrawPayload, options?: { hasExternalRange?: boolean }) {
  const mode = getRedrawMode(body);
  if (mode === 'tag') {
    const regions = Array.isArray(body.regions) ? body.regions : [];
    const hasValidRegion = regions.some((region) => typeof region.naturalX === 'number' && typeof region.naturalY === 'number');
    return hasValidRegion ? null : '请先点击图片添加标记点位';
  }

  if (options?.hasExternalRange) {
    return null;
  }

  return normalizeRedrawBrushSegments(body.brushSegments).length > 0 ? null : '请先用画笔涂抹要修改的区域';
}

function buildSmartEditRequestParams(params: {
  body: RedrawPayload;
  resolvedAspectRatio: string;
  outputWidth: number | null;
  outputHeight: number | null;
  promptSummary?: string;
  finalPrompt?: string;
  agentPrompt?: string;
  negativePrompt?: string;
  promptSource?: string;
  preparedSource?: Awaited<ReturnType<typeof prepareSourceImageForSmartEdit>>;
  imageEditMeta?: Awaited<ReturnType<typeof runPsydoImageEditWithMetaFromPreparedBuffer>>['meta'];
}) {
  const { body, resolvedAspectRatio, outputWidth, outputHeight, promptSummary, finalPrompt, agentPrompt, negativePrompt, promptSource, preparedSource, imageEditMeta } = params;
  const mode = getRedrawMode(body);
  const imageEditRequest = getSmartEditImageEditRequest(resolvedAspectRatio);
  return {
    toolPage: '智能改图',
    imageUrl: body.imageUrl,
    uploadedImage: body.imageUrl,
    sessionId: body.sessionId || '',
    mode,
    editControlMode: mode === 'brush' ? 'brush-range' : 'tag-prompt',
    userInstruction: body.prompt?.trim() || '',
    summary: promptSummary || body.prompt?.trim() || '智能改图处理中',
    promptSummary: promptSummary || body.prompt?.trim() || '智能改图处理中',
    finalPrompt,
    agentPrompt,
    negativePrompt,
    promptSource,
    requestedAspectRatio: body.aspectRatio || DEFAULT_SMART_EDIT_SIZE_OPTION,
    resolvedAspectRatio,
    requestedResolution: getRedrawResolution(body),
    requiredPoints: getRedrawRequiredPoints(body),
    requestedOutputSize: outputWidth && outputHeight ? { width: outputWidth, height: outputHeight } : null,
    sourceSize: body.sourceSize,
    tagMaskRadius: body.tagMaskRadius,
    brushSegments: normalizeRedrawBrushSegments(body.brushSegments).slice(0, 1500),
    preparedSourceSize: preparedSource ? { width: preparedSource.width, height: preparedSource.height } : null,
    originalSourceSize: preparedSource ? { width: preparedSource.sourceWidth, height: preparedSource.sourceHeight } : null,
    sourceWasResized: preparedSource?.wasResized ?? null,
    requestedImageEditTimeoutMs: SMART_EDIT_IMAGE_EDIT_TIMEOUT_MS,
    imageEditQuality: getSmartEditImageQuality(getRedrawResolution(body)),
    imageEditAspectRatio: imageEditRequest.aspectRatio || null,
    imageEditSize: imageEditRequest.size || null,
    agentName: 'material-editor-prompt-agent',
    agentModel: 'gpt-5.4-mini',
    editModel: imageEditMeta?.model,
    editTarget: imageEditMeta?.targetName,
    editBaseUrl: imageEditMeta?.baseUrl,
    regionCount: Array.isArray(body.regions) ? body.regions.length : 0,
    regions: sanitizeRegionsForRequest(body.regions),
    hasMask: mode === 'brush',
  };
}

function restoreRedrawPayloadFromRequestParams(rawParams: string | null | undefined): RedrawPayload | null {
  if (!rawParams) return null;

  try {
    const params = JSON.parse(rawParams) as Record<string, unknown>;
    const imageUrl = typeof params.imageUrl === 'string' ? params.imageUrl : typeof params.uploadedImage === 'string' ? params.uploadedImage : '';
    const userInstruction = typeof params.userInstruction === 'string' ? params.userInstruction : '';
    if (!imageUrl || !userInstruction) return null;

    return {
      action: 'redraw',
      imageUrl,
      aspectRatio: typeof params.requestedAspectRatio === 'string' ? params.requestedAspectRatio : DEFAULT_SMART_EDIT_SIZE_OPTION,
      resolution: normalizeRedrawResolution(typeof params.requestedResolution === 'string' ? params.requestedResolution : undefined) || '2k',
      outputSize: typeof params.requestedOutputSize === 'object' && params.requestedOutputSize !== null ? params.requestedOutputSize as RedrawPayload['outputSize'] : undefined,
      sourceSize: typeof params.sourceSize === 'object' && params.sourceSize !== null ? params.sourceSize as RedrawPayload['sourceSize'] : undefined,
      sessionId: typeof params.sessionId === 'string' ? `${params.sessionId}-retry-${Date.now()}` : `smart-edit-retry-${Date.now()}`,
      mode: params.mode === 'tag' ? 'tag' : 'brush',
      prompt: userInstruction,
      regions: Array.isArray(params.regions) ? params.regions as RedrawPayload['regions'] : [],
      brushSegments: normalizeRedrawBrushSegments(Array.isArray(params.brushSegments) ? params.brushSegments as RedrawPayload['brushSegments'] : []),
      tagMaskRadius: normalizeTagMaskRadius(params.tagMaskRadius),
    };
  } catch {
    return null;
  }
}

async function createSmartEditPendingOrder(params: {
  userId: string;
  currentPoints: number;
  origin: string;
  body: RedrawPayload;
  maskImageBuffer?: Buffer;
}) {
  const { userId, currentPoints, origin, body, maskImageBuffer } = params;
  const orderNumber = `MD${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const resolvedAspectRatio = resolveSmartEditAspectRatio(body.aspectRatio, body.sourceSize);
  const outputWidth = normalizeOutputDimension(body.outputSize?.width);
  const outputHeight = normalizeOutputDimension(body.outputSize?.height);
  const requiredPoints = getRedrawRequiredPoints(body);

  await transactionManager.createTransaction({
    userId,
    orderNumber,
    toolPage: '智能改图',
    description: `智能改图: ${body.prompt?.trim().substring(0, 50) || '处理中'}`,
    points: requiredPoints,
    actualPoints: 0,
    remainingPoints: currentPoints,
    status: '处理中',
    prompt: body.prompt?.trim() || '',
    requestParams: JSON.stringify(buildSmartEditRequestParams({
      body,
      resolvedAspectRatio,
      outputWidth,
      outputHeight,
    })),
    resultData: null,
    uploadedImage: body.imageUrl,
  });

  const chargedUser = await userManager.deductPointsAtomically(userId, requiredPoints);
  if (!chargedUser) {
    await transactionManager.updateTransaction(orderNumber, {
      status: '失败',
      resultData: JSON.stringify({ error: '积分不足' }),
      actualPoints: 0,
    });
    throw new MaterialEditorBadRequestError('积分不足');
  }

  try {
    await transactionManager.updateTransaction(orderNumber, {
      actualPoints: requiredPoints,
      remainingPoints: chargedUser.points,
    });
  } catch (error) {
    try {
      await userManager.addPointsAtomically(userId, requiredPoints);
    } catch (refundError) {
      console.error('[MaterialEditor] smart-edit-create-refund-failed', { orderNumber, refundError });
    }
    throw error;
  }

  after(async () => completeSmartEditRedrawInBackground({
    userId,
    orderNumber,
    origin,
    body,
    maskImageBuffer,
    chargedPoints: requiredPoints,
    chargedRemainingPoints: chargedUser.points,
  }));

  return {
    orderNumber,
    remainingPoints: chargedUser.points,
  };
}

async function completeSmartEditRedrawInBackground(params: {
  userId: string;
  orderNumber: string;
  origin: string;
  body: RedrawPayload;
  maskImageBuffer?: Buffer;
  chargedPoints: number;
  chargedRemainingPoints: number;
}) {
  const { userId, orderNumber, origin, body, maskImageBuffer, chargedPoints, chargedRemainingPoints } = params;
  const requiredPoints = getRedrawRequiredPoints(body);
  const resolvedAspectRatio = resolveSmartEditAspectRatio(body.aspectRatio, body.sourceSize);
  const outputWidth = normalizeOutputDimension(body.outputSize?.width);
  const outputHeight = normalizeOutputDimension(body.outputSize?.height);
  const startedAt = Date.now();
  let stepStartedAt = startedAt;

  const logStep = (step: string, extra?: Record<string, unknown>) => {
    const now = Date.now();
    console.info('[MaterialEditor] smart-edit-background-step', {
      orderNumber,
      step,
      stepMs: now - stepStartedAt,
      totalMs: now - startedAt,
      ...extra,
    });
    stepStartedAt = now;
  };

  try {
    const mode = getRedrawMode(body);
    const promptResult = await composePromptFromImage({
      origin,
      imageUrl: body.imageUrl || '',
      mode,
      instruction: body.prompt?.trim() || '',
      regions: Array.isArray(body.regions) ? body.regions : [],
      sessionId: body.sessionId,
    });
    logStep('compose-prompt', { promptSource: promptResult.source });

    console.info('[MaterialEditor] smart-edit-background-submit', {
      orderNumber,
      sessionId: body.sessionId || 'unknown',
      mode,
      regionCount: Array.isArray(body.regions) ? body.regions.length : 0,
      promptSource: promptResult.source,
    });

    const finalPrompt = `${promptResult.prompt}${promptResult.negativePrompt ? `\n\n负面约束：${promptResult.negativePrompt}` : ''}`.trim();
    const preparedSource = await prepareSourceImageForSmartEdit(body.imageUrl || '', origin);
    logStep('prepare-source', {
      preparedWidth: preparedSource.width,
      preparedHeight: preparedSource.height,
      sourceWasResized: preparedSource.wasResized,
    });
    const resolvedMaskImageBuffer = mode === 'brush'
      ? await resolveRedrawMaskImageBuffer(body, preparedSource.width, preparedSource.height, maskImageBuffer)
      : undefined;
    if (mode === 'brush' && !resolvedMaskImageBuffer) {
      throw new MaterialEditorBadRequestError(getRedrawSelectionError(body) || '请先选择修改区域');
    }
    logStep(mode === 'brush' ? 'prepare-range' : 'skip-range', { hasMask: Boolean(resolvedMaskImageBuffer) });

    const imageEditRequest = getSmartEditImageEditRequest(resolvedAspectRatio);
    const imageEditQuality = getSmartEditImageQuality(getRedrawResolution(body));
    logStep('image-edit-request', {
      imageEditAspectRatio: imageEditRequest.aspectRatio || null,
      imageEditSize: imageEditRequest.size || null,
      imageEditQuality,
      timeoutMs: SMART_EDIT_IMAGE_EDIT_TIMEOUT_MS,
    });

    const imageEditResult = await runPsydoImageEditWithMetaFromPreparedBuffer({
      prompt: finalPrompt,
      ...imageEditRequest,
      quality: imageEditQuality,
      ...(resolvedMaskImageBuffer ? { maskImageBuffer: resolvedMaskImageBuffer } : {}),
      timeoutMs: SMART_EDIT_IMAGE_EDIT_TIMEOUT_MS,
    }, preparedSource.buffer);
    logStep('image-edit', {
      editModel: imageEditResult.meta.model,
      editTarget: imageEditResult.meta.targetName,
    });
    const resultBuffer = outputWidth && outputHeight
      ? await sharp(imageEditResult.buffer)
        .resize({ width: outputWidth, height: outputHeight, fit: 'fill' })
        .png()
        .toBuffer()
      : imageEditResult.buffer;
    logStep('resize-result', {
      outputWidth,
      outputHeight,
    });

    const editedUrl = await uploadToCozeStorage(resultBuffer, `material-editor/${userId}/${orderNumber}-redraw.png`, 'image/png');
    logStep('upload-result');

    logStep('deduct-points', { remainingPoints: chargedRemainingPoints, prepaid: true });

    await transactionManager.updateTransaction(orderNumber, {
      status: '成功',
      points: requiredPoints,
      actualPoints: requiredPoints,
      remainingPoints: chargedRemainingPoints,
      description: `智能改图: ${promptResult.summary.substring(0, 50)}`,
      prompt: finalPrompt,
      requestParams: JSON.stringify(buildSmartEditRequestParams({
        body,
        resolvedAspectRatio,
        outputWidth,
        outputHeight,
        promptSummary: promptResult.summary,
        finalPrompt,
        agentPrompt: promptResult.prompt,
        negativePrompt: promptResult.negativePrompt,
        promptSource: promptResult.source,
        preparedSource,
        imageEditMeta: imageEditResult.meta,
      })),
      resultData: editedUrl,
      uploadedImage: body.imageUrl,
    });
    logStep('update-order-success');

    try {
      await createMaterialRecord(userId, editedUrl, 'redraw');
      logStep('create-material-record');
    } catch (recordError) {
      console.warn('[MaterialEditor] smart-edit-material-record-failed', { orderNumber, error: recordError });
    }
  } catch (error) {
    console.error('[MaterialEditor] smart-edit-background-failed', { orderNumber, totalMs: Date.now() - startedAt, error });
    let refundedPoints: number | undefined;
    if (chargedPoints > 0) {
      try {
        const refundedUser = await userManager.addPointsAtomically(userId, chargedPoints);
        refundedPoints = refundedUser?.points;
      } catch (refundError) {
        console.error('[MaterialEditor] smart-edit-refund-failed', { orderNumber, refundError });
      }
    }
    try {
      await transactionManager.updateTransaction(orderNumber, {
        status: isImageEditTimeoutError(error) ? '超时' : '失败',
        remainingPoints: refundedPoints,
        actualPoints: 0,
        resultData: JSON.stringify({ error: getErrorMessage(error) }),
        requestParams: JSON.stringify(buildSmartEditRequestParams({
          body,
          resolvedAspectRatio,
          outputWidth,
          outputHeight,
        })),
      });
    } catch (updateError) {
      console.error('[MaterialEditor] smart-edit-background-update-failed', { orderNumber, error: updateError });
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '请先登录后再生成编辑素材' }, { status: 401 });
    }

    const { body, maskImageBuffer } = await parseEditorPayload(request);

    if (body.action === 'retry-redraw') {
      const orderId = body.orderId?.trim();
      if (!orderId) {
        return NextResponse.json({ success: false, message: '缺少订单号' }, { status: 400 });
      }

      const existingOrder = await transactionManager.getTransactionByOrderNumber(orderId);
      if (!existingOrder || existingOrder.userId !== userId) {
        return NextResponse.json({ success: false, message: '订单不存在' }, { status: 404 });
      }

      const restoredBody = restoreRedrawPayloadFromRequestParams(existingOrder.requestParams);
      if (!restoredBody?.imageUrl || !restoredBody.prompt?.trim()) {
        return NextResponse.json({ success: false, message: '该订单缺少可重试参数' }, { status: 400 });
      }

      const selectionError = getRedrawSelectionError(restoredBody);
      if (selectionError) {
        return NextResponse.json({ success: false, message: selectionError }, { status: 400 });
      }

      const user = await userManager.getUserById(userId);
      if (!user) {
        return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
      }

      const requiredPoints = getRedrawRequiredPoints(restoredBody);
      if ((user.points || 0) < requiredPoints) {
        return NextResponse.json({ success: false, message: `积分不足，当前积分：${user.points}，需要：${requiredPoints}` }, { status: 400 });
      }

      const order = await createSmartEditPendingOrder({
        userId,
        currentPoints: user.points || 0,
        origin,
        body: restoredBody,
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order.orderNumber,
          status: '处理中',
          remainingPoints: order.remainingPoints,
        },
      });
    }

    if (!('imageUrl' in body) || !body.imageUrl) {
      return NextResponse.json({ success: false, message: '缺少原图地址' }, { status: 400 });
    }

    if (body.action === 'redraw') {
      if (!body.prompt?.trim()) {
        return NextResponse.json({ success: false, message: '缺少修改提示词' }, { status: 400 });
      }

      const selectionError = getRedrawSelectionError(body, { hasExternalRange: Boolean(maskImageBuffer || body.maskImageBase64) });
      if (selectionError) {
        return NextResponse.json({ success: false, message: selectionError }, { status: 400 });
      }

      const user = await userManager.getUserById(userId);
      if (!user) {
        return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
      }

      const requiredPoints = getRedrawRequiredPoints(body);
      if ((user.points || 0) < requiredPoints) {
        return NextResponse.json({ success: false, message: `积分不足，当前积分：${user.points}，需要：${requiredPoints}` }, { status: 400 });
      }

      const order = await createSmartEditPendingOrder({
        userId,
        currentPoints: user.points || 0,
        origin,
        body,
        maskImageBuffer,
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: order.orderNumber,
          status: '处理中',
          remainingPoints: order.remainingPoints,
        },
      });
    }

    const sourceBuffer = await downloadImageBuffer(resolveImageUrl(body.imageUrl, origin), origin);
    const normalizedBuffer = await sharp(sourceBuffer).rotate().toBuffer();
    const baseImage = sharp(normalizedBuffer);
    const baseMetadata = await baseImage.metadata();
    const imageWidth = baseMetadata.width || 0;
    const imageHeight = baseMetadata.height || 0;

    if (imageWidth <= 0 || imageHeight <= 0) {
      throw new Error('无法读取原图尺寸');
    }

    let outputBuffer: Buffer;
    let action: 'crop' | 'annotate';

    if (body.action === 'crop') {
      const crop = body.crop;
      if (!crop) {
        return NextResponse.json({ success: false, message: '缺少裁切区域' }, { status: 400 });
      }

      const rotation = normalizeRotation(body.rotation);
      const scale = normalizeScale(body.scale);
      let transformed = sharp(normalizedBuffer).flatten({ background: '#ffffff' });

      if (body.flipHorizontal) {
        transformed = transformed.flop();
      }

      if (body.flipVertical) {
        transformed = transformed.flip();
      }

      if (rotation !== 0) {
        transformed = transformed.rotate(rotation, { background: '#ffffff' });
      }

      const transformedBuffer = await transformed.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const transformedMetadata = await sharp(transformedBuffer).metadata();
      const transformedWidth = transformedMetadata.width || imageWidth;
      const transformedHeight = transformedMetadata.height || imageHeight;

      const cropArea = getContainedCropArea(crop, transformedWidth, transformedHeight, scale);
      const left = cropArea.left;
      const top = cropArea.top;
      const width = Math.max(1, Math.min(transformedWidth - left, cropArea.width));
      const height = Math.max(1, Math.min(transformedHeight - top, cropArea.height));

      let outputImage = sharp(transformedBuffer)
        .extract({ left, top, width, height })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, mozjpeg: true });

      const outputWidth = normalizeOutputDimension(body.outputSize?.width);
      const outputHeight = normalizeOutputDimension(body.outputSize?.height);

      if (outputWidth && outputHeight) {
        outputImage = outputImage.resize({ width: outputWidth, height: outputHeight, fit: 'fill' });
      }

      outputBuffer = await outputImage.toBuffer();
      action = 'crop';
    } else if (body.action === 'annotate') {
      if (!body.annotationData) {
        return NextResponse.json({ success: false, message: '缺少标注画布' }, { status: 400 });
      }

      const overlayBuffer = await sharp(parsePngDataUrl(body.annotationData))
        .resize(imageWidth, imageHeight, { fit: 'fill' })
        .png()
        .toBuffer();

      outputBuffer = await sharp(normalizedBuffer)
        .png()
        .composite([{ input: overlayBuffer, left: 0, top: 0 }])
        .toBuffer();
      action = 'annotate';
    } else {
      return NextResponse.json({ success: false, message: '未知编辑动作' }, { status: 400 });
    }

    const editedUrl = await persistEditedImage(outputBuffer, userId, action);

    if (body.action === 'crop' && body.destination === 'orders') {
      const toolLabel = body.toolLabel?.trim() || '裁切工具';
      const orderRecord = await createOrderRecord(userId, editedUrl, {
        toolPage: '裁切工具',
        description: `${toolLabel}裁切结果`,
        uploadedImage: body.imageUrl,
        sourceImageUrl: body.sourceImageUrl,
      });

      return NextResponse.json({
        success: true,
        data: {
          orderNumber: orderRecord.orderNumber,
          url: editedUrl,
        },
      });
    }

    const record = await createMaterialRecord(userId, editedUrl, action);

    return NextResponse.json({
      success: true,
      data: {
        id: record.id,
        url: editedUrl,
      },
    });
  } catch (error) {
    console.error('[素材编辑] 生成失败:', error);
    return NextResponse.json({ success: false, message: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
}
