export const DEFAULT_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isLatin1(value: string) {
  for (const char of value) {
    if (char.charCodeAt(0) > 255) {
      return false;
    }
  }

  return true;
}

export function buildSafeRefererHeader(urlValue?: string | null) {
  if (!urlValue) {
    return undefined;
  }

  try {
    const normalizedUrl = new URL(urlValue).toString();
    if (isLatin1(normalizedUrl)) {
      return normalizedUrl;
    }

    const origin = new URL(urlValue).origin;
    if (origin && isLatin1(origin)) {
      return origin;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildBrowserImageHeaders(
  resourceUrl: string,
  options?: {
    refererUrl?: string | null;
    accept?: string;
    userAgent?: string;
  },
) {
  const headers: Record<string, string> = {
    'User-Agent': options?.userAgent || DEFAULT_BROWSER_USER_AGENT,
  };

  const referer = buildSafeRefererHeader(options?.refererUrl ?? resourceUrl);
  if (referer) {
    headers.Referer = referer;
  }

  if (options?.accept) {
    headers.Accept = options.accept;
  }

  return headers;
}
