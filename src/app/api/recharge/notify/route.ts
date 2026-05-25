import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getMysqlPool } from '@/storage/database';
import { RECHARGE_EXCHANGE_RATE, RECHARGE_TOOL_PAGE } from '@/lib/recharge';

type RechargeNotifyBody = {
  orderNumber?: string;
  tradeNo?: string;
  amountYuan?: number;
  paidPoints?: number;
  status?: string;
  channel?: string;
  paidAt?: string;
  raw?: unknown;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function getRequiredSecret() {
  return process.env.RECHARGE_CALLBACK_SECRET || process.env.RECHARGE_NOTIFY_SECRET || null;
}

function isSuccessStatus(status?: string) {
  return status === 'success' || status === 'paid' || status === 'SUCCESS' || status === 'SUCCESSFUL' || status === '成功';
}

type RechargeTransactionRow = RowDataPacket & {
  id: string;
  user_id: string;
  order_number: string;
  tool_page: string;
  description: string;
  points: number;
  actual_points: number;
  remaining_points: number;
  status: string;
  prompt: string | null;
  request_params: string | null;
  result_data: string | null;
  psd_url: string | null;
  uploaded_image: string | null;
  created_at: string;
};

type RechargeUserRow = RowDataPacket & {
  id: string;
  points: number;
};

function parseJsonObject(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function buildResultData(existing: string | null, payload: Record<string, unknown>) {
  const previous = parseJsonObject(existing);
  return JSON.stringify({
    ...(previous || {}),
    ...payload,
  });
}

export async function POST(request: NextRequest) {
  try {
    const secret = getRequiredSecret();
    if (!secret) {
      return NextResponse.json({ success: false, message: '未配置充值回调密钥' }, { status: 503 });
    }

    const providedSecret = request.headers.get('x-recharge-secret') || request.headers.get('x-callback-secret');
    if (providedSecret !== secret) {
      return NextResponse.json({ success: false, message: '无效的回调密钥' }, { status: 401 });
    }

    const body = await request.json() as RechargeNotifyBody;
    const orderNumber = body.orderNumber?.trim();
    if (!orderNumber) {
      return NextResponse.json({ success: false, message: '订单号不能为空' }, { status: 400 });
    }

    const pool = await getMysqlPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [transactionRows] = await connection.query<RechargeTransactionRow[]>(
        `SELECT id, user_id, order_number, tool_page, description, points, actual_points, remaining_points, status, prompt, request_params, result_data, psd_url, uploaded_image, created_at
         FROM transactions
         WHERE order_number = ?
         FOR UPDATE`,
        [orderNumber]
      );

      const transaction = transactionRows[0];
      if (!transaction || transaction.tool_page !== RECHARGE_TOOL_PAGE) {
        await connection.rollback();
        return NextResponse.json({ success: false, message: '充值订单不存在' }, { status: 404 });
      }

      if (transaction.status === '成功') {
        await connection.commit();
        return NextResponse.json({ success: true, message: '订单已处理', data: { orderNumber, status: '成功' } });
      }

      const nextStatus = isSuccessStatus(body.status)
        ? '成功'
        : body.status === 'failed' || body.status === 'FAIL'
          ? '失败'
          : '处理中';

      if (nextStatus !== '成功') {
        const nextResultData = buildResultData(transaction.result_data, {
          providerStatus: body.status || '处理中',
          tradeNo: body.tradeNo || '',
          paidAt: body.paidAt || '',
          raw: body.raw || null,
        });

        await connection.query<ResultSetHeader>(
          `UPDATE transactions
           SET status = ?, result_data = ?
           WHERE order_number = ?`,
          [nextStatus, nextResultData, orderNumber]
        );

        await connection.commit();
        return NextResponse.json({ success: true, message: '充值订单状态已更新', data: { orderNumber, status: nextStatus } });
      }

      const amountYuan = Number(body.amountYuan || 0);
      const paidPoints = Number(body.paidPoints || (amountYuan > 0 ? amountYuan * RECHARGE_EXCHANGE_RATE : transaction.points));

      const [userRows] = await connection.query<RechargeUserRow[]>(
        `SELECT id, points
         FROM users
         WHERE id = ?
         FOR UPDATE`,
        [transaction.user_id]
      );

      const user = userRows[0];
      if (!user) {
        await connection.rollback();
        return NextResponse.json({ success: false, message: '入账失败，用户不存在' }, { status: 404 });
      }

      const nextPoints = Number(user.points || 0) + paidPoints;
      await connection.query<ResultSetHeader>(
        `UPDATE users
         SET points = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [nextPoints, user.id]
      );

      const nextResultData = buildResultData(transaction.result_data, {
        providerStatus: body.status || 'success',
        tradeNo: body.tradeNo || '',
        paidAt: body.paidAt || new Date().toISOString(),
        channel: body.channel || '',
        paidPoints,
        raw: body.raw || null,
      });

      await connection.query<ResultSetHeader>(
        `UPDATE transactions
         SET status = ?, actual_points = ?, remaining_points = ?, result_data = ?
         WHERE order_number = ?`,
        ['成功', paidPoints, nextPoints, nextResultData, orderNumber]
      );

      await connection.commit();

    return NextResponse.json({
      success: true,
      message: '充值成功',
      data: {
        orderNumber,
        status: '成功',
        points: paidPoints,
        remainingPoints: nextPoints,
      },
    });
    } catch (innerError) {
      await connection.rollback();
      throw innerError;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('[RechargeNotify] 处理失败:', error);
    return NextResponse.json(
      { success: false, message: `充值回调处理失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
