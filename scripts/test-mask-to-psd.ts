import fs from 'node:fs/promises';
import path from 'node:path';
import * as AgPsd from 'ag-psd';
import sharp from 'sharp';
import { getMysqlPool, transactionManager } from '@/storage/database';
import { getTaskOutputs } from '@/lib/runningHub';

type ParsedRecord = Record<string, unknown>;
type PromptNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
type Component = {
  pixels: number[];
  area: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  borderTouches: number;
};
type CandidateResult = {
  label: string;
  taskId?: string;
  maskUrl?: string;
  maskUrls?: string[];
  error?: string;
  components: Component[];
  foregroundRatio: number;
};
type MaskRunResult = {
  taskId: string;
  maskUrl: string;
  maskUrls?: string[];
};

const BASE_URL = 'https://www.runninghub.cn';
const API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const OUT_DIR = '/tmp/zaomeng-mask-psd';
const DETECTION_PROMPT = '人物, 脸, 头发, 衣服, 配饰, 帽子, 手, 眼睛, 背景, 文字, 装饰, 所有可见物体';
const SAM3_DETECTION_PROMPT = 'all visible objects, characters, faces, hats, clothes, hands, stars, moon, fountain, water, reflections, stone pillar, text, decorations, foreground objects, background regions, small details';
const MAX_LAYERS = 28;
const MIN_COMPONENT_AREA_RATIO = 0.00018;
const TILE_WIDTH = 260;
const TILE_HEIGHT = 420;
const LABEL_HEIGHT = 34;

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
  if (!response.ok) throw new Error(`下载失败: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function getWorkflowPrompt(workflowId: string): Promise<Record<string, PromptNode>> {
  const response = await fetch(`${BASE_URL}/api/openapi/getJsonApiFormat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'www.runninghub.cn',
    },
    body: JSON.stringify({ workflowId, apiKey: API_KEY }),
  });
  const data = await response.json() as { msg?: string; data?: { prompt?: string } };
  if (data.msg !== 'success' || !data.data?.prompt) {
    throw new Error(`读取工作流失败: ${data.msg || 'unknown'}`);
  }
  return JSON.parse(data.data.prompt) as Record<string, PromptNode>;
}

async function createWorkflowTask(workflowId: string, workflow: Record<string, PromptNode>) {
  const response = await fetch(`${BASE_URL}/task/openapi/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'www.runninghub.cn',
    },
    body: JSON.stringify({
      workflowId,
      apiKey: API_KEY,
      workflow: JSON.stringify(workflow),
    }),
  });
  const data = await response.json() as { msg?: string; data?: { taskId?: string } };
  if (data.msg !== 'success' || !data.data?.taskId) {
    throw new Error(`创建工作流任务失败: ${data.msg || JSON.stringify(data).slice(0, 240)}`);
  }
  return data.data.taskId;
}

async function getOpenApiTaskStatus(taskId: string) {
  const response = await fetch(`${BASE_URL}/task/openapi/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'www.runninghub.cn',
    },
    body: JSON.stringify({ apiKey: API_KEY, taskId }),
  });
  const data = await response.json() as { msg?: string; data?: string };
  if (data.msg !== 'success') throw new Error(`查询任务状态失败: ${data.msg || 'unknown'}`);
  return data.data || '';
}

async function waitForOpenApiTaskComplete(taskId: string, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    const status = await getOpenApiTaskStatus(taskId);
    console.log(`[${label}] ${taskId} ${status}`);
    if (status === 'SUCCESS') return;
    if (status === 'FAILED') throw new Error(`任务失败: ${taskId}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`任务超时: ${taskId}`);
}

function normalizeOutputUrl(url: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.startsWith('/') ? `${BASE_URL}${url}` : url;
}

function setLoadImageFromUrl(workflow: Record<string, PromptNode>, nodeId: string, imageUrl: string) {
  const node = workflow[nodeId];
  if (!node) throw new Error(`缺少图片节点 ${nodeId}`);
  node.class_type = 'LoadImageFromUrl';
  node.inputs = {
    image: imageUrl,
    keep_alpha_channel: false,
  };
}

function setPrompt(workflow: Record<string, PromptNode>, nodeId: string, fieldName: string, prompt: string) {
  const node = workflow[nodeId];
  if (!node) throw new Error(`缺少提示词节点 ${nodeId}`);
  node.inputs = {
    ...(node.inputs || {}),
    [fieldName]: prompt,
  };
}

async function runGroundedSam2Qwen(imageUrl: string) {
  const workflowId = '1934072503814021121';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, '127', imageUrl);
  setPrompt(workflow, '135', 'prompt', DETECTION_PROMPT);
  workflow['122'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'mask_psd_grounded_sam2_qwen',
      images: ['118', 0],
    },
    _meta: { title: 'Save mask for PSD experiment' },
  };
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'Grounded-SAM2/Qwen');
  const outputs = await getTaskOutputs(taskId);
  const maskUrl = outputs.find((item) => item.fileUrl)?.fileUrl || '';
  return {
    taskId,
    maskUrl: maskUrl ? normalizeOutputUrl(maskUrl) : '',
  };
}

async function runQwenSam2Basic(imageUrl: string) {
  const workflowId = '1934512191934517249';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, '84', imageUrl);
  setPrompt(workflow, '3', 'target', DETECTION_PROMPT);
  if (workflow['3']?.inputs) {
    workflow['3'].inputs.score_threshold = 0;
    workflow['3'].inputs.bbox_selection = 'all';
    workflow['3'].inputs.merge_boxes = false;
  }
  if (workflow['27']?.inputs) {
    workflow['27'].inputs.bbox_select = 'all';
    workflow['27'].inputs.select_index = '0,';
  }
  workflow['122'] = {
    class_type: 'MaskToImage',
    inputs: {
      mask: ['50', 0],
    },
    _meta: { title: 'Convert SAM2 instances to image' },
  };
  workflow['123'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'mask_psd_qwen_sam2_basic',
      images: ['122', 0],
    },
    _meta: { title: 'Save mask for PSD experiment' },
  };
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'Qwen+SAM2 Basic');
  const outputs = await getTaskOutputs(taskId);
  const preferred = outputs.find((item) => item.nodeId === '123' && item.fileUrl) || outputs.find((item) => item.fileUrl);
  return {
    taskId,
    maskUrl: preferred?.fileUrl ? normalizeOutputUrl(preferred.fileUrl) : '',
  };
}

async function runSam3Configured(imageUrl: string) {
  const workflowId = process.env.RUNNINGHUB_CLOWN_WORKFLOW_ID || '2052146758297374721';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, process.env.RUNNINGHUB_CLOWN_IMAGE_NODE_ID || '8', imageUrl);
  setPrompt(workflow, process.env.RUNNINGHUB_CLOWN_PROMPT_NODE_ID || '26', process.env.RUNNINGHUB_CLOWN_PROMPT_FIELD_NAME || 'text', SAM3_DETECTION_PROMPT);

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === 'SaveImage') delete workflow[nodeId];
  }

  workflow['900'] = {
    class_type: 'MaskToImage',
    inputs: {
      mask: [
        process.env.RUNNINGHUB_CLOWN_MASK_SOURCE_NODE_ID || '4',
        Number(process.env.RUNNINGHUB_CLOWN_MASK_SOURCE_OUTPUT_INDEX || 2),
      ],
    },
    _meta: { title: 'Convert SAM3 object masks to image batch' },
  };
  workflow['901'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'mask_psd_sam3_instances',
      images: ['900', 0],
    },
    _meta: { title: 'Save SAM3 masks for PSD experiment' },
  };

  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'SAM3 Multi-mask');
  const outputs = await getTaskOutputs(taskId);
  const maskUrls = outputs
    .filter((item) => (!item.nodeId || item.nodeId === '901') && item.fileUrl)
    .map((item) => normalizeOutputUrl(item.fileUrl));
  return {
    taskId,
    maskUrl: maskUrls[0] || '',
    maskUrls,
  };
}

function thresholdMask(raw: Buffer) {
  const totalPixels = raw.length / 3;
  const light = new Uint8Array(totalPixels);
  const dark = new Uint8Array(totalPixels);
  let lightArea = 0;
  let darkArea = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    const offset = pixelIndex * 3;
    const luma = raw[offset] * 0.299 + raw[offset + 1] * 0.587 + raw[offset + 2] * 0.114;
    if (luma > 128) {
      light[pixelIndex] = 1;
      lightArea += 1;
    } else {
      dark[pixelIndex] = 1;
      darkArea += 1;
    }
  }

  const lightRatio = lightArea / totalPixels;
  const darkRatio = darkArea / totalPixels;
  if (lightRatio > 0 && lightRatio <= 0.55 && (lightRatio <= darkRatio || darkRatio > 0.55)) {
    return { mask: light, foregroundRatio: lightRatio };
  }
  return { mask: dark, foregroundRatio: darkRatio };
}

function extractComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const totalPixels = width * height;
  const minArea = Math.max(80, Math.floor(totalPixels * MIN_COMPONENT_AREA_RATIO));
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const components: Component[] = [];

  for (let start = 0; start < totalPixels; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let borderTouches = 0;
    const pixels: number[] = [];
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      pixels.push(pixelIndex);

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);

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

    if (pixels.length >= minArea) {
      if (left <= 1) borderTouches += 1;
      if (top <= 1) borderTouches += 1;
      if (right >= width - 1) borderTouches += 1;
      if (bottom >= height - 1) borderTouches += 1;
      components.push({
        pixels,
        area: pixels.length,
        bounds: { left, top, right, bottom },
        borderTouches,
      });
    }
  }

  return components
    .sort((a, b) => scoreComponent(b, width, height) - scoreComponent(a, width, height))
    .slice(0, MAX_LAYERS);
}

function scoreComponent(component: Component, width: number, height: number) {
  const totalPixels = width * height;
  const areaRatio = component.area / totalPixels;
  const componentWidth = component.bounds.right - component.bounds.left;
  const componentHeight = component.bounds.bottom - component.bounds.top;
  const boxRatio = (componentWidth * componentHeight) / totalPixels;
  const isolatedBonus = component.borderTouches === 0 ? 5000 : component.borderTouches === 1 ? 1200 : 0;
  const largeBackgroundPenalty = component.borderTouches >= 2 || areaRatio > 0.18 || boxRatio > 0.45 ? 4000 : 0;
  const tinyNoisePenalty = areaRatio < 0.0005 ? 800 : 0;
  return isolatedBonus + Math.sqrt(component.area) * 18 - largeBackgroundPenalty - tinyNoisePenalty;
}

async function analyzeMask(maskUrl: string, width: number, height: number) {
  const maskBuffer = await downloadBuffer(maskUrl);
  const raw = await sharp(maskBuffer, { failOnError: false })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer();
  const { mask, foregroundRatio } = thresholdMask(raw);
  return {
    mask,
    foregroundRatio,
    components: extractComponents(mask, width, height),
  };
}

async function analyzeMasks(maskUrls: string[], width: number, height: number) {
  const analyzed = await Promise.all(maskUrls.map((maskUrl) => analyzeMask(maskUrl, width, height)));
  const components = analyzed.flatMap((item) => item.components);
  const foregroundRatio = analyzed.length
    ? analyzed.reduce((sum, item) => sum + item.foregroundRatio, 0) / analyzed.length
    : 0;
  return {
    components: components.sort((a, b) => scoreComponent(b, width, height) - scoreComponent(a, width, height)).slice(0, MAX_LAYERS),
    foregroundRatio,
  };
}

function makeLayerFromComponent(sourceRgba: Buffer, component: Component, width: number, height: number) {
  const layer = Buffer.alloc(width * height * 4);
  for (const pixelIndex of component.pixels) {
    const offset = pixelIndex * 4;
    layer[offset] = sourceRgba[offset];
    layer[offset + 1] = sourceRgba[offset + 1];
    layer[offset + 2] = sourceRgba[offset + 2];
    layer[offset + 3] = sourceRgba[offset + 3] || 255;
  }
  return layer;
}

function writePsdFromComponents(sourceRgba: Buffer, components: Component[], width: number, height: number) {
  const children: AgPsd.Layer[] = components.map((component, index) => ({
    name: `Mask Layer ${String(index + 1).padStart(2, '0')}`,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    blendMode: 'normal',
    opacity: 255,
    imageData: {
      data: new Uint8ClampedArray(makeLayerFromComponent(sourceRgba, component, width, height)),
      width,
      height,
    },
  }));

  children.push({
    name: 'Original Backup',
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    blendMode: 'normal',
    opacity: 255,
    imageData: {
      data: new Uint8ClampedArray(sourceRgba),
      width,
      height,
    },
  });

  return AgPsd.writePsdBuffer({
    width,
    height,
    channels: 4,
    bitsPerChannel: 8,
    colorMode: 3,
    children,
  });
}

async function makeMaskPreview(maskUrl: string, width: number, height: number) {
  return sharp(await downloadBuffer(maskUrl), { failOnError: false })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function makeLayerGrid(sourceRgba: Buffer, components: Component[], width: number, height: number) {
  const cellWidth = 180;
  const cellHeight = 180;
  const cells = await Promise.all(components.slice(0, 12).map(async (component) => {
    const layer = makeLayerFromComponent(sourceRgba, component, width, height);
    return sharp(layer, { raw: { width, height, channels: 4 } })
      .trim({ background: '#00000000', threshold: 1 })
      .resize(cellWidth, cellHeight, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
      .png()
      .toBuffer();
  }));
  if (!cells.length) {
    return sharp({
      create: {
        width: TILE_WIDTH,
        height: TILE_HEIGHT,
        channels: 4,
        background: { r: 10, g: 13, b: 20, alpha: 1 },
      },
    }).png().toBuffer();
  }

  const columns = 3;
  const rows = Math.ceil(cells.length / columns);
  return sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: { r: 10, g: 13, b: 20, alpha: 1 },
    },
  })
    .composite(cells.map((input, index) => ({
      input,
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    })))
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
    .png()
    .toBuffer();
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
      <text x="10" y="22" fill="#ffffff" font-size="14" font-family="Arial, sans-serif">${escapeSvgText(label)}</text>
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
  const svg = Buffer.from(`<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="14" y="34" fill="#ffaaaa" font-size="14" font-family="Arial">${escapeSvgText(message)}</text></svg>`);
  return sharp(svg).png().toBuffer();
}

function scoreCandidate(candidate: CandidateResult) {
  if (!candidate.components.length) return -1;
  const usefulLayerCount = Math.min(candidate.components.length, 14);
  const coveragePenalty = candidate.foregroundRatio > 0.6 ? -20 : 0;
  return usefulLayerCount * 10 + Math.min(candidate.foregroundRatio, 0.5) * 20 + coveragePenalty;
}

async function main() {
  if (!API_KEY) throw new Error('缺少 RUNNINGHUB_API_KEY');
  const orderNumber = process.argv[2];
  if (!orderNumber) throw new Error('请传入彩绘提取订单号');
  await fs.mkdir(OUT_DIR, { recursive: true });

  const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
  if (!transaction) throw new Error(`订单不存在: ${orderNumber}`);
  const imageUrl = extractImageUrl(transaction.resultData);
  if (!imageUrl) throw new Error(`订单无结果图: ${orderNumber}`);

  const sourceBuffer = await downloadBuffer(imageUrl);
  const metadata = await sharp(sourceBuffer, { failOnError: false }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw new Error('无法读取原图尺寸');
  const sourceRgba = await sharp(sourceBuffer, { failOnError: false })
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const candidates: CandidateResult[] = [];
  const requestedMethod = process.argv[3] || '';
  const runs: Array<{ label: string; fn: (imageUrl: string) => Promise<MaskRunResult> }> = [
    { label: 'SAM3 Multi-mask', fn: runSam3Configured },
    { label: 'Grounded-SAM2/Qwen', fn: runGroundedSam2Qwen },
    { label: 'Qwen+SAM2 Basic', fn: runQwenSam2Basic },
  ].filter((run) => !requestedMethod || run.label.toLowerCase().includes(requestedMethod.toLowerCase()));

  for (const run of runs) {
    try {
      const result = await run.fn(imageUrl);
      const maskUrls = result.maskUrls?.length ? result.maskUrls : result.maskUrl ? [result.maskUrl] : [];
      if (!maskUrls.length) throw new Error('无mask输出');
      const analyzed = await analyzeMasks(maskUrls, width, height);
      candidates.push({
        label: run.label,
        taskId: result.taskId,
        maskUrl: maskUrls[0],
        maskUrls,
        components: analyzed.components,
        foregroundRatio: analyzed.foregroundRatio,
      });
    } catch (error) {
      candidates.push({
        label: run.label,
        error: error instanceof Error ? error.message : String(error),
        components: [],
        foregroundRatio: 0,
      });
    }
  }

  const best = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
  if (!best || !best.maskUrl || !best.components.length) {
    throw new Error(`没有可用mask结果: ${JSON.stringify(candidates.map((item) => ({ label: item.label, error: item.error })))}`);
  }

  const psdBuffer = writePsdFromComponents(sourceRgba, best.components, width, height);
  const stamp = Date.now();
  const psdPath = path.join(OUT_DIR, `${orderNumber}-${best.label.replace(/[^a-z0-9]+/gi, '-')}-${stamp}.psd`);
  await fs.writeFile(psdPath, psdBuffer);

  const tiles: Buffer[] = [
    await makeTile(sourceBuffer, '原图'),
  ];
  for (const candidate of candidates) {
    const detail = candidate.error
      ? `${candidate.label} 失败`
      : `${candidate.label} ${candidate.components.length}层`;
    tiles.push(await makeTile(
      candidate.maskUrl ? await makeMaskPreview(candidate.maskUrl, width, height) : await makeErrorTile(candidate.error || '无输出'),
      detail,
    ));
  }
  tiles.push(await makeTile(await makeLayerGrid(sourceRgba, best.components, width, height), `PSD预览 ${best.components.length}层`));

  const preview = await sharp({
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
  const previewPath = path.join(OUT_DIR, `${orderNumber}-${stamp}.png`);
  await fs.writeFile(previewPath, preview);

  console.log(JSON.stringify({
    orderNumber,
    imageUrl,
    psdPath,
    previewPath,
    best: {
      label: best.label,
      taskId: best.taskId,
      maskUrl: best.maskUrl,
      maskUrls: best.maskUrls,
      layerCount: best.components.length,
      foregroundRatio: best.foregroundRatio,
    },
    candidates: candidates.map((candidate) => ({
      label: candidate.label,
      taskId: candidate.taskId || '',
      maskUrl: candidate.maskUrl || '',
      maskCount: candidate.maskUrls?.length || 0,
      error: candidate.error || '',
      layerCount: candidate.components.length,
      foregroundRatio: candidate.foregroundRatio,
    })),
  }, null, 2));
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
