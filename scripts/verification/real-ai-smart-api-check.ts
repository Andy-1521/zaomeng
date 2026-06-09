import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { getMysqlPool, userManager } from '@/storage/database';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const baseUrl = process.env.REAL_SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const testEmail = process.env.REAL_SMOKE_EMAIL || 'assistant-real-smoke@example.test';
const testUsername = 'assistant-real-smoke';
const testPoints = 300;

type JsonResponse = {
  ok: boolean;
  status: number;
  body: any;
};

function absoluteUrl(url: string) {
  return new URL(url, baseUrl).toString();
}

function redactUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url, baseUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

async function ensureTestUser() {
  const password = crypto.randomBytes(18).toString('base64url');
  const existing = await userManager.getUserByEmail(testEmail);

  if (!existing) {
    const user = await userManager.createUser({
      email: testEmail,
      username: testUsername,
      password,
      points: testPoints,
    });
    return { user, password };
  }

  await userManager.updateUser(existing.id, {
    username: testUsername,
    isActive: true,
  });
  await userManager.updatePassword(existing.id, password);
  await userManager.updateUserCredits(existing.id, testPoints);
  const user = await userManager.getUserById(existing.id);
  if (!user) throw new Error('Unable to reload test user');
  return { user, password };
}

function getSetCookieHeader(response: Response) {
  const withGetter = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieValues = typeof withGetter.getSetCookie === 'function'
    ? withGetter.getSetCookie()
    : [];
  return cookieValues[0] || response.headers.get('set-cookie') || '';
}

async function login(email: string, password: string) {
  const response = await fetch(absoluteUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok || !body?.success) {
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const setCookie = getSetCookieHeader(response);
  const cookie = setCookie.split(';')[0];
  if (!cookie) {
    throw new Error('Login did not return a user cookie');
  }

  return { cookie, user: body.data };
}

async function fetchJson(url: string, init?: RequestInit): Promise<JsonResponse> {
  const response = await fetch(absoluteUrl(url), init);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { ok: response.ok, status: response.status, body };
}

async function uploadTestImage(cookie: string) {
  const filePath = path.join(process.cwd(), 'public/assets/remove-watermark-demo.jpg');
  const buffer = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'real-smoke-source.jpg');
  formData.append('folder', 'uploads');

  const result = await fetchJson('/api/upload/file', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });

  if (!result.ok || !result.body?.success || !result.body?.data?.url) {
    throw new Error(`Upload failed: ${result.status} ${JSON.stringify(result.body)}`);
  }

  const metadata = await sharp(buffer).metadata();
  return {
    imageUrl: absoluteUrl(result.body.data.url),
    width: metadata.width || 1024,
    height: metadata.height || 1024,
  };
}

async function runAiGenerate(cookie: string, userId: string, imageUrl: string, sourceSize: { width: number; height: number }) {
  const result = await fetchJson('/api/image-to-image/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      userId,
      imageUrl,
      prompt: 'Keep the product composition, improve clarity and lighting, and preserve the original subject.',
      aspectRatio: '1:1',
      resolution: '1k',
      sourceSize,
      orderId: `AIG_REAL_${Date.now()}`,
    }),
  });

  return {
    ok: result.ok && result.body?.success === true,
    httpStatus: result.status,
    success: Boolean(result.body?.success),
    message: result.body?.message || null,
    orderId: result.body?.data?.orderId || null,
    resultUrl: redactUrl(result.body?.data?.url),
    remainingPoints: result.body?.data?.remainingPoints ?? null,
  };
}

async function runSmartEdit(cookie: string, imageUrl: string, sourceSize: { width: number; height: number }) {
  const centerX = Math.round(sourceSize.width / 2);
  const centerY = Math.round(sourceSize.height / 2);
  const radius = Math.max(32, Math.round(Math.min(sourceSize.width, sourceSize.height) * 0.16));
  const result = await fetchJson('/api/material-editor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: 'redraw',
      imageUrl,
      aspectRatio: '1:1',
      resolution: '1k',
      sourceSize,
      outputSize: { width: 1024, height: 1024 },
      sessionId: `real-smoke-${Date.now()}`,
      prompt: 'Replace only the painted area with a small clean blue label. Keep all unselected areas unchanged.',
      mode: 'brush',
      brushSegments: [
        { x: centerX, y: centerY, r: radius },
        { x: centerX + Math.round(radius * 0.3), y: centerY, r: radius },
      ],
    }),
  });

  const orderId = result.body?.data?.orderId || null;
  const initial = {
    ok: result.ok && result.body?.success === true,
    httpStatus: result.status,
    success: Boolean(result.body?.success),
    message: result.body?.message || null,
    orderId,
    remainingPoints: result.body?.data?.remainingPoints ?? null,
  };

  if (!orderId) {
    return { initial, final: null };
  }

  const deadline = Date.now() + 6 * 60 * 1000;
  let last: any = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const check = await fetchJson(`/api/task/check?orderId=${encodeURIComponent(orderId)}`, {
      headers: { Cookie: cookie },
    });
    last = check.body?.data || check.body;
    const status = last?.status;
    if (status && status !== '处理中') {
      break;
    }
  }

  return {
    initial,
    final: last ? {
      status: last.status || null,
      orderId: last.orderId || orderId,
      resultUrl: redactUrl(last.resultData),
      remainingPoints: last.remainingPoints ?? null,
      points: last.points ?? null,
    } : null,
  };
}

async function main() {
  const { user, password } = await ensureTestUser();
  const { cookie } = await login(testEmail, password);
  const upload = await uploadTestImage(cookie);
  const sourceSize = { width: upload.width, height: upload.height };

  const aiGenerate = await runAiGenerate(cookie, user.id, upload.imageUrl, sourceSize);
  const smartEdit = await runSmartEdit(cookie, upload.imageUrl, sourceSize);
  const finalUser = await userManager.getUserById(user.id);

  console.log(JSON.stringify({
    user: {
      id: user.id,
      email: testEmail,
      startingPoints: testPoints,
      finalPoints: finalUser?.points ?? null,
    },
    upload: {
      imageUrl: redactUrl(upload.imageUrl),
      width: upload.width,
      height: upload.height,
    },
    aiGenerate,
    smartEdit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await getMysqlPool().then((pool) => pool.end()).catch(() => {});
});
