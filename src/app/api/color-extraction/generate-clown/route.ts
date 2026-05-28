import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { transactionManager, userManager } from '@/storage/database';
import { generateClownWithRunningHub, isRunningHubClownConfigured } from '@/lib/runningHub';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';
import { tryCreateAndUploadResultThumbnailFromUrl } from '@/lib/resultThumbnail';
import { getGenerateClownPoints } from '@/lib/pricing';
import { runPsydoImageEditWithMetaFromUrl } from '@/lib/psydoImageEdits';

type ParsedRecord = Record<string, unknown>;
type ClownGenerationStatus = 'processing' | 'success' | 'failed' | 'pending';
type ClownGenerationVariant = 'runninghub' | 'gpt';

export const runtime = 'nodejs';
export const maxDuration = 600;

const CLOWN_POINTS = getGenerateClownPoints();
const CLOWN_PROCESSING_STALE_MS = 12 * 60 * 1000;
const MASK_DOWNLOAD_LIMIT = 64;
const MASK_PIXEL_THRESHOLD = 16;
const MASK_MAX_REGIONS = 32;
const MASK_MIN_COMPONENT_AREA_RATIO = 0.00003;
const MASK_MIN_AREA_RATIO = 0.00008;
const MASK_DUPLICATE_OVERLAP_RATIO = 0.9;
const MASK_DUPLICATE_AREA_RATIO = 0.55;
const BACKGROUND_RGB: [number, number, number] = [12, 16, 24];
const GPT_CLOWN_TIMEOUT_MS = 300000;
const GPT_CLOWN_PROMPT = [
  'Create a Photoshop clown color selection map from the input image.',
  'Keep the exact same composition, object positions, scale, and canvas ratio.',
  'Convert every visible object, text, sticker, decoration, foreground area, and background region into clean flat solid color regions.',
  'Use high-contrast random colors. Each semantic region should be one flat color.',
  'No gradients, no shadows, no texture, no outlines, no labels, no watermark, no original image details, no antialias noise.',
  'The result must look like a clean segmentation/clown pass for Magic Wand color selection in Photoshop.',
].join(' ');

const CLOWN_PALETTE: Array<[number, number, number]> = [
  [255, 59, 92],
  [36, 188, 255],
  [255, 202, 40],
  [104, 230, 126],
  [180, 99, 255],
  [255, 132, 45],
  [0, 220, 190],
  [255, 95, 210],
  [119, 155, 255],
  [214, 255, 72],
  [255, 112, 112],
  [80, 255, 170],
  [190, 130, 60],
  [62, 120, 255],
  [255, 182, 0],
  [48, 235, 235],
  [230, 90, 255],
  [145, 255, 100],
  [255, 70, 140],
  [100, 200, 255],
  [245, 245, 80],
  [75, 255, 120],
  [170, 120, 255],
  [255, 155, 85],
];

type CleanedMaskFrame = {
  pixels: Uint8Array;
  area: number;
  index: number;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message)) {
    return 'Clown生成时间较长，请稍后重试';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Clown生成失败，请稍后重试';
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveImageUrl(value: string, request: NextRequest) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return new URL(value, request.nextUrl.origin).toString();
}

function parseRecord(value: unknown): ParsedRecord | null {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ParsedRecord : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value as ParsedRecord : null;
}

function getClownGenerationStatus(record: ParsedRecord | null): ClownGenerationStatus | null {
  const status = record?.clownGenerationStatus;
  return status === 'processing' || status === 'success' || status === 'failed' || status === 'pending' ? status : null;
}

function getGptClownGenerationStatus(record: ParsedRecord | null): ClownGenerationStatus | null {
  const status = record?.clownGptGenerationStatus;
  return status === 'processing' || status === 'success' || status === 'failed' || status === 'pending' ? status : null;
}

function getGenerationStatus(record: ParsedRecord, variant: ClownGenerationVariant) {
  return variant === 'gpt' ? getGptClownGenerationStatus(record) : getClownGenerationStatus(record);
}

function getRequestUser(request: NextRequest) {
  const userCookie = request.cookies.get('user')?.value;
  const user = parseRecord(userCookie);
  const id = getString(user?.id);
  if (!id) return null;

  return {
    id,
    isAdmin: user?.isAdmin === true,
  };
}

function getTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractImageUrls(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    const directUrl = getString(value);
    if (directUrl && (directUrl.startsWith('http://') || directUrl.startsWith('https://') || directUrl.startsWith('/'))) {
      return [directUrl];
    }

    try {
      return extractImageUrls(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractImageUrls(item));
  }

  if (typeof value === 'object') {
    const record = value as ParsedRecord;
    return [
      ...extractImageUrls(record.imageUrl),
      ...extractImageUrls(record.image_url),
      ...extractImageUrls(record.result_image_url),
      ...extractImageUrls(record.url),
      ...extractImageUrls(record.urls),
    ];
  }

  return [];
}

function getVariantExistingUrls(requestParams: ParsedRecord, variant: ClownGenerationVariant) {
  if (variant === 'gpt') {
    return {
      url: getString(requestParams.clownGptUrl),
      thumbnailUrl: getString(requestParams.clownGptThumbnailUrl),
    };
  }

  return {
    url: getString(requestParams.clownUrl),
    thumbnailUrl: getString(requestParams.clownThumbnailUrl),
  };
}

function getVariantPoints(requestParams: ParsedRecord, variant: ClownGenerationVariant) {
  const value = variant === 'gpt' ? requestParams.clownGptPoints : requestParams.clownPoints;
  return typeof value === 'number' && value > 0 ? value : CLOWN_POINTS;
}

function isVariantPointsCharged(requestParams: ParsedRecord, variant: ClownGenerationVariant) {
  return variant === 'gpt'
    ? requestParams.clownGptPointsCharged === true
    : requestParams.clownPointsCharged === true;
}

function withVariantProcessingParams(
  requestParams: ParsedRecord,
  variant: ClownGenerationVariant,
  clownPoints: number,
  chargedForClown: boolean,
) {
  if (variant === 'gpt') {
    return {
      ...requestParams,
      clownGptPoints: clownPoints,
      clownGptGenerationStatus: 'processing',
      clownGptGenerationStartedAt: new Date().toISOString(),
      clownGptGenerationError: undefined,
      clownGptPointsCharged: chargedForClown,
    };
  }

  return {
    ...requestParams,
    clownPoints,
    clownGenerationStatus: 'processing',
    clownGenerationStartedAt: new Date().toISOString(),
    clownGenerationError: undefined,
    clownPointsCharged: chargedForClown,
  };
}

function withVariantFailedParams(
  requestParams: ParsedRecord,
  variant: ClownGenerationVariant,
  clownPoints: number,
  error: unknown,
) {
  if (variant === 'gpt') {
    return {
      ...requestParams,
      clownGptPoints: clownPoints,
      clownGptGenerationStatus: 'failed',
      clownGptGenerationStartedAt: undefined,
      clownGptGenerationError: getErrorMessage(error),
      clownGptPointsCharged: false,
    };
  }

  return {
    ...requestParams,
    clownPoints,
    clownGenerationStatus: 'failed',
    clownGenerationStartedAt: undefined,
    clownGenerationError: getErrorMessage(error),
    clownPointsCharged: false,
  };
}

function colorKeyAt(buffer: Buffer, pixelIndex: number) {
  const offset = pixelIndex * 3;
  return `${buffer[offset]},${buffer[offset + 1]},${buffer[offset + 2]}`;
}

function binaryDilate(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (mask[pixelIndex]) {
        output[pixelIndex] = 1;
        continue;
      }

      let hasNeighbor = false;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !hasNeighbor; ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
          if (mask[ny * width + nx]) {
            hasNeighbor = true;
            break;
          }
        }
      }
      output[pixelIndex] = hasNeighbor ? 1 : 0;
    }
  }
  return output;
}

function binaryErode(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (!mask[pixelIndex]) continue;

      let allNeighbors = true;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && allNeighbors; ny += 1) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
          if (!mask[ny * width + nx]) {
            allNeighbors = false;
            break;
          }
        }
      }
      output[pixelIndex] = allNeighbors ? 1 : 0;
    }
  }
  return output;
}

function closeBinaryMask(mask: Uint8Array, width: number, height: number) {
  return binaryErode(binaryDilate(mask, width, height), width, height);
}

function removeSmallMaskComponents(mask: Uint8Array, width: number, height: number, minComponentArea: number) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const output = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const component: number[] = [];
  let keptArea = 0;

  for (let start = 0; start < totalPixels; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    component.length = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      component.push(pixelIndex);

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const neighbors = [
        x > 0 ? pixelIndex - 1 : -1,
        x < width - 1 ? pixelIndex + 1 : -1,
        y > 0 ? pixelIndex - width : -1,
        y < height - 1 ? pixelIndex + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || !mask[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail] = neighbor;
        tail += 1;
      }
    }

    if (component.length >= minComponentArea) {
      keptArea += component.length;
      for (const pixelIndex of component) {
        output[pixelIndex] = 1;
      }
    }
  }

  return {
    pixels: output,
    area: keptArea,
  };
}

function toCleanedMaskFrame(
  pixels: Buffer,
  width: number,
  height: number,
  index: number,
  minComponentArea: number,
  minMaskArea: number,
): CleanedMaskFrame | null {
  const binary = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) {
    binary[i] = pixels[i] > MASK_PIXEL_THRESHOLD ? 1 : 0;
  }

  const closed = closeBinaryMask(binary, width, height);
  let cleaned = removeSmallMaskComponents(closed, width, height, minComponentArea);
  if (cleaned.area < minMaskArea) {
    cleaned = removeSmallMaskComponents(binary, width, height, Math.max(16, Math.floor(minComponentArea / 3)));
  }
  if (cleaned.area < Math.max(48, Math.floor(minMaskArea / 3))) {
    return null;
  }

  return {
    pixels: cleaned.pixels,
    area: cleaned.area,
    index,
  };
}

function countMaskIntersection(a: Uint8Array, b: Uint8Array) {
  let intersection = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) intersection += 1;
  }
  return intersection;
}

function selectDistinctMaskFrames(maskFrames: CleanedMaskFrame[]) {
  const selected: CleanedMaskFrame[] = [];
  const sortedMasks = [...maskFrames].sort((a, b) => b.area - a.area);

  for (const mask of sortedMasks) {
    let isDuplicate = false;
    for (const existing of selected) {
      const intersection = countMaskIntersection(mask.pixels, existing.pixels);
      const smallerArea = Math.min(mask.area, existing.area);
      const largerArea = Math.max(mask.area, existing.area);
      const overlapRatio = smallerArea > 0 ? intersection / smallerArea : 0;
      const areaRatio = largerArea > 0 ? smallerArea / largerArea : 0;
      if (overlapRatio >= MASK_DUPLICATE_OVERLAP_RATIO && areaRatio >= MASK_DUPLICATE_AREA_RATIO) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      selected.push(mask);
    }
    if (selected.length >= MASK_MAX_REGIONS) {
      break;
    }
  }

  return selected;
}

function fillSmallBackgroundIslands(output: Buffer, assigned: Uint8Array, width: number, height: number) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const maxFillArea = Math.max(128, Math.floor(totalPixels * 0.0008));
  const queue = new Int32Array(totalPixels);
  const component: number[] = [];
  const neighborColorCounts = new Map<string, number>();

  for (let start = 0; start < totalPixels; start += 1) {
    if (assigned[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let touchesBorder = false;
    component.length = 0;
    neighborColorCounts.clear();
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      component.push(pixelIndex);

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      const neighbors = [
        x > 0 ? pixelIndex - 1 : -1,
        x < width - 1 ? pixelIndex + 1 : -1,
        y > 0 ? pixelIndex - width : -1,
        y < height - 1 ? pixelIndex + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0) continue;
        if (assigned[neighbor]) {
          const key = colorKeyAt(output, neighbor);
          neighborColorCounts.set(key, (neighborColorCounts.get(key) || 0) + 1);
          continue;
        }
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }

    if (touchesBorder || component.length > maxFillArea || neighborColorCounts.size === 0) {
      continue;
    }

    const bestColor = [...neighborColorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!bestColor) continue;

    const [r, g, b] = bestColor.split(',').map((value) => Number(value));
    if (![r, g, b].every((value) => Number.isFinite(value))) continue;

    for (const pixelIndex of component) {
      const offset = pixelIndex * 3;
      output[offset] = r;
      output[offset + 1] = g;
      output[offset + 2] = b;
      assigned[pixelIndex] = 1;
    }
  }
}

async function persistClownPngBuffer(clownBuffer: Buffer, orderNumber: string, request: NextRequest) {
  const clownUrl = await uploadToCozeStorage(clownBuffer, `color-extraction/clown/${orderNumber}.png`, 'image/png');
  const clownThumbnailUrl = await tryCreateAndUploadResultThumbnailFromUrl(
    clownUrl,
    `thumbnails/color-extraction/clown/${orderNumber}.webp`,
    'Clown生成',
    { localMaterialOrigin: request.nextUrl.origin },
  );
  return { clownUrl, clownThumbnailUrl };
}

async function persistRunningHubClownPng(outputUrl: string, orderNumber: string, request: NextRequest) {
  const image = await downloadSafeRemoteImage(outputUrl, {
    timeoutMs: 90000,
    maxBytes: 120 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  return persistClownPngBuffer(image.buffer, orderNumber, request);
}

async function downloadMaskBuffer(maskUrl: string, request: NextRequest) {
  const image = await downloadSafeRemoteImage(maskUrl, {
    timeoutMs: 90000,
    maxBytes: 80 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  return image.buffer;
}

async function composeClownPngFromMasks(maskUrls: string[], request: NextRequest) {
  const selectedMaskUrls = maskUrls.slice(0, MASK_DOWNLOAD_LIMIT);
  const masks = await Promise.all(selectedMaskUrls.map((maskUrl) => downloadMaskBuffer(maskUrl, request)));

  if (!masks.length) {
    throw new Error('Clown 工作流未返回可用mask输出');
  }

  const firstMetadata = await sharp(masks[0], { failOnError: false }).metadata();
  const width = firstMetadata.width || 0;
  const height = firstMetadata.height || 0;
  if (!width || !height) {
    throw new Error('Clown mask尺寸无效');
  }

  const totalPixels = width * height;
  const minComponentArea = Math.max(96, Math.floor(totalPixels * MASK_MIN_COMPONENT_AREA_RATIO));
  const minMaskArea = Math.max(180, Math.floor(totalPixels * MASK_MIN_AREA_RATIO));
  const maskFrames: CleanedMaskFrame[] = [];
  for (let index = 0; index < masks.length; index += 1) {
    const pixels = await sharp(masks[index], { failOnError: false })
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    const maskFrame = toCleanedMaskFrame(pixels, width, height, index, minComponentArea, minMaskArea);
    if (maskFrame) {
      maskFrames.push(maskFrame);
    }
  }

  if (!maskFrames.length) {
    throw new Error('Clown mask为空');
  }

  const output = Buffer.alloc(width * height * 3);
  const assigned = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 3;
    output[offset] = BACKGROUND_RGB[0];
    output[offset + 1] = BACKGROUND_RGB[1];
    output[offset + 2] = BACKGROUND_RGB[2];
  }

  const sortedMasks = selectDistinctMaskFrames(maskFrames);
  sortedMasks.forEach((mask, sortedIndex) => {
    const color = CLOWN_PALETTE[sortedIndex % CLOWN_PALETTE.length];
    for (let i = 0; i < mask.pixels.length; i += 1) {
      if (!mask.pixels[i]) continue;
      const offset = i * 3;
      output[offset] = color[0];
      output[offset + 1] = color[1];
      output[offset + 2] = color[2];
      assigned[i] = 1;
    }
  });

  fillSmallBackgroundIslands(output, assigned, width, height);
  smoothSmallColorIslands(output, width, height, 0.00022, 64);

  const buffer = await sharp(output, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  return {
    buffer,
    maskCount: sortedMasks.length,
  };
}

async function generateQuantizedClownFromSource(imageUrl: string, request: NextRequest) {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 90000,
    maxBytes: 80 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  const metadata = await sharp(image.buffer, { failOnError: false }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) {
    throw new Error('无法读取彩绘结果图尺寸');
  }

  const workingWidth = Math.min(width, 420);
  const workingHeight = Math.max(1, Math.round(height * (workingWidth / width)));
  const quantizedBuffer = await sharp(image.buffer, { failOnError: false })
    .rotate()
    .resize(workingWidth, workingHeight, { fit: 'fill' })
    .median(13)
    .blur(1.2)
    .png({ palette: true, colors: 10, dither: 0 })
    .toBuffer();
  const raw = await sharp(quantizedBuffer, { failOnError: false })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer();

  const colorCounts = new Map<string, number>();
  for (let i = 0; i < raw.length; i += 3) {
    const key = `${raw[i]},${raw[i + 1]},${raw[i + 2]}`;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }

  const sourceColors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const mappedColors = new Map<string, [number, number, number]>();
  sourceColors.forEach((key, index) => {
    mappedColors.set(key, index === 0 ? BACKGROUND_RGB : CLOWN_PALETTE[(index - 1) % CLOWN_PALETTE.length]);
  });

  const output = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 3) {
    const pixelIndex = i / 3;
    const offset = pixelIndex * 3;
    const key = `${raw[i]},${raw[i + 1]},${raw[i + 2]}`;
    const color = mappedColors.get(key) || BACKGROUND_RGB;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
  }

  smoothSmallColorIslands(output, width, height, 0.0012, 180);

  const colors = new Set<string>();
  for (let i = 0; i < output.length; i += 3) {
    colors.add(`${output[i]},${output[i + 1]},${output[i + 2]}`);
  }

  const buffer = await sharp(output, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  return {
    buffer,
    sourceWidth: width,
    sourceHeight: height,
    colorCount: colors.size,
  };
}

function resolveGptClownSize(width: number, height: number): '1024x1024' | '1024x1536' | '1536x1024' {
  if (width <= 0 || height <= 0) return '1024x1024';
  const aspectRatio = width / height;
  if (aspectRatio > 1.2) return '1536x1024';
  if (aspectRatio < 0.82) return '1024x1536';
  return '1024x1024';
}

function nearestPaletteColor(r: number, g: number, b: number) {
  const palette = [BACKGROUND_RGB, ...CLOWN_PALETTE];
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const color of palette) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }

  return best;
}

function smoothSmallColorIslands(output: Buffer, width: number, height: number, maxAreaRatio = 0.0006, minArea = 96) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const maxFillArea = Math.max(minArea, Math.floor(totalPixels * maxAreaRatio));
  const queue = new Int32Array(totalPixels);
  const component: number[] = [];
  const neighborColorCounts = new Map<string, number>();

  for (let start = 0; start < totalPixels; start += 1) {
    if (visited[start]) continue;

    const startOffset = start * 3;
    const sr = output[startOffset];
    const sg = output[startOffset + 1];
    const sb = output[startOffset + 2];
    let head = 0;
    let tail = 0;
    let count = 0;
    let touchesBorder = false;
    component.length = 0;
    neighborColorCounts.clear();
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      count += 1;
      if (component.length <= maxFillArea) {
        component.push(pixelIndex);
      }

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      const neighbors = [
        x > 0 ? pixelIndex - 1 : -1,
        x < width - 1 ? pixelIndex + 1 : -1,
        y > 0 ? pixelIndex - width : -1,
        y < height - 1 ? pixelIndex + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0) continue;
        const offset = neighbor * 3;
        const sameColor = output[offset] === sr && output[offset + 1] === sg && output[offset + 2] === sb;
        if (sameColor) {
          if (!visited[neighbor]) {
            visited[neighbor] = 1;
            queue[tail] = neighbor;
            tail += 1;
          }
          continue;
        }

        const key = colorKeyAt(output, neighbor);
        neighborColorCounts.set(key, (neighborColorCounts.get(key) || 0) + 1);
      }
    }

    if (touchesBorder || count > maxFillArea || component.length > maxFillArea || neighborColorCounts.size === 0) {
      continue;
    }

    const bestColor = [...neighborColorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!bestColor) continue;

    const [r, g, b] = bestColor.split(',').map((value) => Number(value));
    if (![r, g, b].every((value) => Number.isFinite(value))) continue;

    for (const pixelIndex of component) {
      const offset = pixelIndex * 3;
      output[offset] = r;
      output[offset + 1] = g;
      output[offset + 2] = b;
    }
  }
}

async function normalizeGptClownBuffer(buffer: Buffer, width: number, height: number) {
  const raw = await sharp(buffer, { failOnError: false })
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .median(5)
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer();

  const output = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 3;
    const color = nearestPaletteColor(raw[offset], raw[offset + 1], raw[offset + 2]);
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
  }

  smoothSmallColorIslands(output, width, height);

  const colors = new Set<string>();
  for (let i = 0; i < output.length; i += 3) {
    colors.add(`${output[i]},${output[i + 1]},${output[i + 2]}`);
  }

  const normalized = await sharp(output, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  return {
    buffer: normalized,
    colorCount: colors.size,
  };
}

async function generateGptClownWithPsydo(imageUrl: string, request: NextRequest) {
  const image = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 90000,
    maxBytes: 80 * 1024 * 1024,
    allowLocalMaterialFile: true,
    localMaterialOrigin: request.nextUrl.origin,
  });
  const metadata = await sharp(image.buffer, { failOnError: false }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) {
    throw new Error('无法读取彩绘结果图尺寸');
  }

  const editResult = await runPsydoImageEditWithMetaFromUrl({
    imageUrl,
    prompt: GPT_CLOWN_PROMPT,
    size: resolveGptClownSize(width, height),
    quality: 'high',
    timeoutMs: GPT_CLOWN_TIMEOUT_MS,
    localMaterialOrigin: request.nextUrl.origin,
  });
  const normalized = await normalizeGptClownBuffer(editResult.buffer, width, height);

  return {
    ...normalized,
    sourceWidth: width,
    sourceHeight: height,
    model: editResult.meta.model,
    baseUrl: editResult.meta.baseUrl,
  };
}

export async function POST(request: NextRequest) {
  let chargedUserId = '';
  let chargedPoints = 0;
  let chargedByThisRequest = false;
  let activeOrderNumber = '';
  let activeVariant: ClownGenerationVariant = 'runninghub';

  try {
    const body = await request.json();
    const { orderNumber, variant } = body as { orderNumber?: string; variant?: string };
    activeVariant = variant === 'gpt' ? 'gpt' : 'runninghub';

    if (!orderNumber) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }
    activeOrderNumber = orderNumber;

    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    if (transaction.toolPage !== '彩绘提取' && transaction.toolPage !== '彩绘提取2') {
      return NextResponse.json({ success: false, error: '只有彩绘提取订单可以生成Clown图' }, { status: 400 });
    }

    if (transaction.status !== '成功' && transaction.status !== 'success') {
      return NextResponse.json({ success: false, error: '彩绘提取成功后才能生成Clown图' }, { status: 400 });
    }

    const requestUser = getRequestUser(request);
    if (!requestUser) {
      return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 });
    }
    if (!requestUser.isAdmin && requestUser.id !== transaction.userId) {
      return NextResponse.json({ success: false, error: '无权操作该订单' }, { status: 403 });
    }

    const requestParams = parseRecord(transaction.requestParams) || {};
    const existingClown = getVariantExistingUrls(requestParams, activeVariant);
    const existingClownUrl = existingClown.url;
    const existingClownThumbnailUrl = existingClown.thumbnailUrl;
    if (existingClownUrl) {
      return NextResponse.json({
        success: true,
        message: activeVariant === 'gpt' ? 'GPT Clown图已存在' : 'Clown图已存在',
        data: {
          clownUrl: existingClownUrl,
          clownThumbnailUrl: existingClownThumbnailUrl || '',
          remainingPoints: transaction.remainingPoints,
        },
      });
    }

    const clownGenerationStatus = getGenerationStatus(requestParams, activeVariant);
    const clownGenerationStartedAt = getTimestamp(activeVariant === 'gpt'
      ? requestParams.clownGptGenerationStartedAt
      : requestParams.clownGenerationStartedAt);
    const isStaleProcessing = clownGenerationStatus === 'processing'
      && (!clownGenerationStartedAt || Date.now() - clownGenerationStartedAt > CLOWN_PROCESSING_STALE_MS);
    const clownPoints = getVariantPoints(requestParams, activeVariant);
    const clownPointsCharged = isVariantPointsCharged(requestParams, activeVariant);

    if (clownGenerationStatus === 'processing' && !isStaleProcessing) {
      return NextResponse.json({ success: false, error: activeVariant === 'gpt' ? 'GPT Clown生成中，请稍后再试' : 'Clown生成中，请稍后再试' }, { status: 409 });
    }

    const resultImages = extractImageUrls(transaction.resultData);
    const extractionImageUrl = resultImages[0] ? resolveImageUrl(resultImages[0], request) : null;
    if (!extractionImageUrl) {
      return NextResponse.json({ success: false, error: '订单暂无可用于Clown生成的彩绘结果图' }, { status: 400 });
    }

    if (activeVariant === 'runninghub' && !isRunningHubClownConfigured()) {
      return NextResponse.json({ success: false, error: 'Clown 分割工作流未配置' }, { status: 400 });
    }

    let chargedForClown = clownPointsCharged;
    let remainingPoints = transaction.remainingPoints;

    if (!clownPointsCharged) {
      const user = await userManager.getUserById(transaction.userId);
      if (!user) {
        return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
      }

      if ((user.points || 0) < clownPoints) {
        return NextResponse.json({ success: false, error: `积分不足，当前积分：${user.points}，需要：${clownPoints}` }, { status: 400 });
      }

      const chargedUser = await userManager.deductPointsAtomically(transaction.userId, clownPoints);
      if (!chargedUser) {
        return NextResponse.json({ success: false, error: '积分不足' }, { status: 400 });
      }

      chargedUserId = transaction.userId;
      chargedPoints = clownPoints;
      chargedByThisRequest = true;
      chargedForClown = true;
      remainingPoints = chargedUser.points;
    }

    await transactionManager.updateTransaction(orderNumber, {
      remainingPoints,
      points: chargedForClown && !clownPointsCharged ? (transaction.points || 0) + clownPoints : (transaction.points || 0),
      actualPoints: chargedForClown && !clownPointsCharged ? (transaction.actualPoints || 0) + clownPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify(withVariantProcessingParams(requestParams, activeVariant, clownPoints, chargedForClown)),
    });

    const clownResult = activeVariant === 'gpt'
      ? null
      : await generateClownWithRunningHub(extractionImageUrl);
    let composedClown: Awaited<ReturnType<typeof composeClownPngFromMasks>> | null = null;
    let quantizedFallback: Awaited<ReturnType<typeof generateQuantizedClownFromSource>> | null = null;
    let fallbackReason = '';
    if (clownResult?.maskUrls?.length) {
      try {
        composedClown = await composeClownPngFromMasks(clownResult.maskUrls, request);
      } catch (composeError) {
        if (composeError instanceof Error && /mask为空|未返回可用mask输出/i.test(composeError.message)) {
          fallbackReason = composeError.message;
          quantizedFallback = await generateQuantizedClownFromSource(extractionImageUrl, request);
        } else {
          throw composeError;
        }
      }
    }
    const gptClown = activeVariant === 'gpt'
      ? await generateGptClownWithPsydo(extractionImageUrl, request)
      : null;
    const persisted = gptClown
      ? await persistClownPngBuffer(gptClown.buffer, `${orderNumber}-gpt`, request)
      : composedClown
        ? await persistClownPngBuffer(composedClown.buffer, orderNumber, request)
        : quantizedFallback
          ? await persistClownPngBuffer(quantizedFallback.buffer, orderNumber, request)
          : clownResult?.outputUrl
            ? await persistRunningHubClownPng(clownResult.outputUrl, orderNumber, request)
            : null;

    if (!persisted) {
      throw new Error('Clown 工作流未返回可用PNG输出');
    }

    const successParams = activeVariant === 'gpt'
      ? {
          ...requestParams,
          clownGptUrl: persisted.clownUrl,
          clownGptThumbnailUrl: persisted.clownThumbnailUrl,
          clownGptGenerationStatus: 'success',
          clownGptGenerationStartedAt: undefined,
          clownGptGenerationError: undefined,
          clownGptProvider: 'psydo',
          clownGptWorkflowMode: 'gpt-image-2-prompt-palette-clean',
          clownGptModel: gptClown?.model,
          clownGptBaseUrl: gptClown?.baseUrl,
          clownGptColorCount: gptClown?.colorCount,
          clownGptSourceWidth: gptClown?.sourceWidth,
          clownGptSourceHeight: gptClown?.sourceHeight,
          clownGptPoints: clownPoints,
          clownGptPointsCharged: true,
          clownGptGeneratedAt: new Date().toISOString(),
        }
      : {
          ...requestParams,
          clownUrl: persisted.clownUrl,
          clownThumbnailUrl: persisted.clownThumbnailUrl,
          clownGenerationStatus: 'success',
          clownGenerationStartedAt: undefined,
          clownGenerationError: undefined,
          clownTaskId: clownResult?.taskId,
          clownProvider: 'runninghub',
          clownWorkflowMode: quantizedFallback ? 'source-quantize-fallback' : clownResult?.maskUrls?.length ? 'sam3-mask-compose-cleaned' : 'direct-png',
          clownMaskCount: composedClown?.maskCount,
          clownFallbackReason: fallbackReason || undefined,
          clownColorCount: quantizedFallback?.colorCount,
          clownSourceWidth: quantizedFallback?.sourceWidth,
          clownSourceHeight: quantizedFallback?.sourceHeight,
          clownPoints,
          clownPointsCharged: true,
          clownGeneratedAt: new Date().toISOString(),
        };

    await transactionManager.updateTransaction(orderNumber, {
      remainingPoints,
      points: chargedForClown && !clownPointsCharged ? (transaction.points || 0) + clownPoints : (transaction.points || 0),
      actualPoints: chargedForClown && !clownPointsCharged ? (transaction.actualPoints || 0) + clownPoints : (transaction.actualPoints || 0),
      requestParams: JSON.stringify(successParams),
    });

    return NextResponse.json({
      success: true,
      message: activeVariant === 'gpt' ? 'GPT Clown图生成成功' : 'Clown图生成成功',
      data: {
        clownUrl: persisted.clownUrl,
        clownThumbnailUrl: persisted.clownThumbnailUrl,
        remainingPoints,
      },
    });
  } catch (error: unknown) {
    console.error('[Clown生成] 异常:', error);

    try {
      if (activeOrderNumber) {
        const latest = await transactionManager.getTransactionByOrderNumber(activeOrderNumber);
        const requestParams = parseRecord(latest?.requestParams) || {};
        const clownPoints = getVariantPoints(requestParams, activeVariant);
        const shouldRefund = !!latest?.userId && isVariantPointsCharged(requestParams, activeVariant);
        const refundedUser = shouldRefund
          ? await userManager.addPointsAtomically(latest.userId, clownPoints)
          : null;
        chargedByThisRequest = false;
        await transactionManager.updateTransaction(activeOrderNumber, {
          remainingPoints: refundedUser?.points ?? latest?.remainingPoints,
          points: shouldRefund ? Math.max(0, (latest?.points || 0) - clownPoints) : (latest?.points || 0),
          actualPoints: shouldRefund ? Math.max(0, (latest?.actualPoints || 0) - clownPoints) : (latest?.actualPoints || 0),
          requestParams: JSON.stringify(withVariantFailedParams(requestParams, activeVariant, clownPoints, error)),
        });
      }
    } catch (statusError) {
      console.error('[Clown生成] 写入失败状态失败:', statusError);
      if (chargedByThisRequest && chargedUserId && chargedPoints > 0) {
        try {
          await userManager.addPointsAtomically(chargedUserId, chargedPoints);
        } catch (refundError) {
          console.error('[Clown生成] 异常退款失败:', refundError);
        }
      }
    }

    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
