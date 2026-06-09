import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getDb } from '@/storage/database/client';
import { transactions } from '@/storage/database/shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { reconcileProcessingTransactions } from '@/lib/reconcileProcessingTransactions';
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS';
import { getCookieUserId } from '@/lib/serverAuth';


function isLocalPreviewRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isLocalWorkspace = process.cwd().startsWith('/Users/andy/Documents/zaomeng/');
  return isLocalHost && isLocalWorkspace;
}

type LocalMarketPreviewItem = {
  id?: unknown;
  sourceOrderNumber?: unknown;
  sourceImageUrl?: unknown;
  previewImageUrl?: unknown;
  thumbnailUrl?: unknown;
  title?: unknown;
  description?: unknown;
  pricePoints?: unknown;
  createdAt?: unknown;
  psdUrl?: unknown;
};

function normalizeLocalPreviewOrder(item: LocalMarketPreviewItem, index: number, userId: string) {
  const sourceOrderNumber = typeof item.sourceOrderNumber === 'string' && item.sourceOrderNumber.trim()
    ? item.sourceOrderNumber.trim()
    : `LOCAL-PREVIEW-${index + 1}`;
  const imageUrl = typeof item.sourceImageUrl === 'string' && item.sourceImageUrl.trim()
    ? item.sourceImageUrl.trim()
    : typeof item.previewImageUrl === 'string' ? item.previewImageUrl.trim() : '';
  if (!imageUrl) return null;

  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date(Date.now() - index * 60000).toISOString();
  const thumbnailUrl = typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : '';
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `本地预览订单 ${index + 1}`;
  const points = typeof item.pricePoints === 'number' && Number.isFinite(item.pricePoints) ? item.pricePoints : 0;

  return {
    id: typeof item.id === 'string' ? `local-order-${item.id}` : `local-order-${sourceOrderNumber}`,
    userId,
    orderNumber: sourceOrderNumber,
    toolPage: '彩绘提取',
    description: title,
    points,
    actualPoints: points,
    remainingPoints: 0,
    status: '成功',
    prompt: typeof item.description === 'string' ? item.description : '本地只读订单预览',
    requestParams: thumbnailUrl ? JSON.stringify({ thumbnailUrl }) : null,
    resultData: imageUrl,
    psdUrl: typeof item.psdUrl === 'string' ? item.psdUrl : null,
    uploadedImage: null,
    createdAt,
    thumbnailUrls: thumbnailUrl ? [thumbnailUrl] : [],
  };
}

async function loadLocalOrderPreview(userId: string, limit: number) {
  try {
    const filePath = join(process.cwd(), '.cache', 'market-preview.json');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as LocalMarketPreviewItem[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item, index) => normalizeLocalPreviewOrder(item, index, userId))
      .filter((item): item is NonNullable<ReturnType<typeof normalizeLocalPreviewOrder>> => Boolean(item))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);
  } catch {
    return null;
  }
}

type RequestParamsObject = {
  thumbnailUrl?: unknown;
  thumbnailUrls?: unknown;
  [key: string]: unknown;
};

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
  if (Array.isArray(value)) {
    return value.flatMap(extractImageUrls);
  }
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

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function shouldUseProxyThumbnail(order: { orderNumber?: string | null; toolPage?: string | null; description?: string | null }) {
  return Boolean(
    order.orderNumber?.startsWith('HDO-')
    || order.orderNumber?.startsWith('HD-')
    || order.orderNumber?.startsWith('RB-')
    || order.toolPage === '高清+扩图'
    || order.toolPage === '高清放大'
    || order.toolPage === '移除背景'
    || order.description?.includes('高清+扩图')
    || order.description?.includes('高清放大')
    || order.description?.includes('移除背景')
  );
}

function buildProxyThumbnailUrl(imageUrl: string, size: number) {
  return `/api/image/thumbnail-proxy?url=${encodeURIComponent(imageUrl)}&size=${size}`;
}

function buildPersistedProxyThumbnailUrl(imageUrl: string, size: number, orderNumber?: string | null) {
  const orderPart = orderNumber ? `&orderNumber=${encodeURIComponent(orderNumber)}` : '';
  return `${buildProxyThumbnailUrl(imageUrl, size)}${orderPart}`;
}

function parseRequestParams(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractThumbnailUrls(requestParams: unknown) {
  if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) return [];
  const params = requestParams as RequestParamsObject;
  const rawUrls = Array.isArray(params.thumbnailUrls) ? params.thumbnailUrls : [params.thumbnailUrl];
  return rawUrls.filter((url): url is string => typeof url === 'string' && url.startsWith('http'));
}

/**
 * GET /api/task/orders
 *
 * 查询用户的订单记录
 *
 * 查询参数：
 * - userId: 用户ID（必需）
 * - toolPage: 工具页面名称（可选，如"彩绘提取"、"去除水印"等）
 *
 * 返回：
 * - success: 是否成功
 * - data: 订单列表
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = clampInteger(searchParams.get('limit'), 120, 20, 200);

  try {
    const requestedUserId = searchParams.get('userId');
    const toolPage = searchParams.get('toolPage');
    const cookieUserId = getCookieUserId(request);

    if (!cookieUserId) {
      return NextResponse.json(
        {
          success: false,
          message: '未登录',
        },
        { status: 401 }
      );
    }

    const userId = requestedUserId || cookieUserId;

    if (requestedUserId && requestedUserId !== cookieUserId) {
      return NextResponse.json(
        {
          success: false,
          message: '无权限访问其他用户订单',
        },
        { status: 403 }
      );
    }

    const db = await getDb();

    // 构建查询条件
    const conditions = [eq(transactions.userId, userId)];

    if (toolPage) {
      // 兼容"彩绘提取"和"彩绘提取2"
      if (toolPage === '彩绘提取') {
        conditions.push(sql`(${transactions.toolPage} = ${toolPage} OR ${transactions.toolPage} = '彩绘提取2')`);
      } else if (toolPage === '智能改图') {
        conditions.push(sql`(${transactions.toolPage} = ${toolPage} OR ${transactions.toolPage} = '局部改图')`);
      } else {
        conditions.push(eq(transactions.toolPage, toolPage));
      }
    }

    const orders = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(limit);

    const visibleOrders = orders.filter((order) => order.toolPage !== '积分充值');

    const reconciledOrders = await reconcileProcessingTransactions(visibleOrders, {
      logPrefix: '订单查询',
    });

    const data = await Promise.all(reconciledOrders.map(async (order) => {
      const resultImageUrls = extractImageUrls(order.resultData);
      const savedThumbnailUrls = extractThumbnailUrls(parseRequestParams(order.requestParams));
      const useProxy = shouldUseProxyThumbnail(order);
      const thumbnailUrls = savedThumbnailUrls.length > 0
        ? savedThumbnailUrls
        : useProxy
          ? resultImageUrls.map((imageUrl) => buildPersistedProxyThumbnailUrl(imageUrl, 512, order.orderNumber))
          : await Promise.all(resultImageUrls.map((imageUrl) => getAliyunOSSThumbnailUrlFromUrl(imageUrl, 512).catch(() => null)));
      const resolvedThumbnailUrls = thumbnailUrls.map((thumbnailUrl) => thumbnailUrl || '');
      return resolvedThumbnailUrls.some(Boolean) ? { ...order, thumbnailUrls: resolvedThumbnailUrls } : order;
    }));

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[订单查询] 查询失败:', error);
    if (process.env.NODE_ENV !== 'production' || isLocalPreviewRequest(request)) {
      const cookieUserId = getCookieUserId(request);
      const previewOrders = cookieUserId && isLocalPreviewRequest(request)
        ? await loadLocalOrderPreview(cookieUserId, limit)
        : null;

      return NextResponse.json({
        success: true,
        data: previewOrders || [],
        preview: true,
        message: previewOrders ? '本地使用生产只读订单缓存预览' : '本地数据库暂不可用，已返回空订单预览',
      });
    }

    return NextResponse.json(
      {
        success: false,
        message: '查询订单记录失败',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
