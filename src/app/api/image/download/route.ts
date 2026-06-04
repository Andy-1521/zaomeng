import { NextRequest, NextResponse } from 'next/server';
import { getCookieUserId } from '@/lib/serverAuth';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

export const runtime = 'nodejs';

function sanitizeFileName(value: string | null, fallbackExtension: string) {
  const fallback = `image.${fallbackExtension || 'jpg'}`;
  if (!value) return fallback;

  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return cleaned || fallback;
}

function encodeContentDispositionFileName(fileName: string) {
  return encodeURIComponent(fileName).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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

    const image = await downloadSafeRemoteImage(imageUrl, {
      timeoutMs: 60000,
      maxBytes: 100 * 1024 * 1024,
      allowLocalMaterialFile: true,
      localMaterialOrigin: request.nextUrl.origin,
    });
    const fileName = sanitizeFileName(request.nextUrl.searchParams.get('filename'), image.extension);

    return new NextResponse(new Uint8Array(image.buffer), {
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.buffer.byteLength),
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    console.error('[图片下载API] 下载失败:', error);
    return NextResponse.json({ success: false, message: '图片下载失败，请稍后重试' }, { status: 500 });
  }
}
