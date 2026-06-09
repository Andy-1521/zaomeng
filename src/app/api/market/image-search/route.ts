import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { marketManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';

const MAX_SEARCH_IMAGE_BYTES = 12 * 1024 * 1024;
const FEATURE_CACHE_TTL_MS = 30 * 60 * 1000;

type ImageFeature = {
  histogram: number[];
  luminance: number[];
  colorLayout: number[];
  aspectRatio: number;
};

type ImageFeatureSet = {
  focused: ImageFeature;
  full: ImageFeature;
};

type CachedFeature = {
  feature: ImageFeatureSet;
  expiresAt: number;
};

type MarketSearchCandidate = Awaited<ReturnType<typeof marketManager.listApproved>>[number];

const marketImageFeatureCache = new Map<string, CachedFeature>();

async function loadLocalPreviewMarketItems(keyword: string): Promise<MarketSearchCandidate[] | null> {
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const filePath = join(process.cwd(), '.cache', 'market-preview.json');
    const raw = await readFile(filePath, 'utf8');
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return null;
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filteredItems = normalizedKeyword
      ? items.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return [record.title, record.category, record.description, ...(Array.isArray(record.tags) ? record.tags : [])]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(normalizedKeyword));
      })
      : items;
    return filteredItems as MarketSearchCandidate[];
  } catch {
    return null;
  }
}

function normalizeVector(vector: number[]) {
  const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (!length) return vector;
  return vector.map((value) => value / length);
}

function cosineSimilarity(a: number[], b: number[]) {
  const count = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < count; index += 1) {
    dot += a[index] * b[index];
  }
  return Math.max(0, Math.min(1, dot));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

async function fetchImageBuffer(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error('图片读取失败');
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_SEARCH_IMAGE_BYTES) {
      throw new Error('图片过大');
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

function estimateBorderColor(data: Buffer, width: number, height: number, channels: number) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const borderSize = Math.max(2, Math.floor(Math.min(width, height) * 0.06));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > borderSize && x < width - borderSize && y > borderSize && y < height - borderSize) continue;
      const offset = (y * width + x) * channels;
      red += data[offset];
      green += data[offset + 1];
      blue += data[offset + 2];
      count += 1;
    }
  }

  return {
    red: red / Math.max(1, count),
    green: green / Math.max(1, count),
    blue: blue / Math.max(1, count),
  };
}

async function createPatternFocusedPreview(input: Buffer) {
  const { data, info } = await sharp(input, { failOnError: false })
    .rotate()
    .resize(192, 192, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const background = estimateBorderColor(data, width, height, channels);
  const scores: number[] = [];
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let selectedCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const { saturation, value } = rgbToHsv(r, g, b);
      const bgDiff = colorDistance(r, g, b, background.red, background.green, background.blue);
      const rightOffset = (y * width + Math.min(width - 1, x + 1)) * channels;
      const downOffset = (Math.min(height - 1, y + 1) * width + x) * channels;
      const edgeDiff = Math.max(
        colorDistance(r, g, b, data[rightOffset], data[rightOffset + 1], data[rightOffset + 2]),
        colorDistance(r, g, b, data[downOffset], data[downOffset + 1], data[downOffset + 2])
      );
      const centerDistance = Math.hypot((x / width - 0.5) * 1.05, y / height - 0.5);
      const centerWeight = clamp(1 - centerDistance * 1.65, 0, 1);
      const plainBackgroundPenalty = saturation < 0.08 && value > 0.88 && bgDiff < 0.16 ? 0.65 : 0;
      const score = clamp(bgDiff * 0.48 + saturation * 0.24 + edgeDiff * 0.34 + centerWeight * 0.1 - plainBackgroundPenalty, 0, 1);
      scores.push(score);
    }
  }

  const sortedScores = [...scores].sort((a, b) => a - b);
  const threshold = Math.max(0.16, sortedScores[Math.floor(sortedScores.length * 0.78)] || 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const score = scores[y * width + x];
      if (score < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      selectedCount += 1;
    }
  }

  const rawImage = sharp(data, { raw: { width, height, channels } });
  const selectedRatio = selectedCount / Math.max(1, width * height);
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const boxAreaRatio = (boxWidth * boxHeight) / Math.max(1, width * height);
  const shouldCrop = selectedCount > 24 && selectedRatio > 0.012 && boxAreaRatio > 0.03 && boxAreaRatio < 0.86;

  if (!shouldCrop) {
    return rawImage.png().toBuffer();
  }

  const padX = Math.max(8, Math.round(boxWidth * 0.18));
  const padY = Math.max(8, Math.round(boxHeight * 0.18));
  const left = clamp(minX - padX, 0, width - 1);
  const top = clamp(minY - padY, 0, height - 1);
  const right = clamp(maxX + padX, left + 1, width);
  const bottom = clamp(maxY + padY, top + 1, height);

  return rawImage
    .extract({
      left: Math.round(left),
      top: Math.round(top),
      width: Math.max(1, Math.round(right - left)),
      height: Math.max(1, Math.round(bottom - top)),
    })
    .png()
    .toBuffer();
}

async function extractVisualFeature(input: Buffer): Promise<ImageFeature> {
  const metadata = await sharp(input, { failOnError: false }).rotate().metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;

  const { data, info } = await sharp(input, { failOnError: false })
    .rotate()
    .resize(48, 48, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const histogram = Array.from({ length: 12 * 4 * 4 }, () => 0);
  const colorCells = Array.from({ length: 4 * 4 * 3 }, () => 0);
  const colorCellCounts = Array.from({ length: 4 * 4 }, () => 0);
  const luminance: number[] = [];
  const channels = info.channels;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const pixel = (y * info.width + x) * channels;
      const r = data[pixel];
      const g = data[pixel + 1];
      const b = data[pixel + 2];
    const { hue, saturation, value } = rgbToHsv(r, g, b);
    const hueBin = Math.min(11, Math.floor(hue * 12));
    const saturationBin = Math.min(3, Math.floor(saturation * 4));
    const valueBin = Math.min(3, Math.floor(value * 4));
    histogram[hueBin * 16 + saturationBin * 4 + valueBin] += 1;
    luminance.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
      const cellX = Math.min(3, Math.floor(x / Math.max(1, info.width / 4)));
      const cellY = Math.min(3, Math.floor(y / Math.max(1, info.height / 4)));
      const cellIndex = cellY * 4 + cellX;
      colorCells[cellIndex * 3] += r / 255;
      colorCells[cellIndex * 3 + 1] += g / 255;
      colorCells[cellIndex * 3 + 2] += b / 255;
      colorCellCounts[cellIndex] += 1;
    }
  }

  for (let index = 0; index < colorCellCounts.length; index += 1) {
    const count = Math.max(1, colorCellCounts[index]);
    colorCells[index * 3] /= count;
    colorCells[index * 3 + 1] /= count;
    colorCells[index * 3 + 2] /= count;
  }

  const mean = luminance.reduce((total, value) => total + value, 0) / Math.max(1, luminance.length);
  const centeredLuminance = luminance.map((value) => value - mean);

  return {
    histogram: normalizeVector(histogram),
    luminance: normalizeVector(centeredLuminance),
    colorLayout: normalizeVector(colorCells),
    aspectRatio: width / height,
  };
}

async function extractPatternImageFeatureSet(input: Buffer): Promise<ImageFeatureSet> {
  const focusedPreview = await createPatternFocusedPreview(input);
  const [focused, full] = await Promise.all([
    extractVisualFeature(focusedPreview),
    extractVisualFeature(input),
  ]);
  return { focused, full };
}

function compareImageFeatures(query: ImageFeature, candidate: ImageFeature) {
  const colorScore = cosineSimilarity(query.histogram, candidate.histogram);
  const structureScore = cosineSimilarity(query.luminance, candidate.luminance);
  const layoutScore = cosineSimilarity(query.colorLayout, candidate.colorLayout);
  const aspectPenalty = Math.min(1.8, Math.abs(Math.log(query.aspectRatio / Math.max(candidate.aspectRatio, 0.01))));
  const aspectScore = 1 - aspectPenalty / 1.8;
  return Math.round((colorScore * 0.45 + structureScore * 0.25 + layoutScore * 0.22 + aspectScore * 0.08) * 1000) / 1000;
}

function compareImageFeatureSets(query: ImageFeatureSet, candidate: ImageFeatureSet) {
  const focusedScore = compareImageFeatures(query.focused, candidate.focused);
  const candidateFullScore = compareImageFeatures(query.focused, candidate.full);
  const queryFullScore = compareImageFeatures(query.full, candidate.focused);
  const stableScore = focusedScore * 0.62 + candidateFullScore * 0.25 + queryFullScore * 0.13;
  return Math.round(Math.max(focusedScore, stableScore) * 1000) / 1000;
}

async function getFeatureForMarketImage(cacheKey: string, url: string) {
  const cached = marketImageFeatureCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.feature;
  }

  const buffer = await fetchImageBuffer(url);
  const feature = await extractPatternImageFeatureSet(buffer);
  marketImageFeatureCache.set(cacheKey, {
    feature,
    expiresAt: Date.now() + FEATURE_CACHE_TTL_MS,
  });
  return feature;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image');
    const keyword = typeof formData.get('keyword') === 'string' ? String(formData.get('keyword')).trim() : '';

    if (!(image instanceof File)) {
      return NextResponse.json({ success: false, message: '请先选择参考图片' }, { status: 400 });
    }
    if (!image.type.startsWith('image/')) {
      return NextResponse.json({ success: false, message: '只支持图片文件' }, { status: 400 });
    }
    if (image.size <= 0 || image.size > MAX_SEARCH_IMAGE_BYTES) {
      return NextResponse.json({ success: false, message: '参考图片需小于 12MB' }, { status: 400 });
    }

    const userId = getCookieUserId(request);
    const queryFeature = await extractPatternImageFeatureSet(Buffer.from(await image.arrayBuffer()));
    let candidates: MarketSearchCandidate[];
    try {
      candidates = await marketManager.listApproved(userId, { keyword, limit: 120 });
    } catch (databaseError) {
      const previewItems = await loadLocalPreviewMarketItems(keyword);
      if (!previewItems) throw databaseError;
      console.warn('[图市] 本地数据库不可用，以图搜图使用 .cache/market-preview.json 预览数据:', databaseError);
      candidates = previewItems.slice(0, 120);
    }
    const ranked = await mapWithConcurrency(candidates, 6, async (item) => {
      const imageUrl = item.thumbnailUrl || item.previewImageUrl || item.sourceImageUrl;
      if (!imageUrl) return null;

      try {
        const feature = await getFeatureForMarketImage(`${item.id}:${imageUrl}`, imageUrl);
        return {
          ...item,
          similarityScore: compareImageFeatureSets(queryFeature, feature),
        };
      } catch (error) {
        console.warn('[图市] 相似图片特征提取失败:', item.id, error);
        return null;
      }
    });

    const results = ranked
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 60);

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('[图市] 以图搜图失败:', error);
    return NextResponse.json({ success: false, message: '以图搜图失败，请稍后重试' }, { status: 500 });
  }
}
