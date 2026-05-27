import { NextRequest, NextResponse } from 'next/server';
import { createAliyunOSSPostPolicy } from '@/lib/aliyunOSS';
import { normalizeFileExtension, normalizeFolder } from '@/lib/localUploadStorage';

const DIRECT_UPLOAD_MAX_BYTES = 40 * 1024 * 1024;
const DIRECT_UPLOAD_FOLDERS = new Set(['uploads']);

type DirectUploadPolicyRequest = {
  fileName?: string;
  contentType?: string;
  fileSize?: number;
  folder?: string;
};

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return null;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch {
    return null;
  }
}

function getExtensionFromFileName(fileName: string, contentType: string) {
  const matched = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (matched) {
    return normalizeFileExtension(matched[1]);
  }

  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  return 'jpg';
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json() as DirectUploadPolicyRequest;
    const fileName = (body.fileName || 'image.jpg').trim();
    const contentType = (body.contentType || '').trim().toLowerCase();
    const fileSize = Number(body.fileSize || 0);
    const folder = normalizeFolder(body.folder || 'uploads');

    if (!DIRECT_UPLOAD_FOLDERS.has(folder)) {
      return NextResponse.json({ success: false, message: '当前目录不支持直传' }, { status: 400 });
    }

    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ success: false, message: '只支持图片直传' }, { status: 400 });
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > DIRECT_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ success: false, message: '图片大小不符合要求' }, { status: 400 });
    }

    const extension = getExtensionFromFileName(fileName, contentType);
    const key = `${folder}/${userId}/${Date.now()}_${Math.floor(Math.random() * 10000)}.${extension}`;
    const policy = createAliyunOSSPostPolicy({
      key,
      contentType,
      maxBytes: DIRECT_UPLOAD_MAX_BYTES,
      expiresInSeconds: 600,
    });

    return NextResponse.json({
      success: true,
      data: policy,
    });
  } catch (error: unknown) {
    console.error('[OSS直传] 生成签名失败:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '生成直传签名失败' },
      { status: 500 }
    );
  }
}
