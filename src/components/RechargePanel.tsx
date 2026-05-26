'use client';

import { useState } from 'react';
import Image from 'next/image';
import { showToast } from '@/lib/toast';
import { toUserFacingErrorMessage } from '@/lib/userFacingError';

type RechargePanelProps = {
  onRechargeUpdated?: () => void | Promise<void>;
};

export default function RechargePanel({ onRechargeUpdated }: RechargePanelProps) {
  const [code, setCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  const redeemCode = async () => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      showToast('请输入兑换码', 'error');
      return;
    }

    setIsRedeeming(true);
    try {
      const response = await fetch('/api/recharge/redeem', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const result = await response.json() as {
        success?: boolean;
        message?: string;
        data?: { points?: number; remainingPoints?: number };
      };

      if (!response.ok || !result.success) {
        showToast(toUserFacingErrorMessage(result.message, '兑换失败，请稍后重试'), 'error');
        return;
      }

      setCode('');
      showToast(`兑换成功，已到账 ${result.data?.points || 0} 积分`, 'success');
      await onRechargeUpdated?.();
    } catch (error) {
      console.error('[RechargePanel] 兑换码兑换失败:', error);
      showToast('兑换失败，请稍后重试', 'error');
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.05] backdrop-blur-xl">
        <div className="px-4 py-4">
          <h3 className="text-xl font-semibold tracking-tight text-white">积分兑换码</h3>
          <p className="mt-1 text-sm leading-6 text-white/40">当前自动支付暂未开放，请联系管理员获取兑换码后在这里兑换积分。</p>
        </div>

        <div className="mx-4 h-px bg-violet-300/10" />

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-[160px_1fr]">
          <div className="rounded-2xl border border-white/12 bg-white p-2">
            <Image
              src="/assets/recharge-admin-wechat.jpg"
              alt="管理员微信二维码"
              width={320}
              height={320}
              className="aspect-square w-full rounded-xl object-cover"
              priority={false}
            />
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-3">
            <div>
              <p className="text-sm text-white/42">管理员微信</p>
              <p className="mt-1 text-lg font-semibold text-white">Kzai-1224</p>
            </div>
            <p className="text-sm leading-6 text-white/48">添加管理员后说明需要兑换的积分额度，管理员确认后会给你一串兑换码。</p>
            <div className="rounded-2xl border border-amber-300/18 bg-amber-400/[0.08] px-3 py-2 text-sm text-amber-100">
              兑换码只可使用一次，请勿转发给他人。
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.05] backdrop-blur-xl">
        <div className="px-4 py-4">
          <p className="text-base font-semibold text-white">输入兑换码</p>
          <p className="mt-1 text-sm text-white/36">兑换成功后积分会立即到账。</p>
        </div>

        <div className="mx-4 h-px bg-violet-300/10" />

        <div className="space-y-3 px-4 py-4">
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void redeemCode();
              }
            }}
            placeholder="请输入管理员提供的兑换码"
            className="w-full rounded-xl border border-violet-300/12 bg-black/25 px-3 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-white/24 focus:border-violet-300/30"
          />

          <button
            type="button"
            onClick={() => void redeemCode()}
            disabled={isRedeeming || !code.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-[1.1rem] bg-gradient-to-r from-violet-500 to-blue-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRedeeming ? '兑换中...' : '立即兑换'}
          </button>
        </div>
      </section>

      <section className="rounded-[1.4rem] border border-violet-300/14 bg-violet-500/[0.04] px-4 py-4 text-sm text-white/46">
        兑换记录会显示在积分明细中，到账积分会同步到顶部余额。
      </section>
    </div>
  );
}
