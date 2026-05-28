import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getMysqlPool, transactionManager } from '@/storage/database';
import { getTaskOutputs } from '@/lib/runningHub';

type ParsedRecord = Record<string, unknown>;
type PromptNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

const BASE_URL = 'https://www.runninghub.cn';
const API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const OUT_DIR = '/tmp/zaomeng-clown-alternatives';
const TILE_WIDTH = 240;
const TILE_HEIGHT = 420;
const LABEL_HEIGHT = 36;
const CLOWN_PROMPT = [
  '生成一张用于 Photoshop 魔棒选区的 Clown 彩色分区图。',
  '必须严格保持原图画布比例、构图、人物/物体位置和轮廓对齐。',
  '不要重绘，不要改变姿势，不要移动元素。',
  '把人物、衣服、头发、脸、配饰、背景、文字、装饰和每个可见物体转换为高对比纯色块。',
  '输出必须是扁平纯色 PNG 风格，无渐变、无阴影、无纹理、无文字、无水印。',
].join('');
const DETECTION_PROMPT = '人物, 脸, 头发, 衣服, 配饰, 耳罩, 围巾, 背景, 天空, 海面, 岩石, 文字, 装饰, 所有可见物体';

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
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${url}`);
  }
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
  if (data.msg !== 'success') {
    throw new Error(`查询任务状态失败: ${data.msg || JSON.stringify(data).slice(0, 240)}`);
  }
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

function normalizeOutputUrl(url: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.startsWith('/') ? `${BASE_URL}${url}` : url;
}

async function runGroundedSam2Qwen(imageUrl: string) {
  const workflowId = '1934072503814021121';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, '127', imageUrl);
  setPrompt(workflow, '135', 'prompt', DETECTION_PROMPT);
  workflow['122'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'grounded_sam2_qwen_mask',
      images: ['118', 0],
    },
    _meta: { title: 'Save Grounded SAM2 Mask' },
  };
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'Grounded-SAM2/Qwen');
  const outputs = await getTaskOutputs(taskId);
  return {
    taskId,
    urls: outputs.filter((item) => item.fileUrl).map((item) => normalizeOutputUrl(item.fileUrl)),
  };
}

async function runSam2UltraDetectors(imageUrl: string) {
  const workflowId = '1903966740169003009';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, '2', imageUrl);
  setPrompt(workflow, '26', 'prompt', DETECTION_PROMPT);
  setPrompt(workflow, '27', 'prompt', DETECTION_PROMPT);
  if (workflow['27']?.inputs) {
    workflow['27'].inputs.bbox_select = 'all';
    workflow['27'].inputs.select_index = '0,';
    workflow['27'].inputs.confidence_threshold = 0.02;
  }
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'SAM2 Ultra');
  const outputs = await getTaskOutputs(taskId);
  return {
    taskId,
    urls: outputs.filter((item) => item.fileUrl).map((item) => normalizeOutputUrl(item.fileUrl)),
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
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'Qwen+SAM2 Basic');
  const outputs = await getTaskOutputs(taskId);
  return {
    taskId,
    urls: outputs.filter((item) => item.fileUrl).map((item) => normalizeOutputUrl(item.fileUrl)),
  };
}

async function runFlorenceSam2(imageUrl: string) {
  const workflowId = '1820435851812712450';
  const workflow = await getWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, '83', imageUrl);
  setPrompt(workflow, '87', 'text_input', DETECTION_PROMPT);
  workflow['132'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'florence_sam2_mask',
      images: ['84', 0],
    },
    _meta: { title: 'Save Florence SAM2 Preview' },
  };
  const taskId = await createWorkflowTask(workflowId, workflow);
  await waitForOpenApiTaskComplete(taskId, 'Florence+SAM2');
  const outputs = await getTaskOutputs(taskId);
  return {
    taskId,
    urls: outputs.filter((item) => item.fileUrl).map((item) => normalizeOutputUrl(item.fileUrl)),
  };
}

async function waitForV2Task(taskId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8 * 60 * 1000) {
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
    if (data.errorCode) throw new Error(`RunningHub v2任务失败: ${data.errorMessage || data.errorCode}`);
    if (data.status === 'SUCCESS' && data.results?.length) {
      return data.results.map((item) => item.url).filter(Boolean) as string[];
    }
    if (data.status === 'FAILED') throw new Error(`RunningHub v2任务失败: ${data.errorMessage || 'FAILED'}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`RunningHub v2任务超时: ${taskId}`);
}

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
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return urls;
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

async function runNano(endpoint: string, imageUrl: string, label: string, aspectRatio: string) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      imageUrls: [imageUrl],
      prompt: CLOWN_PROMPT,
      aspectRatio,
      resolution: '1k',
    }),
  });
  const data = await response.json() as Record<string, unknown>;
  const directUrls = collectImageUrls(data);
  const taskId = typeof data.taskId === 'string' ? data.taskId : typeof data.data === 'object' && data.data && typeof (data.data as ParsedRecord).taskId === 'string' ? (data.data as ParsedRecord).taskId as string : '';
  if (directUrls.length) return { label, taskId, urls: directUrls, raw: data };
  if (taskId) return { label, taskId, urls: await waitForV2Task(taskId), raw: data };
  return { label, taskId, urls: [], raw: data };
}

async function makeTile(buffer: Buffer, label: string) {
  const image = await sharp(buffer, { failOnError: false })
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: 'contain', background: { r: 10, g: 13, b: 20, alpha: 1 } })
    .png()
    .toBuffer();
  const labelSvg = Buffer.from(`
    <svg width="${TILE_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="10" y="23" fill="#ffffff" font-size="14" font-family="Arial, sans-serif">${label}</text>
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
  if (!API_KEY) throw new Error('缺少 RUNNINGHUB_API_KEY');
  const orderNumber = process.argv[2] || 'ORD1779968144892_7211';
  await fs.mkdir(OUT_DIR, { recursive: true });
  const transaction = await transactionManager.getTransactionByOrderNumber(orderNumber);
  if (!transaction) throw new Error(`订单不存在: ${orderNumber}`);
  const imageUrl = extractImageUrl(transaction.resultData);
  if (!imageUrl) throw new Error(`订单无结果图: ${orderNumber}`);
  const sourceBuffer = await downloadBuffer(imageUrl);
  const sourceMetadata = await sharp(sourceBuffer, { failOnError: false }).metadata();
  const aspectRatio = pickAspectRatio(sourceMetadata.width || 1, sourceMetadata.height || 1);

  const candidates: Array<{ label: string; urls: string[]; taskId?: string; raw?: unknown; error?: string }> = [];
  candidates.push({ label: '原图', urls: [imageUrl] });

  for (const run of [
    { label: '1 Grounded-SAM2/Qwen', fn: runGroundedSam2Qwen },
    { label: '2 SAM2 Ultra', fn: runSam2UltraDetectors },
    { label: 'Qwen+SAM2 Basic', fn: runQwenSam2Basic },
    { label: 'Florence+SAM2', fn: runFlorenceSam2 },
  ]) {
    try {
      const result = await run.fn(imageUrl);
      candidates.push({ label: run.label, urls: result.urls, taskId: result.taskId });
    } catch (error) {
      candidates.push({ label: run.label, urls: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const nano of [
    { label: 'NanoBanana Pro', endpoint: '/openapi/v2/rhart-image-n-pro/edit' },
    { label: 'NanoBanana 2', endpoint: '/openapi/v2/rhart-image-n-g31-flash/image-to-image' },
  ]) {
    try {
      const result = await runNano(nano.endpoint, imageUrl, nano.label, aspectRatio);
      candidates.push(result);
    } catch (error) {
      candidates.push({ label: nano.label, urls: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  const tiles: Buffer[] = [];
  const report: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    const firstUrl = candidate.urls[0];
    report.push({
      label: candidate.label,
      taskId: candidate.taskId || '',
      outputCount: candidate.urls.length,
      firstUrl: firstUrl || '',
      error: candidate.error || '',
      raw: candidate.raw ? JSON.stringify(candidate.raw).slice(0, 500) : '',
    });
    if (!firstUrl) {
      const svg = Buffer.from(`<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="14" y="30" fill="#ffaaaa" font-size="14">${candidate.error || '无输出'}</text></svg>`);
      tiles.push(await makeTile(await sharp(svg).png().toBuffer(), candidate.label));
    } else {
      tiles.push(await makeTile(await downloadBuffer(firstUrl), candidate.label));
    }
  }

  const montage = await sharp({
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

  const outPath = path.join(OUT_DIR, `alternatives-${orderNumber}-${Date.now()}.png`);
  await fs.writeFile(outPath, montage);
  console.log(JSON.stringify({ orderNumber, outPath, report }, null, 2));
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
