"use client";

import { useEffect, useState } from "react";
import Image, { type ImageLoaderProps, type ImageProps } from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "@/contexts/UserContext";

interface NavbarProps {
  showUserMenu?: boolean;
}

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function SafeImage({ alt, ...props }: Omit<ImageProps, "loader">) {
  return (
    <Image {...props} alt={alt} loader={passthroughImageLoader} unoptimized />
  );
}

function scheduleIdleTask(callback: () => void, timeout = 900) {
  if (typeof window === "undefined") return () => undefined;

  let idleId: number | null = null;
  const timerId = globalThis.setTimeout(() => {
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(callback, { timeout });
      return;
    }

    callback();
  }, timeout);

  return () => {
    globalThis.clearTimeout(timerId);
    if (idleId !== null) {
      window.cancelIdleCallback(idleId);
    }
  };
}

async function readMarketPendingCount() {
  const response = await fetch("/api/market/stats", { credentials: "include" });
  const text = await response.text().catch(() => "");
  if (!response.ok || !text.trim()) return 0;

  try {
    const result = JSON.parse(text) as {
      success?: boolean;
      data?: { pendingCount?: number };
    };
    return result.success ? Number(result.data?.pendingCount || 0) : 0;
  } catch {
    return 0;
  }
}

export default function Navbar({ showUserMenu = true }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useUser();
  const [pluginReady, setPluginReady] = useState(false);
  const [pluginVersion, setPluginVersion] = useState<string | null>(null);
  const [latestPluginVersion, setLatestPluginVersion] = useState<string | null>(
    null,
  );
  const [marketPendingCount, setMarketPendingCount] = useState(0);

  const compareVersions = (left: string, right: string) => {
    const leftParts = left.split(".").map((part) => Number(part) || 0);
    const rightParts = right.split(".").map((part) => Number(part) || 0);
    const maxLength = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < maxLength; index += 1) {
      const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  const pluginNeedsUpdate =
    pluginReady &&
    latestPluginVersion &&
    (!pluginVersion || compareVersions(pluginVersion, latestPluginVersion) < 0);

  const handleLogoClick = () => {
    const targetPath = user?.id ? "/home" : "/market";
    if (pathname === targetPath) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    router.push(targetPath);
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
    router.refresh();
  };

  useEffect(() => {
    router.prefetch("/home");
    router.prefetch("/plugin");
    router.prefetch("/profile");
    router.prefetch("/profile?tab=recharge");
    router.prefetch("/admin/generations");
    router.prefetch("/market");
    router.prefetch("/market?tab=pending");

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: { version?: string } | null;
      };
      if (
        data?.source === "zaomeng-extension" &&
        data.type === "ZAOMENG_EXTENSION_READY"
      ) {
        setPluginReady(true);
        setPluginVersion(data.payload?.version || null);
      }
    };

    const cancelDeferredPluginStatus = scheduleIdleTask(() => {
      fetch("/api/plugin/version", { credentials: "include" })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => {
          const version = result?.data?.version;
          if (typeof version === "string" && version.trim()) {
            setLatestPluginVersion(version);
          }
        })
        .catch(() => undefined);

      window.postMessage(
        { source: "zaomeng-web", type: "ZAOMENG_EXTENSION_PING" },
        window.location.origin,
      );
    }, 1800);

    window.addEventListener("message", handler);
    return () => {
      cancelDeferredPluginStatus();
      window.removeEventListener("message", handler);
    };
  }, [router]);

  useEffect(() => {
    if (!user?.isAdmin) {
      setMarketPendingCount(0);
      return;
    }

    let cancelled = false;
    const refreshPendingCount = () => {
      void readMarketPendingCount()
        .then((count) => {
          if (!cancelled) setMarketPendingCount(count);
        })
        .catch(() => {
          if (!cancelled) setMarketPendingCount(0);
        });
    };

    const cancelInitialLoad = scheduleIdleTask(refreshPendingCount, 700);
    const intervalId = globalThis.setInterval(refreshPendingCount, 60_000);
    window.addEventListener("marketPendingChanged", refreshPendingCount);

    return () => {
      cancelled = true;
      cancelInitialLoad();
      globalThis.clearInterval(intervalId);
      window.removeEventListener("marketPendingChanged", refreshPendingCount);
    };
  }, [user?.isAdmin]);

  return (
    <nav className="sticky top-0 z-[80] border-b border-white/[0.08] bg-black/72 px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:px-6 sm:py-3">
      <div className="mx-auto flex max-w-[92vw] items-center justify-between gap-2 2xl:max-w-[1780px]">
        {/* Logo - 点击回到首页 */}
        <button
          onClick={handleLogoClick}
          className="group flex shrink-0 items-center gap-2 rounded-full px-1.5 py-1 transition-colors hover:bg-white/[0.04] sm:gap-2.5 sm:px-2"
        >
          <Image
            src="/assets/32.png"
            alt="Logo"
            width={32}
            height={32}
            className="h-7 w-7 rounded-lg border border-purple-500/30 object-cover sm:h-8 sm:w-8"
          />
          <h1 className="whitespace-nowrap bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-lg font-bold text-transparent transition-all group-hover:from-purple-300 group-hover:to-blue-300 sm:text-2xl">
            造梦AI
          </h1>
        </button>

        {/* 右侧用户菜单 */}
        {showUserMenu && !user && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/market")}`}
              prefetch
              className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/72 transition hover:bg-white/[0.12] hover:text-white sm:px-4 sm:py-2 sm:text-sm"
            >
              登录
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/market")}`}
              prefetch
              className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-[0_12px_32px_rgba(255,255,255,0.12)] transition hover:bg-cyan-50 sm:inline-flex"
            >
              注册
            </Link>
          </div>
        )}

        {showUserMenu && user && (
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {user.isAdmin && marketPendingCount > 0 ? (
              <Link
                href="/market?tab=pending"
                prefetch
                className="hidden items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/14 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-400/20 sm:flex"
                title="前往图市待审核"
              >
                <span className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.55)]" />
                图市待审 {marketPendingCount}
              </Link>
            ) : null}

            <div className="group relative hidden sm:block">
              <Link
                href="/plugin"
                prefetch
                className={`px-3 py-1.5 rounded-full border text-xs flex items-center gap-2 transition-colors ${
                  pluginNeedsUpdate
                    ? "bg-amber-500/15 border-amber-500/35 text-amber-200 hover:bg-amber-500/20"
                    : pluginReady
                      ? "bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/20"
                      : "bg-white/[0.055] border-white/10 text-white/58 hover:bg-white/[0.1] hover:text-white"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${pluginNeedsUpdate ? "bg-amber-300" : pluginReady ? "bg-green-400" : "bg-white/40"}`}
                ></span>
                插件
                {pluginNeedsUpdate
                  ? "需更新"
                  : pluginReady
                    ? "已连接"
                    : "未连接"}
              </Link>
              <div className="absolute right-0 top-full z-[90] mt-2 w-80 rounded-2xl border border-white/15 bg-black/85 p-4 text-xs text-white/70 opacity-0 invisible transition-all group-hover:visible group-hover:opacity-100 backdrop-blur-xl">
                <p className="text-white font-medium mb-2">插件下载与安装</p>
                {pluginNeedsUpdate ? (
                  <p className="mb-3 rounded-xl border border-amber-300/18 bg-amber-400/[0.08] px-3 py-2 leading-5 text-amber-100">
                    当前插件版本{pluginVersion ? ` v${pluginVersion}` : "较旧"}
                    ，最新版本 v{latestPluginVersion}。请重新下载并安装插件。
                  </p>
                ) : null}
                <p className="text-white/52 leading-5">
                  支持 Chrome、Edge、Brave、Arc、360
                  极速。下载后解压安装，刷新页面即可连接。
                </p>
                <ol className="space-y-1 list-decimal pl-4">
                  <li>打开 `chrome://extensions/`</li>
                  <li>开启开发者模式</li>
                  <li>点击“加载已解压的扩展程序”</li>
                  <li>选择解压后的 `zaomeng-capture` 目录</li>
                </ol>
                <p className="mt-3 text-white/45">
                  安装后刷新网站页面，再去目标网页右键保存图片到造梦AI。
                </p>
                <Link
                  href="/plugin"
                  prefetch
                  className="mt-3 inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 text-white transition-colors hover:bg-white/[0.12]"
                >
                  前往插件页面
                </Link>
              </div>
            </div>

            {/* 用户头像和用户名 */}
            <Link
              href="/profile"
              prefetch
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] p-1 backdrop-blur-md transition-all hover:border-white/18 hover:bg-white/[0.12] sm:gap-3 sm:py-1 sm:pl-1 sm:pr-4"
            >
              <SafeImage
                src={user.avatar || "/images/avatar.png"}
                alt="用户头像"
                width={36}
                height={36}
                className="h-8 w-8 rounded-full border-2 border-purple-500/30 object-cover sm:h-9 sm:w-9"
              />
              <span className="hidden max-w-[180px] truncate font-medium text-white sm:inline">
                {user.username}
              </span>
            </Link>

            {/* 积分显示 */}
            <Link
              href="/profile?tab=recharge"
              prefetch
              className="flex items-center gap-1.5 rounded-full border border-yellow-500/25 bg-yellow-500/12 px-2.5 py-1.5 transition-colors hover:bg-yellow-500/18 sm:px-3"
              title="前往积分兑换"
            >
              <Image
                src="/points-icon.png"
                alt="积分"
                width={16}
                height={16}
                className="h-4 w-4"
              />
              <span className="text-sm text-yellow-300">{user.points}</span>
            </Link>

            {/* 退出登录按钮 */}
            <button
              onClick={handleLogout}
              className="whitespace-nowrap rounded-full px-2 py-1.5 text-xs text-white/48 transition-colors hover:bg-white/[0.06] hover:text-white sm:px-3 sm:text-sm"
            >
              <span className="sm:hidden">退出</span>
              <span className="hidden sm:inline">退出登录</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
