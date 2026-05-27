import { readFile } from 'fs/promises';
import path from 'path';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

type ManifestJson = {
  version?: string;
};

async function readExtensionVersion() {
  try {
    const manifestPath = path.join(process.cwd(), 'browser-extension/zaomeng-capture/manifest.json');
    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText) as ManifestJson;
    return manifest.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const browserDownloads = [
  { label: 'Chrome', browser: 'chrome' },
  { label: 'Edge', browser: 'edge' },
  { label: 'Brave', browser: 'brave' },
  { label: 'Arc', browser: 'arc' },
  { label: '360 极速', browser: '360' },
];

const installSteps = [
  {
    title: '下载最新版插件',
    description: '点击下载后解压 zip，得到 zaomeng-capture 文件夹。',
  },
  {
    title: '打开扩展管理页',
    description: 'Chrome / Brave / Arc / 360 打开 chrome://extensions/，Edge 打开 edge://extensions/。',
  },
  {
    title: '加载文件夹并刷新造梦AI',
    description: '开启开发者模式，选择“加载已解压的扩展程序”，安装后刷新造梦AI页面。',
  },
];

const faqItems = [
  {
    question: '导航栏一直显示“插件未连接”',
    answer: '先确认扩展已启用，再刷新造梦AI页面。仍未连接时，删除旧插件后重新安装最新版。',
  },
  {
    question: '保存时报未登录',
    answer: '先回到造梦AI确认账号已经登录，再刷新页面后重试采集。',
  },
  {
    question: '右键没有识别到正确图片',
    answer: '部分网页会使用背景图、懒加载或遮罩。先把鼠标移到大图区域，再使用右键或悬浮采集按钮。',
  },
];

export default async function PluginPage() {
  const version = await readExtensionVersion();

  return (
    <div className="min-h-screen bg-[#050506] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.045)_0%,rgba(255,255,255,0)_34rem),linear-gradient(90deg,rgba(14,165,233,0.08),rgba(168,85,247,0.06)_45%,rgba(255,255,255,0)_78%)]" />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-7 sm:px-6 lg:px-8">
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/52">
                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">最新版 v{version}</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">支持主流浏览器</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">右键采图</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">悬浮采集</span>
              </div>

              <div className="mt-7 max-w-2xl">
                <p className="text-sm font-medium text-cyan-100/78">浏览器插件下载</p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">
                  造梦AI采图插件
                </h1>
                <p className="mt-4 text-sm leading-7 text-white/64 sm:text-base">
                  安装后，可以把网页图片直接保存到当前账号素材库。适合采集商品图、参考图和需要后续 AI 处理的图片素材。
                </p>
              </div>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="/api/plugin/download?browser=chromium"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-cyan-100"
                >
                  下载最新版插件
                </a>
                <Link
                  href="/home"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/12 bg-white/[0.035] px-5 text-sm text-white/72 transition hover:bg-white/[0.08] hover:text-white"
                >
                  返回工作台
                </Link>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/44">
                <span>按浏览器下载：</span>
                {browserDownloads.map((item) => (
                  <a
                    key={item.browser}
                    href={`/api/plugin/download?browser=${item.browser}`}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/58 transition hover:border-white/22 hover:bg-white/[0.06] hover:text-white"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <aside className="rounded-2xl border border-white/10 bg-[#0b0b0e]/86 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">安装只需三步</h2>
                  <p className="mt-1 text-xs text-white/42">下载后按顺序操作即可</p>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-100">约 1 分钟</span>
              </div>

              <ol className="mt-4 space-y-3">
                {installSteps.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-semibold text-black">
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-white/88">{step.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-white/48">{step.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
          </section>

          <section className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <h2 className="text-base font-semibold text-white">使用方式</h2>
              <div className="mt-4 space-y-3 text-sm leading-7 text-white/62">
                <p>先保持造梦AI页面已登录，再打开想采图的网页。</p>
                <p>在目标图片上右键选择“保存至造梦AI”，或把鼠标移到大图区域后使用悬浮采集按钮。</p>
                <p>采集完成后回到素材库刷新，即可继续做 AI 生图、智能改图、彩绘提取等处理。</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <h2 className="text-base font-semibold text-white">常见问题</h2>
              <div className="mt-4 divide-y divide-white/8">
                {faqItems.map((item) => (
                  <div key={item.question} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-white/84">{item.question}</p>
                    <p className="mt-1 text-xs leading-6 text-white/50">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
