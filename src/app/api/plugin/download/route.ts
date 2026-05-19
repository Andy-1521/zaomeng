import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import * as yazl from 'yazl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXTENSION_ROOT = path.join(process.cwd(), 'browser-extension/zaomeng-capture');
const DEFAULT_BROWSER = 'chromium';
const SUPPORTED_BROWSERS = new Map([
  ['chromium', 'Chromium'],
  ['chrome', 'Chrome'],
  ['edge', 'Edge'],
  ['brave', 'Brave'],
  ['arc', 'Arc'],
  ['360', '360极速浏览器'],
  ['360chrome', '360极速浏览器'],
  ['360se', '360极速浏览器'],
]);
const ALLOWED_EXTENSION_FILES = new Set([
  'README.md',
  'background.js',
  'manifest.json',
  'site-bridge.js',
  'taobao-content.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'icons/zaomeng-logo.jpg',
]);

type ManifestJson = {
  version?: string;
  host_permissions?: string[];
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
  }>;
};

type WebsiteConfig = {
  primaryOrigin: string;
  alternateOrigins: string[];
  matchPatterns: string[];
  hostnames: string[];
};

function resolveWebsiteOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

function buildWebsiteConfig(origin: string): WebsiteConfig {
  const url = new URL(origin);
  const currentProtocol = url.protocol === 'https:' ? 'https' : 'http';
  const alternateProtocol = currentProtocol === 'https' ? 'http' : 'https';
  const authority = `${url.hostname}${url.port ? `:${url.port}` : ''}`;

  const primaryOrigin = `${currentProtocol}://${authority}`;
  const alternateOrigins = Array.from(new Set([primaryOrigin, `${alternateProtocol}://${authority}`]));
  const matchPatterns = alternateOrigins.map((item) => `${item}/*`);
  const hostnames = Array.from(new Set([url.hostname, url.hostname.replace(/^www\./, '')].filter(Boolean)));

  return {
    primaryOrigin,
    alternateOrigins,
    matchPatterns,
    hostnames,
  };
}

async function collectExtensionFiles(rootDir: string, nestedDir = ''): Promise<string[]> {
  const currentDir = path.join(rootDir, nestedDir);
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(nestedDir.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectExtensionFiles(rootDir, relativePath));
      continue;
    }

    files.push(relativePath);
  }

  return files.sort();
}

function transformManifest(text: string, config: WebsiteConfig) {
  const manifest = JSON.parse(text) as ManifestJson;
  manifest.host_permissions = Array.from(new Set(['<all_urls>', ...config.matchPatterns]));
  manifest.content_scripts = (manifest.content_scripts || []).map((script) => {
    if (script.js?.includes('site-bridge.js')) {
      return {
        ...script,
        matches: config.matchPatterns,
      };
    }

    return script;
  });

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function transformBackground(text: string, config: WebsiteConfig) {
  const patternsLiteral = config.matchPatterns.map((item) => `  ${JSON.stringify(item)}`).join(',\n');
  const originChecksLiteral = config.alternateOrigins
    .map((item, index) => `${index === 0 ? '  return ' : '    || '}url.startsWith(${JSON.stringify(`${item}/`)})`)
    .join('\n');

  const replacement = [
    `const WEBSITE_ORIGIN = ${JSON.stringify(config.primaryOrigin)}`,
    'const WEBSITE_PATTERNS = [',
    patternsLiteral,
    ']',
    "const WORKSPACE_PATH = '/home'",
    '',
    "const CONTEXT_MENU_ID = 'ZAOMENG_SAVE_IMAGE'",
    '',
    "const isWebsiteUrl = (url = '') => {",
    originChecksLiteral,
    '}',
    '',
    'const showTabTip = (tabId, message) => {',
  ].join('\n');

  return text.replace(/const WEBSITE_ORIGIN = [\s\S]*?const showTabTip = \(tabId, message\) => \{/, replacement);
}

function transformContentScript(text: string, config: WebsiteConfig) {
  const hostsLiteral = config.hostnames.map((item) => JSON.stringify(item)).join(', ');
  const replacement = `const WEBSITE_HOSTS = new Set([${hostsLiteral}])\n  if (WEBSITE_HOSTS.has(window.location.hostname)) return`;
  return text.replace(/const WEBSITE_HOSTS = new Set\(\[[^\]]*\]\)\n  if \(WEBSITE_HOSTS.has\(window.location.hostname\)\) return/, replacement);
}

function transformReadme(text: string) {
  return text.replace(/browser-extension\/zaomeng-capture/g, 'zaomeng-capture');
}

function normalizeBrowserParam(value: string | null) {
  return (value || DEFAULT_BROWSER).trim().toLowerCase();
}

function shouldIncludeExtensionFile(relativePath: string) {
  return ALLOWED_EXTENSION_FILES.has(relativePath.replace(/\\/g, '/'));
}

function transformExtensionFile(relativePath: string, text: string, config: WebsiteConfig) {
  if (relativePath === 'manifest.json') {
    return transformManifest(text, config);
  }

  if (relativePath === 'background.js') {
    return transformBackground(text, config);
  }

  if (relativePath === 'taobao-content.js') {
    return transformContentScript(text, config);
  }

  if (relativePath === 'README.md') {
    return transformReadme(text);
  }

  return text;
}

async function readExtensionVersion() {
  const manifestPath = path.join(EXTENSION_ROOT, 'manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as ManifestJson;
  return manifest.version || '0.0.0';
}

async function buildExtensionZip(config: WebsiteConfig) {
  const zipFile = new yazl.ZipFile();
  const relativePaths = await collectExtensionFiles(EXTENSION_ROOT);

  for (const relativePath of relativePaths) {
    if (!shouldIncludeExtensionFile(relativePath)) {
      continue;
    }

    const absolutePath = path.join(EXTENSION_ROOT, relativePath);
    const outputPath = path.posix.join('zaomeng-capture', relativePath.replace(/\\/g, '/'));

    if (['manifest.json', 'background.js', 'taobao-content.js', 'README.md'].includes(relativePath)) {
      const fileText = await readFile(absolutePath, 'utf8');
      const transformedText = transformExtensionFile(relativePath, fileText, config);
      zipFile.addBuffer(Buffer.from(transformedText, 'utf8'), outputPath);
      continue;
    }

    const fileBuffer = await readFile(absolutePath);
    zipFile.addBuffer(fileBuffer, outputPath);
  }

  zipFile.end();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    zipFile.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    zipFile.outputStream.on('error', reject);
  });
}

export async function GET(request: NextRequest) {
  const browser = normalizeBrowserParam(request.nextUrl.searchParams.get('browser'));
  if (!SUPPORTED_BROWSERS.has(browser)) {
    return NextResponse.json({ success: false, error: '当前只提供 Chrome、Edge、Brave、Arc、360极速等 Chromium 内核浏览器安装包' }, { status: 400 });
  }

  try {
    const websiteOrigin = resolveWebsiteOrigin(request);
    const websiteConfig = buildWebsiteConfig(websiteOrigin);
    const version = await readExtensionVersion();
    const archive = await buildExtensionZip(websiteConfig);
    const responseBody = new Uint8Array(archive);
    const fileName = `zaomeng-capture-${browser}-v${version}.zip`;

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Zaomeng-Plugin-Browser': browser,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[插件下载] 生成安装包失败:', error);
    return NextResponse.json({ success: false, error: '生成插件安装包失败，请稍后重试' }, { status: 500 });
  }
}
