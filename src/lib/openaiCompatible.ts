const DEFAULT_OPENAI_COMPAT_BASE_URL = 'https://subapi.xiaoye.lol/v1';
const DEFAULT_OPENAI_COMPAT_IMAGE_MODEL = 'gpt-image-2';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getOpenAICompatBaseUrl() {
  const value = process.env.OPENAI_COMPAT_BASE_URL || process.env.PSYDO_BASE_URL || DEFAULT_OPENAI_COMPAT_BASE_URL;
  return trimTrailingSlash(value);
}

export function buildOpenAICompatUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getOpenAICompatBaseUrl()}${normalizedPath}`;
}

export function getOpenAICompatApiKey() {
  return process.env.OPENAI_COMPAT_API_KEY || process.env.PSYDO_API_KEY || '';
}

export function getOpenAICompatImageModel() {
  return process.env.OPENAI_COMPAT_IMAGE_MODEL || process.env.PSYDO_IMAGE_MODEL || DEFAULT_OPENAI_COMPAT_IMAGE_MODEL;
}

export function getOpenAICompatFallbackBaseUrl() {
  const value = process.env.OPENAI_COMPAT_FALLBACK_BASE_URL || process.env.PSYDO_FALLBACK_BASE_URL || '';
  return value ? trimTrailingSlash(value) : '';
}

export function getOpenAICompatFallbackApiKey() {
  return process.env.OPENAI_COMPAT_FALLBACK_API_KEY || process.env.PSYDO_FALLBACK_API_KEY || '';
}

export function getOpenAICompatFallbackImageModel(primaryModel = getOpenAICompatImageModel()) {
  return process.env.OPENAI_COMPAT_FALLBACK_IMAGE_MODEL || process.env.PSYDO_FALLBACK_IMAGE_MODEL || primaryModel;
}

export function requireOpenAICompatApiKey() {
  const apiKey = getOpenAICompatApiKey();
  if (!apiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }
  return apiKey;
}
