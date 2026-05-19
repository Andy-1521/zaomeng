import sharp from 'sharp';

export const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const SUPPORTED_DECLARED_CONTENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

const FORMAT_TO_EXTENSION: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
};

const FORMAT_TO_CONTENT_TYPE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

export function isImageValidationError(error: unknown): error is ImageValidationError {
  return error instanceof ImageValidationError;
}

function normalizeContentType(contentType?: string | null) {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

function normalizeSharpFormat(format?: string) {
  return format === 'jpg' ? 'jpeg' : format;
}

function isAllowedDeclaredContentType(contentType?: string | null) {
  const normalized = normalizeContentType(contentType);
  if (!normalized || normalized === 'application/octet-stream') return true;
  return SUPPORTED_DECLARED_CONTENT_TYPES.has(normalized);
}

export async function validateUploadedImageBuffer(
  buffer: Buffer,
  options: { declaredContentType?: string | null; maxBytes?: number } = {},
) {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_IMAGE_BYTES;
  if (buffer.byteLength <= 0) {
    throw new ImageValidationError('缺少图片数据');
  }

  if (buffer.byteLength > maxBytes) {
    throw new ImageValidationError('单张图片大小不能超过 10MB');
  }

  if (!isAllowedDeclaredContentType(options.declaredContentType)) {
    throw new ImageValidationError('请上传 JPG、PNG、WebP 或 GIF 格式的图片');
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const format = normalizeSharpFormat(metadata.format);
    if (!format || !SUPPORTED_IMAGE_FORMATS.has(format) || !metadata.width || !metadata.height) {
      throw new ImageValidationError('请上传 JPG、PNG、WebP 或 GIF 格式的图片');
    }

    return {
      format,
      extension: FORMAT_TO_EXTENSION[format],
      contentType: FORMAT_TO_CONTENT_TYPE[format],
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    if (isImageValidationError(error)) {
      throw error;
    }

    throw new ImageValidationError('图片文件无法读取，请重新上传');
  }
}
