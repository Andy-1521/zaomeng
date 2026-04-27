import { NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import sharp from 'sharp';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * POST /api/image/thumbnail
 * 生成图片缩略图并上传到对象存储
 *
 * 请求体：
 * - imageUrl: 原图URL
 * - width: 缩略图宽度（可选，默认200）
 * - height: 缩略图高度（可选，默认200）
 * - quality: 图片质量（可选，默认80）
 *
 * 返回：
 * - thumbnailUrl: 缩略图URL
 * - thumbnailKey: 缩略图对象Key
 */

// 初始化对象存储
const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// 带超时的fetch
async function fetchWithTimeout(url: string, timeout = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imageUrl, width = 200, height = 200, quality = 80 } = body;

    if (!imageUrl) {
      return NextResponse.json(
        {
          success: false,
          message: '缺少 imageUrl 参数',
        },
        { status: 400 }
      );
    }

    console.log('[缩略图API] 请求参数:', {
      imageUrl: imageUrl.substring(0, 80) + '...',
      width,
      height,
      quality,
    });

    // 从URL下载原图
    console.log('[缩略图API] 开始下载原图...');
    let imageBuffer: Buffer;
    try {
      const response = await fetchWithTimeout(imageUrl, 30000);
      if (!response.ok) {
        throw new Error(`下载原图失败: ${response.status} ${response.statusText}`);
      }
      imageBuffer = Buffer.from(await response.arrayBuffer());
      console.log('[缩略图API] 原图下载成功，大小:', imageBuffer.length, 'bytes');
    } catch (error: unknown) {
      console.error('[缩略图API] 下载原图失败:', error);
      return NextResponse.json(
        {
          success: false,
          message: '下载原图失败',
          error: getErrorMessage(error),
        },
        { status: 500 }
      );
    }

    // 生成缩略图
    console.log('[缩略图API] 开始生成缩略图...');
    let thumbnailBuffer: Buffer;
    try {
      thumbnailBuffer = await sharp(imageBuffer)
        .resize(width, height, {
          fit: 'cover', // 保持比例填充
          position: 'center',
        })
        .jpeg({ quality }) // 转换为JPEG格式
        .toBuffer();
      console.log('[缩略图API] 缩略图生成成功，大小:', thumbnailBuffer.length, 'bytes');
    } catch (error: unknown) {
      console.error('[缩略图API] 生成缩略图失败:', error);
      return NextResponse.json(
        {
          success: false,
          message: '生成缩略图失败',
          error: getErrorMessage(error),
        },
        { status: 500 }
      );
    }

    // 上传缩略图到对象存储
    console.log('[缩略图API] 开始上传缩略图...');
    let thumbnailKey: string;
    try {
      // 生成缩略图文件名：thumbnail_{原文件名}
      const originalFileName = imageUrl.split('/').pop() || 'image.jpg';
      const thumbnailFileName = `thumbnails/thumbnail_${Date.now()}_${originalFileName}`;

      thumbnailKey = await storage.uploadFile({
        fileContent: thumbnailBuffer,
        fileName: thumbnailFileName,
        contentType: 'image/jpeg',
      });
      console.log('[缩略图API] 缩略图上传成功，key:', thumbnailKey);
    } catch (error: unknown) {
      console.error('[缩略图API] 上传缩略图失败:', error);
      return NextResponse.json(
        {
          success: false,
          message: '上传缩略图失败',
          error: getErrorMessage(error),
        },
        { status: 500 }
      );
    }

    // 生成缩略图签名URL
    console.log('[缩略图API] 生成签名URL...');
    let thumbnailUrl: string;
    try {
      thumbnailUrl = await storage.generatePresignedUrl({
        key: thumbnailKey,
        expireTime: 365 * 24 * 60 * 60, // 1年有效期
      });
      console.log('[缩略图API] 缩略图URL生成成功');
    } catch (error: unknown) {
      console.error('[缩略图API] 生成签名URL失败:', error);
      return NextResponse.json(
        {
          success: false,
          message: '生成缩略图URL失败',
          error: getErrorMessage(error),
        },
        { status: 500 }
      );
    }

    console.log('[缩略图API] ========== 缩略图生成成功 ==========');

    return NextResponse.json({
      success: true,
      data: {
        thumbnailUrl,
        thumbnailKey,
      },
    });
  } catch (error: unknown) {
    console.error('[缩略图API] ========== 缩略图生成失败 ==========');
    console.error('[缩略图API] 错误信息:', getErrorMessage(error));
    console.error('[缩略图API] 错误堆栈:', getErrorStack(error));

    return NextResponse.json(
      {
        success: false,
        message: '缩略图生成失败',
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
