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

const installPages = [
  { browser: 'Chrome / Brave / Arc', url: 'chrome://extensions/' },
  { browser: 'Edge', url: 'edge://extensions/' },
  { browser: '360 极速', url: 'chrome://extensions/' },
];

export default async function PluginPage() {
  const version = await readExtensionVersion();

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
        <div className="absolute top-24 left-[-8rem] h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/16 blur-[120px]" />
        <div className="absolute right-[-10rem] top-1/3 h-[30rem] w-[30rem] rounded-full bg-sky-600/14 blur-[140px]" />
      </div>

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10">
          <section className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                  <span className="h-2 w-2 rounded-full bg-cyan-300" />
                  浏览器插件下载
                </div>
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-5xl">一键下载造梦AI采图插件</h1>
                  <p className="max-w-2xl text-sm leading-7 text-white/70 lg:text-base">
                    安装后，你可以在任意网页的图片上右键保存到造梦AI素材库，也可以在较大的图片上使用悬浮采集按钮。网站会自动识别插件版本，提醒你保持最新版。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-white/52">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">最新版 v{version}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">支持主流浏览器</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">支持右键采图和悬浮采图</span>
                  <span className="rounded-full border border-amber-300/18 bg-amber-400/[0.08] px-3 py-1.5 text-amber-100">看到更新提醒时请安装最新版</span>
                </div>
              </div>

              <div className="flex w-full max-w-md flex-col gap-3 lg:items-end">
                <a
                  href="/api/plugin/download?browser=chromium"
                  className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-600 via-violet-600 to-sky-600 px-5 py-3 text-sm font-medium text-white shadow-[0_18px_40px_rgba(92,70,255,0.32)] transition hover:scale-[1.01] hover:from-fuchsia-500 hover:via-violet-500 hover:to-sky-500"
                >
                  下载最新版插件
                </a>
                <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
                  {browserDownloads.map((item) => (
                    <a
                      key={item.browser}
                      href={`/api/plugin/download?browser=${item.browser}`}
                      className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-center text-xs text-white/68 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
                <p className="text-xs leading-6 text-white/50 lg:text-right">
                  下载后解压文件夹，在浏览器扩展管理页选择“加载已解压的扩展程序”。不同按钮只是为了方便你按常用浏览器下载。
                </p>
                <Link
                  href="/home"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] px-5 py-3 text-sm text-white/78 transition hover:bg-white/[0.07] hover:text-white"
                >
                  返回工作台
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white">当前支持</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <p className="text-sm font-medium text-emerald-200">Chrome / Edge / Brave</p>
                  <p className="mt-2 text-xs leading-6 text-emerald-100/70">可直接使用当前下载包安装。</p>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <p className="text-sm font-medium text-emerald-200">Arc / 360 极速</p>
                  <p className="mt-2 text-xs leading-6 text-emerald-100/70">同样可以使用当前下载包安装。</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white/78">Firefox</p>
                  <p className="mt-2 text-xs leading-6 text-white/52">暂未提供单独安装包，后续按需求补充。</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white/78">Safari</p>
                  <p className="mt-2 text-xs leading-6 text-white/52">暂未支持，后续如果需要会单独适配。</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white">安装前确认</h2>
              <div className="mt-5 space-y-3 text-sm leading-7 text-white/68">
                <p>先登录造梦AI网站，插件保存图片时会直接写入当前账号的素材库。</p>
                <p>如果你曾经装过旧版本，建议先删除旧插件，再安装这里下载的最新版。</p>
                <p>导航栏显示“插件需更新”时，请下载最新版插件并重新加载。</p>
                <p>安装完成后刷新造梦AI页面，导航栏状态会从“插件未连接”变成“插件已连接”。</p>
                <p>点击浏览器工具栏里的插件图标，会自动打开或聚焦造梦AI工作台。</p>
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl lg:p-8">
            <h2 className="text-xl font-semibold text-white">安装步骤</h2>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/54">
              {installPages.map((item) => (
                <span key={item.browser} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  {item.browser}：{item.url}
                </span>
              ))}
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-white/38">STEP 1</p>
                <p className="mt-2 text-sm font-medium text-white">下载并解压插件包</p>
                <p className="mt-2 text-xs leading-6 text-white/52">点击上方下载按钮，解压得到 `zaomeng-capture` 目录。</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-white/38">STEP 2</p>
                <p className="mt-2 text-sm font-medium text-white">打开扩展管理页</p>
                <p className="mt-2 text-xs leading-6 text-white/52">在 Chrome、Brave、Arc 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-white/38">STEP 3</p>
                <p className="mt-2 text-sm font-medium text-white">加载已解压扩展</p>
                <p className="mt-2 text-xs leading-6 text-white/52">开启开发者模式，然后点击“加载已解压的扩展程序”。</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-white/38">STEP 4</p>
                <p className="mt-2 text-sm font-medium text-white">选择插件目录并刷新网站</p>
                <p className="mt-2 text-xs leading-6 text-white/52">选择解压后的 `zaomeng-capture` 目录，安装后刷新造梦AI页面即可连接。</p>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white">使用方式</h2>
              <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-7 text-white/68">
                <li>保持造梦AI页面已登录并已刷新到最新状态。</li>
                <li>打开任意商品页、图库页或你想采图的网站页面。</li>
                <li>在目标图片上右键，点击“保存至造梦AI”。</li>
                <li>如果网站用背景图、懒加载或遮罩承载主图，先把鼠标移到大图区域，再使用右键或悬浮“采集”按钮。</li>
                <li>点击浏览器工具栏插件图标，可以快速回到造梦AI工作台。</li>
                <li>回到造梦AI素材库或项目页，刷新后查看采集结果。</li>
              </ol>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white">常见问题</h2>
              <div className="mt-5 space-y-4 text-sm leading-7 text-white/68">
                <div>
                  <p className="font-medium text-white">导航栏一直显示“插件未连接”</p>
                  <p className="mt-1 text-white/56">先确认插件已启用，再刷新一次造梦AI页面。仍未连接时，删除旧插件后重新安装最新版。</p>
                </div>
                <div>
                  <p className="font-medium text-white">右键时没有出现正确图片</p>
                  <p className="mt-1 text-white/56">部分网站会把主图做成背景图、srcset 或懒加载结构。当前插件会向上查找图片元素和背景图，仍不稳定时先悬停在大图区域再采集。</p>
                </div>
                <div>
                  <p className="font-medium text-white">保存时报未登录</p>
                  <p className="mt-1 text-white/56">插件需要读取你当前网站登录态，请先回到造梦AI确认已经登录，再刷新页面重试。</p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
