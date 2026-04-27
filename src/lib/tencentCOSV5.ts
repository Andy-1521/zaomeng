/**
 * 腾讯云COS上传工具（使用官方SDK）
 * 使用腾讯云COS SDK v5
 */

import COS from 'cos-nodejs-sdk-v5';
import { getTencentCOSUrl } from './tencentCOS';

// 初始化COS客户端
const cos = new COS({
  SecretId: process.env.COS_ACCESS_KEY || '',
  SecretKey: process.env.COS_SECRET_KEY || '',
  Timeout: 300000, // 超时时间5分钟（PSD文件可能很大）
  // 腾讯云COS SDK v5默认使用虚拟域名格式，无需额外配置
});

// Bucket名称和地域
const BUCKET_NAME = process.env.COS_BUCKET_NAME || '';
const REGION = process.env.COS_REGION || 'ap-guangzhou';

console.log('[腾讯云COS V5] 初始化配置:', {
  bucket: BUCKET_NAME,
  region: REGION,
  hasAccessKey: !!process.env.COZE_ACCESS_KEY,
  hasSecretKey: !!process.env.COZE_SECRET_KEY,
});

/**
 * 上传Buffer到腾讯云COS
 * @param buffer - 文件内容Buffer
 * @param fileName - 文件名（包含路径，如 'sjkch_png/image.png'）
 * @param contentType - 内容类型（如 'image/png'）
 * @returns 文件key
 */
export async function uploadToTencentCOSV5(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`[腾讯云COS V5] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

    cos.putObject({
      Bucket: BUCKET_NAME,
      Region: REGION,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
    }, (err, data) => {
      if (err) {
        console.error('[腾讯云COS V5] 上传失败:', err);
        reject(new Error(`上传到腾讯云COS失败: ${err.message}`));
      } else {
        console.log(`[腾讯云COS V5] 上传成功，key: ${fileName}`);
        console.log('[腾讯云COS V5] 返回数据:', data);
        resolve(fileName);
      }
    });
  });
}

/**
 * 从URL下载并上传到腾讯云COS
 * @param url - 远程URL
 * @param fileName - 文件名（包含路径）
 * @param contentType - 内容类型（可选）
 * @returns 文件key
 */
export async function uploadFromUrlToTencentCOSV5(
  url: string,
  fileName: string,
  contentType?: string
): Promise<string> {
  try {
    console.log(`[腾讯云COS V5] 开始从URL下载: ${url.substring(0, 80)}...`);

    // 使用AbortController实现超时
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

    console.log(`[腾讯云COS V5] 下载成功，大小: ${buffer.length} bytes`);

    // 上传到COS
    const key = await uploadToTencentCOSV5(buffer, fileName, finalContentType);

    return key;
  } catch (error: any) {
    console.error('[腾讯云COS V5] 从URL上传失败:', error);
    throw new Error(`从URL上传到腾讯云COS失败: ${error.message}`);
  }
}

/**
 * 腾讯云COS直接访问URL（不需要签名，如果bucket是公共读的）
 * @param key - 文件key
 * @returns 访问URL
 */
export function getTencentCOSV5Url(key: string): string {
  // 如果bucket是公共读，可以直接访问
  // 格式: https://{bucket-name}.cos.{region}.myqcloud.com/{key}
  const domain = `${BUCKET_NAME}.cos.${REGION}.myqcloud.com`;
  return `https://${domain}/${key}`;
}

/**
 * 上传PSD文件到腾讯云COS（带签名URL）
 * @param key - 文件key（包含路径，如 'andy-1390504588/cjkch_PSD/psd_123.psd'）
 * @param buffer - PSD文件Buffer
 * @returns 签名URL（有效期1年）
 */
export async function uploadPsdToTencentCOS(key: string, buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`[腾讯云COS V5] 开始上传PSD: ${key}, 大小: ${buffer.length} bytes`);

    cos.putObject({
      Bucket: BUCKET_NAME,
      Region: REGION,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }, async (err, data) => {
      if (err) {
        console.error('[腾讯云COS V5] 上传PSD失败:', err);
        reject(new Error(`上传PSD到腾讯云COS失败: ${err.message}`));
      } else {
        console.log(`[腾讯云COS V5] PSD上传成功，key: ${key}`);

        // 【修复】改用AWS SDK v3生成签名URL（使用path-style格式）
        // 腾讯云COS SDK v5的getObjectUrl默认使用虚拟域名格式，会导致405错误
        try {
          console.log('[腾讯云COS V5] 开始生成签名URL（使用AWS SDK v3）');
          const signedUrl = await getTencentCOSUrl(key, 365 * 24 * 60 * 60); // 1年有效期
          console.log('[腾讯云COS V5] 签名URL生成成功:', signedUrl.substring(0, 80) + '...');
          resolve(signedUrl);
        } catch (signErr: any) {
          console.error('[腾讯云COS V5] 生成签名URL失败:', signErr);
          reject(new Error(`生成签名URL失败: ${signErr.message}`));
        }
      }
    });
  });
}
