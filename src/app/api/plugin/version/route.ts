import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ManifestJson = {
  version?: string;
};

async function readExtensionVersion() {
  const manifestPath = path.join(process.cwd(), 'browser-extension/zaomeng-capture/manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as ManifestJson;
  return manifest.version || '0.0.0';
}

export async function GET() {
  try {
    const version = await readExtensionVersion();
    return NextResponse.json({
      success: true,
      data: {
        version,
        downloadUrl: '/plugin',
      },
    }, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[插件版本] 读取最新版本失败:', error);
    return NextResponse.json({ success: false, error: '读取插件版本失败' }, { status: 500 });
  }
}
