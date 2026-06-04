import { NextRequest, NextResponse } from 'next/server';
import { getCookieUserId } from '@/lib/serverAuth';
import { assertAliyunOSSObjectExistsBestEffort, getAliyunOSSUrl } from '@/lib/aliyunOSS';
import { withStorageKeyLock } from '@/lib/storageKeyLock';
import { capturedImageManager, materialFolderManager } from '@/storage/database';

type CompleteMaterialRequest = {
  key?: string;
  originalFileName?: string;
  materialFolderId?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json() as CompleteMaterialRequest;
    const key = (body.key || '').trim();
    const expectedPrefix = `uploads/${userId}/`;

    if (!key || !key.startsWith(expectedPrefix) || key.includes('..')) {
      return NextResponse.json({ success: false, message: '上传对象无效' }, { status: 400 });
    }

    const result = await withStorageKeyLock('material', userId, key, async () => {
      const existingRecord = await capturedImageManager.getUserCapturedImageByStorageKey(userId, key);
      if (existingRecord) {
        return {
          key,
          url: existingRecord.imageUrl,
          material: existingRecord,
        };
      }

      await assertAliyunOSSObjectExistsBestEffort(key);
      const storageUrl = await getAliyunOSSUrl(key);

      let targetFolderId: string | null = null;
      if (body.materialFolderId) {
        const targetFolder = await materialFolderManager.getFolderById(body.materialFolderId, userId);
        targetFolderId = targetFolder ? targetFolder.id : null;
      }

      const materialRecord = await capturedImageManager.createCapturedImage({
        userId,
        imageUrl: storageUrl,
        originalUrl: null,
        pageUrl: null,
        pageTitle: body.originalFileName?.trim() || key.split('/').pop() || 'uploaded-image',
        sourceHost: 'local-upload',
        imageType: 'main',
        folderId: targetFolderId,
      });

      return {
        key,
        url: storageUrl,
        material: materialRecord,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    console.error('[OSS直传] 完成素材入库失败:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '素材入库失败' },
      { status: 500 }
    );
  }
}
