import { NextRequest, NextResponse } from 'next/server';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { normalizeFileExtension, normalizeFolder } from '@/lib/localUploadStorage';
import { isImageValidationError, validateUploadedImageBuffer } from '@/lib/serverImageValidation';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '图片上传失败';
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

console.log('[图片上传] 使用腾讯COS对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageData, folder = 'color-extraction' } = body;
    const normalizedFolder = normalizeFolder(folder);

    // 参数验证
    if (!imageData) {
      return NextResponse.json(
        { success: false, message: '缺少图片数据' },
        { status: 400 }
      );
    }

    // 解析 base64 数据
    const matches = imageData.match(/^data:(.+?);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { success: false, message: '图片格式不正确' },
        { status: 400 }
      );
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    const imageInfo = await validateUploadedImageBuffer(buffer, { declaredContentType: mimeType });

    // 生成文件名
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = normalizeFileExtension(imageInfo.extension);
    const fileName = `${normalizedFolder}/${timestamp}_${random}.${extension}`;

    console.log('[图片上传] 开始上传到腾讯COS:', fileName);
    const storageUrl = await uploadToCozeStorage(buffer, fileName, imageInfo.contentType);
    console.log('[图片上传] 腾讯COS上传成功:', storageUrl.substring(0, 80) + '...');

    return NextResponse.json({
      success: true,
      data: {
        key: fileName,
        url: storageUrl,
      },
    });

  } catch (error: unknown) {
    if (isImageValidationError(error)) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 }
      );
    }

    console.error('[图片上传] 失败:', error);
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
