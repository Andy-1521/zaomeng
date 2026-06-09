import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { marketManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { getAliyunOSSDownloadUrl, getAliyunOSSKeyFromUrl } from '@/lib/aliyunOSS';

type LocalPreviewMarketItem = Record<string, unknown> & {
  id?: string;
  sellerId?: string;
  title?: string;
  sourceImageUrl?: string;
  psdUrl?: string | null;
  purchased?: boolean;
  buyerId?: string;
  purchasedBy?: string[];
};

function isLocalPreviewRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isLocalWorkspace = process.cwd().startsWith('/Users/andy/Documents/zaomeng/');
  return isLocalHost && isLocalWorkspace;
}

function getExtension(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return matched ? matched[1].toLowerCase() : fallback;
  } catch {
    return fallback;
  }
}

async function readLocalPreviewMarketItems(allowLocalPreview = process.env.NODE_ENV !== 'production') {
  if (!allowLocalPreview) return null;
  try {
    const filePath = join(process.cwd(), '.cache', 'market-preview.json');
    const raw = await readFile(filePath, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items as LocalPreviewMarketItem[] : null;
  } catch {
    return null;
  }
}

async function authorizeLocalPreviewDownload(itemId: string, userId: string, type: 'image' | 'psd') {
  const items = await readLocalPreviewMarketItems(true);
  const item = items?.find((entry) => entry.id === itemId);
  if (!item) {
    return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 });
  }

  const purchasedBy = Array.isArray(item.purchasedBy) ? item.purchasedBy : [];
  const canDownload = item.sellerId === userId || item.buyerId === userId || purchasedBy.includes(userId);
  if (!canDownload) {
    return NextResponse.json({ success: false, message: '购买后才能下载该素材' }, { status: 403 });
  }

  const targetUrl = type === 'psd' ? item.psdUrl : item.sourceImageUrl;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return NextResponse.json({ success: false, message: type === 'psd' ? '该素材不包含 PSD' : '素材文件不存在' }, { status: 404 });
  }

  const key = getAliyunOSSKeyFromUrl(targetUrl);
  const extension = type === 'psd' ? 'psd' : getExtension(targetUrl, 'png');
  const fileName = `${item.title || 'market-item'}.${extension}`;
  const downloadUrl = key ? await getAliyunOSSDownloadUrl(key, fileName) : targetUrl;

  return NextResponse.json({ success: true, data: { url: downloadUrl }, preview: true });
}

export async function GET(request: NextRequest) {
  let userId = '';
  let itemId = '';
  let type: 'image' | 'psd' = 'image';
  try {
    userId = getCookieUserId(request) || '';
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    itemId = request.nextUrl.searchParams.get('itemId') || '';
    type = request.nextUrl.searchParams.get('type') === 'psd' ? 'psd' : 'image';
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
    if (isLocalPreviewRequest(request) && userId && itemId) {
      console.warn('[图市] 本地数据库不可用，使用 .cache/market-preview.json 预览下载授权:', error);
      return authorizeLocalPreviewDownload(itemId, userId, type);
    }
    return NextResponse.json({ success: false, message: '下载授权失败，请稍后重试' }, { status: 500 });
  }
}
