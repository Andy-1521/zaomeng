import sharp from 'sharp';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

const DEFAULT_THUMBNAIL_SIZE = 512;

export async function createResultThumbnailBuffer(
  imageBuffer: Buffer,
  size: number = DEFAULT_THUMBNAIL_SIZE,
) {
  return sharp(imageBuffer)
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
}

export async function createAndUploadResultThumbnail(
  imageBuffer: Buffer,
  key: string,
  size: number = DEFAULT_THUMBNAIL_SIZE,
) {
  const thumbnailBuffer = await createResultThumbnailBuffer(imageBuffer, size);
  return uploadToCozeStorage(thumbnailBuffer, key, 'image/webp');
}

export async function createAndUploadResultThumbnailFromUrl(
  imageUrl: string,
  key: string,
  options?: {
    size?: number;
    localMaterialOrigin?: string;
  },
) {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 45000,
    maxBytes: 80 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: options?.localMaterialOrigin,
  });
  return createAndUploadResultThumbnail(image.buffer, key, options?.size || DEFAULT_THUMBNAIL_SIZE);
}

export async function tryCreateAndUploadResultThumbnail(
  imageBuffer: Buffer,
  key: string,
  logPrefix: string,
) {
  try {
    return await createAndUploadResultThumbnail(imageBuffer, key);
  } catch (error) {
    console.warn(`[${logPrefix}] 结果缩略图生成失败，保留原图结果`, error);
    return '';
  }
}

export async function tryCreateAndUploadResultThumbnailFromUrl(
  imageUrl: string,
  key: string,
  logPrefix: string,
  options?: {
    localMaterialOrigin?: string;
  },
) {
  try {
    return await createAndUploadResultThumbnailFromUrl(imageUrl, key, options);
  } catch (error) {
    console.warn(`[${logPrefix}] 结果缩略图生成失败，保留原图结果`, error);
    return '';
  }
}
