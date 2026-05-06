import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export const localUploadRoots = new Set([
  'plugin-capture',
  'material-editor',
  'uploads',
  'ai-reference',
  'color-extraction',
  'grsai',
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
