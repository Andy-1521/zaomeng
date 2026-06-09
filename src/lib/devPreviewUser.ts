import { readFile } from 'fs/promises';
import { join } from 'path';

type DevPreviewUserCache = {
  user?: {
    id?: unknown;
    username?: unknown;
    email?: unknown;
    points?: unknown;
    isAdmin?: unknown;
    createdAt?: unknown;
  };
};

export type DevPreviewUser = {
  id: string;
  username: string;
  email?: string;
  points: number;
  isAdmin: boolean;
  createdAt?: string;
};

export async function readDevPreviewUser(): Promise<DevPreviewUser | null> {
  if (process.env.NODE_ENV === 'production') return null;

  try {
    const filePath = join(process.cwd(), '.cache', 'material-preview.json');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as DevPreviewUserCache;
    const user = parsed.user;
    const id = typeof user?.id === 'string' ? user.id : '';
    if (!id) return null;

    return {
      id,
      username: typeof user?.username === 'string' && user.username.trim() ? user.username : '本地预览',
      email: typeof user?.email === 'string' ? user.email : undefined,
      points: typeof user?.points === 'number' && Number.isFinite(user.points) ? user.points : 0,
      isAdmin: user?.isAdmin === true || user?.isAdmin === 1,
      createdAt: typeof user?.createdAt === 'string' ? user.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

export async function readDevPreviewUserByEmail(email: string): Promise<DevPreviewUser | null> {
  const user = await readDevPreviewUser();
  if (!user?.email || user.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  return user;
}
