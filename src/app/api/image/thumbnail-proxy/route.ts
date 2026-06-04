import { NextRequest, NextResponse } from 'next/server';
import { getCookieUserId } from '@/lib/serverAuth';
import sharp from 'sharp';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { transactionManager } from '@/storage/database';

export const runtime = 'nodejs';
export const maxDuration = 60;

const thumbnailMemoryCache = new Map<string, { createdAt: number; contentType: string; buffer: Buffer }>();
const THUMBNAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const THUMBNAIL_CACHE_MAX_ITEMS = 80;

function clampSize(value: string | null) {
  const parsed = Number(value || 256);
  if (!Number.isFinite(parsed)) return 256;
  return Math.max(48, Math.min(768, Math.round(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    if (!getCookieUserId(request)) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const imageUrl = request.nextUrl.searchParams.get('url') || '';
    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少图片地址' }, { status: 400 });
    }

    const size = clampSize(request.nextUrl.searchParams.get('size'));
    const orderNumber = request.nextUrl.searchParams.get('orderNumber') || '';
    const cacheKey = `${imageUrl}|${size}`;
    const cached = thumbnailMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < THUMBNAIL_CACHE_TTL_MS) {
      return new NextResponse(new Uint8Array(cached.buffer), {
        headers: {
          'Content-Type': cached.contentType,
          'Content-Length': String(cached.buffer.byteLength),
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    const image = await downloadSafeRemoteImage(imageUrl, {
      timeoutMs: 60000,
      maxBytes: 120 * 1024 * 1024,
      allowLocalMaterialFile: true,
      localMaterialOrigin: request.nextUrl.origin,
    });

    const thumbnail = await sharp(image.buffer)
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();

    let persistedThumbnailUrl = '';
    if (orderNumber) {
      try {
        const userId = getCookieUserId(request) || '';
        const order = await transactionManager.getTransactionByOrderNumber(orderNumber);
        if (order?.userId === userId) {
          persistedThumbnailUrl = await uploadToCozeStorage(
            thumbnail,
            `thumbnails/backfill/${orderNumber}-${size}.webp`,
            'image/webp',
          );
          let requestParams: Record<string, unknown> = {};
          try {
            requestParams = order.requestParams ? JSON.parse(order.requestParams) : {};
          } catch {
            requestParams = {};
          }
          await transactionManager.updateTransaction(orderNumber, {
            requestParams: JSON.stringify({
              ...requestParams,
              thumbnailUrl: persistedThumbnailUrl,
            }),
          });
        }
      } catch (persistError) {
        console.warn('[缩略图代理] 缩略图已生成，但写入OSS/订单失败:', persistError);
      }
    }

    thumbnailMemoryCache.set(cacheKey, {
      createdAt: Date.now(),
      contentType: 'image/webp',
      buffer: thumbnail,
    });
    if (thumbnailMemoryCache.size > THUMBNAIL_CACHE_MAX_ITEMS) {
      const oldestKey = thumbnailMemoryCache.keys().next().value as string | undefined;
      if (oldestKey) thumbnailMemoryCache.delete(oldestKey);
    }

    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(thumbnail.byteLength),
        'Cache-Control': 'private, max-age=86400',
        ...(persistedThumbnailUrl ? { 'X-Persisted-Thumbnail': '1' } : {}),
      },
    });
  } catch (error) {
    console.error('[缩略图代理] 生成失败:', error);
    return NextResponse.json({ success: false, message: '生成缩略图失败' }, { status: 500 });
  }
}
