"use client";

import { useState, useEffect, type ChangeEvent, type ReactNode } from "react";
import Image, { type ImageLoaderProps, type ImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import PointsIconLabel from "@/components/PointsIconLabel";
import RechargePanel from "@/components/RechargePanel";
import { useUser } from "@/contexts/UserContext";
import { isRechargeTransaction } from "@/lib/recharge";
import { toUserFacingErrorMessage } from "@/lib/userFacingError";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface Transaction {
  id: string;
  orderNumber: string;
  toolPage?: string;
  description: string;
  points: number;
  actualPoints?: number;
  remainingPoints: number;
  time: number;
  status: string;
  prompt: string;
  requestParams: JsonValue;
  resultData: JsonValue;
}

type ProfileTab = "info" | "security" | "transactions" | "recharge";
type TransactionFilter = "all" | "recharge" | "usage" | "pending" | "success";

const PROFILE_TABS: Array<{ key: ProfileTab; label: string }> = [
  { key: "info", label: "资料" },
  { key: "security", label: "安全" },
  { key: "transactions", label: "明细" },
  { key: "recharge", label: "兑换" },
];

const TRANSACTION_FILTERS: Array<{ key: TransactionFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "recharge", label: "兑换" },
  { key: "usage", label: "消费" },
  { key: "pending", label: "待支付" },
  { key: "success", label: "成功" },
];

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function SafeImage({ alt, ...props }: Omit<ImageProps, "loader">) {
  return (
    <Image {...props} alt={alt} loader={passthroughImageLoader} unoptimized />
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, isLoading, refreshUser } = useUser();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>("info");
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const [transactionFilter, setTransactionFilter] =
    useState<TransactionFilter>("all");

  // 表单状态
  const [editUsername, setEditUsername] = useState("");
  const [showEditUsername, setShowEditUsername] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const userId = user?.id;
  const username = user?.username || "";

  // 错误和成功消息
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (
      tab === "info" ||
      tab === "security" ||
      tab === "transactions" ||
      tab === "recharge"
    ) {
      setActiveTab(tab);
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) {
      router.prefetch("/admin/generations");
    }
  }, [router, user?.isAdmin]);

  // 获取用户信息和积分明细
  useEffect(() => {
    if (isLoading) return;
    if (!userId) {
      router.push("/login?next=/profile");
      return;
    }

    const fetchData = async () => {
      try {
        // 刷新用户信息
        await refreshUser();

        // 获取积分明细
        const transResponse = await fetch(
          `/api/user/transactions?userId=${userId}`,
        );
        const transResult = await transResponse.json();

        if (transResult.success) {
          setTransactions(transResult.data);
        }

        setEditUsername(username);
      } catch (error) {
        console.error("获取用户信息失败:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [isLoading, refreshUser, router, userId]);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleTabChange = (tab: ProfileTab) => {
    setActiveTab(tab);
    const url = tab === "info" ? "/profile" : `/profile?tab=${tab}`;
    window.history.replaceState(null, "", url);
  };

  const refreshTransactions = async () => {
    if (!user?.id) return;

    try {
      const transResponse = await fetch(
        `/api/user/transactions?userId=${user.id}`,
        { credentials: "include" },
      );
      const transResult = await transResponse.json();

      if (transResult.success) {
        setTransactions(transResult.data);
      }
    } catch (error) {
      console.error("[Profile] 刷新积分明细失败:", error);
    }
  };

  const filteredTransactions = transactions.filter((trans) => {
    if (transactionFilter === "all") return true;

    if (transactionFilter === "recharge") {
      return isRechargeTransaction(trans.toolPage);
    }

    if (transactionFilter === "usage") {
      return !isRechargeTransaction(trans.toolPage);
    }

    if (transactionFilter === "pending") {
      return trans.status === "待支付" || trans.status === "处理中";
    }

    return trans.status === "成功";
  });

  // 获取状态标签
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { className: string; icon: ReactNode }> =
      {
        处理中: {
          className: "bg-violet-500/20 text-violet-100",
          icon: (
            <svg
              className="w-3 h-3 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ),
        },
        待支付: {
          className: "bg-violet-500/20 text-violet-100",
          icon: (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ),
        },
        成功: {
          className: "bg-green-500/20 text-green-300",
          icon: (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ),
        },
        失败: {
          className: "bg-red-500/20 text-red-300",
          icon: (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ),
        },
        超时: {
          className: "bg-yellow-500/20 text-yellow-300",
          icon: (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ),
        },
      };

    // 如果状态不在配置中，使用默认的失败样式
    const config = statusConfig[status] || statusConfig["失败"];
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.className}`}
      >
        {config.icon}
        <span>{status}</span>
      </div>
    );
  };

  // 格式化时间
  const formatTime = (time: number | string) => {
    try {
      const date = new Date(typeof time === "number" ? time : time);
      return date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(time);
    }
  };

  const formatUserId = (id?: string | null) => {
    if (!id) return "-";
    if (id.length <= 14) return id;
    return `${id.slice(0, 6)}...${id.slice(-6)}`;
  };

  const copyText = async (value?: string | null) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 2000);
    } catch (error) {
      console.error("复制失败:", error);
      showMessage("error", "复制失败，请手动复制");
    }
  };

  // 处理用户名修改
  const handleUpdateUsername = async () => {
    if (!user || !editUsername.trim()) {
      showMessage("error", "用户名不能为空");
      return;
    }

    try {
      const response = await fetch("/api/user/update-username", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          newUsername: editUsername.trim(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        setUser({ ...user!, username: result.data.username });
        showMessage("success", "用户名修改成功");
        setShowEditUsername(false);
      } else {
        showMessage(
          "error",
          toUserFacingErrorMessage(result.message, "修改失败，请稍后重试"),
        );
      }
    } catch {
      showMessage("error", "修改失败，请稍后重试");
    }
  };

  // 处理密码修改
  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      showMessage("error", "新密码至少6位");
      return;
    }

    if (newPassword !== confirmPassword) {
      showMessage("error", "两次密码不一致");
      return;
    }

    try {
      const response = await fetch("/api/user/update-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user!.id,
          oldPassword,
          newPassword,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showMessage("success", "密码修改成功");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        showMessage(
          "error",
          toUserFacingErrorMessage(result.message, "修改失败，请稍后重试"),
        );
      }
    } catch {
      showMessage("error", "修改失败，请稍后重试");
    }
  };

  // 处理头像修改
  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      showMessage("error", "仅支持 JPG、PNG、GIF、WEBP 格式的图片");
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showMessage("error", "图片大小不能超过 5MB");
      return;
    }

    const formData = new FormData();
    formData.append("userId", user!.id);
    formData.append("file", file);

    try {
      const response = await fetch("/api/user/update-avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setUser({ ...user!, avatar: result.data.avatar });
        showMessage("success", "头像修改成功");
      } else {
        showMessage(
          "error",
          toUserFacingErrorMessage(result.message, "修改失败，请稍后重试"),
        );
      }
    } catch {
      showMessage("error", "修改失败，请稍后重试");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="rounded-full border border-violet-300/18 bg-violet-500/[0.08] px-5 py-3 text-sm text-violet-100 shadow-2xl shadow-violet-950/30 backdrop-blur-xl">
          个人中心加载中...
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="zaomeng-page-shell">
      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
          <div className="mb-4 flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/30">
                Profile
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
                个人中心
              </h1>
            </div>
            <button
              type="button"
              onClick={() => handleTabChange("recharge")}
              className="zaomeng-ghost-button rounded-full px-3 py-2 text-sm"
            >
              <PointsIconLabel
                points={user.points || 0}
                className="font-semibold text-yellow-200"
                iconClassName="h-4 w-4"
              />
            </button>
          </div>

          {/* 消息提示 */}
          {message && (
            <div
              className={`mb-6 rounded-2xl p-4 backdrop-blur-xl ${message.type === "success" ? "border border-emerald-400/24 bg-emerald-500/12 text-emerald-200" : "border border-rose-400/24 bg-rose-500/12 text-rose-200"}`}
            >
              {message.text}
            </div>
          )}

          {/* 复制成功提示 */}
          {showCopySuccess && (
            <div className="zaomeng-glass-panel fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl px-6 py-3 text-sm text-white">
              ✓ 编号已复制
            </div>
          )}

          <div className="zaomeng-soft-panel mb-5 rounded-full p-1">
            <div className="grid grid-cols-4 gap-1">
              {PROFILE_TABS.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={`rounded-full px-3 py-2 text-center text-sm font-medium transition ${
                    activeTab === tab.key
                      ? "bg-white/16 text-white shadow-sm shadow-black/20"
                      : "text-white/48 hover:bg-white/[0.08] hover:text-white/85"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === "info" && (
            <div className="space-y-5">
              <section className="zaomeng-glass-panel overflow-hidden rounded-[1.4rem]">
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.05]">
                  <div className="relative h-12 w-12 shrink-0">
                    <SafeImage
                      src={user.avatar || "/images/avatar.png"}
                      alt="用户头像"
                      fill
                      sizes="48px"
                      className="rounded-2xl object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">头像</p>
                    <p className="text-xs text-white/34">点击更换头像</p>
                  </div>
                  <span className="text-sm text-white/34">更换</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleAvatarChange}
                  />
                </label>

                <div className="mx-4 h-px bg-white/10" />

                <div className="px-4 py-3.5">
                  <p className="text-xs text-white/34">用户名</p>
                  {showEditUsername ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="zaomeng-input min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleUpdateUsername}
                        className="zaomeng-primary-button rounded-xl px-4 py-2 text-sm font-medium"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditUsername(user.username);
                          setShowEditUsername(false);
                        }}
                        className="zaomeng-ghost-button rounded-xl px-4 py-2 text-sm"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-base text-white">
                        {user.username}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowEditUsername(true)}
                        className="text-sm text-cyan-100/72 transition hover:text-cyan-50"
                      >
                        修改
                      </button>
                    </div>
                  )}
                </div>

                <div className="mx-4 h-px bg-white/10" />
                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <span className="text-sm text-white/44">邮箱</span>
                  <span className="min-w-0 truncate text-right text-sm text-white/82">
                    {user.email}
                  </span>
                </div>
                <div className="mx-4 h-px bg-white/10" />
                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <span className="text-sm text-white/44">用户 ID</span>
                  <button
                    type="button"
                    onClick={() => void copyText(user.id)}
                    className="min-w-0 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-right font-mono text-xs text-white/62 transition hover:bg-white/[0.08] hover:text-white"
                    title="复制完整用户 ID"
                  >
                    {formatUserId(user.id)}
                  </button>
                </div>
                <div className="mx-4 h-px bg-white/10" />
                <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <span className="text-sm text-white/44">注册时间</span>
                  <span className="text-right text-sm text-white/70">
                    {formatTime(user.createTime ?? user.createdAt ?? "")}
                  </span>
                </div>
              </section>

              {user.isAdmin && (
                <Link
                  href="/admin/generations"
                  prefetch
                  className="zaomeng-glass-panel flex w-full items-center justify-between gap-3 rounded-[1.4rem] px-4 py-3.5 text-sm text-white transition hover:bg-white/[0.06]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span>进入管理员后台</span>
                      <span className="rounded-full border border-amber-300/20 bg-amber-400/12 px-2 py-0.5 text-[11px] font-medium text-amber-100">
                        管理员
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-white/36">
                      查看订单、用户和兑换码管理
                    </span>
                  </span>
                  <span className="text-white/28">›</span>
                </Link>
              )}
            </div>
          )}

          {activeTab === "security" && (
            <div className="space-y-4">
              <section className="zaomeng-glass-panel overflow-hidden rounded-[1.4rem]">
                <div className="px-4 py-4">
                  <h3 className="text-base font-semibold text-white">
                    修改密码
                  </h3>
                  <p className="mt-1 text-sm text-white/38">
                    新密码至少 6 位，建议不要与邮箱或旧密码相同。
                  </p>
                </div>

                <div className="mx-4 h-px bg-white/10" />

                <label className="block px-4 py-3.5">
                  <span className="block text-sm text-white/44">当前密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="请输入当前密码"
                    className="zaomeng-input mt-2 w-full rounded-xl px-3 py-2.5 text-sm"
                  />
                </label>

                <div className="mx-4 h-px bg-white/10" />

                <label className="block px-4 py-3.5">
                  <span className="block text-sm text-white/44">新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className="zaomeng-input mt-2 w-full rounded-xl px-3 py-2.5 text-sm"
                  />
                </label>

                <div className="mx-4 h-px bg-white/10" />

                <label className="block px-4 py-3.5">
                  <span className="block text-sm text-white/44">
                    确认新密码
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入新密码"
                    className="zaomeng-input mt-2 w-full rounded-xl px-3 py-2.5 text-sm"
                  />
                </label>
              </section>

              <button
                type="button"
                onClick={handleUpdatePassword}
                className="zaomeng-primary-button w-full rounded-[1.15rem] py-3 text-sm font-semibold"
              >
                保存新密码
              </button>
            </div>
          )}

          {/* 充值中心标签页 */}
          {activeTab === "recharge" && (
            <RechargePanel
              onRechargeUpdated={async () => {
                await refreshUser();
                await refreshTransactions();
              }}
            />
          )}

          {activeTab === "transactions" && (
            <div className="space-y-4">
              <div className="flex items-end justify-between gap-4 px-1">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    积分明细
                  </h3>
                  <p className="mt-1 text-sm text-white/38">
                    共 {filteredTransactions.length} / {transactions.length}{" "}
                    条记录
                  </p>
                </div>
                <Link
                  href="/home"
                  prefetch
                  className="zaomeng-ghost-button shrink-0 rounded-full px-4 py-2 text-sm"
                >
                  订单记录
                </Link>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {TRANSACTION_FILTERS.map((filter) => {
                  const active = transactionFilter === filter.key;

                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setTransactionFilter(filter.key)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "border-cyan-200/28 bg-cyan-300/[0.14] text-cyan-50 shadow-sm shadow-cyan-500/10"
                          : "border-white/10 bg-white/[0.045] text-white/58 hover:bg-white/[0.08] hover:text-white"
                      }`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              {filteredTransactions.length === 0 ? (
                <section className="rounded-[1.4rem] border border-dashed border-white/14 bg-white/[0.035] px-4 py-10 text-center">
                  <p className="text-sm text-white/48">暂无积分明细</p>
                  <button
                    type="button"
                    onClick={() => handleTabChange("recharge")}
                    className="zaomeng-primary-button mt-4 rounded-full px-4 py-2 text-sm font-medium"
                  >
                    去兑换
                  </button>
                </section>
              ) : (
                <section className="zaomeng-glass-panel max-h-[620px] overflow-y-auto overflow-x-hidden rounded-[1.4rem] history-scrollbar">
                  {filteredTransactions.map((trans, index) => {
                    const isRecharge = isRechargeTransaction(trans.toolPage);
                    const pointValue = isRecharge
                      ? trans.actualPoints || trans.points
                      : trans.points;
                    const amountClass =
                      trans.status !== "成功"
                        ? "text-white/38"
                        : isRecharge
                          ? "text-emerald-300"
                          : "text-rose-300";

                    return (
                      <div key={trans.id}>
                        {index > 0 && <div className="mx-4 h-px bg-white/10" />}
                        <div className="px-4 py-3.5 transition hover:bg-white/[0.05]">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <p className="min-w-0 max-w-full truncate text-sm font-medium text-white">
                                  {trans.description}
                                </p>
                                {getStatusBadge(trans.status)}
                              </div>
                              <p className="mt-1 text-xs text-white/34">
                                {formatTime(trans.time)}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/34">
                                <button
                                  type="button"
                                  disabled={!trans.orderNumber}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyText(trans.orderNumber);
                                  }}
                                  className="min-w-0 max-w-full truncate rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-left transition hover:bg-white/[0.08] disabled:cursor-default disabled:opacity-50"
                                  title="复制编号"
                                >
                                  编号 {trans.orderNumber || "-"}
                                </button>
                                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1">
                                  <span>余额</span>
                                  <PointsIconLabel
                                    points={trans.remainingPoints}
                                    iconClassName="h-3.5 w-3.5"
                                  />
                                </span>
                              </div>
                            </div>
                            <div
                              className={`shrink-0 pt-0.5 text-sm font-semibold ${amountClass}`}
                            >
                              <div className="flex items-center justify-end gap-0.5">
                                <span>{isRecharge ? "+" : "-"}</span>
                                <PointsIconLabel
                                  points={pointValue}
                                  iconClassName="h-4 w-4"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs text-white/32">
            <Link href="/terms" className="transition hover:text-white/70">
              用户服务协议
            </Link>
            <span>/</span>
            <Link href="/privacy" className="transition hover:text-white/70">
              隐私政策
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
