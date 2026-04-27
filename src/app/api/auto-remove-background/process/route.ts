import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { uploadToCozeStorage } from '@/lib/dualStorage';

const MAX_FETCH_RETRIES = 3; // 最大重试次数
const RETRY_DELAY_BASE = 3000; // 基础重试延迟（秒）

type CozeGenerateResponse = {
  status?: number;
  statusText?: string;
  [key: string]: unknown;
};

type CozeResponseHelper = {
  success: boolean;
  errorMessages: string[];
  imageUrls: string[];
};

type CozeImageClient = {
  generate(params: {
    prompt: string;
    image: string;
    size: string;
    watermark: boolean;
    responseFormat: string;
  }): Promise<CozeGenerateResponse>;
  getResponseHelper(response: CozeGenerateResponse): CozeResponseHelper;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '智能抠图失败，请重试';
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

// 延迟加载和缓存 Coze SDK 客户端
let imageClient: CozeImageClient | null = null;

async function getImageClient() {
  if (!imageClient) {
    const { ImageGenerationClient, Config } = await import('coze-coding-dev-sdk');
    const config = new Config();
    imageClient = new ImageGenerationClient(config);
  }
  return imageClient;
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  console.log('[智能抠图] ========== 开始处理请求 ==========');

  try {
    // 解析请求参数
    const requestBody = await request.json();
    const { imageUrl } = requestBody;

    console.log('[智能抠图] 接收到请求参数:', {
      hasImageUrl: !!imageUrl,
      imageUrlPreview: imageUrl ? imageUrl.substring(0, 80) : 'none',
      requestTime: new Date().toISOString(),
    });

    // 参数验证
    if (!imageUrl) {
      console.error('[智能抠图] 参数验证失败: 缺少imageUrl');
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证imageUrl是否为有效的HTTP URL
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return NextResponse.json(
        { success: false, message: '图片URL格式不正确，必须为HTTP/HTTPS地址' },
        { status: 400 }
      );
    }

    console.log('[智能抠图] 开始调用 Coze 生图大模型 API（智能抠图）...');

    let response: CozeGenerateResponse | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
      try {
        console.log(`[智能抠图] 第${attempt}次尝试调用API...`);
        console.log('[智能抠图] 请求参数:', {
          prompt: 'remove background completely, keep main subject with transparent PNG format',
          image: imageUrl,
          size: '2K',
        });

        // 使用 Coze 生图大模型的图生图功能实现智能抠图
        const client = await getImageClient();
        response = await client.generate({
          prompt: 'Professional background removal: completely remove all background, keep only the main subject with clean edges, output as transparent PNG format with exact original dimensions, maintain high quality and original aspect ratio. Ensure the subject is perfectly isolated with no background artifacts.',
          image: imageUrl, // 参考图片URL
          size: '2K', // 高分辨率
          watermark: false, // 不添加水印
          responseFormat: 'url', // 返回URL格式
        });

        console.log(`[智能抠图] 第${attempt}次调用成功`);
        break;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error));
        console.error(`[智能抠图] 第${attempt}次调用失败:`, getErrorMessage(error));
        console.error(`[智能抠图] 错误详情:`, error);

        if (attempt === MAX_FETCH_RETRIES) {
          console.error('[智能抠图] 所有重试均失败');
          break;
        }

        // 指数退避重试
        const waitTime = RETRY_DELAY_BASE * attempt;
        console.log(`[智能抠图] ${waitTime / 1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // 检查是否成功获取响应
    if (!response) {
      const errorMsg = `API请求超时或失败，已重试${MAX_FETCH_RETRIES}次: ${lastError?.message || '未知错误'}`;
      console.error('[智能抠图]', errorMsg);
      throw new Error(errorMsg);
    }

    console.log('[智能抠图] API 响应状态:', response.status, response.statusText);

    // 使用 ResponseHelper 处理响应
    const helper = (await getImageClient()).getResponseHelper(response);
    console.log('[智能抠图] API 响应数据:', JSON.stringify(response, null, 2));

    if (!helper.success) {
      console.error('[智能抠图] 生成失败:', helper.errorMessages);
      const errorMsg = helper.errorMessages.length > 0 ? helper.errorMessages[0] : '智能抠图失败';
      throw new Error(errorMsg);
    }

    if (helper.imageUrls.length === 0) {
      console.error('[智能抠图] 没有返回图片URL');
      throw new Error('没有返回处理后的图片');
    }

    const resultUrl = helper.imageUrls[0];
    console.log('[智能抠图] 提取成功的图片 URL:', resultUrl);

    // 下载并验证图片格式，确保是PNG
    try {
      console.log('[智能抠图] 下载并验证图片...');

      // 下载图片，添加超时保护
      const downloadController = new AbortController();
      const downloadTimeout = setTimeout(() => downloadController.abort(), 60000); // 60秒下载超时

      let downloadResponse: Response;
      try {
        downloadResponse = await fetch(resultUrl, {
          signal: downloadController.signal,
        });
        clearTimeout(downloadTimeout);
       } catch (downloadError: unknown) {
         clearTimeout(downloadTimeout);
         console.error('[智能抠图] 下载图片超时:', downloadError);
         throw new Error('下载图片超时，请重试');
      }

      if (!downloadResponse.ok) {
        throw new Error(`下载图片失败 (${downloadResponse.status})`);
      }

      // 检查图片格式
      const contentType = downloadResponse.headers.get('content-type');
      console.log('[智能抠图] 返回的图片类型:', contentType);

      if (!contentType?.includes('png') && !contentType?.includes('image')) {
        console.warn('[智能抠图] 警告：返回的不是PNG格式，尝试处理');
      }

      const buffer = await downloadResponse.arrayBuffer() as ArrayBuffer;
      const imageBuffer = Buffer.from(buffer);

      // 检查图片元数据
      const metadata = await sharp(imageBuffer).metadata();
      console.log('[智能抠图] 图片元数据:', {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        hasAlpha: metadata.hasAlpha,
        size: imageBuffer.length,
      });

      // 确保是PNG格式，包含透明通道
      let finalBuffer = imageBuffer;

      if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.channels !== 4) {
        console.warn('[智能抠图] 图片不是PNG RGBA格式，进行转换...');

        // 转换为PNG RGBA格式
        const tempBuffer = await sharp(imageBuffer)
          .ensureAlpha() // 添加alpha通道
          .png({
            palette: false,
            compressionLevel: 6,
            quality: 100
          })
          .toBuffer();

        // 创建新的 Buffer 以避免类型问题
        finalBuffer = Buffer.from(tempBuffer);

        const finalMetadata = await sharp(finalBuffer).metadata();
        console.log('[智能抠图] 转换后的图片元数据:', {
          format: finalMetadata.format,
          width: finalMetadata.width,
          height: finalMetadata.height,
          channels: finalMetadata.channels,
          hasAlpha: finalMetadata.hasAlpha,
          size: finalBuffer.length,
        });
      } else {
        console.log('[智能抠图] ✓ 图片格式正确，直接使用');
      }

      // 上传图片到双存储（Coze + 腾讯云COS）
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const processedFileName = `sjkch_png/auto_cut_${timestamp}_${random}.png`;

      const storageResult = await uploadToCozeStorage(
        finalBuffer,
        processedFileName,
        'image/png'
      );

      console.log('[智能抠图] 图片已上传:', {
        cozeUrl: storageResult.substring(0, 80) + '...',
      });

      const totalTime = Date.now() - requestStartTime;
      console.log(`[智能抠图] ========== 请求成功完成，总耗时: ${totalTime}ms ==========`);

      return NextResponse.json({
        success: true,
        data: {
          resultUrl: storageResult,
        },
      });

    } catch (processError: unknown) {
      console.error('[智能抠图] 图片处理失败:', processError);
      console.error('[智能抠图] 错误堆栈:', getErrorStack(processError));

      // 如果处理失败，尝试返回原始URL（可能不透明）
      console.warn('[智能抠图] 处理失败，返回原始URL（可能不透明）');
      const totalTime = Date.now() - requestStartTime;
      console.log(`[智能抠图] ========== 请求完成（警告），总耗时: ${totalTime}ms ==========`);

      return NextResponse.json({
        success: true,
        data: {
          resultUrl: resultUrl,
          warning: '图片处理失败，返回未处理的图片',
        },
      });
    }

  } catch (error: unknown) {
    const totalTime = Date.now() - requestStartTime;
    console.error('[智能抠图] 处理失败:', error);
    console.error(`[智能抠图] ========== 请求失败，总耗时: ${totalTime}ms ==========`);

    const errorMessage = getErrorMessage(error);

    return NextResponse.json(
      {
        success: false,
        message: errorMessage,
        debug: {
          error: errorMessage,
          stack: getErrorStack(error),
        },
      },
      { status: 500 }
    );
  }
}
