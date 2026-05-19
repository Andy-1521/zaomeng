import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export const localUploadRoots = new Set([
  'plugin-capture',
  'material-editor',
  'uploads',
  'ai-reference',
  'color-extraction',
  'ai-generate',
  'avatars',
]);

export function normalizeFileExtension(extension: string) {
  const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  if (normalized === 'jpeg') return 'jpg';
  if (normalized === 'web') return 'webp';
  return normalized;
}

export function normalizeFolder(folder: string) {
  const segments = folder
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, '-'));

  const root = segments[0] || 'uploads';
  if (!localUploadRoots.has(root)) {
    return 'uploads';
  }

  return segments.join('/');
}

export async function saveBufferToLocalMaterialFile(buffer: Buffer, relativeFilePath: string) {
  const normalizedPath = relativeFilePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .join('/');

  const root = normalizedPath.split('/')[0];
  if (!root || !localUploadRoots.has(root)) {
    throw new Error('本地上传路径无效');
  }

  const publicRoot = path.join(process.cwd(), 'public');
  const filePath = path.join(publicRoot, normalizedPath);
  if (!filePath.startsWith(publicRoot)) {
    throw new Error('本地上传路径无效');
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `/api/material-file/${normalizedPath}`;
}

export function getLocalMaterialPathFromUrl(urlOrPath: string, options?: { allowedOrigin?: string | null }) {
  const localMaterialPrefix = '/api/material-file/';
  let pathname = '';

  if (urlOrPath.startsWith(localMaterialPrefix)) {
    pathname = new URL(urlOrPath, 'http://local').pathname;
  } else {
    try {
      const url = new URL(urlOrPath);
      if (!options?.allowedOrigin || url.origin !== options.allowedOrigin) {
        return null;
      }
      pathname = url.pathname;
    } catch {
      return null;
    }
  }

  if (!pathname.startsWith(localMaterialPrefix)) {
    return null;
  }

  const relativePath = decodeURIComponent(pathname.slice(localMaterialPrefix.length));
  const segments = relativePath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const root = segments[0];

  if (!root || !localUploadRoots.has(root) || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('..'))) {
    throw new Error('本地素材路径无效');
  }

  return segments.join('/');
}

export async function readLocalMaterialFileFromUrl(urlOrPath: string, options?: { allowedOrigin?: string | null }) {
  const localMaterialPath = getLocalMaterialPathFromUrl(urlOrPath, options);
  if (!localMaterialPath) {
    return null;
  }

  const publicRoot = path.join(process.cwd(), 'public');
  const filePath = path.join(publicRoot, ...localMaterialPath.split('/'));
  if (!filePath.startsWith(publicRoot)) {
    throw new Error('本地素材路径无效');
  }

  return {
    buffer: await readFile(filePath),
    relativePath: localMaterialPath,
  };
}
