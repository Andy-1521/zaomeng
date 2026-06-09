import { readFile } from "fs/promises";
import path from "path";
import Link from "next/link";
import Image from "next/image";
import Navbar from "@/components/Navbar";

type ManifestJson = {
  version?: string;
};

async function readExtensionVersion() {
  try {
    const manifestPath = path.join(
      process.cwd(),
      "browser-extension/zaomeng-capture/manifest.json",
    );
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as ManifestJson;
    return manifest.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const supportedBrowsers = ["Chrome", "Edge", "Brave", "Arc", "360 极速"];

const storeInstallOptions = [
  {
    label: "Chrome Web Store",
    browser: "Chrome",
    href: process.env.CHROME_WEB_STORE_URL || "",
  },
  {
    label: "Microsoft Edge Add-ons",
    browser: "Edge",
    href: process.env.EDGE_ADDONS_URL || "",
  },
];

const quickSteps = [
  {
    title: "网页采图",
    description: "在商品页或图片页触发采集，把图片保存到当前账号。",
  },
  {
    title: "素材入库",
    description: "采集成功后回到素材库查看，不需要重新上传。",
  },
  {
    title: "继续处理",
    description: "选中素材后继续做彩绘提取、AI生图或高清处理。",
  },
];

const manualInstallSteps = [
  {
    title: "解压安装包",
    description: "下载后解压，不要直接把 zip 拖进浏览器。",
  },
  {
    title: "打开扩展管理",
    description:
      "Chrome 输入 chrome://extensions，Edge 输入 edge://extensions。",
  },
  {
    title: "加载已解压扩展",
    description: "打开开发者模式，选择刚解压出来的插件文件夹。",
  },
  {
    title: "刷新造梦AI",
    description: "回到工作台刷新页面，导航栏会显示插件连接状态。",
  },
];

const faqItems = [
  {
    question: "插件未连接怎么办？",
    answer:
      "确认浏览器扩展已启用，然后刷新造梦AI页面。仍未连接时，删除旧版本后重新安装最新版。",
  },
  {
    question: "保存时报未登录怎么办？",
    answer: "先回到造梦AI确认账号仍在登录状态，再刷新目标网页重新采集。",
  },
  {
    question: "采集不到正确图片怎么办？",
    answer:
      "部分网页会使用背景图、懒加载或遮罩。把鼠标移到大图区域，再使用右键或悬浮采集按钮。",
  },
];

export default async function PluginPage() {
  const version = await readExtensionVersion();
  const availableStoreInstallOptions = storeInstallOptions.filter((item) =>
    Boolean(item.href),
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05060b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_-8%,rgba(95,112,255,0.22),transparent_34rem),radial-gradient(circle_at_12%_24%,rgba(124,58,237,0.18),transparent_26rem),linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24rem)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <section className="rounded-3xl border border-white/[0.08] bg-[#090a10]/84 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/58">
                  <span className="rounded-full border border-emerald-300/22 bg-emerald-400/12 px-3 py-1 text-emerald-100">
                    最新版 v{version}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">
                    网页采图
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">
                    自动入库
                  </span>
                </div>

                <div className="mt-7 max-w-2xl">
                  <p className="text-sm font-medium text-cyan-100/76">
                    浏览器扩展
                  </p>
                  <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
                    安装造梦AI采图插件
                  </h1>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-white/62 sm:text-base">
                    把网页图片直接保存到当前账号素材库，采集后可继续做彩绘提取、AI生图、智能改图和高清处理。
                  </p>
                </div>

                <div className="mt-8 max-w-2xl">
                  <p className="mb-3 text-xs font-medium tracking-[0.2em] text-emerald-100/70">
                    从这里开始
                  </p>
                  <a
                    href="/api/plugin/download?browser=chromium"
                    className="group flex min-h-[5.3rem] items-center gap-4 rounded-3xl border border-cyan-300/18 bg-white/[0.045] px-5 py-4 text-white shadow-[0_18px_55px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:bg-white/[0.07] sm:px-6"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-xs font-semibold text-white ring-1 ring-white/10">
                      1
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold sm:text-lg">
                        开始安装：下载插件包
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-white/50 sm:text-sm">
                        点这里下载 zip，随后按右侧步骤解压并加载扩展。
                      </span>
                    </span>
                    <span className="hidden shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-white/[0.1] sm:inline-flex">
                      点击下载
                    </span>
                  </a>
                  <a
                    href="/api/plugin/download?browser=chromium"
                    className="mt-3 inline-flex w-full min-h-11 items-center justify-center rounded-2xl bg-white text-sm font-semibold text-black shadow-[0_14px_36px_rgba(255,255,255,0.12)] transition hover:bg-cyan-50 sm:hidden"
                  >
                    下载插件包
                  </a>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/45">
                    <span>已经安装过？刷新工作台查看顶部导航栏插件状态。</span>
                    <Link
                      href="/home"
                      className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-white/66 transition hover:bg-white/[0.1] hover:text-white"
                    >
                      登录后返回工作台检查
                    </Link>
                  </div>
                </div>

                {availableStoreInstallOptions.length > 0 ? (
                  <div className="mt-5 rounded-2xl border border-emerald-300/16 bg-emerald-400/[0.06] p-3">
                    <p className="text-sm font-semibold text-emerald-50">
                      浏览器商店安装
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {availableStoreInstallOptions.map((item) => (
                        <a
                          key={item.browser}
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-emerald-300/22 bg-emerald-400/[0.09] px-3 text-sm font-medium text-emerald-50 transition hover:bg-emerald-400/[0.14]"
                        >
                          {item.browser} 商店安装
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/46">
                  <span>支持浏览器</span>
                  {supportedBrowsers.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-white/64"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <aside className="border-t border-white/[0.08] bg-white/[0.035] p-5 lg:border-l lg:border-t-0">
                <div className="flex h-full flex-col gap-6">
                  <div>
                    <div className="flex items-center gap-3">
                      <Image
                        src="/assets/32.png"
                        alt="造梦AI"
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-2xl border border-purple-300/22 object-cover"
                      />
                      <div>
                        <p className="text-sm font-semibold text-white">
                          下载后继续
                        </p>
                        <p className="mt-1 text-xs text-white/42">
                          按顺序走完即可连接插件
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      {manualInstallSteps.map((step, index) => (
                        <div
                          key={step.title}
                          className="grid grid-cols-[1.5rem_1fr] gap-3"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.08] text-[11px] font-semibold text-white ring-1 ring-white/10">
                            {index + 2}
                          </span>
                          <span>
                            <span className="block text-sm font-medium text-white/88">
                              {step.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-white/45">
                              {step.description}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-300/16 bg-cyan-400/[0.06] px-4 py-3 text-xs leading-5 text-cyan-50/70">
                    当前版本 v{version}
                    。安装完成后刷新页面，顶部导航栏会显示插件是否连接。
                  </div>
                </div>
              </aside>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            {quickSteps.map((step, index) => (
              <div
                key={step.title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4 backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-black">
                    {index + 1}
                  </span>
                  <h2 className="text-sm font-semibold text-white">
                    {step.title}
                  </h2>
                </div>
                <p className="mt-3 text-xs leading-6 text-white/52">
                  {step.description}
                </p>
              </div>
            ))}
          </section>

          <section>
            <div className="rounded-3xl border border-white/[0.08] bg-black/30 p-5 backdrop-blur-2xl">
              <h2 className="text-base font-semibold text-white">常见问题</h2>
              <div className="mt-3 divide-y divide-white/[0.08]">
                {faqItems.map((item) => (
                  <details
                    key={item.question}
                    className="group py-3 first:pt-0 last:pb-0"
                  >
                    <summary className="cursor-pointer list-none text-sm font-medium text-white/84 transition group-open:text-white">
                      {item.question}
                    </summary>
                    <p className="mt-2 text-xs leading-6 text-white/48">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
