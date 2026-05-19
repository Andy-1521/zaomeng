import sharp from 'sharp';
import {
  getOpenAICompatApiKey,
  getOpenAICompatBaseUrl,
  getOpenAICompatFallbackApiKey,
  getOpenAICompatFallbackBaseUrl,
  getOpenAICompatFallbackImageModel,
  getOpenAICompatImageModel,
} from '@/lib/openaiCompatible';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const IMAGE_EDIT_TIMEOUT_MS = 300000;
const IMAGE_EDIT_MAX_ATTEMPTS = 2;
const IMAGE_EDIT_RETRY_DELAY_MS = 1500;

type ImageEditTarget = {
  name: 'primary' | 'fallback';
  model: string;
  baseUrl: string;
  apiKey: string;
  usedFallback: boolean;
};

type ImageEditParams = {
  imageUrl: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  maskImageBase64?: string;
};

type ImageEditResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
};

type ImageEditMeta = {
  model: string;
  baseUrl: string;
  targetName: ImageEditTarget['name'];
  usedFallback: boolean;
};

export class ImageEditTimeoutError extends Error {
  readonly code = 'IMAGE_EDIT_TIMEOUT';

  constructor(message: string) {
    super(message);
    this.name = 'ImageEditTimeoutError';
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function buildCompatUrl(baseUrl: string, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
}

function getFallbackImageEditTarget(primaryModel: string): ImageEditTarget | null {
  const baseUrl = getOpenAICompatFallbackBaseUrl();
  const apiKey = getOpenAICompatFallbackApiKey();
  const model = getOpenAICompatFallbackImageModel(primaryModel);

  if (!baseUrl || !apiKey) {
    return null;
  }

  const primaryBaseUrl = trimTrailingSlash(getOpenAICompatBaseUrl());
  const primaryApiKey = getOpenAICompatApiKey();
  if (baseUrl === primaryBaseUrl && apiKey === primaryApiKey && model === primaryModel) {
    return null;
  }

  return {
    name: 'fallback',
    model,
    baseUrl,
    apiKey,
    usedFallback: true,
  };
}

function getImageEditTargets(): ImageEditTarget[] {
  const primaryApiKey = getOpenAICompatApiKey();
  const primaryModel = getOpenAICompatImageModel();
  const targets: ImageEditTarget[] = [];

  if (primaryApiKey) {
    targets.push({
      name: 'primary',
      model: primaryModel,
      baseUrl: trimTrailingSlash(getOpenAICompatBaseUrl()),
      apiKey: primaryApiKey,
      usedFallback: false,
    });
  }

  const fallbackTarget = getFallbackImageEditTarget(primaryModel);
  if (fallbackTarget) {
    targets.push(fallbackTarget);
  }

  if (targets.length === 0) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }

  return targets;
}

function isTimeoutLikeMessage(message: string) {
  return /timeout|ETIMEDOUT|AbortError|超时/i.test(message);
}

export function isImageEditTimeoutError(error: unknown) {
  return error instanceof ImageEditTimeoutError
    || (error instanceof Error && isTimeoutLikeMessage(error.message));
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, {
      headers: buildBrowserImageHeaders(imageUrl),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`下载图片失败 (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`下载图片超时（${IMAGE_DOWNLOAD_TIMEOUT_MS}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function decodeImageBase64(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

function createImageEditForm(params: ImageEditParams, normalizedBuffer: Buffer, model: string) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  const arrayBuffer = normalizedBuffer.buffer.slice(
    normalizedBuffer.byteOffset,
    normalizedBuffer.byteOffset + normalizedBuffer.byteLength,
  ) as ArrayBuffer;
  form.append('image', new Blob([arrayBuffer], { type: 'image/png' }), 'source.png');

  if (params.maskImageBase64) {
    const maskMatch = params.maskImageBase64.match(/^data:image\/png;base64,(.+)$/);
    const maskData = maskMatch ? maskMatch[1] : params.maskImageBase64;
    form.append('mask_image', new Blob([Buffer.from(maskData, 'base64')], { type: 'image/png' }), 'mask.png');
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
  return /upstream_error|Upstream request failed|fetch failed/i.test(error.message);
}

function isFallbackEligibleImageEditError(error: unknown) {
  if (isImageEditTimeoutError(error)) {
    return true;
  }

  return error instanceof Error && isRetriableImageEditError(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPsydoImageEditFromUrl(params: ImageEditParams): Promise<Buffer> {
  const result = await runPsydoImageEditWithMetaFromUrl(params);
  return result.buffer;
}

async function runImageEditWithTarget(
  params: ImageEditParams,
  normalizedBuffer: Buffer,
  target: ImageEditTarget,
): Promise<Buffer> {
  const startedAt = Date.now();
  let lastRetryableError: Error | null = null;

  for (let attempt = 1; attempt <= IMAGE_EDIT_MAX_ATTEMPTS; attempt++) {
    const remainingTimeoutMs = IMAGE_EDIT_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new ImageEditTimeoutError(`图像编辑超时（${IMAGE_EDIT_TIMEOUT_MS}ms）`);
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
          throw new ImageEditTimeoutError(`图像编辑超时（${IMAGE_EDIT_TIMEOUT_MS}ms）`);
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
        return fetchImageBuffer(first.url);
      }

      throw new Error('图像编辑返回格式不支持');
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ImageEditTimeoutError(`图像编辑超时（${IMAGE_EDIT_TIMEOUT_MS}ms）`);
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
      await sleep(Math.min(IMAGE_EDIT_RETRY_DELAY_MS, Math.max(0, IMAGE_EDIT_TIMEOUT_MS - (Date.now() - startedAt))));
    }
  }

  throw lastRetryableError || new Error('图像编辑失败');
}

export async function runPsydoImageEditWithMetaFromUrl(params: ImageEditParams): Promise<{ buffer: Buffer; meta: ImageEditMeta }> {
  const targets = getImageEditTargets();
  const sourceBuffer = await fetchImageBuffer(params.imageUrl);
  const normalizedBuffer = await sharp(sourceBuffer).rotate().png().toBuffer();

  let lastTimeoutError: ImageEditTimeoutError | null = null;
  let lastFallbackEligibleError: Error | null = null;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    try {
      const buffer = await runImageEditWithTarget(params, normalizedBuffer, target);
      return {
        buffer,
        meta: {
          model: target.model,
          baseUrl: target.baseUrl,
          targetName: target.name,
          usedFallback: target.usedFallback,
        },
      };
    } catch (error) {
      const canUseNextTarget = index < targets.length - 1;

      if (isImageEditTimeoutError(error)) {
        lastTimeoutError = error instanceof ImageEditTimeoutError
          ? error
          : new ImageEditTimeoutError(`图像编辑超时（${IMAGE_EDIT_TIMEOUT_MS}ms）`);

        if (canUseNextTarget) {
          console.warn(`[Psydo图像编辑] ${target.name} 超时，切换到备用目标`);
          continue;
        }
      }

      if (isFallbackEligibleImageEditError(error)) {
        lastFallbackEligibleError = error instanceof Error ? error : new Error('图像编辑失败');
        if (canUseNextTarget) {
          console.warn(`[Psydo图像编辑] ${target.name} 上游异常，切换到备用目标: ${lastFallbackEligibleError.message}`);
          continue;
        }
      }

      throw error;
    }
  }

  throw lastFallbackEligibleError || lastTimeoutError || new ImageEditTimeoutError(`图像编辑超时（${IMAGE_EDIT_TIMEOUT_MS}ms）`);
}
