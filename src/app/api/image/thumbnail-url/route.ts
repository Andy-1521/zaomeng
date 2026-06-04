import { NextRequest, NextResponse } from 'next/server';
import { getCookieUserId } from '@/lib/serverAuth';
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS';

export const runtime = 'nodejs';

function clampSize(value: string | null) {
  const parsed = Number(value || 160);
  if (!Number.isFinite(parsed)) return 160;
  return Math.max(48, Math.min(2048, Math.round(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    if (!getCookieUserId(request)) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const imageUrl = request.nextUrl.searchParams.get('url') || '';
    const size = clampSize(request.nextUrl.searchParams.get('size'));

    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少图片地址' }, { status: 400 });
    }

    const thumbnailUrl = await getAliyunOSSThumbnailUrlFromUrl(imageUrl, size);
    if (!thumbnailUrl) {
      return NextResponse.json({ success: true, data: { thumbnailUrl: imageUrl, passthrough: true } });
    }

    return NextResponse.json({
      success: true,
      data: {
        thumbnailUrl,
        passthrough: false,
      },
    });
  } catch (error) {
    console.error('[缩略图URL] 生成失败:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '生成缩略图URL失败' },
      { status: 500 }
    );
  }
}
