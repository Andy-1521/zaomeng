import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { marketManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

type LocalPreviewMarketItem = Record<string, unknown> & {
  id?: string;
  sellerId?: string;
  status?: string;
  title?: string;
  pricePoints?: number;
  platformFeeRate?: number;
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

function isDatabaseUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return (
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT') ||
    message.includes('connect ') ||
    message.includes('数据库')
  );
}

function getSafePurchaseError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (
    message.includes('不存在') ||
    message.includes('已购买') ||
    message.includes('积分不足') ||
    message.includes('自己的素材')
  ) {
    return { message, status: 400 };
  }

  if (isDatabaseUnavailable(error)) {
    return { message: '购买服务暂时不可用，请稍后重试', status: 500 };
  }

  return { message: message || '购买失败，请稍后重试', status: 400 };
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

async function writeLocalPreviewMarketItems(items: LocalPreviewMarketItem[], allowLocalPreview = process.env.NODE_ENV !== 'production') {
  if (!allowLocalPreview) return false;
  const filePath = join(process.cwd(), '.cache', 'market-preview.json');
  await writeFile(filePath, JSON.stringify(items, null, 2), 'utf8');
  return true;
}

async function purchaseLocalPreviewItem(itemId: string, buyerId: string) {
  const items = await readLocalPreviewMarketItems(true);
  if (!items) return null;

  const index = items.findIndex((item) => item.id === itemId);
  const item = index >= 0 ? items[index] : null;
  if (!item || item.status !== 'approved') {
    return { success: false as const, message: '该素材暂不可购买', status: 400 };
  }

  if (item.sellerId === buyerId) {
    return { success: false as const, message: '不能购买自己上架的素材', status: 400 };
  }

  const purchasedBy = Array.isArray(item.purchasedBy) ? item.purchasedBy : [];
  if (item.buyerId === buyerId || purchasedBy.includes(buyerId)) {
    return { success: false as const, message: '你已购买过该素材', status: 400 };
  }

  const pricePoints = Math.max(1, Number(item.pricePoints || 50));
  const feeRate = Math.max(0, Math.min(100, Number(item.platformFeeRate ?? 20)));
  const platformFeePoints = Math.floor(pricePoints * feeRate / 100);
  const sellerPoints = pricePoints - platformFeePoints;
  const buyerRemainingPoints = Math.max(0, 840 - pricePoints);
  const sellerRemainingPoints = sellerPoints;
  const orderNumber = `LOCAL-MKT-${Date.now()}`;
  const now = new Date().toISOString();

  items[index] = {
    ...item,
    purchased: true,
    buyerId,
    purchasedBy: [...purchasedBy, buyerId],
    purchasedAt: now,
    orderNumber,
    updatedAt: now,
  };

  await writeLocalPreviewMarketItems(items, true);

  return {
    success: true as const,
    data: {
      orderNumber,
      buyerRemainingPoints,
      sellerRemainingPoints,
      pricePoints,
      sellerPoints,
      platformFeePoints,
      previewPurchaseId: randomUUID(),
    },
  };
}

export async function POST(request: NextRequest) {
  let requestItemId = '';
  let requestUserId = '';
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    requestUserId = userId;

    const body = await request.json() as { itemId?: string };
    requestItemId = body.itemId || '';
    if (!body.itemId) {
      return NextResponse.json({ success: false, message: '缺少素材 ID' }, { status: 400 });
    }

    const result = await marketManager.purchaseItem(body.itemId, userId);
    return NextResponse.json({ success: true, message: '购买成功', data: result });
  } catch (error) {
    console.error('[图市] 购买失败:', error);
    if (isDatabaseUnavailable(error) && isLocalPreviewRequest(request)) {
      if (requestItemId && requestUserId) {
        const previewResult = await purchaseLocalPreviewItem(requestItemId, requestUserId);
        if (previewResult) {
          if (previewResult.success) {
            console.warn('[图市] 本地数据库不可用，已写入 .cache/market-preview.json 预览购买:', error);
            return NextResponse.json({ success: true, message: '本地预览购买成功', data: previewResult.data, preview: true });
          }
          return NextResponse.json({ success: false, message: previewResult.message, preview: true }, { status: previewResult.status });
        }
      }
    }
    const { message, status } = getSafePurchaseError(error);
    return NextResponse.json(
      { success: false, message },
      { status }
    );
  }
}
