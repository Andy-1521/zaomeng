import { NextRequest, NextResponse } from 'next/server';
import { transactionManager } from '@/storage/database';
import { reconcileProcessingTransactions } from '@/lib/reconcileProcessingTransactions';
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS';
import { getCookieUserId } from '@/lib/serverAuth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

type ResultDataObject = {
  imageUrl?: string;
  image_url?: string;
  result_image_url?: string;
  [key: string]: unknown;
};

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

function shouldUseProxyThumbnail(transaction: { orderNumber?: string | null; toolPage?: string | null; description?: string | null }) {
  return Boolean(
    transaction.orderNumber?.startsWith('HDO-')
    || transaction.orderNumber?.startsWith('HD-')
    || transaction.orderNumber?.startsWith('RB-')
    || transaction.toolPage === '高清+扩图'
    || transaction.toolPage === '高清放大'
    || transaction.toolPage === '移除背景'
    || transaction.description?.includes('高清+扩图')
    || transaction.description?.includes('高清放大')
    || transaction.description?.includes('移除背景')
  );
}

function buildProxyThumbnailUrl(imageUrl: string, size: number) {
  return `/api/image/thumbnail-proxy?url=${encodeURIComponent(imageUrl)}&size=${size}`;
}

function buildPersistedProxyThumbnailUrl(imageUrl: string, size: number, orderNumber?: string | null) {
  const orderPart = orderNumber ? `&orderNumber=${encodeURIComponent(orderNumber)}` : '';
  return `${buildProxyThumbnailUrl(imageUrl, size)}${orderPart}`;
}

function extractThumbnailUrls(requestParams: unknown) {
  if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) return [];
  const params = requestParams as RequestParamsObject;
  const rawUrls = Array.isArray(params.thumbnailUrls) ? params.thumbnailUrls : [params.thumbnailUrl];
  return rawUrls.filter((url): url is string => typeof url === 'string' && url.startsWith('http'));
}

function isSmartEditTransaction(toolPage?: string | null, description?: string | null, orderNumber?: string | null) {
  return toolPage === '智能改图'
    || toolPage === '局部改图'
    || description?.includes('智能改图')
    || description?.includes('局部改图')
    || orderNumber?.startsWith('LCL-');
}

function sanitizeSmartEditRequestParams(params: unknown) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;

  const source = params as RequestParamsObject;
  return {
    toolPage: '智能改图',
    imageUrl: source.imageUrl,
    uploadedImage: source.uploadedImage,
    mode: source.mode,
    userInstruction: source.userInstruction,
    summary: source.summary || source.promptSummary,
    regionCount: source.regionCount,
  };
}

/**
 * 获取用户消费记录接口
 *
 * 功能说明：
 * - 根据 userId 获取用户的消费记录
 * - 支持多种获取用户ID的方式：cookie、查询参数、请求体
 * - 返回订单编号、工具页、消费积分、剩余积分、消费时间、提示词、请求参数、结果数据等信息
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const cookieUserId = getCookieUserId(request);
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 200);
    const cursor = searchParams.get('cursor'); // 游标分页：上一页最后一条的 createdAt

    if (!cookieUserId) {
      return NextResponse.json(
        { success: false, message: '未登录' },
        { status: 401 }
      );
    }

    if (requestedUserId && requestedUserId !== cookieUserId) {
      return NextResponse.json(
        { success: false, message: '无权限访问其他用户的消费记录' },
        { status: 403 }
      );
    }

    // 获取用户消费记录（支持游标分页）
    const transactions = await transactionManager.getUserTransactions(cookieUserId, limit, cursor);
    const reconciledTransactions = await reconcileProcessingTransactions(transactions, {
      logPrefix: 'API/Transactions',
    });

    // 格式化返回数据 - 一次性解析，避免前端重复解析
    const formattedTransactions = await Promise.all(reconciledTransactions.map(async (trans) => {
      // 解析 resultData（可能是 JSON 字符串，也可能是普通字符串）
      let resultData: unknown = null;
      if (trans.resultData) {
        try {
          const parsed: unknown = JSON.parse(trans.resultData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            resultData = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            const parsedObject = parsed as ResultDataObject;
            resultData = parsedObject.imageUrl || parsedObject.image_url || parsedObject.result_image_url || parsedObject;
          } else {
            resultData = parsed;
          }
        } catch {
          resultData = trans.resultData;
        }
      }

      // 解析 requestParams（JSON 字符串）
      let requestParams = null;
      try {
        requestParams = trans.requestParams ? JSON.parse(trans.requestParams) : null;
      } catch {
        // 忽略解析失败
      }

      const isSmartEdit = isSmartEditTransaction(trans.toolPage, trans.description, trans.orderNumber);
      const resultImageUrls = extractImageUrls(resultData);
      const savedThumbnailUrls = extractThumbnailUrls(requestParams);
      const useProxy = shouldUseProxyThumbnail(trans);
      const thumbnailUrls = savedThumbnailUrls.length > 0
        ? savedThumbnailUrls
        : useProxy
          ? resultImageUrls.map((imageUrl) => buildPersistedProxyThumbnailUrl(imageUrl, 256, trans.orderNumber))
          : await Promise.all(resultImageUrls.map((imageUrl) => getAliyunOSSThumbnailUrlFromUrl(imageUrl, 256).catch(() => null)));

      return {
        id: trans.id,
        orderNumber: trans.orderNumber,
        toolPage: trans.toolPage,
        description: trans.description || trans.toolPage || '未知',
        points: trans.points || 0,
        actualPoints: trans.actualPoints ?? 0,
        remainingPoints: trans.remainingPoints || 0,
        time: trans.createdAt,
        status: trans.status || '未知',
        prompt: isSmartEdit ? '' : trans.prompt || '',
        requestParams: isSmartEdit ? sanitizeSmartEditRequestParams(requestParams) : requestParams,
        resultData,
        thumbnailUrls: thumbnailUrls.map((thumbnailUrl) => thumbnailUrl || ''),
        psdUrl: trans.psdUrl || '',
        uploadedImage: trans.uploadedImage || '',
      };
    }));

    // 返回数据 + 分页游标
    const lastItem = reconciledTransactions[reconciledTransactions.length - 1];
    const nextCursor = reconciledTransactions.length >= limit && lastItem?.createdAt
      ? lastItem.createdAt
      : null;

    return NextResponse.json({
      success: true,
      data: formattedTransactions,
      nextCursor,
    });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    console.error('[API/Transactions] 请求失败:', errorMessage);
    return NextResponse.json(
      { success: false, message: `获取消费记录失败: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * 创建消费记录接口
 *
 * 安全说明：该通用扣积分接口曾接受客户端传入 userId/points，容易被用于盗刷积分。
 * 生产业务应使用各工具自己的接口完成：登录校验、订单创建、积分预扣、失败退款。
 */
export async function POST() {
  return NextResponse.json(
    { success: false, message: '通用扣积分接口已禁用，请使用具体工具接口' },
    { status: 403 }
  );
}
