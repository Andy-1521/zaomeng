const DEFAULT_OPENAI_COMPAT_BASE_URL = 'https://subapi.xiaoye.lol/v1';

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

export function requireOpenAICompatApiKey() {
  const apiKey = getOpenAICompatApiKey();
  if (!apiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }
  return apiKey;
}
