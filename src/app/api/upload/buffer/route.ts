import { NextRequest, NextResponse } from 'next/server';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { normalizeFileExtension, normalizeFolder } from '@/lib/localUploadStorage';
import { isImageValidationError, validateUploadedImageBuffer } from '@/lib/serverImageValidation';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '文件上传失败';
}

console.log('[Buffer上传] 使用阿里云OSS对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    // 解析FormData
    const formData = await request.formData();
    const bufferData = formData.get('buffer') as string; // Base64编码的Buffer
    const fileName = (formData.get('fileName') as string) || 'result.png';
    const contentType = (formData.get('contentType') as string) || 'image/png';
    const folder = normalizeFolder((formData.get('folder') as string) || 'ai-generate');

    // 参数验证
    if (!bufferData) {
      return NextResponse.json(
        { success: false, message: '缺少buffer数据' },
        { status: 400 }
      );
    }

    // 将Base64字符串转换为Buffer
    const buffer = Buffer.from(bufferData, 'base64');
    const imageInfo = await validateUploadedImageBuffer(buffer, { declaredContentType: contentType });

    console.log(`[Buffer上传] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

    // 生成文件路径
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = normalizeFileExtension(imageInfo.extension);
    const filePath = `${folder}/${userId}/${timestamp}_${random}.${extension}`;

    console.log('[Buffer上传] 开始上传到阿里云OSS:', filePath);
    const storageUrl = await uploadToCozeStorage(buffer, filePath, imageInfo.contentType);
    console.log('[Buffer上传] 阿里云OSS上传成功:', storageUrl.substring(0, 80) + '...');

    return NextResponse.json({
      success: true,
      data: {
        key: filePath,
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

    console.error('[Buffer上传] 失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
