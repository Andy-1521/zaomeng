/**
 * 阿里云 OSS 上传工具。
 * 对象存储是主链路：上传或签名失败时直接抛错，由业务层按积分规则失败/退款。
 */

import OSS from 'ali-oss';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '阿里云 OSS 操作失败';
}

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

const region = firstEnv('ALIYUN_OSS_REGION', 'OSS_REGION', 'OSSRegion', 'RegionID');
const bucketName = firstEnv('ALIYUN_OSS_BUCKET', 'OSS_BUCKET', 'OSSBucket');
const accessKeyId = firstEnv('ALIYUN_OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_ID', 'AccessKeyID');
const accessKeySecret = firstEnv('ALIYUN_OSS_ACCESS_KEY_SECRET', 'OSS_ACCESS_KEY_SECRET', 'AccessKeySecret');

const HAS_ALIYUN_OSS_CONFIG = !!(region && bucketName && accessKeyId && accessKeySecret);

let ossClient: OSS | null = null;

if (HAS_ALIYUN_OSS_CONFIG) {
  ossClient = new OSS({
    region,
    bucket: bucketName,
    accessKeyId,
    accessKeySecret,
    secure: true,
    timeout: '60s',
  });
}

console.log('[阿里云OSS] 初始化配置:', {
  enabled: HAS_ALIYUN_OSS_CONFIG,
  region,
  bucket: bucketName,
  hasAccessKey: !!accessKeyId,
  hasSecretKey: !!accessKeySecret,
});

if (!HAS_ALIYUN_OSS_CONFIG) {
  console.warn('[阿里云OSS] 警告：缺少有效配置，已自动禁用（主链路会失败）');
}

export async function uploadToAliyunOSS(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  if (!HAS_ALIYUN_OSS_CONFIG || !ossClient) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  try {
    console.log(`[阿里云OSS] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);
    await ossClient.put(fileName, buffer, {
      headers: {
        'Content-Type': contentType,
      },
    });
    console.log(`[阿里云OSS] 上传成功，key: ${fileName}`);
    return fileName;
  } catch (error: unknown) {
    console.error('[阿里云OSS] 上传失败:', error);
    throw new Error(`上传到阿里云OSS失败: ${getErrorMessage(error)}`);
  }
}

export async function uploadFromUrlToAliyunOSS(
  url: string,
  fileName: string,
  contentType?: string
): Promise<string> {
  if (!HAS_ALIYUN_OSS_CONFIG || !ossClient) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  try {
    console.log(`[阿里云OSS] 开始从URL下载: ${url.substring(0, 80)}...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const finalContentType = contentType || response.headers.get('content-type') || 'image/jpeg';

    console.log(`[阿里云OSS] 下载成功，大小: ${buffer.length} bytes`);
    return uploadToAliyunOSS(buffer, fileName, finalContentType);
  } catch (error: unknown) {
    console.error('[阿里云OSS] 从URL上传失败:', error);
    throw new Error(`从URL上传到阿里云OSS失败: ${getErrorMessage(error)}`);
  }
}

export async function getAliyunOSSUrl(key: string, expireSeconds: number = 365 * 24 * 60 * 60): Promise<string> {
  if (!HAS_ALIYUN_OSS_CONFIG || !ossClient) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  try {
    const signedUrl = ossClient.signatureUrl(key, {
      expires: expireSeconds,
      method: 'GET',
    });
    console.log(`[阿里云OSS] 签名URL生成成功: ${signedUrl.substring(0, 80)}...`);
    return signedUrl;
  } catch (error: unknown) {
    console.error('[阿里云OSS] 生成签名URL失败:', error);
    throw new Error(`生成阿里云OSS签名URL失败: ${getErrorMessage(error)}`);
  }
}
