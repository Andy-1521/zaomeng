import { S3Storage } from 'coze-coding-dev-sdk';

const REQUIRED_COZE_STORAGE_ENV_KEYS = [
  'COZE_BUCKET_ENDPOINT_URL',
  'COZE_ACCESS_KEY',
  'COZE_SECRET_KEY',
  'COZE_BUCKET_NAME',
] as const;

type CozeStorageEnvKey = (typeof REQUIRED_COZE_STORAGE_ENV_KEYS)[number];

function getMissingCozeStorageEnvKeys(): CozeStorageEnvKey[] {
  return REQUIRED_COZE_STORAGE_ENV_KEYS.filter((key) => !process.env[key]?.trim());
}

export function validateCozeStorageConfig(): void {
  const missingKeys = getMissingCozeStorageEnvKeys();
  if (missingKeys.length === 0) {
    return;
  }

  throw new Error(`Coze对象存储未配置完整，缺少环境变量: ${missingKeys.join(', ')}`);
}

export function getCozeStorage(): S3Storage {
  validateCozeStorageConfig();

  return new S3Storage({
    endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
    accessKey: process.env.COZE_ACCESS_KEY,
    secretKey: process.env.COZE_SECRET_KEY,
    bucketName: process.env.COZE_BUCKET_NAME,
    region: 'cn-beijing',
  });
}
