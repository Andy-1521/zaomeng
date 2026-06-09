import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { marketManager, transactionManager, userManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS';
import { inspectMarketPsd, inspectMarketPsdFromUrl } from '@/lib/marketPsd';

const MAX_PSD_UPLOAD_BYTES = 120 * 1024 * 1024;
const DEFAULT_PRICE_POINTS = 50;


function isLocalPreviewRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isLocalWorkspace = process.cwd().startsWith('/Users/andy/Documents/zaomeng/');
  return isLocalHost && isLocalWorkspace;
}

async function loadLocalPreviewMarketItems(keyword: string, allowLocalPreview = process.env.NODE_ENV !== 'production') {
  if (!allowLocalPreview) return null;
  try {
    const filePath = join(process.cwd(), '.cache', 'market-preview.json');
    const raw = await readFile(filePath, 'utf8');
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return null;
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;
    return items.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return [record.title, record.category, record.description, ...(Array.isArray(record.tags) ? record.tags : [])]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(normalizedKeyword));
    });
  } catch {
    return null;
  }
}

function parseTags(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return [];
  return value
    .split(/[，,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return extractImageUrls(JSON.parse(trimmed));
    } catch {
      return trimmed.startsWith('http://') || trimmed.startsWith('https://') ? [trimmed] : [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(extractImageUrls);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...extractImageUrls(record.imageUrl),
      ...extractImageUrls(record.image_url),
      ...extractImageUrls(record.result_image_url),
      ...extractImageUrls(record.url),
    ];
  }
  return [];
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function getPositiveInteger(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const userId = getCookieUserId(request);
  const mode = request.nextUrl.searchParams.get('mode') || 'approved';
  const keyword = request.nextUrl.searchParams.get('keyword') || '';

  if (mode === 'mine' || mode === 'purchased' || mode === 'pending') {
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
  }

  if (mode === 'mine' && userId) {
    return NextResponse.json({ success: true, data: await marketManager.listUserItems(userId) });
  }

  if (mode === 'purchased' && userId) {
    return NextResponse.json({ success: true, data: await marketManager.listPurchased(userId) });
  }

  if (mode === 'pending' && userId) {
    const admin = await userManager.getUserById(userId);
    if (!admin?.isAdmin) {
      return NextResponse.json({ success: false, message: '无管理员权限' }, { status: 403 });
    }
    return NextResponse.json({ success: true, data: await marketManager.listByStatus('pending', userId) });
  }

  try {
    return NextResponse.json({
      success: true,
      data: await marketManager.listApproved(userId, { keyword, limit: 120 }),
    });
  } catch (error) {
    const previewItems = await loadLocalPreviewMarketItems(keyword, isLocalPreviewRequest(request));
    if (previewItems) {
      console.warn('[图市] 本地数据库不可用，使用 .cache/market-preview.json 预览数据:', error);
      return NextResponse.json({ success: true, data: previewItems, preview: true });
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const formData = await request.formData();
    const sourceOrderNumber = getString(formData, 'sourceOrderNumber');
    const sourceImageUrl = getString(formData, 'sourceImageUrl');
    const title = getString(formData, 'title').slice(0, 120);
    const description = getString(formData, 'description').slice(0, 1000);
    const category = getString(formData, 'category') || '手机壳图案';
    const pricePoints = getPositiveInteger(getString(formData, 'pricePoints'), DEFAULT_PRICE_POINTS, 1, 9999);
    const psdMode = getString(formData, 'psdMode') || 'none';

    if (!sourceOrderNumber) {
      return NextResponse.json({ success: false, message: '请从成功订单结果中发起上架' }, { status: 400 });
    }
    if (!sourceImageUrl.startsWith('http')) {
      return NextResponse.json({ success: false, message: '缺少可上架的结果图' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ success: false, message: '请填写素材标题' }, { status: 400 });
    }

    const order = await transactionManager.getTransactionByOrderNumber(sourceOrderNumber);
    if (!order || order.userId !== userId || order.status !== '成功') {
      return NextResponse.json({ success: false, message: '订单不可上架或无权访问' }, { status: 403 });
    }
    const resultImages = extractImageUrls(order.resultData);
    if (!resultImages.includes(sourceImageUrl)) {
      return NextResponse.json({ success: false, message: '该图片不属于当前订单结果' }, { status: 400 });
    }
    const orderPsdUrl = order.psdUrl || '';

    let psdUrl = psdMode === 'order' ? orderPsdUrl : '';
    let psdFileName = psdMode === 'order' && orderPsdUrl ? `${sourceOrderNumber || 'order'}.psd` : '';
    let psdFileSize: number | undefined;
    let psdLayerCount = 0;
    let psdLayers: unknown[] = [];

    if (psdMode === 'order' && orderPsdUrl) {
      try {
        const inspected = await inspectMarketPsdFromUrl(orderPsdUrl, {
          keyPrefix: `market/psd/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}/layers`,
        });
        psdLayerCount = inspected.layerCount;
        psdLayers = inspected.layers;
      } catch (error) {
        console.warn('[图市] 订单PSD解析失败，继续上架:', error);
      }
    }

    const psdFile = formData.get('psdFile');
    if (psdMode === 'upload' && psdFile instanceof File) {
      if (!psdFile.name.toLowerCase().endsWith('.psd')) {
        return NextResponse.json({ success: false, message: '只支持上传 PSD 文件' }, { status: 400 });
      }
      if (psdFile.size <= 0 || psdFile.size > MAX_PSD_UPLOAD_BYTES) {
        return NextResponse.json({ success: false, message: 'PSD 文件需小于 120MB' }, { status: 400 });
      }

      const buffer = Buffer.from(await psdFile.arrayBuffer());
      const itemPrefix = `market/psd/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      psdUrl = await uploadToCozeStorage(buffer, `${itemPrefix}/${psdFile.name.replace(/[^\w.-]+/g, '-')}`, 'application/octet-stream');
      psdFileName = psdFile.name;
      psdFileSize = psdFile.size;

      try {
        const inspected = await inspectMarketPsd(buffer, { keyPrefix: `${itemPrefix}/layers` });
        psdLayerCount = inspected.layerCount;
        psdLayers = inspected.layers;
      } catch (error) {
        console.warn('[图市] PSD解析失败，继续上架:', error);
      }
    }

    const thumbnailUrl = await getAliyunOSSThumbnailUrlFromUrl(sourceImageUrl, 512).catch(() => null);
    const item = await marketManager.createItem({
      sellerId: userId,
      sourceOrderNumber: sourceOrderNumber || null,
      sourceImageUrl,
      previewImageUrl: sourceImageUrl,
      thumbnailUrl: thumbnailUrl || null,
      title,
      description,
      category,
      tags: parseTags(formData.get('tags')),
      pricePoints,
      status: 'pending',
      licenseType: 'standard',
      allowCommercialUse: true,
      psdUrl: psdUrl || null,
      psdFileName: psdFileName || null,
      psdFileSize: psdFileSize ?? null,
      psdLayerCount,
      psdLayers,
    });

    return NextResponse.json({ success: true, message: '已提交审核，通过后会展示到图市', data: item });
  } catch (error) {
    console.error('[图市] 上架失败:', error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '上架失败，请稍后重试' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const userId = getCookieUserId(request);
  if (!userId) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  const admin = await userManager.getUserById(userId);
  if (!admin?.isAdmin) {
    return NextResponse.json({ success: false, message: '无管理员权限' }, { status: 403 });
  }

  const body = await request.json() as { id?: string; status?: 'approved' | 'rejected' | 'delisted'; rejectionReason?: string };
  if (!body.id || !body.status) {
    return NextResponse.json({ success: false, message: '缺少审核参数' }, { status: 400 });
  }

  const item = await marketManager.reviewItem(body.id, body.status, body.rejectionReason);
  return NextResponse.json({ success: true, data: item });
}
