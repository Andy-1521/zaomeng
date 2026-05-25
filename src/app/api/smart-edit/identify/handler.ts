import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { buildOpenAICompatUrl, getOpenAICompatApiKey } from '@/lib/openaiCompatible';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

const FAST_VISION_MODEL = 'gpt-5.4-mini';
const MAX_CANDIDATES = 4;
const IDENTIFY_CACHE_TTL_MS = 10 * 60 * 1000;
const IDENTIFY_CACHE_DISTANCE = 0.015;
const IMAGE_ASSET_CACHE_TTL_MS = 10 * 60 * 1000;

function getIdentifyErrorMessage(error?: unknown) {
  if (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message)) {
    return '识别耗时较长，请稍后重试';
  }

  return '识别失败，请重试';
}

type IdentifyCacheEntry = {
  imageUrl: string;
  ratioX: number;
  ratioY: number;
  result: IdentifyResult;
  createdAt: number;
};

const identifyCache = new Map<string, IdentifyCacheEntry[]>();

interface IdentifyRequest {
  action?: 'identify' | 'prewarm';
  imageUrl: string;
  sessionId?: string;
  clickX: number;
  clickY: number;
  imageWidth: number;
  imageHeight: number;
  forceRefresh?: boolean;
}

interface IdentifyResult {
  description: string;
  candidates: string[];
}

type PreparedImageAssets = {
  normalizedBuffer: Buffer;
  width: number;
  height: number;
  overviewUrl: string;
  createdAt: number;
};

const imageAssetCache = new Map<string, PreparedImageAssets>();

/**
 * 调用视觉模型识别图片中指定位置的内容
 * 使用 Psydo OpenAI 兼容视觉模型，支持多模态输入
 */
async function callVisionModel(
  apiKey: string,
  model: string,
  imageUrls: string[],
  prompt: string
): Promise<string> {
  const response = await fetch(buildOpenAICompatUrl('/chat/completions'), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
      max_tokens: 220,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const result = await response.json() as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };

  return result.choices?.[0]?.message?.content?.trim() || '';
}

async function fetchImageBuffer(imageUrl: string, request: NextRequest): Promise<{ buffer: Buffer; contentType: string }> {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 30000,
    maxBytes: 30 * 1024 * 1024,
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  return { buffer: image.buffer, contentType: image.contentType };
}

function resolveImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toDataUrl(buffer: Buffer, contentType = 'image/png') {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function getFreshPreparedAssets(imageUrl: string) {
  const cached = imageAssetCache.get(imageUrl);
  if (!cached) return null;

  if (Date.now() - cached.createdAt > IMAGE_ASSET_CACHE_TTL_MS) {
    imageAssetCache.delete(imageUrl);
    return null;
  }

  return cached;
}

async function prepareImageAssets(imageUrl: string, request: NextRequest, forceRefresh = false) {
  const startedAt = Date.now();

  if (!forceRefresh) {
    const cached = getFreshPreparedAssets(imageUrl);
    if (cached) {
      console.info('[Identify] image-assets-cache-hit', {
        durationMs: Date.now() - startedAt,
      });
      return { assets: cached, cached: true };
    }
  }

  const { buffer } = await fetchImageBuffer(imageUrl, request);
  const normalizedBuffer = await sharp(buffer).rotate().png().toBuffer();
  const metadata = await sharp(normalizedBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error('无法读取图片尺寸');
  }

  const overviewBuffer = await sharp(normalizedBuffer)
    .resize(896, 896, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();

  const assets: PreparedImageAssets = {
    normalizedBuffer,
    width,
    height,
    overviewUrl: toDataUrl(overviewBuffer, 'image/jpeg'),
    createdAt: Date.now(),
  };

  imageAssetCache.set(imageUrl, assets);
  console.info('[Identify] image-assets-prepared', {
    forceRefresh,
    width,
    height,
    durationMs: Date.now() - startedAt,
  });
  return { assets, cached: false };
}

async function buildFocusCrop(
  imageBuffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  clickX: number,
  clickY: number,
  zoomRatio: number,
  outputSize: number
) {
  const cropSize = clamp(Math.round(Math.min(imageWidth, imageHeight) * zoomRatio), 160, 560);
  const left = clamp(Math.round(clickX - cropSize / 2), 0, Math.max(0, imageWidth - cropSize));
  const top = clamp(Math.round(clickY - cropSize / 2), 0, Math.max(0, imageHeight - cropSize));

  const cropBuffer = await sharp(imageBuffer)
    .rotate()
    .extract({ left, top, width: Math.min(cropSize, imageWidth), height: Math.min(cropSize, imageHeight) })
      .resize(outputSize, outputSize, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

  return toDataUrl(cropBuffer, 'image/png');
}

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/^[。、！？，：;；""''【】\s]+/, '')
    .replace(/[。、！？，：;；""''【】\s]+$/, '')
    .replace(/\n/g, '')
    .substring(0, 30);
}

function normalizeCandidates(values: string[], primary: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of [...values, primary]) {
    const cleaned = cleanLabel(value);
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);

    if (result.length >= MAX_CANDIDATES) {
      break;
    }
  }

  return result;
}

function isLikelyNoiseLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^[A-Z0-9\-_/]+$/.test(trimmed) && trimmed.length <= 16) return true;
  if (/^[a-z0-9\-_/]+$/.test(trimmed) && trimmed.length <= 16) return true;
  if (/^[0-9]+$/.test(trimmed)) return true;
  if (/^(logo|text|pattern|object|item|thing|part)$/i.test(trimmed)) return true;
  return false;
}

function parseIdentifyResult(raw: string): IdentifyResult {
  const cleanedRaw = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleanedRaw) as { description?: string; primary?: string; label?: string; candidates?: unknown[] };
  const description = cleanLabel(parsed.description || parsed.primary || parsed.label || '');
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.map(String) : [];
  const filteredCandidates = candidates.filter((item: string) => !isLikelyNoiseLabel(item));
  const primary = description || cleanLabel(filteredCandidates[0] || '');
  const normalizedCandidates = normalizeCandidates(filteredCandidates, primary);

  if (!primary || normalizedCandidates.length === 0) {
    throw new Error('识别模型返回格式不完整');
  }

  return {
    description: primary,
    candidates: normalizedCandidates,
  };
}

function getCachedIdentifyResult(imageUrl: string, ratioX: number, ratioY: number) {
  const entries = identifyCache.get(imageUrl);
  if (!entries?.length) return null;

  const now = Date.now();
  const freshEntries = entries.filter((entry) => now - entry.createdAt <= IDENTIFY_CACHE_TTL_MS);
  if (freshEntries.length !== entries.length) {
    if (freshEntries.length > 0) {
      identifyCache.set(imageUrl, freshEntries);
    } else {
      identifyCache.delete(imageUrl);
    }
  }

  let best: IdentifyCacheEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of freshEntries) {
    const dx = entry.ratioX - ratioX;
    const dy = entry.ratioY - ratioY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= IDENTIFY_CACHE_DISTANCE && distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best?.result || null;
}

function setCachedIdentifyResult(imageUrl: string, ratioX: number, ratioY: number, result: IdentifyResult) {
  const now = Date.now();
  const nextEntry: IdentifyCacheEntry = { imageUrl, ratioX, ratioY, result, createdAt: now };
  const current = identifyCache.get(imageUrl) || [];
  const deduped = current.filter((entry) => {
    const dx = entry.ratioX - ratioX;
    const dy = entry.ratioY - ratioY;
    return now - entry.createdAt <= IDENTIFY_CACHE_TTL_MS && Math.sqrt(dx * dx + dy * dy) > IDENTIFY_CACHE_DISTANCE;
  });
  deduped.unshift(nextEntry);
  identifyCache.set(imageUrl, deduped.slice(0, 24));
}

export async function POST(request: NextRequest) {
  try {
    const body: IdentifyRequest = await request.json();
    const { action, imageUrl, sessionId, clickX, clickY, imageWidth, imageHeight, forceRefresh } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const resolvedImageUrl = resolveImageUrl(imageUrl, request);

    if (action === 'prewarm') {
      const prepared = await prepareImageAssets(resolvedImageUrl, request, forceRefresh === true);
      console.info('[Identify] prewarm-complete', {
        sessionId: sessionId || 'unknown',
        cached: prepared.cached,
        width: prepared.assets.width,
        height: prepared.assets.height,
      });
      return NextResponse.json({
        success: true,
        data: {
          prepared: true,
          cached: prepared.cached,
          width: prepared.assets.width,
          height: prepared.assets.height,
        },
      });
    }

    if (clickX === undefined || clickY === undefined) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const prepared = await prepareImageAssets(resolvedImageUrl, request, false);
    const sourceWidth = imageWidth || prepared.assets.width;
    const sourceHeight = imageHeight || prepared.assets.height;

    // 计算点击位置占比
    const ratioX = sourceWidth ? clickX / sourceWidth : 0;
    const ratioY = sourceHeight ? clickY / sourceHeight : 0;
    const assetClickX = Math.round(ratioX * prepared.assets.width);
    const assetClickY = Math.round(ratioY * prepared.assets.height);

    if (!forceRefresh) {
      const cachedResult = getCachedIdentifyResult(resolvedImageUrl, ratioX, ratioY);
      if (cachedResult) {
        console.info('[Identify] label-cache-hit', {
          sessionId: sessionId || 'unknown',
          ratioX: Number(ratioX.toFixed(4)),
          ratioY: Number(ratioY.toFixed(4)),
        });
        return NextResponse.json({
          success: true,
          description: cachedResult.description,
          candidates: cachedResult.candidates,
          position: { x: clickX, y: clickY, ratioX, ratioY },
          cached: true,
        });
      }
    }

    const apiKey = getOpenAICompatApiKey();

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: getIdentifyErrorMessage() },
        { status: 500 }
      );
    }

    const prompt = `你会看到多张图。

前两张图分别是点击位置附近的近景裁切和更近距离特写，最后一张是原图缩略总览。请优先参考前两张图的中心区域，再结合最后一张图的整体语境，识别这个点击点本身最准确的单个标记。

观察图片中位置(${Math.round(ratioX * 100)}%, ${Math.round(ratioY * 100)}%)附近的内容。

请只返回一个 JSON 对象，不要输出 Markdown，不要解释：
{
  "description": "最准确的单个标记",
  "candidates": ["候选1", "候选2", "候选3"]
}

规则：
- 只识别前两张图中心位置对应的内容，不要识别附近更显眼但偏离中心的文字或物体
- 优先识别该位置本身最可能的物体、图案、人物部位或文字
- 如果该位置是文字，候选词可以同时包含“文字ABC”和“ABC”这种更短的叫法
- 如果有歧义，给出 2 到 4 个从最可能到次可能的候选标记
- 每个标记不超过 12 个字
- 如果点击点没有直接落在文字笔画上，不要优先返回附近文字
- 不要把图案、花纹、纹理误认为文字`;

    const betterPrompt = `${prompt}
- 尽量使用中文名词或常见中文叫法，只有确实没有中文时才给英文名词
- 不要返回“所选区域”“点击位置”“图案”“内容”“元素”这类泛化词，除非实在无法识别
- 如果中心点落在局部小物件上，优先说该小物件，不要说整张图的大类`;

    const focusCropUrl = await buildFocusCrop(prepared.assets.normalizedBuffer, prepared.assets.width, prepared.assets.height, assetClickX, assetClickY, 0.32, 512);
    const detailCropUrl = await buildFocusCrop(prepared.assets.normalizedBuffer, prepared.assets.width, prepared.assets.height, assetClickX, assetClickY, 0.16, 576);
    const fullImageUrl = prepared.assets.overviewUrl;
    const modelResult = await callVisionModel(
      apiKey,
      FAST_VISION_MODEL,
      [focusCropUrl, detailCropUrl, fullImageUrl],
      betterPrompt.replace('请只返回一个 JSON 对象，不要输出 Markdown，不要解释：', `模型：${FAST_VISION_MODEL}\n\n请只返回一个 JSON 对象，不要输出 Markdown，不要解释：`)
    );

    if (!modelResult) {
      throw new Error('识别模型未返回结果');
    }

    const identifyResult = parseIdentifyResult(modelResult);
    setCachedIdentifyResult(resolvedImageUrl, ratioX, ratioY, identifyResult);

    console.info('[Identify] identify-complete', {
      sessionId: sessionId || 'unknown',
      cachedAssets: prepared.cached,
      ratioX: Number(ratioX.toFixed(4)),
      ratioY: Number(ratioY.toFixed(4)),
      candidateCount: identifyResult.candidates.length,
    });

    return NextResponse.json({
      success: true,
      description: identifyResult.description,
      candidates: identifyResult.candidates,
      position: { x: clickX, y: clickY, ratioX, ratioY },
    });
  } catch (error) {
    console.error('[识别区域] 失败:', error);
    return NextResponse.json(
      { success: false, error: getIdentifyErrorMessage(error) },
      { status: 500 }
    );
  }
}
