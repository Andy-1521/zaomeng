import path from 'path';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';

const COZE_FILES_UPLOAD_API = 'https://api.coze.cn/v1/files/upload';
const DEFAULT_UPLOAD_TIMEOUT = 60_000;

export type CozeWorkflowInputImage =
  | {
      url: string;
      file_type?: string;
    }
  | {
      file_id: string;
      file_type?: string;
    };

export type CozeOpenApiUploadedFile = {
  id: string;
  fileName: string;
  bytes?: number;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

async function fetchFileBuffer(fileUrl: string, timeout = DEFAULT_UPLOAD_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(fileUrl, {
      signal: controller.signal,
      headers: buildBrowserImageHeaders(fileUrl, { userAgent: 'Mozilla/5.0' }),
    });

    if (!response.ok) {
      throw new Error(`下载文件失败: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return { buffer, contentType };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`下载文件超时（${timeout}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveUploadFileName(fileUrl: string, fallbackName: string) {
  try {
    const url = new URL(fileUrl);
    const pathname = decodeURIComponent(url.pathname);
    const basename = path.basename(pathname);
    return basename || fallbackName;
  } catch {
    return fallbackName;
  }
}

export async function uploadFileUrlToCozeOpenApi(
  fileUrl: string,
  fallbackName: string
): Promise<CozeOpenApiUploadedFile> {
  const apiToken = getRequiredEnv('COZE_API_TOKEN');
  const fileName = resolveUploadFileName(fileUrl, fallbackName);
  const { buffer, contentType } = await fetchFileBuffer(fileUrl);

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: contentType }), fileName);

  const response = await fetch(COZE_FILES_UPLOAD_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: formData,
  });

  const payload = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: {
      id?: string;
      file_name?: string;
      bytes?: number;
    };
  };

  if (!response.ok || payload.code !== 0 || !payload.data?.id) {
    throw new Error(payload.msg || `Coze 文件上传失败: ${response.status}`);
  }

  return {
    id: payload.data.id,
    fileName: payload.data.file_name || fileName,
    bytes: payload.data.bytes,
  };
}
