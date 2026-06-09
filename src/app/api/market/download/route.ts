import { NextRequest, NextResponse } from 'next/server';
import { marketManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { getAliyunOSSDownloadUrl, getAliyunOSSKeyFromUrl } from '@/lib/aliyunOSS';

function getExtension(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return matched ? matched[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const itemId = request.nextUrl.searchParams.get('itemId') || '';
    const type = request.nextUrl.searchParams.get('type') === 'psd' ? 'psd' : 'image';
    if (!itemId) {
      return NextResponse.json({ success: false, message: '缺少素材 ID' }, { status: 400 });
    }

    const canDownload = await marketManager.userCanDownload(itemId, userId);
    if (!canDownload) {
      return NextResponse.json({ success: false, message: '购买后才能下载该素材' }, { status: 403 });
    }

    const item = await marketManager.getItemById(itemId, userId);
    if (!item) {
      return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 });
    }

    const targetUrl = type === 'psd' ? item.psdUrl : item.sourceImageUrl;
    if (!targetUrl) {
      return NextResponse.json({ success: false, message: type === 'psd' ? '该素材不包含 PSD' : '素材文件不存在' }, { status: 404 });
    }

    const key = getAliyunOSSKeyFromUrl(targetUrl);
    const extension = type === 'psd' ? 'psd' : getExtension(targetUrl, 'png');
    const fileName = `${item.title || 'market-item'}.${extension}`;
    const downloadUrl = key ? await getAliyunOSSDownloadUrl(key, fileName) : targetUrl;

    return NextResponse.json({ success: true, data: { url: downloadUrl } });
  } catch (error) {
    console.error('[图市] 下载授权失败:', error);
    return NextResponse.json({ success: false, message: '下载授权失败，请稍后重试' }, { status: 500 });
  }
}
