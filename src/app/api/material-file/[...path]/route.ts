import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { localUploadRoots } from '@/lib/localUploadStorage';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.mp4' || extension === '.webm' || extension === '.mov' || extension === '.m4v' || extension === '.avi') return 'application/octet-stream';
  return 'image/jpeg';
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const segments = params.path || [];
    const root = segments[0];

    if (!root || !localUploadRoots.has(root) || segments.some((segment) => segment.includes('..'))) {
      return NextResponse.json({ success: false, message: '图片路径无效' }, { status: 400 });
    }

    const publicRoot = path.join(process.cwd(), 'public');
    const filePath = path.join(publicRoot, ...segments);

    if (!filePath.startsWith(publicRoot)) {
      return NextResponse.json({ success: false, message: '图片路径无效' }, { status: 400 });
    }

    const contentType = getContentType(filePath);
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ success: false, message: '当前文件不是图片' }, { status: 415 });
    }

    const file = await readFile(filePath);
    return new NextResponse(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: '图片不存在' }, { status: 404 });
  }
}
