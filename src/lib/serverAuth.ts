import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

export type AuthCookieUser = {
  id: string;
  username?: string;
  email?: string;
  points?: number;
  isAdmin?: boolean;
};

export const AUTH_COOKIE_NAME = 'user';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SIGNED_COOKIE_PREFIX = 'v1';

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getAuthCookieSecret() {
  return process.env.AUTH_COOKIE_SECRET
    || process.env.SESSION_SECRET
    || process.env.NEXTAUTH_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-only-zaomeng-auth-cookie-secret');
}

function signPayload(payload: string) {
  const secret = getAuthCookieSecret();
  if (!secret) return '';
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function verifySignature(payload: string, signature: string) {
  const expected = signPayload(payload);
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function normalizeAuthCookieUser(value: unknown): AuthCookieUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;

  return {
    id,
    username: typeof record.username === 'string' ? record.username : undefined,
    email: typeof record.email === 'string' ? record.email : undefined,
    points: typeof record.points === 'number' && Number.isFinite(record.points) ? record.points : undefined,
    isAdmin: record.isAdmin === true,
  };
}

export function buildAuthCookieUser(user: {
  id: string;
  username?: string | null;
  email?: string | null;
  points?: number | null;
  isAdmin?: boolean | null;
}): AuthCookieUser {
  return {
    id: user.id,
    username: user.username || undefined,
    email: user.email || undefined,
    points: typeof user.points === 'number' ? user.points : 0,
    isAdmin: user.isAdmin === true,
  };
}

export function createAuthCookieValue(user: AuthCookieUser) {
  const normalized = normalizeAuthCookieUser(user);
  if (!normalized) {
    throw new Error('无法创建登录态 Cookie：用户信息无效');
  }

  const payload = base64UrlEncode(JSON.stringify(normalized));
  const signature = signPayload(payload);
  if (!signature) {
    throw new Error('AUTH_COOKIE_SECRET 未配置，无法创建安全登录态 Cookie');
  }

  return `${SIGNED_COOKIE_PREFIX}.${payload}.${signature}`;
}

function shouldUseSecureCookie(request?: NextRequest) {
  const hostname = request?.nextUrl.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return false;
  }

  return process.env.NODE_ENV === 'production';
}

export function getAuthCookieOptions(request?: NextRequest) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: 'lax' as const,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  };
}

export function getClearAuthCookieOptions(request?: NextRequest) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: 'lax' as const,
    maxAge: 0,
    path: '/',
  };
}

export function parseAuthCookieValue(rawValue: string | undefined): AuthCookieUser | null {
  if (!rawValue) return null;

  const parts = rawValue.split('.');
  if (parts.length === 3 && parts[0] === SIGNED_COOKIE_PREFIX) {
    const [, payload, signature] = parts;
    if (!payload || !signature || !verifySignature(payload, signature)) return null;

    try {
      return normalizeAuthCookieUser(JSON.parse(base64UrlDecode(payload)));
    } catch {
      return null;
    }
  }

  // Legacy unsigned JSON cookies are accepted only outside production to keep local/dev sessions usable.
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_UNSIGNED_USER_COOKIE === 'true') {
    try {
      return normalizeAuthCookieUser(JSON.parse(rawValue));
    } catch {
      return null;
    }
  }

  return null;
}

export function getCookieUser(request: NextRequest): AuthCookieUser | null {
  return parseAuthCookieValue(request.cookies.get(AUTH_COOKIE_NAME)?.value);
}

export function getCookieUserId(request: NextRequest): string | null {
  return getCookieUser(request)?.id || null;
}

export function isBodyUserMismatch(requestUserId: unknown, cookieUserId: string) {
  return typeof requestUserId === 'string' && requestUserId.trim() !== '' && requestUserId.trim() !== cookieUserId;
}
