import { NextRequest, NextResponse } from 'next/server';
import { getAliyunOSSDownloadUrl, getAliyunOSSKeyFromUrl } from '@/lib/aliyunOSS';

export const runtime = 'nodejs';

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

function sanitizeFileName(value: string | null) {
  const fallback = 'image.png';
  if (!value) return fallback;

  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return cleaned || fallback;
}

export async function GET(request: NextRequest) {
  try {
    if (!hasLoggedInUser(request)) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const imageUrl = request.nextUrl.searchParams.get('url') || '';
    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少图片地址' }, { status: 400 });
    }

    const key = getAliyunOSSKeyFromUrl(imageUrl);
    if (!key) {
      return NextResponse.json({ success: false, message: '该图片暂不支持直签下载' }, { status: 400 });
    }

    const downloadUrl = await getAliyunOSSDownloadUrl(key, sanitizeFileName(request.nextUrl.searchParams.get('filename')));

    return NextResponse.json({
      success: true,
      data: { downloadUrl },
    });
  } catch (error) {
    console.error('[图片下载签名API] 生成失败:', error);
    return NextResponse.json({ success: false, message: '生成下载链接失败，请稍后重试' }, { status: 500 });
  }
}
