import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runPsydoImageEditWithMetaFromUrl } from '@/lib/psydoImageEdits';

type ParsedRecord = Record<string, unknown>;
type Candidate = {
  label: string;
  buffer?: Buffer;
  url?: string;
  error?: string;
  taskId?: string;
};

const BASE_URL = 'https://www.runninghub.cn';
const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const OUT_DIR = '/tmp/zaomeng-gpt-vs-nano-color-extraction';
const TILE_WIDTH = 170;
const TILE_HEIGHT = 250;
const LABEL_HEIGHT = 46;

type SourceImage = {
  id: string;
  label: string;
  url: string;
};

function parseSourceImages(): SourceImage[] {
  const raw = process.env.COLOR_EXTRACTION_TEST_IMAGES_JSON;
  if (!raw) {
    throw new Error(
      '缺少 COLOR_EXTRACTION_TEST_IMAGES_JSON。示例: ' +
      '[{"id":"dual-flat","label":"双款平铺","url":"https://..."}]',
    );
  }
  const parsed = JSON.parse(raw) as SourceImage[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('COLOR_EXTRACTION_TEST_IMAGES_JSON 必须是非空数组');
  }
  parsed.forEach((item, index) => {
    if (!item.id || !item.label || !/^https?:\/\//.test(item.url || '')) {
      throw new Error(`COLOR_EXTRACTION_TEST_IMAGES_JSON 第 ${index + 1} 项缺少 id/label/url`);
    }
  });
  return parsed;
}

const SOURCE_IMAGES = parseSourceImages();

const PROMPTS = [
  {
    id: 'production',
    label: '生产稿',
    text: [
      '请从商品图中提取手机壳背面的彩绘/印刷图案，输出可用于工厂打印的正视平面稿。',
      '只保留手机壳背面印刷内容，包括图案、文字、线条、装饰和颜色。',
      '必须去除摄像头孔、镜头边框、壳体边缘、侧边、材质高光、阴影、手、背景和商品摄影元素。',
      '透视、倾斜和弯曲需要校正为平整二维视图。',
      '严格还原原图案，不要重新设计、不要改字、不要增加原图没有的元素。',
    ].join('\n'),
  },
  {
    id: 'trace',
    label: '临摹还原',
    text: [
      '把手机壳上的印刷图案当作需要临摹的原稿，尽量一比一复刻可见内容。',
      '重点保留图案主题、细小文字、线条粗细、颜色关系和元素布局。',
      '不要保留手机壳实物、孔位、相机区域、反光、阴影和拍摄背景。',
      '如果原图有多款手机壳，请分别提取每款背面图案并排展示。',
      '输出干净、清晰、平面化，方便后续人工修图和印刷。',
    ].join('\n'),
  },
  {
    id: 'isolate',
    label: '只抠图案',
    text: [
      '只抠出手机壳背面真正印刷的图案，不要输出手机壳外形。',
      '背景使用干净白底，图案保持原来的相对位置、颜色和线条。',
      '摄像头孔、壳体边框、产品阴影、手、桌面、布景全部删除。',
      '不要把手机壳重新画出来，也不要生成新的手机壳效果图。',
      '目标是得到接近原始图案素材的平面图片。',
    ].join('\n'),
  },
];

function collectImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      if (/^https?:\/\//.test(item) && /\.(png|jpe?g|webp)(?:$|[?&])/i.test(item)) urls.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === 'object') {
      Object.values(item as ParsedRecord).forEach(visit);
    }
  };
  visit(value);
  return urls;
}

async function downloadBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function pickAspectRatio(width: number, height: number) {
  const candidates = [
    { value: '1:1', ratio: 1 },
    { value: '3:4', ratio: 3 / 4 },
    { value: '4:3', ratio: 4 / 3 },
    { value: '9:16', ratio: 9 / 16 },
    { value: '16:9', ratio: 16 / 9 },
  ];
  const ratio = width / height;
  return candidates
    .map((candidate) => ({ ...candidate, diff: Math.abs(candidate.ratio - ratio) }))
    .sort((a, b) => a.diff - b.diff)[0]?.value || '1:1';
}

async function waitForV2Task(taskId: string, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    const response = await fetch(`${BASE_URL}/openapi/v2/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
      },
      body: JSON.stringify({ taskId }),
    });
    const data = await response.json() as {
      status?: string;
      errorCode?: string;
      errorMessage?: string;
      results?: Array<{ url?: string; outputType?: string }>;
    };
    console.log(`[${label}] ${taskId} ${data.status || data.errorCode || 'UNKNOWN'}`);
    if (data.errorCode) throw new Error(`RunningHub v2任务失败: ${data.errorMessage || data.errorCode}`);
    if (data.status === 'SUCCESS' && data.results?.length) {
      return data.results.map((item) => item.url).filter(Boolean) as string[];
    }
    if (data.status === 'FAILED') throw new Error(`RunningHub v2任务失败: ${data.errorMessage || 'FAILED'}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`RunningHub v2任务超时: ${taskId}`);
}

async function runNano2(imageUrl: string, prompt: string, aspectRatio: string, label: string) {
  if (!RUNNINGHUB_API_KEY) throw new Error('缺少 RUNNINGHUB_API_KEY');
  const response = await fetch(`${BASE_URL}/openapi/v2/rhart-image-n-g31-flash/image-to-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
    },
    body: JSON.stringify({
      imageUrls: [imageUrl],
      prompt,
      aspectRatio,
      resolution: '1k',
    }),
  });
  const data = await response.json() as ParsedRecord;
  const directUrls = collectImageUrls(data);
  const taskId = typeof data.taskId === 'string'
    ? data.taskId
    : typeof data.data === 'object' && data.data && typeof (data.data as ParsedRecord).taskId === 'string'
      ? (data.data as ParsedRecord).taskId as string
      : '';
  if (directUrls.length) return { taskId, buffer: await downloadBuffer(directUrls[0]) };
  if (!taskId) throw new Error(`NanoBanana 2未返回任务ID: ${JSON.stringify(data).slice(0, 200)}`);
  const urls = await waitForV2Task(taskId, label);
  if (!urls[0]) throw new Error('NanoBanana 2无输出');
  return { taskId, buffer: await downloadBuffer(urls[0]) };
}

async function runGptImage2(imageUrl: string, prompt: string) {
  const result = await runPsydoImageEditWithMetaFromUrl({
    imageUrl,
    prompt,
    size: '1024x1024',
    quality: 'high',
    timeoutMs: 300000,
  });
  return result.buffer;
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] || char));
}

async function makeTile(candidate: Candidate) {
  const image = candidate.buffer
    ? await sharp(candidate.buffer, { failOnError: false })
      .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
      .png()
      .toBuffer()
    : await sharp(Buffer.from(`<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="10" y="28" fill="#ffaaaa" font-size="12">${escapeSvgText((candidate.error || '无输出').slice(0, 70))}</text></svg>`))
      .png()
      .toBuffer();
  const labelSvg = Buffer.from(`
    <svg width="${TILE_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="8" y="18" fill="#ffffff" font-size="12" font-family="Arial, sans-serif">${escapeSvgText(candidate.label.slice(0, 24))}</text>
      <text x="8" y="35" fill="#9ca3af" font-size="10" font-family="Arial, sans-serif">${escapeSvgText(candidate.label.slice(24, 54))}</text>
    </svg>
  `);
  return sharp({
    create: {
      width: TILE_WIDTH,
      height: TILE_HEIGHT + LABEL_HEIGHT,
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite([
      { input: await sharp(labelSvg).png().toBuffer(), left: 0, top: 0 },
      { input: image, left: 0, top: LABEL_HEIGHT },
    ])
    .png()
    .toBuffer();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows: Buffer[] = [];
  const report: Array<Record<string, unknown>> = [];

  for (const source of SOURCE_IMAGES) {
    const original = await downloadBuffer(source.url);
    const metadata = await sharp(original, { failOnError: false }).metadata();
    const aspectRatio = pickAspectRatio(metadata.width || 1, metadata.height || 1);
    const candidates: Candidate[] = [{ label: `${source.label} / 原图`, buffer: original }];

    for (const prompt of PROMPTS) {
      const gptLabel = `GPT / ${prompt.label}`;
      try {
        candidates.push({ label: gptLabel, buffer: await runGptImage2(source.url, prompt.text) });
      } catch (error) {
        candidates.push({ label: gptLabel, error: error instanceof Error ? error.message : String(error) });
      }

      const nanoLabel = `Nano2 / ${prompt.label}`;
      try {
        const result = await runNano2(source.url, prompt.text, aspectRatio, `${source.label} ${nanoLabel}`);
        candidates.push({ label: nanoLabel, buffer: result.buffer, taskId: result.taskId });
      } catch (error) {
        candidates.push({ label: nanoLabel, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const tiles = await Promise.all(candidates.map(makeTile));
    const row = await sharp({
      create: {
        width: tiles.length * TILE_WIDTH,
        height: TILE_HEIGHT + LABEL_HEIGHT,
        channels: 4,
        background: { r: 10, g: 13, b: 20, alpha: 1 },
      },
    })
      .composite(tiles.map((input, index) => ({ input, left: index * TILE_WIDTH, top: 0 })))
      .png()
      .toBuffer();
    rows.push(row);
    report.push({
      source: source.label,
      aspectRatio,
      results: candidates.map((candidate) => ({
        label: candidate.label,
        taskId: candidate.taskId || '',
        error: candidate.error || '',
      })),
    });
  }

  const outPath = path.join(OUT_DIR, `gpt-vs-nano-color-extraction-${Date.now()}.png`);
  const montage = await sharp({
    create: {
      width: Math.max(...rows.map((row) => row.length ? TILE_WIDTH * (1 + PROMPTS.length * 2) : 1)),
      height: rows.length * (TILE_HEIGHT + LABEL_HEIGHT),
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite(rows.map((input, index) => ({ input, left: 0, top: index * (TILE_HEIGHT + LABEL_HEIGHT) })))
    .png()
    .toBuffer();
  await fs.writeFile(outPath, montage);
  console.log(JSON.stringify({ outPath, report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
