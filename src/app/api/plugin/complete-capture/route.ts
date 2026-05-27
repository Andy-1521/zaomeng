import { NextRequest, NextResponse } from 'next/server';
import { assertAliyunOSSObjectExistsBestEffort, getAliyunOSSUrl } from '@/lib/aliyunOSS';
import { withStorageKeyLock } from '@/lib/storageKeyLock';
import { capturedImageManager, userManager } from '@/storage/database';

type CompleteCaptureRequest = {
  key?: string;
  originalUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceHost?: string;
  capturedAt?: number;
  imageType?: 'main' | 'detail';
  captureMethod?: string;
};

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return null;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch {
    return null;
  }
}

function isAllowedImageType(value: unknown): value is NonNullable<CompleteCaptureRequest['imageType']> {
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

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: '请先登录网站后再使用浏览器插件采集' }, { status: 401 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: '当前登录用户不存在' }, { status: 404 });
    }

    const body = await request.json() as CompleteCaptureRequest;
    const key = (body.key || '').trim();
    const expectedPrefix = `plugin-capture/${userId}/`;

    if (!key || !key.startsWith(expectedPrefix) || key.includes('..')) {
      return NextResponse.json({ success: false, error: '上传对象无效' }, { status: 400 });
    }

    const result = await withStorageKeyLock('plugin-capture', userId, key, async () => {
      const existingRecord = await capturedImageManager.getUserCapturedImageByStorageKey(userId, key);
      if (existingRecord) {
        const material = toMaterialResponse(existingRecord);
        return {
          id: existingRecord.id,
          userId,
          uploadedUrl: material.imageUrl,
          imageUrl: material.imageUrl,
          originalUrl: material.originalUrl || body.originalUrl || '',
          pageUrl: material.pageUrl || body.pageUrl || '',
          pageTitle: material.pageTitle || body.pageTitle || '',
          sourceHost: material.sourceHost || body.sourceHost || '',
          imageType: material.imageType || 'main',
          folderId: material.folderId,
          isFavorite: material.isFavorite,
          createdAt: material.createdAt,
          capturedAt: body.capturedAt || Date.now(),
          material,
        };
      }

      await assertAliyunOSSObjectExistsBestEffort(key);
      const uploadedUrl = await getAliyunOSSUrl(key);
      const imageType = isAllowedImageType(body.imageType) ? body.imageType : 'main';
      const record = await capturedImageManager.createCapturedImage({
        userId,
        imageUrl: uploadedUrl,
        originalUrl: body.originalUrl || null,
        pageUrl: body.pageUrl || '',
        pageTitle: body.pageTitle || '',
        sourceHost: body.sourceHost || '',
        imageType,
      });
      const material = toMaterialResponse(record);

      return {
        id: record.id,
        userId,
        uploadedUrl: material.imageUrl,
        imageUrl: material.imageUrl,
        originalUrl: body.originalUrl || '',
        pageUrl: body.pageUrl || '',
        pageTitle: body.pageTitle || '',
        sourceHost: body.sourceHost || '',
        imageType,
        folderId: material.folderId,
        isFavorite: material.isFavorite,
        createdAt: material.createdAt,
        capturedAt: body.capturedAt || Date.now(),
        material,
      };
    });

    return NextResponse.json({
      success: true,
      message: '图片已采集到当前账号',
      data: result,
    });
  } catch (error) {
    console.error('[插件直传] 完成采集入库失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '采集图片失败' },
      { status: 500 }
    );
  }
}
