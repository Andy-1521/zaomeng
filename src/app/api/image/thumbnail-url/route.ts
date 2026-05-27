import { NextRequest, NextResponse } from 'next/server';
import { getAliyunOSSKeyFromUrl, getAliyunOSSProcessedUrl } from '@/lib/aliyunOSS';

export const runtime = 'nodejs';

function clampSize(value: string | null) {
  const parsed = Number(value || 160);
  if (!Number.isFinite(parsed)) return 160;
  return Math.max(48, Math.min(512, Math.round(parsed)));
}

function hasLoggedInUser(request: NextRequest) {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return false;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: unknown };
    return typeof userData.id === 'string' && userData.id.length > 0;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!hasLoggedInUser(request)) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const imageUrl = request.nextUrl.searchParams.get('url') || '';
    const size = clampSize(request.nextUrl.searchParams.get('size'));

    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少图片地址' }, { status: 400 });
    }

    const key = getAliyunOSSKeyFromUrl(imageUrl);
    if (!key) {
      return NextResponse.json({ success: true, data: { thumbnailUrl: imageUrl, passthrough: true } });
    }

    const thumbnailUrl = await getAliyunOSSProcessedUrl(
      key,
      `image/resize,m_fill,w_${size},h_${size}/quality,q_72/format,jpg`
    );

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
