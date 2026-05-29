import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

type ParsedRecord = Record<string, unknown>;

const BASE_URL = 'https://www.runninghub.cn';
const API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const OUT_DIR = '/tmp/zaomeng-nanobanana-color-extraction';
const TILE_WIDTH = 240;
const TILE_HEIGHT = 320;
const LABEL_HEIGHT = 44;

const DEFAULT_IMAGE_URL = 'https://oss-pai-ka782xl0c1sqwpwipw-cn-shanghai.oss-cn-shanghai.aliyuncs.com/plugin-capture/c1753538-ee66-41c9-94b3-0585c7d6e8ee/1779968129687_5887.webp?OSSAccessKeyId=LTAI5t7rZZbFA6WVL7HM3WL2&Expires=1811504130&Signature=Ety6BysXQUfE4KAislNH%2FtulDqg%3D';

const PROMPTS = [
  {
    id: 'strict-print',
    label: '严格印刷稿',
    text: [
      '从商品图中精准提取手机壳背面的彩绘/印刷图案，生成可用于工厂打印的平面印刷稿。',
      '只保留壳背上的设计图案、文字、线条和颜色，不保留手机壳硬件、摄像头孔、镜头边框、壳体外形、阴影、反光、手、背景或商品摄影元素。',
      '将透视和倾斜校正为正视平面。严格保持原图案的内容、位置关系、颜色、线条粗细和细节，禁止重新设计、禁止增加元素、禁止改字。',
      '如果图中有多款手机壳，请把每款壳背图案分别完整提取到干净画布中，保持相对清晰可辨。',
      '输出干净、高清、无水印、无噪点的平面图案稿。',
    ].join('\n'),
  },
  {
    id: 'copy-fidelity',
    label: '还原优先',
    text: [
      '请像扫描原始印刷文件一样，复刻手机壳背面可见的图案。',
      '目标不是生成新图，而是最大程度还原原商品图里的图案：鱼、猫、文字、装饰符号、线稿、颜色都要尽量保持一致。',
      '去掉手机壳边框、摄像头区域、产品材质、阴影、背景和拍摄透视，只输出平面化的图案内容。',
      '不要美化，不要卡通化，不要改风格，不要补充原图没有的元素。',
      '图案边缘要干净，适合后续打印和人工修图。',
    ].join('\n'),
  },
  {
    id: 'layout-clean',
    label: '分款排版',
    text: [
      '把图片中每个手机壳背面的印刷图案单独提取出来，整理成白色或透明感干净背景上的平面设计稿。',
      '每个款式单独成块展示：保留蓝色鱼图案款、黄色小猫图案款等原有设计内容。',
      '移除手机壳硬件、摄像头孔、壳体边缘、产品摄影背景、阴影和高光。',
      '严格参考原图，不要重新创作，不要改变图案主题，不要新增图案。',
      '输出清晰锐利的平面印刷图，方便判断是否接近原图。',
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
        Authorization: `Bearer ${API_KEY}`,
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

async function runNano(endpoint: string, imageUrl: string, prompt: string, aspectRatio: string, label: string) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
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
  if (directUrls.length) return { taskId, urls: directUrls, raw: data };
  if (taskId) return { taskId, urls: await waitForV2Task(taskId, label), raw: data };
  return { taskId, urls: [], raw: data };
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

async function makeTile(buffer: Buffer, label: string) {
  const image = await sharp(buffer, { failOnError: false })
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
    .png()
    .toBuffer();
  const labelSvg = Buffer.from(`
    <svg width="${TILE_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="10" y="19" fill="#ffffff" font-size="13" font-family="Arial, sans-serif">${escapeSvgText(label.slice(0, 28))}</text>
      <text x="10" y="36" fill="#9ca3af" font-size="11" font-family="Arial, sans-serif">${escapeSvgText(label.slice(28, 58))}</text>
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

async function makeErrorTile(message: string) {
  const svg = Buffer.from(`<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="14" y="30" fill="#ffaaaa" font-size="13">${escapeSvgText(message.slice(0, 70))}</text></svg>`);
  return sharp(svg).png().toBuffer();
}

async function main() {
  if (!API_KEY) throw new Error('缺少 RUNNINGHUB_API_KEY');
  await fs.mkdir(OUT_DIR, { recursive: true });
  const imageUrl = process.argv[2] || DEFAULT_IMAGE_URL;
  const original = await downloadBuffer(imageUrl);
  const metadata = await sharp(original, { failOnError: false }).metadata();
  const aspectRatio = pickAspectRatio(metadata.width || 1, metadata.height || 1);
  const candidates: Array<{ label: string; url?: string; error?: string; taskId?: string }> = [
    { label: '原图', url: imageUrl },
  ];

  const endpoints = [
    { model: 'Pro', endpoint: '/openapi/v2/rhart-image-n-pro/edit' },
    { model: 'Nano 2', endpoint: '/openapi/v2/rhart-image-n-g31-flash/image-to-image' },
  ];

  for (const prompt of PROMPTS) {
    for (const endpoint of endpoints) {
      const label = `${endpoint.model} / ${prompt.label}`;
      try {
        const result = await runNano(endpoint.endpoint, imageUrl, prompt.text, aspectRatio, label);
        candidates.push({ label, url: result.urls[0], taskId: result.taskId });
      } catch (error) {
        candidates.push({ label, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const tiles = await Promise.all(candidates.map(async (candidate) => {
    if (!candidate.url) return makeTile(await makeErrorTile(candidate.error || '无输出'), candidate.label);
    return makeTile(await downloadBuffer(candidate.url), candidate.label);
  }));

  const columns = 4;
  const rows = Math.ceil(tiles.length / columns);
  const montage = await sharp({
    create: {
      width: columns * TILE_WIDTH,
      height: rows * (TILE_HEIGHT + LABEL_HEIGHT),
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite(tiles.map((input, index) => ({
      input,
      left: (index % columns) * TILE_WIDTH,
      top: Math.floor(index / columns) * (TILE_HEIGHT + LABEL_HEIGHT),
    })))
    .png()
    .toBuffer();

  const outPath = path.join(OUT_DIR, `nanobanana-color-extraction-${Date.now()}.png`);
  await fs.writeFile(outPath, montage);
  console.log(JSON.stringify({
    imageUrl,
    aspectRatio,
    outPath,
    report: candidates.map((candidate) => ({
      label: candidate.label,
      taskId: candidate.taskId || '',
      url: candidate.url || '',
      error: candidate.error || '',
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
