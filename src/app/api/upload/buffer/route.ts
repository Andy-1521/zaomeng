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

console.log('[Buffer上传] 使用Coze对象存储（1年有效期）');

export async function POST(request: NextRequest) {
  try {
    // 解析FormData
    const formData = await request.formData();
    const bufferData = formData.get('buffer') as string; // Base64编码的Buffer
    const fileName = (formData.get('fileName') as string) || 'result.png';
    const contentType = (formData.get('contentType') as string) || 'image/png';
    const folder = (formData.get('folder') as string) || 'grsai';

    // 参数验证
    if (!bufferData) {
      return NextResponse.json(
        { success: false, message: '缺少buffer数据' },
        { status: 400 }
      );
    }

    // 将Base64字符串转换为Buffer
    const buffer = Buffer.from(bufferData, 'base64');

    console.log(`[Buffer上传] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

    // 生成文件路径
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const extension = fileName.split('.').pop() || 'png';
    const filePath = `${folder}/${timestamp}_${random}.${extension}`;

    // 使用Coze对象存储上传（1年有效期）
    try {
      console.log('[Buffer上传] 开始上传到Coze对象存储:', filePath);
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
        fileName: filePath,
        contentType: contentType,
      });

      console.log('[Buffer上传] Coze对象存储上传成功，key:', key);

      // 生成1年有效期的签名URL
      const signedUrl = await cozeStorage.generatePresignedUrl({
        key: key,
        expireTime: 365 * 24 * 60 * 60, // 1年
      });

      console.log('[Buffer上传] Coze签名URL生成成功（1年有效期）:', signedUrl.substring(0, 80) + '...');

      return NextResponse.json({
        success: true,
        data: {
          key: key,
          url: signedUrl,
        },
      });
    } catch (cozeError) {
      console.error('[Buffer上传] Coze对象存储上传失败:', cozeError);
      return NextResponse.json(
        {
          success: false,
          message: '文件上传失败：Coze对象存储不可用',
        },
        { status: 500 }
      );
    }

  } catch (error: unknown) {
    console.error('[Buffer上传] 失败:', error);
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
