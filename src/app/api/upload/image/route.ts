import { NextRequest, NextResponse } from 'next/server';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '图片上传失败';
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

console.log('[图片上传] 使用Coze对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageData, folder = 'color-extraction' } = body;

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

    // 生成文件名
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = mimeType.split('/')[1] || 'jpg';
    const fileName = `${folder}/${timestamp}_${random}.${extension}`;

    // 使用Coze对象存储上传（1年有效期）
    try {
      console.log('[图片上传] 开始上传到Coze对象存储:', fileName);
      const S3Storage = (await import('coze-coding-dev-sdk')).S3Storage;
      const cozeStorage = new S3Storage({
        endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
        accessKey: process.env.COZE_ACCESS_KEY,
        secretKey: process.env.COZE_SECRET_KEY,
        bucketName: process.env.COZE_BUCKET_NAME,
        region: 'cn-beijing',
      });

      const key = await cozeStorage.uploadFile({
        fileContent: buffer,
        fileName: fileName,
        contentType: mimeType,
      });

      console.log('[图片上传] Coze对象存储上传成功，key:', key);

      // 生成1年有效期的签名URL
      const signedUrl = await cozeStorage.generatePresignedUrl({
        key: key,
        expireTime: 365 * 24 * 60 * 60, // 1年
      });

      console.log('[图片上传] Coze签名URL生成成功（1年有效期）:', signedUrl.substring(0, 80) + '...');

      return NextResponse.json({
        success: true,
        data: {
          key: key,
          url: signedUrl,
        },
      });
    } catch (cozeError) {
      console.error('[图片上传] Coze对象存储上传失败:', cozeError);
      return NextResponse.json(
        {
          success: false,
          message: '图片上传失败：Coze对象存储不可用',
        },
        { status: 500 }
      );
    }

  } catch (error: unknown) {
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
