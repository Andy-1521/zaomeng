import { NextRequest, NextResponse } from 'next/server';
import { capturedImageManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_PLUGIN_CAPTURE_BYTES = 30 * 1024 * 1024;

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

function isAllowedImageType(value: unknown): value is NonNullable<CaptureImageRequest['imageType']> {
  return value === 'main' || value === 'detail';
}

function toMaterialResponse(record: Awaited<ReturnType<typeof capturedImageManager.createCapturedImage>>) {
  return {
    id: record.id,
    imageUrl: record.imageUrl,
    originalUrl: record.originalUrl,
    pageUrl: record.pageUrl,
    pageTitle: record.pageTitle,
    sourceHost: record.sourceHost,
    imageType: record.imageType,
    folderId: record.folderId,
    isFavorite: record.isFavorite,
    createdAt: record.createdAt,
  };
}

async function downloadImageBuffer(imageUrl: string, pageUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  return downloadSafeRemoteImage(imageUrl, {
    refererUrl: pageUrl || imageUrl,
    timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS,
    maxBytes: MAX_PLUGIN_CAPTURE_BYTES,
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  });
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
    const uploadedUrl = await uploadToCozeStorage(imageBuffer, fileName, contentType)

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
    const material = toMaterialResponse(record);

    return NextResponse.json({
      success: true,
      message: '图片已采集到当前账号',
      data: {
        id: record.id,
        userId,
        uploadedUrl: material.imageUrl,
        imageUrl: material.imageUrl,
        originalUrl: imageUrl,
        pageUrl,
        pageTitle,
        sourceHost,
        imageType,
        folderId: material.folderId,
        isFavorite: material.isFavorite,
        createdAt: material.createdAt,
        capturedAt: capturedAt || Date.now(),
        material,
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
