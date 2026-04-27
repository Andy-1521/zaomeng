/**
 * 对象存储上传工具
 * 只上传到Coze对象存储
 */

import { S3Storage } from 'coze-coding-dev-sdk';
import { compressImageFromUrl } from './imageCompression';

// 初始化Coze S3存储
const cozeStorage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: process.env.COZE_ACCESS_KEY,
  secretKey: process.env.COZE_SECRET_KEY,
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

/**
 * 存储上传结果
 */
export interface DualStorageResult {
  cozeUrl: string; // Coze存储的URL
}

/**
 * 从Buffer上传到对象存储
 * @param buffer - 文件内容Buffer
 * @param fileName - 文件名（包含路径）
 * @param contentType - 内容类型
 * @returns 存储URL
 */
export async function uploadToCozeStorage(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  console.log(`[对象存储] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

  // 上传到Coze对象存储
  const cozeKey = await cozeStorage.uploadFile({
    fileContent: buffer,
    fileName: fileName,
    contentType: contentType,
  });

  const cozeUrl = await cozeStorage.generatePresignedUrl({
    key: cozeKey,
    expireTime: 365 * 24 * 60 * 60, // 1年
  });

  console.log(`[对象存储] 上传成功: ${cozeUrl.substring(0, 80)}...`);

  return cozeUrl;
}

/**
 * 从URL上传到对象存储
 * @param url - 远程URL
 * @param fileName - 文件名（包含路径）
 * @param contentType - 内容类型（可选）
 * @returns 存储URL
 */
export async function uploadFromUrlToCozeStorage(
  url: string,
  fileName: string,
  contentType?: string
): Promise<string> {
  console.log(`[对象存储] 开始从URL上传: ${url.substring(0, 80)}...`);

  // 判断是否需要压缩（仅对图片进行压缩）
  const isImage = contentType?.startsWith('image/') ||
                   fileName.match(/\.(jpg|jpeg|png|webp)$/i);

  let imageBuffer: Buffer | null = null;

  if (isImage) {
    console.log(`[对象存储] 检测到图片，开始压缩`);
    try {
      // 下载并压缩图片（最大5MB）
      imageBuffer = await compressImageFromUrl(url, {
        maxWidthSize: 5 * 1024 * 1024, // 5MB
        initialQuality: 95,
        minQuality: 70,
      });
      console.log(`[对象存储] 图片压缩完成，大小: ${imageBuffer.length} bytes`);
    } catch (compressError) {
      console.warn('[对象存储] 图片压缩失败，将使用原始图片:', compressError);
      // 压缩失败不影响主流程，继续使用原始URL
    }
  }

  // 如果压缩成功，使用压缩后的Buffer上传
  if (imageBuffer && imageBuffer.length > 0) {
    console.log(`[对象存储] 使用压缩后的图片上传`);

    // 上传到Coze对象存储
    const cozeKey = await cozeStorage.uploadFile({
      fileContent: imageBuffer,
      fileName: fileName,
      contentType: contentType || 'image/jpeg',
    });

    const cozeUrl = await cozeStorage.generatePresignedUrl({
      key: cozeKey,
      expireTime: 365 * 24 * 60 * 60, // 1年
    });

    console.log(`[对象存储] 上传成功: ${cozeUrl.substring(0, 80)}...`);

    return cozeUrl;
  } else {
    // 压缩失败或不是图片，使用原始URL上传
    console.log(`[对象存储] 使用原始URL上传（未压缩）`);

    // 上传到Coze对象存储
    const cozeKey = await cozeStorage.uploadFromUrl({
      url: url,
      timeout: 60000, // 60秒超时
    });

    const cozeUrl = await cozeStorage.generatePresignedUrl({
      key: cozeKey,
      expireTime: 365 * 24 * 60 * 60, // 1年
    });

    console.log(`[对象存储] 上传成功: ${cozeUrl.substring(0, 80)}...`);

    return cozeUrl;
  }
}
