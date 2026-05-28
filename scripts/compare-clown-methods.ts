import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getMysqlPool, transactionManager } from '@/storage/database';

type ParsedRecord = Record<string, unknown>;

const OUT_DIR = '/tmp/zaomeng-clown-methods';
const TILE_WIDTH = 220;
const TILE_HEIGHT = 386;
const LABEL_HEIGHT = 34;
const BACKGROUND_RGB: [number, number, number] = [12, 16, 24];
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
];

type QuantizeOptions = {
  name: string;
  colors: number;
  workingWidth: number;
  median: number;
  blur: number;
  smoothAreaRatio: number;
};

const QUANTIZE_METHODS: QuantizeOptions[] = [
  { name: '对齐量化-均衡', colors: 12, workingWidth: 520, median: 9, blur: 0.7, smoothAreaRatio: 0.0007 },
  { name: '对齐量化-少噪', colors: 10, workingWidth: 420, median: 13, blur: 1.2, smoothAreaRatio: 0.0012 },
  { name: '对齐量化-大块', colors: 7, workingWidth: 320, median: 17, blur: 1.6, smoothAreaRatio: 0.0022 },
];

function parseRecord(value: unknown): ParsedRecord {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ParsedRecord : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as ParsedRecord : {};
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function extractImageUrl(value: unknown): string {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    const parsed = parseRecord(value);
    return extractImageUrl(parsed.imageUrl || parsed.image_url || parsed.result_image_url || parsed.url || parsed.urls);
  }
  if (Array.isArray(value)) return extractImageUrl(value[0]);
  if (value && typeof value === 'object') {
    const record = value as ParsedRecord;
    return extractImageUrl(record.imageUrl || record.image_url || record.result_image_url || record.url || record.urls);
  }
  return '';
}

async function downloadBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function colorKeyAt(buffer: Buffer, pixelIndex: number) {
  const offset = pixelIndex * 3;
  return `${buffer[offset]},${buffer[offset + 1]},${buffer[offset + 2]}`;
}

function smoothSmallColorIslands(output: Buffer, width: number, height: number, maxAreaRatio: number) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const maxFillArea = Math.max(96, Math.floor(totalPixels * maxAreaRatio));
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
      if (component.length <= maxFillArea) component.push(pixelIndex);

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

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

    if (touchesBorder || count > maxFillArea || component.length > maxFillArea || neighborColorCounts.size === 0) continue;

    const bestColor = [...neighborColorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!bestColor) continue;

    const [r, g, b] = bestColor.split(',').map(Number);
    if (![r, g, b].every(Number.isFinite)) continue;

    for (const pixelIndex of component) {
      const offset = pixelIndex * 3;
      output[offset] = r;
      output[offset + 1] = g;
      output[offset + 2] = b;
    }
  }
}

async function quantizeSource(buffer: Buffer, options: QuantizeOptions) {
  const metadata = await sharp(buffer, { failOnError: false }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw new Error('无法读取图片尺寸');

  const workingWidth = Math.min(width, options.workingWidth);
  const workingHeight = Math.max(1, Math.round(height * (workingWidth / width)));
  const quantized = await sharp(buffer, { failOnError: false })
    .rotate()
    .resize(workingWidth, workingHeight, { fit: 'fill' })
    .median(options.median)
    .blur(options.blur)
    .png({ palette: true, colors: options.colors, dither: 0 })
    .toBuffer();
  const raw = await sharp(quantized, { failOnError: false })
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

  smoothSmallColorIslands(output, width, height, options.smoothAreaRatio);

  return sharp(output, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function makeTile(buffer: Buffer, label: string) {
  const image = await sharp(buffer, { failOnError: false })
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
    .png()
    .toBuffer();
  const labelSvg = Buffer.from(`
    <svg width="${TILE_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="10" y="22" fill="#ffffff" font-size="15" font-family="Arial, sans-serif">${label}</text>
    </svg>
  `);
  const labelBuffer = await sharp(labelSvg).png().toBuffer();
  return sharp({
    create: {
      width: TILE_WIDTH,
      height: TILE_HEIGHT + LABEL_HEIGHT,
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite([
      { input: labelBuffer, left: 0, top: 0 },
      { input: image, left: 0, top: LABEL_HEIGHT },
    ])
    .png()
    .toBuffer();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const orderNumbers = process.argv.slice(2);
  if (!orderNumbers.length) throw new Error('请传入订单号');

  const rowBuffers: Buffer[] = [];
  const report: Array<Record<string, unknown>> = [];

  for (const orderNumber of orderNumbers) {
    const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
    if (!transaction) throw new Error(`订单不存在: ${orderNumber}`);

    const params = parseRecord(transaction.requestParams);
    const resultUrl = extractImageUrl(transaction.resultData);
    if (!resultUrl) throw new Error(`订单无结果图: ${orderNumber}`);

    const original = await downloadBuffer(resultUrl);
    const candidates: Array<{ label: string; buffer: Buffer }> = [
      { label: `${orderNumber.slice(-4)} 原图`, buffer: original },
    ];

    const clownUrl = getString(params.clownUrl);
    if (clownUrl) candidates.push({ label: '当前Clown', buffer: await downloadBuffer(clownUrl) });

    const gptUrl = getString(params.clownGptUrl);
    if (gptUrl) candidates.push({ label: 'GPT实验', buffer: await downloadBuffer(gptUrl) });

    for (const method of QUANTIZE_METHODS) {
      candidates.push({ label: method.name, buffer: await quantizeSource(original, method) });
    }

    const tiles = await Promise.all(candidates.map((candidate) => makeTile(candidate.buffer, candidate.label)));
    const row = await sharp({
      create: {
        width: TILE_WIDTH * tiles.length,
        height: TILE_HEIGHT + LABEL_HEIGHT,
        channels: 4,
        background: { r: 10, g: 13, b: 20, alpha: 1 },
      },
    })
      .composite(tiles.map((input, index) => ({ input, left: index * TILE_WIDTH, top: 0 })))
      .png()
      .toBuffer();
    rowBuffers.push(row);
    report.push({
      orderNumber,
      currentClownMode: params.clownWorkflowMode || '',
      hasCurrentClown: Boolean(clownUrl),
      hasGptExperiment: Boolean(gptUrl),
      resultUrl,
    });
  }

  const montage = await sharp({
    create: {
      width: Math.max(...rowBuffers.map(() => TILE_WIDTH * (3 + QUANTIZE_METHODS.length))),
      height: rowBuffers.length * (TILE_HEIGHT + LABEL_HEIGHT),
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite(rowBuffers.map((input, index) => ({ input, left: 0, top: index * (TILE_HEIGHT + LABEL_HEIGHT) })))
    .png()
    .toBuffer();

  const outPath = path.join(OUT_DIR, `compare-${Date.now()}.png`);
  await fs.writeFile(outPath, montage);
  console.log(JSON.stringify({ outPath, report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = await getMysqlPool();
    if (pool?.end) await pool.end();
    process.exit(process.exitCode || 0);
  });
