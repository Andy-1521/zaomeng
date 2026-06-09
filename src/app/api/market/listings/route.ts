import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { marketManager, transactionManager, userManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS';
import { inspectMarketPsd, inspectMarketPsdFromUrl } from '@/lib/marketPsd';
import { normalizeFileExtension } from '@/lib/localUploadStorage';
import { isImageValidationError, validateUploadedImageBuffer } from '@/lib/serverImageValidation';

const MAX_PSD_UPLOAD_BYTES = 120 * 1024 * 1024;
const DEFAULT_PRICE_POINTS = 50;


function isLocalPreviewRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isLocalWorkspace = process.cwd().startsWith('/Users/andy/Documents/zaomeng/');
  return isLocalHost && isLocalWorkspace;
}

type LocalPreviewMarketItem = Record<string, unknown> & {
  id?: string;
  sellerId?: string;
  status?: string;
};

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

async function writeLocalPreviewMarketItem(item: LocalPreviewMarketItem, allowLocalPreview = process.env.NODE_ENV !== 'production') {
  if (!allowLocalPreview) return false;
  const filePath = join(process.cwd(), '.cache', 'market-preview.json');
  const currentItems = await readLocalPreviewMarketItems(allowLocalPreview);
  if (!currentItems) return false;
  const nextItems = [item, ...currentItems.filter((entry) => entry.id !== item.id)];
  await writeFile(filePath, JSON.stringify(nextItems, null, 2), 'utf8');
  return true;
}

async function loadLocalPreviewMarketItems(
  options: { keyword?: string; mode?: string; userId?: string | null },
  allowLocalPreview = process.env.NODE_ENV !== 'production',
) {
  const items = await readLocalPreviewMarketItems(allowLocalPreview);
  if (!items) return null;

  const mode = options.mode || 'approved';
  const userId = options.userId || '';
  let filteredItems = items;

  if (mode === 'mine') {
    filteredItems = filteredItems.filter((item) => item.sellerId === userId);
  } else if (mode === 'pending') {
    filteredItems = filteredItems.filter((item) => item.status === 'pending');
  } else if (mode === 'approved') {
    filteredItems = filteredItems.filter((item) => item.status === 'approved');
  }

  const normalizedKeyword = (options.keyword || '').trim().toLowerCase();
  if (!normalizedKeyword) return filteredItems;

  return filteredItems.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return [record.title, record.category, record.description, ...(Array.isArray(record.tags) ? record.tags : [])]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(normalizedKeyword));
  });
}

function buildLocalPreviewItem(data: {
  sellerId: string;
  sourceOrderNumber: string | null;
  sourceImageUrl: string;
  previewImageUrl: string;
  thumbnailUrl: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  pricePoints: number;
  psdUrl: string | null;
  psdFileName: string | null;
  psdFileSize: number | null;
  psdLayerCount: number;
  psdLayers: unknown[];
}) {
  const createdAt = new Date().toISOString();
  return {
    id: `preview-custom-${randomUUID()}`,
    sellerId: data.sellerId,
    sellerName: '本地预览',
    sourceOrderNumber: data.sourceOrderNumber,
    sourceImageUrl: data.sourceImageUrl,
    previewImageUrl: data.previewImageUrl,
    thumbnailUrl: data.thumbnailUrl,
    title: data.title,
    description: data.description,
    category: data.category,
    tags: data.tags,
    pricePoints: data.pricePoints,
    platformFeeRate: 20,
    status: 'pending',
    licenseType: 'standard',
    allowCommercialUse: true,
    psdUrl: data.psdUrl,
    psdFileName: data.psdFileName,
    psdFileSize: data.psdFileSize,
    psdLayerCount: data.psdLayerCount,
    psdLayers: data.psdLayers,
    rejectionReason: null,
    approvedAt: null,
    createdAt,
    updatedAt: createdAt,
    purchased: false,
  };
}

async function uploadDirectMarketImage(imageFile: FormDataEntryValue | null, userId: string) {
  if (!(imageFile instanceof File) || imageFile.size <= 0) {
    return null;
  }

  const buffer = Buffer.from(await imageFile.arrayBuffer());
  const imageInfo = await validateUploadedImageBuffer(buffer, {
    declaredContentType: imageFile.type,
  });
  const extension = normalizeFileExtension(imageInfo.extension);
  const safeName = imageFile.name.replace(/[^\w.-]+/g, '-').replace(/\.+$/, '') || 'listing';
  const fileName = `market/custom/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}-${safeName}.${extension}`;
  const url = await uploadToCozeStorage(buffer, fileName, imageInfo.contentType);

  return { url, imageInfo };
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

  try {
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

    return NextResponse.json({
      success: true,
      data: await marketManager.listApproved(userId, { keyword, limit: 120 }),
    });
  } catch (error) {
    const previewMode = mode === 'market' ? 'approved' : mode;
    const previewItems = await loadLocalPreviewMarketItems(
      { keyword, mode: previewMode, userId },
      isLocalPreviewRequest(request),
    );
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
    let sourceImageUrl = getString(formData, 'sourceImageUrl');
    const title = getString(formData, 'title').slice(0, 120);
    const description = getString(formData, 'description').slice(0, 1000);
    const category = getString(formData, 'category') || '手机壳图案';
    const tags = parseTags(formData.get('tags'));
    const pricePoints = getPositiveInteger(getString(formData, 'pricePoints'), DEFAULT_PRICE_POINTS, 1, 9999);
    const psdMode = getString(formData, 'psdMode') || 'none';
    const directImageFile = formData.get('imageFile');
    const isDirectUpload = directImageFile instanceof File && directImageFile.size > 0;

    if (!title) {
      return NextResponse.json({ success: false, message: '请填写素材标题' }, { status: 400 });
    }

    let orderPsdUrl = '';

    if (isDirectUpload) {
      const uploadedImage = await uploadDirectMarketImage(directImageFile, userId);
      if (!uploadedImage?.url) {
        return NextResponse.json({ success: false, message: '请上传要上架的图片' }, { status: 400 });
      }
      sourceImageUrl = uploadedImage.url;
    } else {
      if (!sourceOrderNumber) {
        return NextResponse.json({ success: false, message: '请上传图片，或从成功订单结果中发起上架' }, { status: 400 });
      }
      if (!sourceImageUrl.startsWith('http')) {
        return NextResponse.json({ success: false, message: '缺少可上架的结果图' }, { status: 400 });
      }

      const order = await transactionManager.getTransactionByOrderNumber(sourceOrderNumber);
      if (!order || order.userId !== userId || order.status !== '成功') {
        return NextResponse.json({ success: false, message: '订单不可上架或无权访问' }, { status: 403 });
      }
      const resultImages = extractImageUrls(order.resultData);
      if (!resultImages.includes(sourceImageUrl)) {
        return NextResponse.json({ success: false, message: '该图片不属于当前订单结果' }, { status: 400 });
      }
      orderPsdUrl = order.psdUrl || '';
    }

    let psdUrl = !isDirectUpload && psdMode === 'order' ? orderPsdUrl : '';
    let psdFileName = !isDirectUpload && psdMode === 'order' && orderPsdUrl ? `${sourceOrderNumber || 'order'}.psd` : '';
    let psdFileSize: number | undefined;
    let psdLayerCount = 0;
    let psdLayers: unknown[] = [];

    if (!isDirectUpload && psdMode === 'order' && orderPsdUrl) {
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
    const itemInput = {
      sellerId: userId,
      sourceOrderNumber: sourceOrderNumber || null,
      sourceImageUrl,
      previewImageUrl: sourceImageUrl,
      thumbnailUrl: thumbnailUrl || null,
      title,
      description,
      category,
      tags,
      pricePoints,
      status: 'pending' as const,
      licenseType: 'standard',
      allowCommercialUse: true,
      psdUrl: psdUrl || null,
      psdFileName: psdFileName || null,
      psdFileSize: psdFileSize ?? null,
      psdLayerCount,
      psdLayers,
    };

    try {
      const item = await marketManager.createItem(itemInput);
      return NextResponse.json({ success: true, message: '已提交审核，通过后会展示到图市', data: item });
    } catch (error) {
      if (!isLocalPreviewRequest(request)) throw error;
      const previewItem = buildLocalPreviewItem({
        sellerId: itemInput.sellerId,
        sourceOrderNumber: itemInput.sourceOrderNumber,
        sourceImageUrl: itemInput.sourceImageUrl,
        previewImageUrl: itemInput.previewImageUrl,
        thumbnailUrl: itemInput.thumbnailUrl,
        title: itemInput.title,
        description: itemInput.description,
        category: itemInput.category,
        tags: itemInput.tags,
        pricePoints: itemInput.pricePoints,
        psdUrl: itemInput.psdUrl,
        psdFileName: itemInput.psdFileName,
        psdFileSize: itemInput.psdFileSize,
        psdLayerCount: itemInput.psdLayerCount,
        psdLayers: itemInput.psdLayers,
      });
      const wrotePreview = await writeLocalPreviewMarketItem(previewItem, true);
      if (!wrotePreview) throw error;
      console.warn('[图市] 本地数据库不可用，已写入 .cache/market-preview.json 预览上架:', error);
      return NextResponse.json({ success: true, message: '本地预览已提交审核', data: previewItem, preview: true });
    }
  } catch (error) {
    if (isImageValidationError(error)) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    }
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
