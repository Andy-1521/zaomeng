import { NextRequest, NextResponse } from 'next/server';
import { getCookieUserId } from '@/lib/serverAuth';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { capturedImageManager, materialFolderManager } from '@/storage/database';
import { normalizeFileExtension, normalizeFolder } from '@/lib/localUploadStorage';
import { isImageValidationError, validateUploadedImageBuffer } from '@/lib/serverImageValidation';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '文件上传失败';
}

function getUploadErrorMessage(error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes('UserDisable')) {
    return '对象存储账号或Bucket当前不可用，请联系管理员检查阿里云OSS状态';
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return '对象存储响应超时，请稍后重试';
  }

  return message;
}

console.log('[文件上传] 使用阿里云OSS对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    // 解析FormData
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = normalizeFolder((formData.get('folder') as string) || 'uploads');
    const createMaterial = formData.get('createMaterial') === 'true';
    const materialFolderId = formData.get('materialFolderId') as string | null;
    const originalFileName = (formData.get('originalFileName') as string | null)?.trim();

    // 参数验证
    if (!file) {
      return NextResponse.json(
        { success: false, message: '缺少文件' },
        { status: 400 }
      );
    }

    console.log(`[文件上传] 开始上传: ${file.name}, 大小: ${file.size} bytes`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageInfo = await validateUploadedImageBuffer(buffer, { declaredContentType: file.type });

    // 生成文件名
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = normalizeFileExtension(imageInfo.extension);
    const fileName = `${folder}/${userId}/${timestamp}_${random}.${extension}`;

    console.log('[文件上传] 开始上传到阿里云OSS:', fileName);
    const storageUrl = await uploadToCozeStorage(buffer, fileName, imageInfo.contentType);
    console.log('[文件上传] 阿里云OSS上传成功:', storageUrl.substring(0, 80) + '...');

    let materialRecord = null;
    if (createMaterial) {
      let targetFolderId: string | null = null;
      if (materialFolderId) {
        const targetFolder = await materialFolderManager.getFolderById(materialFolderId, userId);
        targetFolderId = targetFolder ? targetFolder.id : null;
      }
      materialRecord = await capturedImageManager.createCapturedImage({
        userId,
        imageUrl: storageUrl,
        originalUrl: null,
        pageUrl: null,
        pageTitle: originalFileName || file.name,
        sourceHost: 'local-upload',
        imageType: 'main',
        folderId: targetFolderId,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        key: fileName,
        url: storageUrl,
        material: materialRecord,
      },
    });

  } catch (error: unknown) {
    if (isImageValidationError(error)) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 }
      );
    }

    console.error('[文件上传] 失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: getUploadErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
