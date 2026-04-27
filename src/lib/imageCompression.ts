/**
 * 图片压缩工具模块
 * 保持分辨率和尺寸不变，只压缩文件大小到5MB以下
 */

import sharp from 'sharp';

/**
 * 压缩选项
 */
export interface CompressionOptions {
  maxWidthSize?: number; // 最大文件大小（字节），默认5MB
  initialQuality?: number; // 初始质量，默认95
  minQuality?: number; // 最小质量，默认70
}

/**
 * 压缩图片Buffer
 * @param input - 输入图片Buffer
 * @param options - 压缩选项
 * @returns 压缩后的Buffer
 */
export async function compressImage(
  input: Buffer,
  options: CompressionOptions = {}
): Promise<Buffer> {
  const {
    maxWidthSize = 5 * 1024 * 1024, // 默认5MB
    initialQuality = 95,
    minQuality = 70,
  } = options;

  console.log(`[图片压缩] 开始压缩，原始大小: ${input.length} bytes (${(input.length / 1024 / 1024).toFixed(2)} MB)`);

  // 如果原始大小已经小于5MB，直接返回
  if (input.length <= maxWidthSize) {
    console.log(`[图片压缩] 原始大小已符合要求，无需压缩`);
    return input;
  }

  // 获取原始图片信息
  let imageInfo: sharp.Metadata;
  try {
    imageInfo = await sharp(input).metadata();
    console.log(`[图片压缩] 原始图片信息: ${imageInfo.width}x${imageInfo.height}, 格式: ${imageInfo.format}`);
  } catch (error) {
    console.error('[图片压缩] 无法读取图片元数据:', error);
    throw new Error('无法读取图片元数据');
  }

  // 如果是PNG格式，尝试转换为JPEG（PNG通常更大）
  // 但保持透明背景的需要特殊处理
  let outputFormat: 'jpeg' | 'png' = imageInfo.format === 'png' && imageInfo.hasAlpha ? 'png' : 'jpeg';

  console.log(`[图片压缩] 压缩格式: ${outputFormat}, 透明背景: ${imageInfo.hasAlpha}`);

  // 二分查找最佳质量
  let lowQuality = minQuality;
  let highQuality = initialQuality;
  let bestResult: Buffer | null = null;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts && lowQuality <= highQuality) {
    attempts++;
    const midQuality = Math.floor((lowQuality + highQuality) / 2);

    try {
      // 根据格式进行压缩
      let compressed: Buffer;

      if (outputFormat === 'jpeg') {
        compressed = await sharp(input, { failOnError: false })
          .jpeg({
            quality: midQuality,
            progressive: true,
            mozjpeg: true, // 使用mozjpeg编码器，效果更好
          })
          .toBuffer();
      } else {
        // PNG格式，使用自适应过滤和压缩级别
        compressed = await sharp(input, { failOnError: false })
          .png({
            quality: midQuality,
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: false,
          })
          .toBuffer();
      }

      console.log(`[图片压缩] 尝试 ${attempts}: 质量=${midQuality}, 大小=${compressed.length} bytes (${(compressed.length / 1024 / 1024).toFixed(2)} MB)`);

      if (compressed.length <= maxWidthSize) {
        bestResult = compressed;
        lowQuality = midQuality + 1; // 尝试更高质量
      } else {
        highQuality = midQuality - 1; // 降低质量
      }
    } catch (error) {
      console.error(`[图片压缩] 压缩失败 (质量=${midQuality}):`, error);
      highQuality = midQuality - 1;
    }
  }

  // 如果没有找到合适的压缩结果，使用最低质量
  if (!bestResult) {
    console.warn(`[图片压缩] 无法在保持质量 ${minQuality} 的情况下压缩到 ${maxWidthSize} bytes 以下，将使用最低质量`);
    bestResult = await sharp(input, { failOnError: false })
      .jpeg({ quality: minQuality, progressive: true, mozjpeg: true })
      .toBuffer();
  }

  console.log(`[图片压缩] 压缩完成: ${(input.length / 1024 / 1024).toFixed(2)} MB -> ${(bestResult.length / 1024 / 1024).toFixed(2)} MB (${((1 - bestResult.length / input.length) * 100).toFixed(1)}% 减少)`);

  return bestResult;
}

/**
 * 从URL下载并压缩图片
 * @param url - 图片URL
 * @param options - 压缩选项
 * @returns 压缩后的Buffer
 */
export async function compressImageFromUrl(
  url: string,
  options: CompressionOptions = {}
): Promise<Buffer> {
  console.log(`[图片压缩] 开始从URL下载并压缩: ${url.substring(0, 80)}...`);

  // 下载图片
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000), // 60秒超时
  });

  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(buffer);

  console.log(`[图片压缩] 下载完成，大小: ${imageBuffer.length} bytes (${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  // 压缩图片
  return compressImage(imageBuffer, options);
}
