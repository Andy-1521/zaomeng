import sharp from 'sharp';
import {
  getOpenAICompatApiKey,
  getOpenAICompatBaseUrl,
  getOpenAICompatImageModel,
} from '@/lib/openaiCompatible';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const IMAGE_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
const IMAGE_RESULT_DOWNLOAD_MAX_BYTES = 80 * 1024 * 1024;
const IMAGE_EDIT_TIMEOUT_MS = 300000;
const IMAGE_EDIT_MAX_ATTEMPTS = 2;
const IMAGE_EDIT_RETRY_DELAY_MS = 1500;

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

type ImageEditMeta = {
  model: string;
  baseUrl: string;
  targetName: ImageEditTarget['name'];
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
  const sourceBuffer = await fetchImageBuffer(params.imageUrl, IMAGE_DOWNLOAD_MAX_BYTES, params.localMaterialOrigin);
  const normalizedBuffer = await sharp(sourceBuffer).rotate().png().toBuffer();

  return runPsydoImageEditWithMetaFromPreparedBuffer(params, normalizedBuffer);
}

export async function runPsydoImageEditWithMetaFromPreparedBuffer(
  params: PreparedImageEditParams,
  normalizedBuffer: Buffer,
): Promise<{ buffer: Buffer; meta: ImageEditMeta }> {
  const target = getImageEditTarget();
  const buffer = await runImageEditWithTarget(params, normalizedBuffer, target);
  return {
    buffer,
    meta: {
      model: target.model,
      baseUrl: target.baseUrl,
      targetName: target.name,
    },
  };
}
