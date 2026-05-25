'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PointsIconLabel from '@/components/PointsIconLabel';
import { showToast } from '@/lib/toast';
import { calculateRechargePoints, RECHARGE_CHANNEL_LABELS, RECHARGE_PRESET_AMOUNTS, type RechargeChannel } from '@/lib/recharge';
import { toUserFacingErrorMessage } from '@/lib/userFacingError';

type RechargeOrder = {
  id: string;
  orderNumber: string;
  amountYuan: number;
  points: number;
  channel: RechargeChannel | null;
  channelLabel: string;
  status: string;
  remainingPoints: number;
  actualPoints: number;
  createdAt: string;
  qrPayload?: string | null;
  qrImageUrl?: string | null;
  pollSeconds?: number;
};

type RechargePanelProps = {
  onRechargeUpdated?: () => void | Promise<void>;
};

function formatTime(value?: string) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusClasses(status: string) {
  if (status === '成功') return 'border-green-400/35 bg-green-500/15 text-green-200';
  if (status === '失败') return 'border-red-400/35 bg-red-500/15 text-red-200';
  if (status === '超时') return 'border-yellow-400/35 bg-yellow-500/15 text-yellow-200';
  return 'border-blue-400/35 bg-blue-500/15 text-blue-200';
}

function isFinalStatus(status?: string) {
  return status === '成功' || status === '失败' || status === '超时';
}

export default function RechargePanel({ onRechargeUpdated }: RechargePanelProps) {
  const [amountYuan, setAmountYuan] = useState(30);
  const [channel, setChannel] = useState<RechargeChannel>('wechat');
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [currentOrder, setCurrentOrder] = useState<RechargeOrder | null>(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const rechargePoints = useMemo(() => calculateRechargePoints(amountYuan), [amountYuan]);
  const canCreateOrder = Number.isInteger(amountYuan) && amountYuan >= 1 && amountYuan <= 5000;

  const loadOrders = useCallback(async () => {
    try {
      setIsLoadingOrders(true);
      const response = await fetch('/api/recharge/orders', { credentials: 'include' });
      const result = await response.json() as { success?: boolean; data?: RechargeOrder[]; message?: string };

      if (!response.ok || !result.success) {
        showToast(toUserFacingErrorMessage(result.message, '加载充值订单失败'), 'error');
        return;
      }

      const nextOrders = Array.isArray(result.data) ? result.data : [];
      setOrders(nextOrders);
      setCurrentOrder((prev) => {
        if (prev && nextOrders.some((order) => order.orderNumber === prev.orderNumber)) {
          return nextOrders.find((order) => order.orderNumber === prev.orderNumber) || prev;
        }

        return nextOrders.find((order) => order.status === '待支付' || order.status === '处理中') || nextOrders[0] || null;
      });
    } catch (error) {
      console.error('[RechargePanel] 加载充值订单失败:', error);
      showToast('加载充值订单失败，请稍后重试', 'error');
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!currentOrder?.orderNumber || isFinalStatus(currentOrder.status)) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/recharge/orders?orderNumber=${encodeURIComponent(currentOrder.orderNumber)}`, {
          credentials: 'include',
        });
        const result = await response.json() as { success?: boolean; data?: RechargeOrder; message?: string };

        if (!response.ok || !result.success || !result.data) {
          return;
        }

        const nextOrder = result.data;
        setCurrentOrder(nextOrder);
        setOrders((prev) => prev.map((order) => order.orderNumber === nextOrder.orderNumber ? nextOrder : order));

        if (nextOrder.status === '成功') {
          showToast('充值已到账', 'success');
          await onRechargeUpdated?.();
        }
      } catch (error) {
        console.error('[RechargePanel] 轮询充值订单失败:', error);
      }
    }, Math.max((currentOrder.pollSeconds || 4) * 1000, 3000));

    return () => window.clearInterval(interval);
  }, [currentOrder?.orderNumber, currentOrder?.pollSeconds, currentOrder?.status, onRechargeUpdated]);

  const refreshCurrentOrder = async () => {
    if (!currentOrder?.orderNumber) return;

    try {
      const response = await fetch(`/api/recharge/orders?orderNumber=${encodeURIComponent(currentOrder.orderNumber)}`, {
        credentials: 'include',
      });
      const result = await response.json() as { success?: boolean; data?: RechargeOrder; message?: string };

      if (!response.ok || !result.success || !result.data) {
        showToast(toUserFacingErrorMessage(result.message, '刷新订单状态失败'), 'error');
        return;
      }

      setCurrentOrder(result.data);
      setOrders((prev) => prev.map((order) => order.orderNumber === result.data!.orderNumber ? result.data! : order));

      if (result.data.status === '成功') {
        showToast('充值已到账', 'success');
        await onRechargeUpdated?.();
      } else {
        showToast('订单状态已刷新', 'success');
      }
    } catch (error) {
      console.error('[RechargePanel] 刷新订单状态失败:', error);
      showToast('刷新订单状态失败，请稍后重试', 'error');
    }
  };

  const createOrder = async () => {
    if (!canCreateOrder) {
      showToast('请输入 1 - 5000 元的整数金额', 'error');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/recharge/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountYuan, channel }),
      });
      const result = await response.json() as { success?: boolean; data?: RechargeOrder; message?: string };

      if (!response.ok || !result.success || !result.data) {
        showToast(toUserFacingErrorMessage(result.message, '创建充值订单失败'), 'error');
        return;
      }

      setCurrentOrder(result.data);
      setOrders((prev) => [result.data!, ...prev.filter((order) => order.orderNumber !== result.data!.orderNumber)]);
      setIsPaymentOpen(true);
      showToast('请扫码完成支付', 'success');
    } catch (error) {
      console.error('[RechargePanel] 创建充值订单失败:', error);
      showToast('创建充值订单失败，请稍后重试', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.05] backdrop-blur-xl">
        <div className="px-4 py-4">
          <h3 className="text-xl font-semibold tracking-tight text-white">充值中心</h3>
          <p className="mt-1 text-sm leading-6 text-white/40">选择金额和支付方式，确认后扫码支付，成功后自动到账。</p>
        </div>

        <div className="mx-4 h-px bg-violet-300/10" />

        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <span className="text-sm text-white/44">本次到账</span>
          <PointsIconLabel points={rechargePoints} className="text-base font-semibold text-emerald-200" iconClassName="h-4 w-4" />
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.05] backdrop-blur-xl">
        <div className="flex items-end justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-base font-semibold text-white">选择金额</p>
            <p className="mt-1 text-sm text-white/36">1 元 = 40 积分</p>
          </div>
          <p className="text-xs text-white/30">1 - 5000 元</p>
        </div>

        <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-3">
          {RECHARGE_PRESET_AMOUNTS.map((amount) => {
            const selected = amountYuan === amount;

            return (
              <button
                key={amount}
                type="button"
                onClick={() => setAmountYuan(amount)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-violet-300/35 bg-violet-400/[0.16] shadow-sm shadow-violet-500/20' : 'border-violet-300/12 bg-violet-500/[0.04] hover:bg-violet-500/[0.09]'}`}
              >
                <span className="block text-xl font-semibold leading-none text-white">¥{amount}</span>
                <PointsIconLabel points={calculateRechargePoints(amount)} className="mt-2 text-sm text-emerald-200" iconClassName="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        <div className="mx-4 h-px bg-violet-300/10" />

        <label className="block px-4 py-3.5">
          <span className="block text-sm text-white/44">自定义金额</span>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-violet-300/12 bg-black/25 px-3 py-2.5">
            <span className="text-sm font-semibold text-white/50">¥</span>
            <input
              type="number"
              min={1}
              max={5000}
              step={1}
              value={amountYuan || ''}
              onChange={(event) => setAmountYuan(Number(event.target.value || 0))}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-white/24"
              placeholder="输入自定义金额"
              aria-label="自定义充值金额"
            />
          </div>
        </label>
      </section>

      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.05] backdrop-blur-xl">
        <div className="px-4 py-4">
          <p className="text-base font-semibold text-white">支付方式</p>
          <p className="mt-1 text-sm text-white/36">确认后打开扫码弹窗</p>
        </div>

        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
          {Object.entries(RECHARGE_CHANNEL_LABELS).map(([key, label]) => {
            const selected = channel === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setChannel(key as RechargeChannel)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-violet-300/35 bg-violet-400/[0.14] shadow-sm shadow-violet-500/20' : 'border-violet-300/12 bg-violet-500/[0.04] hover:bg-violet-500/[0.09]'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-white">{label}</span>
                    <span className="mt-1 block text-xs text-white/34">扫码支付</span>
                  </span>
                  <span className={`h-3 w-3 rounded-full ${selected ? 'bg-violet-200' : 'bg-white/18'}`} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="mx-4 h-px bg-violet-300/10" />

        <div className="space-y-2 px-4 py-3.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-white/44">支付金额</span>
            <span className="font-semibold text-white">¥{amountYuan || 0}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-white/44">到账积分</span>
            <PointsIconLabel points={rechargePoints} className="font-semibold text-emerald-200" iconClassName="h-4 w-4" />
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={() => void createOrder()}
        disabled={isCreating || !canCreateOrder}
        className="w-full rounded-[1.15rem] bg-gradient-to-r from-violet-500 to-blue-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isCreating ? '正在打开支付二维码...' : canCreateOrder ? `立即充值 ¥${amountYuan}` : '请输入充值金额'}
      </button>

      {currentOrder && !isFinalStatus(currentOrder.status) && (
        <button
          type="button"
          onClick={() => setIsPaymentOpen(true)}
          className="w-full rounded-[1.15rem] border border-violet-300/20 bg-violet-500/10 px-4 py-3 text-left text-sm text-violet-100 transition hover:bg-violet-500/16"
        >
          <span className="block font-semibold">继续支付待处理订单</span>
          <span className="mt-1 block truncate text-xs text-violet-100/60">{currentOrder.orderNumber}</span>
        </button>
      )}

      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.045] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">充值记录</h3>
            <p className="mt-1 text-sm text-white/36">默认收起</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadOrders()}
              className="rounded-full border border-violet-300/14 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-100 transition hover:bg-violet-500/[0.12] hover:text-white"
            >
              刷新
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              className="rounded-full border border-violet-300/14 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-100 transition hover:bg-violet-500/[0.12] hover:text-white"
            >
              {showHistory ? '收起' : '查看'}
            </button>
          </div>
        </div>

        {showHistory && (
          <div className="border-t border-violet-300/10">
            {isLoadingOrders ? (
              <div className="py-8 text-center text-sm text-white/42">加载中...</div>
            ) : orders.length === 0 ? (
              <div className="py-8 text-center text-sm text-white/42">暂无充值记录</div>
            ) : (
              <div>
                {orders.map((order, index) => (
                  <button
                    key={order.orderNumber}
                    type="button"
                    onClick={() => {
                      setCurrentOrder(order);
                      setIsPaymentOpen(true);
                    }}
                    className={`w-full px-4 py-3.5 text-left transition ${currentOrder?.orderNumber === order.orderNumber ? 'bg-violet-500/[0.12]' : 'hover:bg-violet-500/[0.06]'}`}
                  >
                    {index > 0 && <span className="mb-3 block h-px bg-violet-300/10" />}
                    <span className="flex flex-wrap items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">{order.channelLabel} ¥{order.amountYuan}</span>
                        <span className="mt-1 block text-xs text-white/34">{formatTime(order.createdAt)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <PointsIconLabel points={order.points} className="text-sm font-semibold text-emerald-200" iconClassName="h-3.5 w-3.5" />
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${getStatusClasses(order.status)}`}>{order.status}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {isPaymentOpen && currentOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
          onClick={() => setIsPaymentOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-violet-300/18 bg-[#0d0d17] p-5 shadow-2xl shadow-violet-950/40 md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-bold text-white">扫码支付</h3>
                <p className="mt-2 text-sm text-white/48">使用{currentOrder.channelLabel}扫描二维码完成支付</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPaymentOpen(false)}
                className="rounded-full border border-violet-300/14 bg-violet-500/[0.08] px-3 py-1.5 text-sm text-violet-100 transition-colors hover:bg-violet-500/[0.14] hover:text-white"
                aria-label="关闭支付弹窗"
              >
                关闭
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-violet-300/14 bg-violet-500/[0.05] p-4 text-center md:p-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-left">
                <div>
                  <p className="text-sm text-white/45">支付金额</p>
                  <p className="mt-1 text-2xl font-black text-white">¥{currentOrder.amountYuan}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${getStatusClasses(currentOrder.status)}`}>
                  {currentOrder.status}
                </span>
              </div>

              {currentOrder.qrImageUrl ? (
                <div className="rounded-3xl bg-white p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]">
                  <img src={currentOrder.qrImageUrl} alt="充值二维码" className="mx-auto h-56 w-56 md:h-60 md:w-60" />
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-violet-300/14 bg-black/24 text-sm text-white/38">
                  正在生成二维码
                </div>
              )}

              <div className="mt-4 grid gap-2 text-left text-xs text-white/50">
                <div className="flex justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2">
                  <span>到账积分</span>
                  <PointsIconLabel points={currentOrder.points} className="text-emerald-200" iconClassName="h-3.5 w-3.5" />
                </div>
                <div className="flex justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2">
                  <span>订单号</span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(currentOrder.orderNumber)}
                    className="max-w-[240px] truncate text-white/78 hover:text-white"
                    title="点击复制订单号"
                  >
                    {currentOrder.orderNumber}
                  </button>
                </div>
                <div className="flex justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2">
                  <span>创建时间</span>
                  <span className="text-white/78">{formatTime(currentOrder.createdAt)}</span>
                </div>
              </div>

              <p className="mt-4 text-xs leading-5 text-white/42">支付完成后请保持页面打开，系统会自动更新订单状态。</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void refreshCurrentOrder()}
                className="rounded-2xl border border-violet-300/14 bg-violet-500/[0.08] px-4 py-3 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/[0.14] hover:text-white"
              >
                已完成支付，刷新状态
              </button>
              <button
                type="button"
                onClick={() => setIsPaymentOpen(false)}
                className="rounded-2xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:brightness-110"
              >
                稍后再看
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
