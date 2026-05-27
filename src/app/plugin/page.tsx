import { readFile } from 'fs/promises';
import path from 'path';
import Link from 'next/link';
import Image from 'next/image';
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
    title: '下载并解压',
    description: '下载 zip 后解压，保留 zaomeng-capture 文件夹。',
  },
  {
    title: '打开扩展管理',
    description: 'Chrome / Brave / Arc / 360 打开 chrome://extensions/，Edge 打开 edge://extensions/。',
  },
  {
    title: '加载后刷新网站',
    description: '开启开发者模式，加载 zaomeng-capture 文件夹，然后刷新造梦AI。',
  },
];

const workflowItems = [
  {
    title: '在网页上采集',
    description: '目标图片上右键保存，或使用悬浮采集按钮。',
  },
  {
    title: '回到素材库',
    description: '图片会进入当前账号素材库，不需要重新上传。',
  },
  {
    title: '继续AI处理',
    description: '可直接接到 AI 生图、彩绘提取、智能改图等流程。',
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
    <div className="min-h-screen bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_420px),linear-gradient(120deg,rgba(147,51,234,0.13)_0%,rgba(37,99,235,0.08)_38%,rgba(0,0,0,0)_76%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)
        `,
        backgroundSize: '44px 44px',
      }} />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-7 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[1.8rem] border border-white/[0.08] bg-black/34 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl ring-1 ring-white/[0.03]">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/56">
                  <span className="rounded-full border border-emerald-300/22 bg-emerald-400/12 px-3 py-1 text-emerald-100">最新版 v{version}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">右键采图</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">素材库同步</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">新版自动提醒</span>
                </div>

                <div className="mt-8 max-w-2xl">
                  <p className="text-sm font-medium text-cyan-100/78">浏览器插件下载</p>
                  <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
                    造梦AI采图插件
                  </h1>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-white/64 sm:text-base">
                    把网页图片直接保存到当前账号素材库，采集后即可继续做 AI 生图、彩绘提取、智能改图和高清扩图。
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <a
                    href="/api/plugin/download?browser=chromium"
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(88,28,135,0.35)] transition hover:-translate-y-0.5 hover:from-purple-500 hover:to-blue-500"
                  >
                    下载最新版插件
                  </a>
                  <Link
                    href="/home"
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/12 bg-white/[0.055] px-6 text-sm text-white/72 transition hover:-translate-y-0.5 hover:bg-white/[0.11] hover:text-white"
                  >
                    返回工作台
                  </Link>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-white/48">
                  <span>按浏览器下载</span>
                  {browserDownloads.map((item) => (
                    <a
                      key={item.browser}
                      href={`/api/plugin/download?browser=${item.browser}`}
                      className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-white/64 transition hover:border-purple-300/28 hover:bg-white/[0.09] hover:text-white"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/[0.08] bg-white/[0.035] p-5 lg:border-l lg:border-t-0">
                <div className="h-full rounded-[1.4rem] border border-white/[0.09] bg-[#09090d]/86 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                    <div className="flex items-center gap-3">
                      <Image
                        src="/assets/32.png"
                        alt="造梦AI"
                        width={42}
                        height={42}
                        className="h-10 w-10 rounded-xl border border-purple-300/22 object-cover"
                      />
                      <div>
                        <p className="text-sm font-semibold text-white">插件连接面板</p>
                        <p className="mt-0.5 text-xs text-white/42">安装后刷新页面即可识别</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-emerald-300/20 bg-emerald-400/12 px-2.5 py-1 text-xs text-emerald-100">v{version}</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {workflowItems.map((item, index) => (
                      <div key={item.title} className="grid grid-cols-[2.25rem_1fr] gap-3 rounded-[1rem] border border-white/[0.08] bg-white/[0.045] p-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-black">
                          {index + 1}
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-white/90">{item.title}</span>
                          <span className="mt-1 block text-xs leading-5 text-white/48">{item.description}</span>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[1rem] border border-cyan-300/16 bg-cyan-400/[0.06] px-4 py-3 text-xs leading-5 text-cyan-50/72">
                    插件有新版本时，导航栏会提示更新。重新下载并加载新版文件夹即可。
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[1.6rem] border border-white/[0.08] bg-black/38 p-5 shadow-[0_18px_52px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">安装只需三步</h2>
                  <p className="mt-1 text-xs text-white/42">旧版本可直接删除后重新加载新版</p>
                </div>
                <span className="rounded-full border border-purple-300/20 bg-purple-500/12 px-2.5 py-1 text-xs text-purple-100">约 1 分钟</span>
              </div>

              <ol className="mt-4 space-y-3">
                {installSteps.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-3 rounded-[1rem] border border-white/[0.08] bg-white/[0.04] p-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-white/88">{step.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-white/48">{step.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-[1.6rem] border border-white/[0.08] bg-black/38 p-5 shadow-[0_18px_52px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <h2 className="text-base font-semibold text-white">常见问题</h2>
              <div className="mt-4 divide-y divide-white/[0.08]">
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
