import { type NextResponse } from 'next/server';

export type PreviewDemoUser = {
  id: string;
  username: string;
  email: string;
  points: number;
  isAdmin: boolean;
  avatar: string;
  createdAt: string;
};

export function isPreviewDemoAuthEnabled() {
  return process.env.VERCEL_ENV === 'preview' && process.env.PREVIEW_DEMO_AUTH === 'true';
}

export function createPreviewDemoUser(email = 'preview@example.com'): PreviewDemoUser {
  const normalizedEmail = email.trim().toLowerCase() || 'preview@example.com';
  const username = normalizedEmail.includes('@') ? normalizedEmail.split('@')[0] : 'preview';

  return {
    id: 'preview-demo-user',
    username: username || 'preview',
    email: normalizedEmail,
    points: 9999,
    isAdmin: true,
    avatar: '/images/avatar.png',
    createdAt: new Date('2026-05-25T00:00:00.000Z').toISOString(),
  };
}

export function setPreviewDemoUserCookie(response: NextResponse, user: PreviewDemoUser) {
  response.cookies.set('user', JSON.stringify({
    id: user.id,
    username: user.username,
    email: user.email,
    points: user.points,
    isAdmin: user.isAdmin,
  }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  });
}
