/**
 * 腾讯云COS上传工具
 * 使用AWS SDK v3连接腾讯云COS
 *
 * 注意：腾讯云COS的bucket已设置为公共读，可以直接使用公共访问URL
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// 腾讯云COS配置
const region = process.env.COS_REGION || 'ap-guangzhou';
const bucketName = process.env.COS_BUCKET_NAME || '';

// 检查是否有有效的腾讯云COS配置
const HAS_TENCENT_COS_CONFIG = !!(
  process.env.COS_ACCESS_KEY &&
  process.env.COS_SECRET_KEY &&
  bucketName &&
  region
);

// 如果没有有效配置，自动禁用
let uploadClient: S3Client | null = null;
let signClient: S3Client | null = null;

if (HAS_TENCENT_COS_CONFIG) {
  // 上传专用客户端：使用虚拟域名格式
  uploadClient = new S3Client({
    region: region,
    endpoint: `https://cos.${region}.myqcloud.com`,
    credentials: {
      accessKeyId: process.env.COS_ACCESS_KEY!,
      secretAccessKey: process.env.COS_SECRET_KEY!,
    },
    forcePathStyle: false, // 强制使用虚拟域名格式（bucket名称会自动添加到endpoint前）
  });

  // 签名URL专用客户端：也使用虚拟域名格式
  signClient = new S3Client({
    region: region,
    endpoint: `https://cos.${region}.myqcloud.com`,
    credentials: {
      accessKeyId: process.env.COS_ACCESS_KEY!,
      secretAccessKey: process.env.COS_SECRET_KEY!,
    },
    forcePathStyle: false, // 腾讯云COS要求使用虚拟域名格式（bucket名称会自动添加到endpoint前）
  });
}

// Bucket名称
const BUCKET_NAME = bucketName;

console.log('[腾讯云COS] 初始化配置:', {
  enabled: HAS_TENCENT_COS_CONFIG,
  region: region,
  bucket: BUCKET_NAME,
  hasAccessKey: HAS_TENCENT_COS_CONFIG && !!process.env.COS_ACCESS_KEY,
  hasSecretKey: HAS_TENCENT_COS_CONFIG && !!process.env.COS_SECRET_KEY,
  uploadEndpoint: `https://${bucketName}.cos.${region}.myqcloud.com`,
  signEndpoint: `https://${bucketName}.cos.${region}.myqcloud.com`,
});

// 禁用警告
if (!HAS_TENCENT_COS_CONFIG) {
  console.warn('[腾讯云COS] 警告：缺少有效配置，已自动禁用（不影响主流程）');
}

/**
 * 上传Buffer到腾讯云COS
 * @param buffer - 文件内容Buffer
 * @param fileName - 文件名（包含路径，如 'sjkch_png/image.png'）
 * @param contentType - 内容类型（如 'image/png'）
 * @returns 文件key
 */
export async function uploadToTencentCOS(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  // 如果没有有效配置，直接抛出错误（让调用者捕获并处理）
  if (!HAS_TENCENT_COS_CONFIG || !uploadClient || !signClient) {
    throw new Error('[腾讯云COS] 未配置或已禁用');
  }

  try {
    console.log(`[腾讯云COS] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
    });

    // 使用上传专用客户端（虚拟域名）
    await uploadClient.send(command);
    console.log(`[腾讯云COS] 上传成功，key: ${fileName}`);

    return fileName;
  } catch (error: any) {
    console.error('[腾讯云COS] 上传失败:', error);
    throw new Error(`上传到腾讯云COS失败: ${error.message}`);
  }
}

/**
 * 从URL下载并上传到腾讯云COS
 * @param url - 远程URL
 * @param fileName - 文件名（包含路径）
 * @param contentType - 内容类型（可选）
 * @returns 文件key
 */
export async function uploadFromUrlToTencentCOS(
  url: string,
  fileName: string,
  contentType?: string
): Promise<string> {
  // 如果没有有效配置，直接抛出错误（让调用者捕获并处理）
  if (!HAS_TENCENT_COS_CONFIG || !uploadClient || !signClient) {
    throw new Error('[腾讯云COS] 未配置或已禁用');
  }

  try {
    console.log(`[腾讯云COS] 开始从URL下载: ${url.substring(0, 80)}...`);

    // 创建AbortController用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

    // 下载远程文件
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const finalContentType = contentType || response.headers.get('content-type') || 'image/jpeg';

    console.log(`[腾讯云COS] 下载成功，大小: ${buffer.length} bytes`);

    // 上传到COS
    const key = await uploadToTencentCOS(buffer, fileName, finalContentType);

    return key;
  } catch (error: any) {
    console.error('[腾讯云COS] 从URL上传失败:', error);
    throw new Error(`从URL上传到腾讯云COS失败: ${error.message}`);
  }
}

/**
 * 生成腾讯云COS的公共访问URL（bucket为公共读）
 * @param key - 文件key
 * @returns 公共访问URL（不需要签名）
 */
export async function getTencentCOSUrl(key: string, expireTime: number = 365 * 24 * 60 * 60): Promise<string> {
  // 如果没有有效配置，直接抛出错误（让调用者捕获并处理）
  if (!HAS_TENCENT_COS_CONFIG) {
    throw new Error('[腾讯云COS] 未配置或已禁用');
  }

  try {
    // 腾讯云COS的bucket已设置为公共读，可以直接使用公共访问URL
    // 格式: https://{bucket-name}.cos.{region}.myqcloud.com/{key}
    const publicUrl = `https://${BUCKET_NAME}.cos.${region}.myqcloud.com/${key}`;

    console.log(`[腾讯云COS] 公共访问URL生成成功（永久有效）: ${publicUrl.substring(0, 80)}...`);

    return publicUrl;
  } catch (error: any) {
    console.error('[腾讯云COS] 生成公共访问URL失败:', error);
    throw new Error(`生成腾讯云COS公共访问URL失败: ${error.message}`);
  }
}
