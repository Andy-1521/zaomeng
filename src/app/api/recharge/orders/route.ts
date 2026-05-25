import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { transactionManager, userManager } from '@/storage/database';
import { calculateRechargePoints, RECHARGE_CHANNEL_LABELS, RECHARGE_EXCHANGE_RATE, RECHARGE_TOOL_PAGE, normalizeRechargeChannel, type RechargeChannel } from '@/lib/recharge';

const MIN_RECHARGE_AMOUNT = 1;
const MAX_RECHARGE_AMOUNT = 5000;
const POLL_SECONDS = 4;

type RechargeRequestParams = {
  kind?: 'recharge-order';
  amountYuan?: number;
  exchangeRate?: number;
  channel?: RechargeChannel;
  channelLabel?: string;
  points?: number;
  qrPayload?: string;
  qrImageUrl?: string | null;
  provider?: string;
  createdAt?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return null;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: unknown };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch (error) {
    console.error('[RechargeOrders] 解析 user cookie 失败:', error);
    return null;
  }
}

function generateRechargeOrderNumber() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `RC${timestamp}${random}`;
}

function parseRequestParams(raw: string | null): RechargeRequestParams | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RechargeRequestParams;
    }
  } catch {
    return null;
  }

  return null;
}

function getRechargeOrderPayload(orderNumber: string, channel: RechargeChannel, amountYuan: number) {
  return JSON.stringify({
    kind: 'recharge-order',
    orderNumber,
    channel,
    amountYuan,
    exchangeRate: RECHARGE_EXCHANGE_RATE,
    points: calculateRechargePoints(amountYuan),
  });
}

function getConfiguredQrUrl(channel: RechargeChannel) {
  const channelKey = channel === 'wechat' ? 'WECHAT' : 'ALIPAY';
  return process.env[`RECHARGE_${channelKey}_QR_URL`]
    || process.env[`NEXT_PUBLIC_RECHARGE_${channelKey}_QR_URL`]
    || process.env.RECHARGE_QR_URL
    || process.env.NEXT_PUBLIC_RECHARGE_QR_URL
    || null;
}

async function buildQrImageUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: {
      dark: '#111111',
      light: '#ffffff',
    },
  });
}

function toRechargeTransaction(transaction: Awaited<ReturnType<typeof transactionManager.getTransactionByOrderNumber>>) {
  if (!transaction) return null;

  const params = parseRequestParams(transaction.requestParams);
  const points = params?.points ?? transaction.points;
  const amountYuan = params?.amountYuan ?? Math.round(points / RECHARGE_EXCHANGE_RATE);
  const channel = normalizeRechargeChannel(params?.channel);

  return {
    id: transaction.id,
    orderNumber: transaction.orderNumber,
    toolPage: transaction.toolPage,
    description: transaction.description,
    amountYuan,
    points,
    channel,
    channelLabel: channel ? RECHARGE_CHANNEL_LABELS[channel] : '充值',
    status: transaction.status,
    remainingPoints: transaction.remainingPoints,
    actualPoints: transaction.actualPoints,
    createdAt: transaction.createdAt,
    pollSeconds: POLL_SECONDS,
    qrPayload: params?.qrPayload ?? null,
    qrImageUrl: params?.qrImageUrl ?? null,
    requestParams: params,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('orderNumber');

    if (orderNumber) {
      const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);

      if (!transaction || transaction.userId !== userId || transaction.toolPage !== RECHARGE_TOOL_PAGE) {
        return NextResponse.json({ success: false, message: '充值订单不存在' }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: toRechargeTransaction(transaction) });
    }

    const transactions = await transactionManager.getAllTransactions(0, 50, {
      userId,
      toolPage: RECHARGE_TOOL_PAGE,
    });
    const rechargeOrders = transactions
      .map((transaction) => toRechargeTransaction(transaction))
      .filter((item): item is NonNullable<ReturnType<typeof toRechargeTransaction>> => Boolean(item));

    return NextResponse.json({ success: true, data: rechargeOrders });
  } catch (error) {
    console.error('[RechargeOrders] 查询失败:', error);
    return NextResponse.json(
      { success: false, message: `查询充值订单失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json() as {
      amountYuan?: number;
      channel?: unknown;
    };

    const amountYuan = Number(body.amountYuan);
    const channel = normalizeRechargeChannel(body.channel);

    if (!Number.isInteger(amountYuan) || amountYuan < MIN_RECHARGE_AMOUNT || amountYuan > MAX_RECHARGE_AMOUNT) {
      return NextResponse.json(
        { success: false, message: `充值金额需为 ${MIN_RECHARGE_AMOUNT} - ${MAX_RECHARGE_AMOUNT} 元的整数` },
        { status: 400 }
      );
    }

    if (!channel) {
      return NextResponse.json({ success: false, message: '请选择支付方式' }, { status: 400 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    const points = calculateRechargePoints(amountYuan);
    const orderNumber = generateRechargeOrderNumber();
    const qrPayload = getRechargeOrderPayload(orderNumber, channel, amountYuan);
    const qrImageUrl = await buildQrImageUrl(qrPayload);
    const channelLabel = RECHARGE_CHANNEL_LABELS[channel];
    const configuredQrUrl = getConfiguredQrUrl(channel);
    const responseQrImageUrl = configuredQrUrl || qrImageUrl;

    const requestParams: RechargeRequestParams = {
      kind: 'recharge-order',
      amountYuan,
      exchangeRate: RECHARGE_EXCHANGE_RATE,
      channel,
      channelLabel,
      points,
      qrPayload,
      qrImageUrl: responseQrImageUrl,
      provider: configuredQrUrl ? 'config' : 'qrcode',
      createdAt: new Date().toISOString(),
    };

    const transaction = await transactionManager.createTransaction({
      userId,
      orderNumber,
      toolPage: RECHARGE_TOOL_PAGE,
      description: `${channelLabel}充值 ${amountYuan} 元`,
      points,
      actualPoints: 0,
      remainingPoints: user.points || 0,
      status: '待支付',
      prompt: `${channelLabel}充值 ${amountYuan} 元`,
      requestParams: JSON.stringify(requestParams),
      resultData: JSON.stringify({ qrPayload, qrImageUrl: responseQrImageUrl, status: '待支付' }),
    });

    return NextResponse.json({
      success: true,
      message: '充值订单已创建',
      data: {
        ...toRechargeTransaction(transaction)!,
        qrImageUrl: responseQrImageUrl,
        qrPayload,
        pollSeconds: POLL_SECONDS,
      },
    });
  } catch (error) {
    console.error('[RechargeOrders] 创建失败:', error);
    return NextResponse.json(
      { success: false, message: `创建充值订单失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
