import net from 'net';
import { lookup } from 'dns/promises';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';
import { normalizeFileExtension, readLocalMaterialFileFromUrl } from '@/lib/localUploadStorage';

export const DEFAULT_SAFE_IMAGE_TIMEOUT_MS = 30000;
export const DEFAULT_SAFE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const DEFAULT_SAFE_IMAGE_MAX_REDIRECTS = 3;

export type SafeRemoteImageOptions = {
  refererUrl?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  allowSvg?: boolean;
  userAgent?: string;
  skipPrivateNetworkCheck?: boolean;
  allowLocalMaterialFile?: boolean;
  localMaterialOrigin?: string | null;
};

export type SafeRemoteImage = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  finalUrl: string;
};

type ResolvedAddress = {
  address: string;
  family: number;
};

function stripIpv6Brackets(hostname: string) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function isPrivateIpAddress(address: string) {
  const normalizedAddress = stripIpv6Brackets(address.toLowerCase());
  const ipv4MappedAddress = normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4MappedAddress) {
    return isPrivateIpAddress(ipv4MappedAddress);
  }

  const ipVersion = net.isIP(normalizedAddress);

  if (ipVersion === 4) {
    const parts = normalizedAddress.split('.').map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }

  if (ipVersion === 6) {
    return normalizedAddress === '::1'
      || normalizedAddress === '::'
      || normalizedAddress.startsWith('fc')
      || normalizedAddress.startsWith('fd')
      || normalizedAddress.startsWith('fe80:')
      || normalizedAddress.startsWith('ff');
  }

  return false;
}

function getImageExtension(imageUrl: string) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (!matched) return 'jpg';
    return normalizeFileExtension(matched[1]);
  } catch {
    const matched = imageUrl.match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/);
    return matched ? normalizeFileExtension(matched[1]) : 'jpg';
  }
}

export function getImageContentType(extension: string) {
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'jpeg':
    case 'jpg':
    default:
      return 'image/jpeg';
  }
}

function getExtensionFromContentType(contentType: string, fallback: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('image/png')) return 'png';
  if (normalized.includes('image/webp')) return 'webp';
  if (normalized.includes('image/gif')) return 'gif';
  if (normalized.includes('image/bmp')) return 'bmp';
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return 'jpg';
  return fallback;
}

export async function assertSafeRemoteImageUrl(imageUrl: string, options?: Pick<SafeRemoteImageOptions, 'skipPrivateNetworkCheck'>) {
  const url = new URL(imageUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https 图片地址');
  }

  if (options?.skipPrivateNetworkCheck) {
    return;
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不支持访问本机地址图片');
  }

  if (isPrivateIpAddress(hostname)) {
    throw new Error('不支持访问内网地址图片');
  }

  let resolvedAddresses: ResolvedAddress[];
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: false });
  } catch {
    throw new Error('图片地址无法解析');
  }

  if (!resolvedAddresses.length || resolvedAddresses.some((item) => isPrivateIpAddress(item.address))) {
    throw new Error('不支持访问内网地址图片');
  }
}

async function fetchImageResponse(
  imageUrl: string,
  signal: AbortSignal,
  options: Required<Pick<SafeRemoteImageOptions, 'maxRedirects' | 'allowSvg' | 'skipPrivateNetworkCheck'>> & SafeRemoteImageOptions,
  redirectCount = 0,
): Promise<{ response: Response; finalUrl: string }> {
  await assertSafeRemoteImageUrl(imageUrl, { skipPrivateNetworkCheck: options.skipPrivateNetworkCheck });

  const response = await fetch(imageUrl, {
    headers: buildBrowserImageHeaders(imageUrl, {
      refererUrl: options.refererUrl ?? imageUrl,
      accept: options.accept || 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      userAgent: options.userAgent,
    }),
    redirect: 'manual',
    signal,
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= options.maxRedirects) {
      throw new Error('图片地址重定向次数过多');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('图片地址重定向无效');
    }

    return fetchImageResponse(new URL(location, imageUrl).toString(), signal, options, redirectCount + 1);
  }

  return { response, finalUrl: imageUrl };
}

async function readLimitedResponseBuffer(response: Response, maxBytes: number) {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error('图片文件过大，暂不支持处理');
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('图片文件过大，暂不支持处理');
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

export async function downloadSafeRemoteImage(imageUrl: string, options: SafeRemoteImageOptions = {}): Promise<SafeRemoteImage> {
  if (options.allowLocalMaterialFile) {
    const localMaterialFile = await readLocalMaterialFileFromUrl(imageUrl, {
      allowedOrigin: options.localMaterialOrigin,
    });
    if (localMaterialFile) {
      const extension = getImageExtension(localMaterialFile.relativePath);
      return {
        buffer: localMaterialFile.buffer,
        contentType: getImageContentType(extension),
        extension,
        finalUrl: imageUrl,
      };
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SAFE_IMAGE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_SAFE_IMAGE_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_SAFE_IMAGE_MAX_REDIRECTS;
  const allowSvg = options.allowSvg ?? false;
  const skipPrivateNetworkCheck = options.skipPrivateNetworkCheck ?? false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { response, finalUrl } = await fetchImageResponse(
      imageUrl,
      controller.signal,
      { ...options, maxRedirects, allowSvg, skipPrivateNetworkCheck },
    );

    if (!response.ok) {
      throw new Error(`无法下载图片资源 (${response.status})`);
    }

    const responseContentType = response.headers.get('content-type') || '';
    const normalizedContentType = responseContentType.toLowerCase();
    if (!normalizedContentType.startsWith('image/')) {
      throw new Error(`当前资源不是图片，无法保存 (${responseContentType || 'unknown'})`);
    }

    if (!allowSvg && normalizedContentType.includes('image/svg')) {
      throw new Error('暂不支持 SVG 图片处理');
    }

    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > maxBytes) {
      throw new Error('图片文件过大，暂不支持处理');
    }

    const buffer = await readLimitedResponseBuffer(response, maxBytes);
    const fallbackExtension = getImageExtension(finalUrl);
    const extension = getExtensionFromContentType(responseContentType, fallbackExtension);

    return {
      buffer,
      contentType: getImageContentType(extension),
      extension,
      finalUrl,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('下载图片超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
