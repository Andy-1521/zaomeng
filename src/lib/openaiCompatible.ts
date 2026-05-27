const DEFAULT_OPENAI_COMPAT_BASE_URL = 'https://api.psydo.top/v1';
const DEFAULT_OPENAI_COMPAT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_OPENAI_COMPAT_VISION_MODEL = 'gpt-5.4-mini';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizeOpenAICompatBaseUrl(value: string) {
  const trimmed = trimTrailingSlash(value);

  try {
    const parsed = new URL(trimmed);
    const path = trimTrailingSlash(parsed.pathname);
    if (!path || path === '/') {
      return `${trimmed}/v1`;
    }
  } catch {
    // Keep non-URL values untouched so deployment logs expose the original misconfiguration.
  }

  return trimmed;
}

export function getOpenAICompatBaseUrl() {
  const value = process.env.OPENAI_COMPAT_BASE_URL || process.env.PSYDO_BASE_URL || DEFAULT_OPENAI_COMPAT_BASE_URL;
  return normalizeOpenAICompatBaseUrl(value);
}

export function buildOpenAICompatUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getOpenAICompatBaseUrl()}${normalizedPath}`;
}

export function getOpenAICompatVisionBaseUrl() {
  const value = process.env.OPENAI_COMPAT_VISION_BASE_URL
    || process.env.PSYDO_VISION_BASE_URL
    || process.env.OPENAI_COMPAT_BASE_URL
    || process.env.PSYDO_BASE_URL
    || DEFAULT_OPENAI_COMPAT_BASE_URL;
  return normalizeOpenAICompatBaseUrl(value);
}

export function buildOpenAICompatVisionUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getOpenAICompatVisionBaseUrl()}${normalizedPath}`;
}

export function getOpenAICompatApiKey() {
  return process.env.OPENAI_COMPAT_API_KEY || process.env.PSYDO_API_KEY || '';
}

export function getOpenAICompatVisionApiKey() {
  return process.env.OPENAI_COMPAT_VISION_API_KEY
    || process.env.PSYDO_VISION_API_KEY
    || getOpenAICompatApiKey();
}

export function getOpenAICompatImageModel() {
  return process.env.OPENAI_COMPAT_IMAGE_MODEL || process.env.PSYDO_IMAGE_MODEL || DEFAULT_OPENAI_COMPAT_IMAGE_MODEL;
}

export function getOpenAICompatVisionModel() {
  return process.env.OPENAI_COMPAT_VISION_MODEL
    || process.env.PSYDO_VISION_MODEL
    || DEFAULT_OPENAI_COMPAT_VISION_MODEL;
}

export function requireOpenAICompatApiKey() {
  const apiKey = getOpenAICompatApiKey();
  if (!apiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }
  return apiKey;
}

export function requireOpenAICompatVisionApiKey() {
  const apiKey = getOpenAICompatVisionApiKey();
  if (!apiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_VISION_API_KEY');
  }
  return apiKey;
}
