export const RECHARGE_TOOL_PAGE = '积分充值';
export const RECHARGE_EXCHANGE_RATE = 40;
export const RECHARGE_PRESET_AMOUNTS = [10, 30, 50, 100, 200, 500] as const;

export const RECHARGE_CHANNEL_LABELS = {
  wechat: '微信支付',
  alipay: '支付宝',
} as const;

export type RechargeChannel = keyof typeof RECHARGE_CHANNEL_LABELS;

export function isRechargeTransaction(toolPage?: string | null) {
  return toolPage === RECHARGE_TOOL_PAGE;
}

export function normalizeRechargeChannel(value: unknown): RechargeChannel | null {
  if (value === 'wechat' || value === 'alipay') {
    return value;
  }

  return null;
}

export function calculateRechargePoints(amountYuan: number) {
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    return 0;
  }

  return Math.round(amountYuan * RECHARGE_EXCHANGE_RATE);
}
