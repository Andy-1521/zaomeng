import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { capturedImageManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { normalizeFileExtension } from '@/lib/localUploadStorage';

type CaptureImageRequest = {
  imageUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
  captureMethod?: string;
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

async function downloadImageBuffer(imageUrl: string, pageUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: pageUrl || imageUrl,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`无法下载图片资源 (${response.status})`);
  }

  const responseContentType = response.headers.get('content-type') || '';
  if (!responseContentType.toLowerCase().startsWith('image/')) {
    throw new Error(`当前资源不是图片，无法保存 (${responseContentType || 'unknown'})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const fallbackExtension = getImageExtension(imageUrl);
  const extension = getExtensionFromContentType(responseContentType, fallbackExtension);
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: getContentType(extension),
    extension,
  };
}

function normalizeLocalMaterialUrl(url: string) {
  if (url.startsWith('/plugin-capture/') || url.startsWith('/material-editor/')) {
    return `/api/material-file${url}`;
  }
  return url;
}

async function saveToLocalPublic(buffer: Buffer, fileName: string) {
  const filePath = path.join('/home/ubuntu/Downloads/zaomeng/project/projects/public', fileName)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, buffer)
  return `/${fileName.replace(/\\/g, '/')}`
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
    const { imageUrl, pageUrl = '', pageTitle = '', sourceHost = '', capturedAt, imageType = 'main' } = body;

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
      const localPath = await saveToLocalPublic(imageBuffer, localFileName)
      uploadedUrl = normalizeLocalMaterialUrl(localPath)
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
