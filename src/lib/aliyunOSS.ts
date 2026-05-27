/**
 * 阿里云 OSS 上传工具。
 * 对象存储是主链路：上传或签名失败时直接抛错，由业务层按积分规则失败/退款。
 */

import OSS from 'ali-oss';
import { createHmac } from 'crypto';

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
const OSS_OPERATION_RETRY_DELAYS_MS = [0, 1500, 4000];

let ossClient: OSS | null = null;

if (HAS_ALIYUN_OSS_CONFIG) {
  ossClient = new OSS({
    region,
    bucket: bucketName,
    accessKeyId,
    accessKeySecret,
    secure: true,
    timeout: '90s',
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

function isRetryableOssError(error: unknown) {
  const message = getErrorMessage(error);
  return /timeout|ECONNRESET|socket hang up|EPIPE|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ResponseTimeout|ResponseError/i.test(message);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withOssRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < OSS_OPERATION_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = OSS_OPERATION_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < OSS_OPERATION_RETRY_DELAYS_MS.length - 1 && isRetryableOssError(error);
      console.warn(`[阿里云OSS] ${label}失败${canRetry ? '，准备重试' : ''}:`, getErrorMessage(error));
      if (!canRetry) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label}失败`);
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
    await withOssRetry(`上传 ${fileName}`, () => (
      (ossClient as OSS).put(fileName, buffer, {
        headers: {
          'Content-Type': contentType,
        },
      })
    ));
    console.log(`[阿里云OSS] 上传成功，key: ${fileName}`);
    return fileName;
  } catch (error: unknown) {
    console.error('[阿里云OSS] 上传失败:', error);
    throw new Error(`上传到阿里云OSS失败: ${getErrorMessage(error)}`);
  }
}

export function createAliyunOSSPostPolicy(options: {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds?: number;
}) {
  if (!HAS_ALIYUN_OSS_CONFIG) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  const expiresInSeconds = options.expiresInSeconds ?? 600;
  const expiration = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const policy = {
    expiration,
    conditions: [
      ['eq', '$key', options.key],
      ['content-length-range', 1, options.maxBytes],
      ['starts-with', '$Content-Type', options.contentType.split('/')[0] ? `${options.contentType.split('/')[0]}/` : ''],
      ['eq', '$success_action_status', '200'],
    ],
  };
  const encodedPolicy = Buffer.from(JSON.stringify(policy)).toString('base64');
  const signature = createHmac('sha1', accessKeySecret).update(encodedPolicy).digest('base64');

  return {
    host: `https://${bucketName}.${region}.aliyuncs.com`,
    key: options.key,
    accessId: accessKeyId,
    policy: encodedPolicy,
    signature,
    successActionStatus: '200',
    expiresAt: expiration,
  };
}

export async function assertAliyunOSSObjectExists(key: string) {
  if (!HAS_ALIYUN_OSS_CONFIG || !ossClient) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  try {
    await withOssRetry(`检查对象 ${key}`, () => (
      (ossClient as OSS & { head: (name: string) => Promise<unknown> }).head(key)
    ));
  } catch (error: unknown) {
    console.error('[阿里云OSS] 对象不存在或不可访问:', key, error);
    throw new Error(`阿里云OSS对象不可访问: ${getErrorMessage(error)}`);
  }
}

export async function assertAliyunOSSObjectExistsBestEffort(key: string) {
  console.log('[阿里云OSS] 跳过阻塞式对象检查，使用已签名对象入库:', key);
  return true;
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

export function isConfiguredAliyunOSSUrl(url: string) {
  if (!HAS_ALIYUN_OSS_CONFIG) return false;

  try {
    const parsed = new URL(url);
    return parsed.hostname === `${bucketName}.${region}.aliyuncs.com`;
  } catch {
    return false;
  }
}

export function getAliyunOSSKeyFromUrl(url: string) {
  if (!isConfiguredAliyunOSSUrl(url)) return null;

  try {
    const parsed = new URL(url);
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return key && !key.includes('..') ? key : null;
  } catch {
    return null;
  }
}

export async function getAliyunOSSProcessedUrl(
  key: string,
  processRule: string,
  expireSeconds: number = 24 * 60 * 60
): Promise<string> {
  if (!HAS_ALIYUN_OSS_CONFIG || !ossClient) {
    throw new Error('[阿里云OSS] 未配置或已禁用');
  }

  try {
    return ossClient.signatureUrl(key, {
      expires: expireSeconds,
      method: 'GET',
      process: processRule,
    } as Parameters<OSS['signatureUrl']>[1] & { process: string });
  } catch (error: unknown) {
    console.error('[阿里云OSS] 生成处理后签名URL失败:', error);
    throw new Error(`生成阿里云OSS缩略图签名失败: ${getErrorMessage(error)}`);
  }
}
