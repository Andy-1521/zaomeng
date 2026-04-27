import { NextRequest, NextResponse } from 'next/server';

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
    const folder = (formData.get('folder') as string) || 'uploads';

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
    const extension = file.name.split('.').pop() || 'jpg';
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

      return NextResponse.json({
        success: true,
        data: {
          key: key,
          url: signedUrl,
        },
      });
    } catch (cozeError) {
      console.error('[文件上传] Coze对象存储上传失败:', cozeError);
      return NextResponse.json(
        {
          success: false,
          message: '文件上传失败：Coze对象存储不可用',
        },
        { status: 500 }
      );
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
