import { NextRequest, NextResponse } from 'next/server';
import { capturedImageManager, materialFolderManager } from '@/storage/database';
import { normalizeFileExtension, normalizeFolder, saveBufferToLocalMaterialFile } from '@/lib/localUploadStorage';

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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '文件上传失败';
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

// Coze对象存储配置
const bucketName = process.env.COZE_BUCKET_NAME || '';
const endpointUrl = process.env.COZE_BUCKET_ENDPOINT_URL || '';

console.log('[文件上传] 使用Coze对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    // 解析FormData
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = normalizeFolder((formData.get('folder') as string) || 'uploads');
    const createMaterial = formData.get('createMaterial') === 'true';
    const materialFolderId = formData.get('materialFolderId') as string | null;

    // 参数验证
    if (!file) {
      return NextResponse.json(
        { success: false, message: '缺少文件' },
        { status: 400 }
      );
    }

    console.log(`[文件上传] 开始上传: ${file.name}, 大小: ${file.size} bytes`);

    // 生成文件名
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = normalizeFileExtension(file.name.split('.').pop() || 'jpg');
    const fileName = `${folder}/${timestamp}_${random}.${extension}`;

    // 读取文件Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // 使用Coze对象存储上传（1年有效期）
    try {
      console.log('[文件上传] 开始上传到Coze对象存储:', fileName);
      const S3Storage = (await import('coze-coding-dev-sdk')).S3Storage;
      const cozeStorage = new S3Storage({
        endpointUrl: endpointUrl,
        accessKey: process.env.COZE_ACCESS_KEY || '',
        secretKey: process.env.COZE_SECRET_KEY || '',
        bucketName: bucketName,
        region: 'cn-beijing',
      });

      const key = await cozeStorage.uploadFile({
        fileContent: buffer,
        fileName: fileName,
        contentType: file.type || 'image/jpeg',
      });

      console.log('[文件上传] Coze对象存储上传成功，key:', key);

      // 生成1年有效期的签名URL
      const signedUrl = await cozeStorage.generatePresignedUrl({
        key: key,
        expireTime: 365 * 24 * 60 * 60, // 1年
      });

      console.log('[文件上传] Coze签名URL生成成功（1年有效期）:', signedUrl.substring(0, 80) + '...');

      let materialRecord = null;
      if (createMaterial) {
        const userId = getCookieUserId(request);
        let targetFolderId: string | null = null;
        if (userId && materialFolderId) {
          const targetFolder = await materialFolderManager.getFolderById(materialFolderId, userId);
          targetFolderId = targetFolder ? targetFolder.id : null;
        }
        if (userId) {
          materialRecord = await capturedImageManager.createCapturedImage({
            userId,
            imageUrl: signedUrl,
            originalUrl: null,
            pageUrl: null,
            pageTitle: file.name,
            sourceHost: 'local-upload',
            imageType: 'main',
            folderId: targetFolderId,
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          key: key,
          url: signedUrl,
          material: materialRecord,
        },
      });
    } catch (cozeError) {
      console.warn('[文件上传] Coze对象存储上传失败，回退到本地 public 存储:', cozeError);
      const localUrl = await saveBufferToLocalMaterialFile(buffer, fileName);

      if (createMaterial) {
        const userId = getCookieUserId(request);
        let targetFolderId: string | null = null;
        if (userId && materialFolderId) {
          const targetFolder = await materialFolderManager.getFolderById(materialFolderId, userId);
          targetFolderId = targetFolder ? targetFolder.id : null;
        }
        if (userId) {
          await capturedImageManager.createCapturedImage({
            userId,
            imageUrl: localUrl,
            originalUrl: null,
            pageUrl: null,
            pageTitle: file.name,
            sourceHost: 'local-upload',
            imageType: 'main',
            folderId: targetFolderId,
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          key: fileName,
          url: localUrl,
          storage: 'local',
        },
      });
    }

  } catch (error: unknown) {
    console.error('[文件上传] 失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: getErrorMessage(error),
        debug: {
          error: getErrorMessage(error),
          stack: getErrorStack(error),
        },
      },
      { status: 500 }
    );
  }
}
