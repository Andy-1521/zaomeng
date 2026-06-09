import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { inArray } from 'drizzle-orm';
import { getDb, getMysqlPool, userManager } from '@/storage/database';
import { capturedImageManager } from '@/storage/database/capturedImageManager';
import { marketItems, marketPurchases } from '@/storage/database/shared/schema';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const baseUrl = process.env.PROD_SMOKE_BASE_URL || process.env.REAL_SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const runId = process.env.PROD_SMOKE_RUN_ID || `prod-smoke-${Date.now()}`;
const marker = `assistant-${runId}`;
const startingPoints = Number(process.env.PROD_SMOKE_POINTS || 1200);
const runSlow = process.env.PROD_SMOKE_SKIP_SLOW !== 'true';
const runPsd = process.env.PROD_SMOKE_RUN_PSD === 'true';
const pollTimeoutMs = Number(process.env.PROD_SMOKE_POLL_TIMEOUT_MS || 8 * 60 * 1000);

type JsonResponse = {
  ok: boolean;
  status: number;
  body: any;
  text: string;
};

type SmokeUser = {
  id: string;
  email: string;
  password: string;
  cookie: string;
};

const results: Array<Record<string, unknown> & { name: string; ok: boolean }> = [];
const createdUserIds = new Set<string>();
const createdMarketItemIds = new Set<string>();
const touchedLegacyTestEmails = ['assistant-real-smoke@example.test'];

function absoluteUrl(url: string) {
  return new URL(url, baseUrl).toString();
}

function push(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  results.push({ name, ok, ...detail });
}

function redactUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url, baseUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.slice(0, 160);
  }
}

function getSetCookieHeader(response: Response) {
  const withGetter = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieValues = typeof withGetter.getSetCookie === 'function' ? withGetter.getSetCookie() : [];
  return cookieValues[0] || response.headers.get('set-cookie') || '';
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
  return { ok: response.ok, status: response.status, body, text };
}

async function request(
  name: string,
  url: string,
  init: RequestInit | undefined,
  expect: (result: JsonResponse) => boolean,
) {
  const result = await fetchJson(url, init);
  const ok = expect(result);
  push(name, ok, {
    status: result.status,
    body: typeof result.body === 'string' ? result.body.slice(0, 240) : JSON.stringify(result.body).slice(0, 320),
  });
  return result;
}

async function ensureUser(role: string, options?: { isAdmin?: boolean; points?: number }): Promise<SmokeUser> {
  const email = `${marker}-${role}@example.test`;
  const password = crypto.randomBytes(18).toString('base64url');
  const existing = await userManager.getUserByEmail(email);
  const points = options?.points ?? startingPoints;
  let user = existing;

  if (!user) {
    user = await userManager.createUser({
      email,
      username: `${marker}-${role}`,
      password,
      points,
    });
  } else {
    await userManager.updateUser(user.id, {
      username: `${marker}-${role}`,
      isActive: true,
      isAdmin: Boolean(options?.isAdmin),
    });
    await userManager.updatePassword(user.id, password);
    await userManager.updateUserCredits(user.id, points);
    user = await userManager.getUserById(user.id);
    if (!user) throw new Error(`Unable to reload user ${email}`);
  }

  if (options?.isAdmin && !user.isAdmin) {
    user = await userManager.updateUser(user.id, { isAdmin: true });
    if (!user) throw new Error(`Unable to promote admin ${email}`);
  }

  createdUserIds.add(user.id);

  const response = await fetch(absoluteUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  const setCookie = getSetCookieHeader(response);
  const realCookie = setCookie.split(';')[0];
  if (!response.ok || body?.success !== true || !realCookie) {
    throw new Error(`Login cookie failed for ${email}: ${response.status} ${JSON.stringify(body)}`);
  }

  return { id: user.id, email, password, cookie: realCookie };
}

async function uploadTestImage(cookie: string, label: string) {
  const filePath = path.join(process.cwd(), 'public/assets/remove-watermark-demo.jpg');
  const buffer = await fs.readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), `${label}.jpg`);
  formData.append('folder', 'uploads');
  formData.append('createMaterial', 'true');
  formData.append('originalFileName', `${marker}-${label}.jpg`);

  const result = await fetchJson('/api/upload/file', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
  const ok = result.ok && result.body?.success === true && Boolean(result.body?.data?.url);
  push('upload file + material record', ok, {
    status: result.status,
    imageUrl: redactUrl(result.body?.data?.url),
    materialId: result.body?.data?.material?.id || null,
  });
  if (!ok) throw new Error(`Upload failed: ${result.status} ${JSON.stringify(result.body)}`);

  return {
    imageUrl: result.body.data.url as string,
    width: metadata.width || 1024,
    height: metadata.height || 1024,
    buffer,
  };
}

async function pollOrder(cookie: string, orderId: string, timeoutMs = pollTimeoutMs) {
  const startedAt = Date.now();
  let last: any = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await fetchJson(`/api/task/check?orderId=${encodeURIComponent(orderId)}`, {
      headers: { Cookie: cookie },
    });
    last = result.body?.data || result.body;
    const status = last?.status;
    if (status && status !== '处理中') {
      return { status, data: last, elapsedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return { status: 'TIMEOUT', data: last, elapsedMs: Date.now() - startedAt };
}

async function runImmediatePaidChecks(user: SmokeUser, imageUrl: string, sourceSize: { width: number; height: number }) {
  const ai = await request('AI生图 returns result', '/api/image-to-image/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({
      userId: user.id,
      imageUrl,
      prompt: '生产巡检：保持主体构图，提升清晰度和光照。',
      aspectRatio: '1:1',
      resolution: '1k',
      sourceSize,
      orderId: `AIG_${runId}`,
    }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.url));

  const smart = await request('智能改图 submit', '/api/material-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({
      action: 'redraw',
      imageUrl,
      aspectRatio: '1:1',
      resolution: '1k',
      sourceSize,
      outputSize: { width: 1024, height: 1024 },
      sessionId: `${marker}-smart`,
      prompt: '仅将中央小区域改成浅蓝色标签，其余保持不变。',
      mode: 'brush',
      brushSegments: [
        { x: Math.round(sourceSize.width / 2), y: Math.round(sourceSize.height / 2), r: 80 },
      ],
    }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.orderId));

  if (smart.body?.data?.orderId) {
    const final = await pollOrder(user.cookie, smart.body.data.orderId);
    push('智能改图 final success', final.status === '成功' && Boolean(final.data?.resultData), {
      orderId: smart.body.data.orderId,
      status: final.status,
      elapsedMs: final.elapsedMs,
      resultUrl: redactUrl(final.data?.resultData),
    });
  }

  return {
    aiOrderId: ai.body?.data?.orderId || null,
    aiResultUrl: ai.body?.data?.url || null,
    smartOrderId: smart.body?.data?.orderId || null,
  };
}

async function runAsyncTool(
  name: string,
  user: SmokeUser,
  pathName: string,
  imageUrl: string,
  timeoutMs = pollTimeoutMs,
) {
  const submitted = await request(`${name} submit`, pathName, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({ userId: user.id, imageUrl, orderId: `${name}-${runId}` }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.orderId));
  const orderId = submitted.body?.data?.orderId;
  if (!orderId) return null;

  const final = await pollOrder(user.cookie, orderId, timeoutMs);
  push(`${name} final success`, final.status === '成功' && Boolean(final.data?.resultData), {
    orderId,
    status: final.status,
    elapsedMs: final.elapsedMs,
    resultUrl: redactUrl(final.data?.resultData),
    message: final.data?.message || null,
  });
  return { orderId, final };
}

async function runPsdCheck(user: SmokeUser, orderNumber: string) {
  const psd = await request('PSD生成 returns result', '/api/color-extraction/generate-psd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({ orderNumber }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.psdUrl));

  return psd.body?.data?.psdUrl || null;
}

async function runMarketChecks(seller: SmokeUser, buyer: SmokeUser, admin: SmokeUser, imageBuffer: Buffer) {
  const list = await request('图市 approved list', '/api/market/listings?mode=approved', {
    headers: { Cookie: buyer.cookie },
  }, (result) => result.ok && result.body?.success === true && Array.isArray(result.body?.data));

  await request('图市 stats as admin', '/api/market/stats', {
    headers: { Cookie: admin.cookie },
  }, (result) => result.ok && result.body?.success === true && typeof result.body?.data?.pendingCount === 'number');

  const formData = new FormData();
  formData.append('imageFile', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), `${marker}-market.jpg`);
  formData.append('title', `${marker} 图市巡检素材`);
  formData.append('description', '生产巡检自动创建，验证后自动清理。');
  formData.append('category', '巡检测试');
  formData.append('tags', '巡检 测试');
  formData.append('pricePoints', '1');
  formData.append('psdMode', 'none');

  const created = await request('图市 direct listing upload', '/api/market/listings', {
    method: 'POST',
    headers: { Cookie: seller.cookie },
    body: formData,
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.id));
  const itemId = created.body?.data?.id;
  if (!itemId) return;
  createdMarketItemIds.add(itemId);

  await request('图市 admin approve listing', '/api/market/listings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ id: itemId, status: 'approved' }),
  }, (result) => result.ok && result.body?.success === true && result.body?.data?.status === 'approved');

  await request('图市 seller download own listing', `/api/market/download?itemId=${encodeURIComponent(itemId)}&type=image`, {
    headers: { Cookie: seller.cookie },
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.url));

  await request('图市 buyer purchase listing', '/api/market/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: buyer.cookie },
    body: JSON.stringify({ itemId }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.orderNumber));

  await request('图市 buyer purchased list includes item', '/api/market/listings?mode=purchased', {
    headers: { Cookie: buyer.cookie },
  }, (result) => result.ok && result.body?.success === true && Array.isArray(result.body?.data)
    && result.body.data.some((item: any) => item.id === itemId));

  await request('图市 buyer download purchased listing', `/api/market/download?itemId=${encodeURIComponent(itemId)}&type=image`, {
    headers: { Cookie: buyer.cookie },
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.url));

  push('图市 existing approved list available', list.ok, { approvedCount: Array.isArray(list.body?.data) ? list.body.data.length : null });
}

async function runMaterialAndPluginChecks(user: SmokeUser, imageUrl: string) {
  await request('素材库 list', '/api/plugin/captured-images?limit=10', {
    headers: { Cookie: user.cookie },
  }, (result) => result.ok && result.body?.success === true && Array.isArray(result.body?.data));

  await request('OSS direct upload policy', '/api/upload/oss-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({
      fileName: `${marker}.jpg`,
      contentType: 'image/jpeg',
      fileSize: 1024,
      folder: 'uploads',
    }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.key));

  await request('插件采集 server fallback', '/api/plugin/capture-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
    body: JSON.stringify({
      imageUrl,
      pageUrl: absoluteUrl('/market'),
      pageTitle: `${marker} plugin smoke`,
      sourceHost: 'zaomengai.icu',
      imageType: 'main',
      capturedAt: Date.now(),
    }),
  }, (result) => result.ok && result.body?.success === true && Boolean(result.body?.data?.material?.id));
}

async function cleanupUsers() {
  const pool = await getMysqlPool();
  const db = await getDb();
  const ids = new Set(createdUserIds);

  const poolForLookup = await getMysqlPool();
  const [smokeUsers] = await poolForLookup.query<any[]>(
    'SELECT id FROM users WHERE email LIKE ? OR email = ?',
    ['assistant-prod-smoke-%@example.test', 'assistant-real-smoke@example.test'],
  );
  for (const row of smokeUsers as Array<{ id?: string }>) {
    if (row.id) ids.add(row.id);
  }

  for (const email of touchedLegacyTestEmails) {
    const user = await userManager.getUserByEmail(email).catch(() => null);
    if (user) ids.add(user.id);
  }

  const userIds = [...ids].filter(Boolean);
  if (userIds.length === 0) return;

  try {
    const [itemRows] = await pool.query<any[]>(
      `SELECT id FROM market_items WHERE seller_id IN (${userIds.map(() => '?').join(',')})`,
      userIds,
    );
    for (const row of itemRows as Array<{ id?: string }>) {
      if (row.id) createdMarketItemIds.add(row.id);
    }

    const itemIds = [...createdMarketItemIds].filter(Boolean);
    if (itemIds.length > 0) {
      await db.delete(marketPurchases).where(inArray(marketPurchases.itemId, itemIds));
      await db.delete(marketItems).where(inArray(marketItems.id, itemIds));
    }

    await db.delete(marketPurchases).where(inArray(marketPurchases.buyerId, userIds));
    await db.delete(marketPurchases).where(inArray(marketPurchases.sellerId, userIds));

    for (const userId of userIds) {
      await capturedImageManager.clearUserCapturedImages(userId).catch(() => {});
      await pool.query('DELETE FROM transactions WHERE user_id = ?', [userId]).catch(() => {});
      await userManager.deleteUser(userId).catch(() => {});
    }

    push('cleanup test users/data', true, { userIds: userIds.length, marketItems: createdMarketItemIds.size });
  } catch (error) {
    push('cleanup test users/data', false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function main() {
  let seller: SmokeUser | null = null;
  let buyer: SmokeUser | null = null;
  let admin: SmokeUser | null = null;

  try {
    seller = await ensureUser('seller', { points: startingPoints });
    buyer = await ensureUser('buyer', { points: startingPoints });
    admin = await ensureUser('admin', { points: startingPoints, isAdmin: true });

    await request('plugin version', '/api/plugin/version', undefined, (result) => result.ok && result.body?.success === true);
    await request('profile current user', '/api/user/profile', {
      headers: { Cookie: buyer.cookie },
    }, (result) => result.ok && result.body?.success !== false);
    await request('admin generations', '/api/admin/generations?limit=5', {
      headers: { Cookie: admin.cookie },
    }, (result) => result.ok && result.body?.success === true);

    const upload = await uploadTestImage(buyer.cookie, 'core-source');
    const sourceSize = { width: upload.width, height: upload.height };
    await runMaterialAndPluginChecks(buyer, upload.imageUrl);
    await runMarketChecks(seller, buyer, admin, upload.buffer);
    await runImmediatePaidChecks(buyer, upload.imageUrl, sourceSize);

    if (runSlow) {
      const hd = await runAsyncTool('高清放大', buyer, '/api/hd-upscale/run', upload.imageUrl, 6 * 60 * 1000);
      const rb = await runAsyncTool('移除背景', buyer, '/api/remove-background/run', upload.imageUrl, 10 * 60 * 1000);
      const outpaint = await runAsyncTool('高清+扩图', buyer, '/api/outpaint-upsampling/run', upload.imageUrl, 8 * 60 * 1000);
      const color = await runAsyncTool('彩绘提取', buyer, '/api/color-extraction/run', upload.imageUrl, 12 * 60 * 1000);

      if (runPsd && color?.final?.status === '成功' && color.orderId) {
        const psdUrl = await runPsdCheck(buyer, color.orderId);
        push('PSD URL generated', Boolean(psdUrl), { psdUrl: redactUrl(psdUrl) });
      } else {
        push('PSD generation skipped', true, {
          reason: runPsd ? 'color extraction did not finish successfully' : 'set PROD_SMOKE_RUN_PSD=true to run paid PSD smoke',
        });
      }

      push('async tools submitted summary', true, {
        hd: hd?.final?.status || null,
        removeBackground: rb?.final?.status || null,
        outpaint: outpaint?.final?.status || null,
        colorExtraction: color?.final?.status || null,
      });
    } else {
      push('slow paid tools skipped', true, { reason: 'PROD_SMOKE_SKIP_SLOW=true' });
    }
  } finally {
    await cleanupUsers().catch((error) => {
      console.error('[production-core-smoke] cleanup failed:', error);
      process.exitCode = 1;
    });
    await getMysqlPool().then((pool) => pool.end()).catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    runId,
    baseUrl,
    counts: {
      passed: results.length - failed.length,
      failed: failed.length,
    },
    failed,
    results,
  }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error('[production-core-smoke] fatal:', error);
  await getMysqlPool().then((pool) => pool.end()).catch(() => {});
  process.exitCode = 1;
});
