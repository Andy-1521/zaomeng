import sharp from 'sharp';
import {
  getOpenAICompatApiKey,
  getOpenAICompatBaseUrl,
  getOpenAICompatImageModel,
} from '@/lib/openaiCompatible';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';
import { uploadToCozeStorage } from '@/lib/dualStorage';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const IMAGE_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
const IMAGE_RESULT_DOWNLOAD_MAX_BYTES = 80 * 1024 * 1024;
const IMAGE_EDIT_TIMEOUT_MS = 300000;
const IMAGE_EDIT_MAX_ATTEMPTS = 2;
const IMAGE_EDIT_RETRY_DELAY_MS = 1500;
const IMAGE_SOURCE_DOWNLOAD_MAX_ATTEMPTS = 4;
const IMAGE_SOURCE_DOWNLOAD_RETRY_DELAY_MS = 2000;
const IMAGE_EDIT_PRIMARY_FALLBACK_TIMEOUT_MS = 60000;
const RUNNINGHUB_MIN_FALLBACK_TIMEOUT_MS = 30000;
const RUNNINGHUB_IMAGE_TO_IMAGE_URL = 'https://www.runninghub.cn/openapi/v2/rhart-image-n-g31-flash/image-to-image';
const RUNNINGHUB_QUERY_URL = 'https://www.runninghub.cn/openapi/v2/query';
const RUNNINGHUB_FALLBACK_CHECK_INTERVAL_MS = 5000;
const RUNNINGHUB_QUERY_RETRY_DELAY_MS = 3000;
const RUNNINGHUB_RESULT_DOWNLOAD_RETRY_DELAY_MS = 5000;

type ImageEditTarget = {
  name: 'primary';
  model: string;
  baseUrl: string;
  apiKey: string;
};

type ImageEditFormParams = {
  prompt: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  maskImageBase64?: string;
  maskImageBuffer?: Buffer;
  timeoutMs?: number;
};

type ImageEditParams = ImageEditFormParams & {
  imageUrl: string;
  localMaterialOrigin?: string | null;
};

type PreparedImageEditParams = ImageEditFormParams;

type ImageEditResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
};

type ImageEditTargetName = ImageEditTarget['name'] | 'runninghub-primary' | 'runninghub-fallback';

type ImageEditMeta = {
  model: string;
  baseUrl: string;
  targetName: ImageEditTargetName;
};

type RunningHubImageToImageResponse = {
  taskId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  results?: unknown;
  failedReason?: unknown;
};

export class ImageEditTimeoutError extends Error {
  readonly code = 'IMAGE_EDIT_TIMEOUT';

  constructor(message: string) {
    super(message);
    this.name = 'ImageEditTimeoutError';
  }
}

class ImageEditResultDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageEditResultDownloadError';
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function buildCompatUrl(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
}

function getImageEditTarget(): ImageEditTarget {
  const primaryApiKey = getOpenAICompatApiKey();
  const primaryModel = getOpenAICompatImageModel();

  if (!primaryApiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }

  return {
    name: 'primary',
    model: primaryModel,
    baseUrl: trimTrailingSlash(getOpenAICompatBaseUrl()),
    apiKey: primaryApiKey,
  };
}

function isTimeoutLikeMessage(message: string) {
  return /timeout|ETIMEDOUT|AbortError|超时/i.test(message);
}

export function isImageEditTimeoutError(error: unknown) {
  return error instanceof ImageEditTimeoutError
    || (error instanceof Error && isTimeoutLikeMessage(error.message));
}

async function fetchImageBuffer(imageUrl: string, maxBytes = IMAGE_DOWNLOAD_MAX_BYTES, localMaterialOrigin?: string | null): Promise<Buffer> {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
    maxBytes,
    allowLocalMaterialFile: true,
    localMaterialOrigin,
  });
  return image.buffer;
}

function decodeImageBase64(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

function bufferToBlob(buffer: Buffer, type: string) {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type });
}

function createImageEditForm(params: ImageEditFormParams, normalizedBuffer: Buffer, model: string) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  form.append('image', bufferToBlob(normalizedBuffer, 'image/png'), 'source.png');

  if (params.maskImageBuffer) {
    form.append('mask_image', bufferToBlob(params.maskImageBuffer, 'image/png'), 'mask.png');
  } else if (params.maskImageBase64) {
    const maskMatch = params.maskImageBase64.match(/^data:image\/png;base64,(.+)$/);
    const maskData = maskMatch ? maskMatch[1] : params.maskImageBase64;
    form.append('mask_image', bufferToBlob(Buffer.from(maskData, 'base64'), 'image/png'), 'mask.png');
  }

  if (params.size) {
    form.append('size', params.size);
  }
  if (params.aspectRatio) {
    form.append('aspect_ratio', params.aspectRatio);
  }
  if (params.quality) {
    form.append('quality', params.quality);
  }

  return form;
}

function isRetriableImageEditError(error: Error) {
  return error instanceof ImageEditResultDownloadError
    || /upstream_error|Upstream request failed|fetch failed/i.test(error.message);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRunningHubApiKey() {
  return process.env.RUNNINGHUB_API_KEY || '';
}

function shouldUseRunningHubFallback(error: unknown) {
  if (!getRunningHubApiKey()) return false;
  if (isImageEditTimeoutError(error)) return true;
  if (!(error instanceof Error)) return true;
  return /不支持该模型|invalid_request_error|upstream_error|Upstream service temporarily unavailable|fetch failed|502|503|504/i.test(error.message);
}

function isTransientRunningHubError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|timeout|AbortError|502|503|504/i.test(error.message);
}

function isTransientImageDownloadError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return /fetch failed|下载图片超时|ECONNRESET|ETIMEDOUT|timeout|AbortError|502|503|504/i.test(error.message);
}

function getFallbackAwarePrimaryTimeoutMs(totalTimeoutMs: number) {
  if (!getRunningHubApiKey()) return totalTimeoutMs;
  return Math.min(totalTimeoutMs, IMAGE_EDIT_PRIMARY_FALLBACK_TIMEOUT_MS);
}

function getRemainingFallbackTimeoutMs(totalTimeoutMs: number, startedAt: number) {
  const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
  return Math.max(RUNNINGHUB_MIN_FALLBACK_TIMEOUT_MS, remainingMs);
}

function inferRunningHubAspectRatio(params: ImageEditFormParams, normalizedBuffer: Buffer) {
  if (params.aspectRatio && params.aspectRatio !== 'auto') {
    return params.aspectRatio;
  }

  if (params.size) {
    const match = params.size.match(/^(\d+)x(\d+)$/);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width > 0 && height > 0) {
        const ratio = width / height;
        if (Math.abs(ratio - 1) < 0.08) return '1:1';
        if (ratio > 1.65) return '16:9';
        if (ratio > 1.25) return '4:3';
        if (ratio < 0.62) return '9:16';
        if (ratio < 0.82) return '3:4';
      }
    }
  }

  return normalizedBuffer.length > 0 ? '1:1' : '1:1';
}

function inferRunningHubResolution(params: ImageEditFormParams) {
  if (!params.size) return '1k';
  const match = params.size.match(/^(\d+)x(\d+)$/);
  if (!match) return '1k';
  const longEdge = Math.max(Number(match[1]), Number(match[2]));
  if (longEdge >= 1800) return '2k';
  return '1k';
}

function extractRunningHubResultUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    return value.startsWith('http://') || value.startsWith('https://') ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractRunningHubResultUrls);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...extractRunningHubResultUrls(record.url),
      ...extractRunningHubResultUrls(record.imageUrl),
      ...extractRunningHubResultUrls(record.image_url),
      ...extractRunningHubResultUrls(record.resultUrl),
      ...extractRunningHubResultUrls(record.results),
      ...extractRunningHubResultUrls(record.data),
    ];
  }
  return [];
}

async function createRunningHubImageToImageTask(params: ImageEditFormParams, imageUrl: string, normalizedBuffer: Buffer) {
  const apiKey = getRunningHubApiKey();
  if (!apiKey) {
    throw new Error('缺少 RUNNINGHUB_API_KEY');
  }

  const response = await fetch(RUNNINGHUB_IMAGE_TO_IMAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      imageUrls: [imageUrl],
      prompt: params.prompt,
      aspectRatio: inferRunningHubAspectRatio(params, normalizedBuffer),
      resolution: inferRunningHubResolution(params),
    }),
  });

  const text = await response.text();
  let data: RunningHubImageToImageResponse;
  try {
    data = JSON.parse(text) as RunningHubImageToImageResponse;
  } catch {
    throw new Error(`RunningHub图像通道返回格式异常: ${text.slice(0, 200)}`);
  }

  if (!response.ok || data.errorCode) {
    throw new Error(`RunningHub图像通道创建失败: ${data.errorMessage || data.errorCode || text.slice(0, 200)}`);
  }

  if (!data.taskId) {
    throw new Error('RunningHub图像通道未返回任务ID');
  }

  return data.taskId;
}

async function queryRunningHubTask(taskId: string) {
  let response: Response;
  try {
    response = await fetch(RUNNINGHUB_QUERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getRunningHubApiKey()}`,
      },
      body: JSON.stringify({ taskId }),
    });
  } catch (error) {
    if (isTransientRunningHubError(error)) {
      return {
        status: 'PENDING',
        errorMessage: getErrorMessage(error),
        results: [],
      };
    }
    throw error;
  }

  const text = await response.text();
  let data: RunningHubImageToImageResponse;
  try {
    data = JSON.parse(text) as RunningHubImageToImageResponse;
  } catch {
    throw new Error(`RunningHub图像通道查询返回格式异常: ${text.slice(0, 200)}`);
  }

  if (!response.ok || data.errorCode) {
    return {
      status: 'FAILED',
      errorMessage: data.errorMessage || data.errorCode || text.slice(0, 200),
      results: [],
    };
  }

  return {
    status: data.status || '',
    errorMessage: data.errorMessage || '',
    results: data.results || [],
  };
}

async function fetchRunningHubResultBuffer(resultUrl: string, deadlineAt: number) {
  let lastError: unknown = null;
  let attempt = 0;

  while (Date.now() < deadlineAt) {
    attempt += 1;
    try {
      return await fetchImageBuffer(resultUrl, IMAGE_RESULT_DOWNLOAD_MAX_BYTES);
    } catch (error) {
      lastError = error;
      if (!isTransientRunningHubError(error)) {
        break;
      }
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      console.warn(`[RunningHub图像通道] 结果图下载失败，准备重试第 ${attempt + 1} 次: ${getErrorMessage(error)}`);
      await sleep(Math.min(RUNNINGHUB_RESULT_DOWNLOAD_RETRY_DELAY_MS, remainingMs));
    }
  }

  throw lastError instanceof Error ? lastError : new ImageEditTimeoutError('RunningHub图像通道结果图下载超时');
}

async function fetchSourceImageBufferWithRetry(imageUrl: string, localMaterialOrigin?: string | null) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= IMAGE_SOURCE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImageBuffer(imageUrl, IMAGE_DOWNLOAD_MAX_BYTES, localMaterialOrigin);
    } catch (error) {
      lastError = error;
      if (attempt >= IMAGE_SOURCE_DOWNLOAD_MAX_ATTEMPTS || !isTransientImageDownloadError(error)) {
        break;
      }
      console.warn(`[图像编辑] 源图下载失败，准备重试 ${attempt}/${IMAGE_SOURCE_DOWNLOAD_MAX_ATTEMPTS}: ${getErrorMessage(error)}`);
      await sleep(IMAGE_SOURCE_DOWNLOAD_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('源图下载失败');
}

async function runRunningHubFallbackFromUrl(
  params: ImageEditFormParams,
  imageUrl: string,
  normalizedBuffer: Buffer,
): Promise<Buffer> {
  const timeoutMs = params.timeoutMs || IMAGE_EDIT_TIMEOUT_MS;
  const startedAt = Date.now();
  const deadlineAt = startedAt + timeoutMs;
  const taskId = await createRunningHubImageToImageTask(params, imageUrl, normalizedBuffer);
  console.warn(`[RunningHub图像通道] 图像编辑任务已创建: ${taskId}`);

  while (Date.now() < deadlineAt) {
    const task = await queryRunningHubTask(taskId);
    if (task.status === 'SUCCESS') {
      const [resultUrl] = extractRunningHubResultUrls(task.results);
      if (!resultUrl) {
        throw new Error('RunningHub图像通道成功但未返回图片URL');
      }
      return fetchRunningHubResultBuffer(resultUrl, deadlineAt);
    }

    if (task.status === 'FAILED') {
      throw new Error(`RunningHub图像通道任务失败: ${task.errorMessage || '未知错误'}`);
    }

    await sleep(task.errorMessage ? RUNNINGHUB_QUERY_RETRY_DELAY_MS : RUNNINGHUB_FALLBACK_CHECK_INTERVAL_MS);
  }

  throw new ImageEditTimeoutError(`RunningHub图像通道超时（${timeoutMs}ms）`);
}


function shouldUseRunningHubPrimary() {
  return process.env.IMAGE_EDIT_PROVIDER === 'runninghub' || Boolean(getRunningHubApiKey());
}

export async function runPsydoImageEditFromUrl(params: ImageEditParams): Promise<Buffer> {
  const result = await runPsydoImageEditWithMetaFromUrl(params);
  return result.buffer;
}

async function runImageEditWithTarget(
  params: ImageEditFormParams,
  normalizedBuffer: Buffer,
  target: ImageEditTarget,
): Promise<Buffer> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs || IMAGE_EDIT_TIMEOUT_MS;
  let lastRetryableError: Error | null = null;

  for (let attempt = 1; attempt <= IMAGE_EDIT_MAX_ATTEMPTS; attempt++) {
    const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new ImageEditTimeoutError(`图像编辑超时（${timeoutMs}ms）`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remainingTimeoutMs);
    const form = createImageEditForm(params, normalizedBuffer, target.model);
    let retryError: Error | null = null;

    try {
      const response = await fetch(buildCompatUrl(target.baseUrl, '/images/edits'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const message = `图像编辑失败: ${response.status} ${errorText.substring(0, 200)}`;
        if (isTimeoutLikeMessage(message)) {
          throw new ImageEditTimeoutError(`图像编辑超时（${timeoutMs}ms）`);
        }
        throw new Error(message);
      }

      const data = await response.json() as ImageEditResponse;
      const first = data.data?.[0];
      if (!first) {
        throw new Error('图像编辑未返回结果');
      }

      if (first.b64_json) {
        return decodeImageBase64(first.b64_json);
      }

      if (first.url) {
        try {
          return await fetchImageBuffer(first.url, IMAGE_RESULT_DOWNLOAD_MAX_BYTES);
        } catch (error) {
          throw new ImageEditResultDownloadError(`图像编辑结果下载失败: ${getErrorMessage(error)}`);
        }
      }

      throw new Error('图像编辑返回格式不支持');
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ImageEditTimeoutError(`图像编辑超时（${timeoutMs}ms）`);
      }

      if (isImageEditTimeoutError(error)) {
        throw error;
      }

      const normalizedError = error instanceof Error ? error : new Error('图像编辑失败');
      const canRetry = attempt < IMAGE_EDIT_MAX_ATTEMPTS && isRetriableImageEditError(normalizedError);
      if (!canRetry) {
        throw normalizedError;
      }

      retryError = normalizedError;
      lastRetryableError = normalizedError;
    } finally {
      clearTimeout(timeoutId);
    }

    if (retryError) {
      console.warn(`[Psydo图像编辑] ${target.name} 第 ${attempt} 次请求失败，准备重试: ${retryError.message}`);
      await sleep(Math.min(IMAGE_EDIT_RETRY_DELAY_MS, Math.max(0, timeoutMs - (Date.now() - startedAt))));
    }
  }

  throw lastRetryableError || new Error('图像编辑失败');
}

export async function runPsydoImageEditWithMetaFromUrl(params: ImageEditParams): Promise<{ buffer: Buffer; meta: ImageEditMeta }> {
  const startedAt = Date.now();
  const totalTimeoutMs = params.timeoutMs || IMAGE_EDIT_TIMEOUT_MS;

  if (shouldUseRunningHubPrimary()) {
    const fallbackTimeoutMs = getRemainingFallbackTimeoutMs(totalTimeoutMs, startedAt);
    const buffer = await runRunningHubFallbackFromUrl({
      ...params,
      timeoutMs: fallbackTimeoutMs,
    }, params.imageUrl, Buffer.alloc(1));

    return {
      buffer,
      meta: {
        model: 'rhart-image-n-g31-flash',
        baseUrl: RUNNINGHUB_IMAGE_TO_IMAGE_URL,
        targetName: 'runninghub-primary',
      },
    };
  }

  try {
    const sourceBuffer = await fetchSourceImageBufferWithRetry(params.imageUrl, params.localMaterialOrigin);
    const normalizedBuffer = await sharp(sourceBuffer).rotate().png().toBuffer();

    return runPsydoImageEditWithMetaFromPreparedBuffer(params, normalizedBuffer, params.imageUrl);
  } catch (error) {
    if (!shouldUseRunningHubFallback(error)) {
      throw error;
    }

    console.warn(`[图像编辑] 源图下载/预处理失败，切换 RunningHub 通道: ${getErrorMessage(error)}`);
    const fallbackTimeoutMs = getRemainingFallbackTimeoutMs(totalTimeoutMs, startedAt);
    const buffer = await runRunningHubFallbackFromUrl({
      ...params,
      timeoutMs: fallbackTimeoutMs,
    }, params.imageUrl, Buffer.alloc(1));

    return {
      buffer,
      meta: {
        model: 'rhart-image-n-g31-flash',
        baseUrl: RUNNINGHUB_IMAGE_TO_IMAGE_URL,
        targetName: 'runninghub-fallback',
      },
    };
  }
}

export async function runPsydoImageEditWithMetaFromPreparedBuffer(
  params: PreparedImageEditParams,
  normalizedBuffer: Buffer,
  fallbackImageUrl?: string,
): Promise<{ buffer: Buffer; meta: ImageEditMeta }> {
  const startedAt = Date.now();
  const totalTimeoutMs = params.timeoutMs || IMAGE_EDIT_TIMEOUT_MS;

  if (shouldUseRunningHubPrimary()) {
    const imageUrl = fallbackImageUrl || await uploadToCozeStorage(
      normalizedBuffer,
      `runninghub-primary/inputs/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`,
      'image/png',
    );
    const buffer = await runRunningHubFallbackFromUrl({
      ...params,
      timeoutMs: getRemainingFallbackTimeoutMs(totalTimeoutMs, startedAt),
    }, imageUrl, normalizedBuffer);
    return {
      buffer,
      meta: {
        model: 'rhart-image-n-g31-flash',
        baseUrl: RUNNINGHUB_IMAGE_TO_IMAGE_URL,
        targetName: 'runninghub-primary',
      },
    };
  }

  const target = getImageEditTarget();
  const primaryTimeoutMs = getFallbackAwarePrimaryTimeoutMs(totalTimeoutMs);
  try {
    const buffer = await runImageEditWithTarget({
      ...params,
      timeoutMs: primaryTimeoutMs,
    }, normalizedBuffer, target);
    return {
      buffer,
      meta: {
        model: target.model,
        baseUrl: target.baseUrl,
        targetName: target.name,
      },
    };
  } catch (error) {
    if (!shouldUseRunningHubFallback(error)) {
      throw error;
    }

    console.warn(`[图像编辑] 主通道失败，切换 RunningHub 通道: ${getErrorMessage(error)}`);
    const fallbackTimeoutMs = getRemainingFallbackTimeoutMs(totalTimeoutMs, startedAt);
    const imageUrl = fallbackImageUrl || await uploadToCozeStorage(
      normalizedBuffer,
      `runninghub-fallback/inputs/${Date.now()}-${Math.floor(Math.random() * 10000)}.png`,
      'image/png',
    );
    const buffer = await runRunningHubFallbackFromUrl({
      ...params,
      timeoutMs: fallbackTimeoutMs,
    }, imageUrl, normalizedBuffer);
    return {
      buffer,
      meta: {
        model: 'rhart-image-n-g31-flash',
        baseUrl: RUNNINGHUB_IMAGE_TO_IMAGE_URL,
        targetName: 'runninghub-fallback',
      },
    };
  }
}
