/**
 * 对象存储上传工具
 * 只上传到阿里云 OSS；上传失败直接抛错。
 */

import { compressImageFromUrl } from './imageCompression';
import {
  getAliyunOSSUrl,
  uploadFromUrlToAliyunOSS,
  uploadToAliyunOSS,
} from './aliyunOSS';

/**
 * 存储上传结果
 */
export interface DualStorageResult {
  storageUrl: string; // 统一返回最终可访问URL
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
  console.log(`[对象存储] 开始上传到阿里云OSS: ${fileName}, 大小: ${buffer.length} bytes`);
  const ossKey = await uploadToAliyunOSS(buffer, fileName, contentType);
  const ossUrl = await getAliyunOSSUrl(ossKey);
  console.log(`[对象存储] 阿里云OSS上传成功: ${ossUrl.substring(0, 80)}...`);
  return ossUrl;
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
  console.log(`[对象存储] 开始从URL上传到阿里云OSS: ${url.substring(0, 80)}...`);

  // 判断是否需要压缩（仅对图片进行压缩）
  const isImage = contentType?.startsWith('image/') ||
                   fileName.match(/\.(jpg|jpeg|png|webp|avif)$/i);

  let imageBuffer: Buffer | null = null;

  if (isImage) {
    console.log(`[对象存储] 检测到图片，开始压缩`);
    // 下载并压缩图片（最大5MB）
    imageBuffer = await compressImageFromUrl(url, {
      maxWidthSize: 5 * 1024 * 1024, // 5MB
      initialQuality: 95,
      minQuality: 70,
    });
    console.log(`[对象存储] 图片压缩完成，大小: ${imageBuffer.length} bytes`);
  }

  // 如果压缩成功，使用压缩后的Buffer上传
  if (imageBuffer && imageBuffer.length > 0) {
    console.log(`[对象存储] 使用压缩后的图片上传`);
    return uploadToCozeStorage(imageBuffer, fileName, contentType || 'image/jpeg');
  } else {
    console.log(`[对象存储] 使用原始URL上传到阿里云OSS`);
    const ossKey = await uploadFromUrlToAliyunOSS(url, fileName, contentType);
    const ossUrl = await getAliyunOSSUrl(ossKey);
    console.log(`[对象存储] 阿里云OSS上传成功: ${ossUrl.substring(0, 80)}...`);
    return ossUrl;
  }
}
