import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import { lookup } from 'dns/promises';
import { capturedImageManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { normalizeFileExtension, saveBufferToLocalMaterialFile } from '@/lib/localUploadStorage';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_PLUGIN_CAPTURE_BYTES = 30 * 1024 * 1024;
const MAX_PLUGIN_REDIRECTS = 3;

type CaptureImageRequest = {
  imageUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
  captureMethod?: string;
};

type ResolvedAddress = {
  address: string;
  family: number;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '采集图片失败';
}

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) {
    return null;
  }

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch (error) {
    console.error('[插件采集] 解析用户 cookie 失败:', error);
    return null;
  }
}

function getImageExtension(imageUrl: string) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (!matched) return 'jpg';
    return normalizeFileExtension(matched[1]);
  } catch {
    return 'jpg';
  }
}

function isAllowedImageType(value: unknown): value is NonNullable<CaptureImageRequest['imageType']> {
  return value === 'main' || value === 'detail';
}

function stripIpv6Brackets(hostname: string) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function isPrivateIpAddress(address: string) {
  const normalizedAddress = stripIpv6Brackets(address.toLowerCase());
  const ipVersion = net.isIP(normalizedAddress);

  if (ipVersion === 4) {
    const parts = normalizedAddress.split('.').map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
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

async function assertSafeRemoteUrl(imageUrl: string) {
  const url = new URL(imageUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https 图片地址');
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不支持采集本机地址图片');
  }

  if (isPrivateIpAddress(hostname)) {
    throw new Error('不支持采集内网地址图片');
  }

  let resolvedAddresses: ResolvedAddress[];
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: false });
  } catch {
    throw new Error('图片地址无法解析');
  }

  if (!resolvedAddresses.length || resolvedAddresses.some((item) => isPrivateIpAddress(item.address))) {
    throw new Error('不支持采集内网地址图片');
  }
}

function getContentType(extension: string) {
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

async function fetchImageResponse(imageUrl: string, pageUrl: string, signal: AbortSignal, redirectCount = 0): Promise<Response> {
  await assertSafeRemoteUrl(imageUrl);

  const response = await fetch(imageUrl, {
    headers: buildBrowserImageHeaders(imageUrl, {
      refererUrl: pageUrl || imageUrl,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    }),
    redirect: 'manual',
    signal,
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= MAX_PLUGIN_REDIRECTS) {
      throw new Error('图片地址重定向次数过多');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('图片地址重定向无效');
    }

    return fetchImageResponse(new URL(location, imageUrl).toString(), pageUrl, signal, redirectCount + 1);
  }

  return response;
}

async function readLimitedResponseBuffer(response: Response) {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PLUGIN_CAPTURE_BYTES) {
      throw new Error('图片文件过大，暂不支持插件采集');
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
    if (totalBytes > MAX_PLUGIN_CAPTURE_BYTES) {
      await reader.cancel();
      throw new Error('图片文件过大，暂不支持插件采集');
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

async function downloadImageBuffer(imageUrl: string, pageUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetchImageResponse(imageUrl, pageUrl, controller.signal);

    if (!response.ok) {
      throw new Error(`无法下载图片资源 (${response.status})`);
    }

    const responseContentType = response.headers.get('content-type') || '';
    const normalizedContentType = responseContentType.toLowerCase();
    if (!normalizedContentType.startsWith('image/')) {
      throw new Error(`当前资源不是图片，无法保存 (${responseContentType || 'unknown'})`);
    }

    if (normalizedContentType.includes('image/svg')) {
      throw new Error('暂不支持 SVG 图片采集');
    }

    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PLUGIN_CAPTURE_BYTES) {
      throw new Error('图片文件过大，暂不支持插件采集');
    }

    const buffer = await readLimitedResponseBuffer(response);

    const fallbackExtension = getImageExtension(imageUrl);
    const extension = getExtensionFromContentType(responseContentType, fallbackExtension);
    return {
      buffer,
      contentType: getContentType(extension),
      extension,
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

function normalizeLocalMaterialUrl(url: string) {
  if (url.startsWith('/plugin-capture/') || url.startsWith('/material-editor/')) {
    return `/api/material-file${url}`;
  }
  return url;
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: '请先登录网站后再使用浏览器插件采集' },
        { status: 401 }
      );
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '当前登录用户不存在' },
        { status: 404 }
      );
    }

    const body = await request.json() as CaptureImageRequest;
    const { imageUrl, pageUrl = '', pageTitle = '', sourceHost = '', capturedAt } = body;
    const imageType = isAllowedImageType(body.imageType) ? body.imageType : 'main';

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少图片地址' },
        { status: 400 }
      );
    }

    try {
      new URL(imageUrl);
    } catch {
      return NextResponse.json(
        { success: false, error: '图片地址无效' },
        { status: 400 }
      );
    }

    const downloadedImage = await downloadImageBuffer(imageUrl, pageUrl);
    const { buffer: imageBuffer, contentType, extension } = downloadedImage;
    const fileName = `plugin-capture/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}-${imageType}.${extension}`;
    let uploadedUrl = ''

    try {
      uploadedUrl = await uploadToCozeStorage(imageBuffer, fileName, contentType)
    } catch (error) {
      console.warn('[插件采集] 对象存储上传失败，回退到本地 public 存储:', error)
      const localFileName = `plugin-capture/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}-${imageType}.${extension}`
      uploadedUrl = normalizeLocalMaterialUrl(await saveBufferToLocalMaterialFile(imageBuffer, localFileName))
    }

    console.log('[插件采集] 采集成功:', {
      userId,
      sourceHost,
      imageType,
      pageUrl,
      pageTitle,
      capturedAt,
      uploadedUrl: uploadedUrl.substring(0, 80),
    });

    const record = await capturedImageManager.createCapturedImage({
      userId,
      imageUrl: uploadedUrl,
      originalUrl: imageUrl,
      pageUrl,
      pageTitle,
      sourceHost,
      imageType,
    })

    return NextResponse.json({
      success: true,
      message: '图片已采集到当前账号',
      data: {
        id: record.id,
        userId,
        uploadedUrl,
        originalUrl: imageUrl,
        pageUrl,
        pageTitle,
        sourceHost,
        imageType,
        capturedAt: capturedAt || Date.now(),
      },
    });
  } catch (error) {
    console.error('[插件采集] 失败:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
