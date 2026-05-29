import * as AgPsd from 'ag-psd';
import sharp from 'sharp';
import { getTaskOutputs, waitForTaskComplete } from '@/lib/runningHub';
import { downloadSafeRemoteImage } from '@/lib/safeRemoteImage';

type RunningHubPromptNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

type RunningHubCreateTaskResponse = {
  msg?: string;
  data?: {
    taskId?: string;
  };
};

type Component = {
  pixels: number[];
  area: number;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  borderTouches: number;
};

export type SmartPsdResult = {
  psdBuffer: Buffer;
  taskId: string;
  maskCount: number;
  layerCount: number;
  sourceWidth: number;
  sourceHeight: number;
};

const BASE_URL = 'https://www.runninghub.cn';
const API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const DEFAULT_WORKFLOW_ID = '2052146758297374721';
const DEFAULT_IMAGE_NODE_ID = '8';
const DEFAULT_PROMPT_NODE_ID = '26';
const DEFAULT_PROMPT_FIELD_NAME = 'text';
const DEFAULT_MASK_SOURCE_NODE_ID = '4';
const DEFAULT_MASK_SOURCE_OUTPUT_INDEX = 2;
const MASK_TO_IMAGE_NODE_ID = '920';
const MASK_SAVE_NODE_ID = '921';
const MAX_LAYERS = 32;
const MIN_COMPONENT_AREA_RATIO = 0.00018;
const SMART_PSD_PROMPT = [
  'all visible objects',
  'characters',
  'faces',
  'hats',
  'clothes',
  'hands',
  'stars',
  'moon',
  'fountain',
  'water',
  'reflections',
  'stone pillar',
  'text',
  'decorations',
  'foreground objects',
  'background regions',
  'small details',
].join(', ');

function getEnvValue(key: string, fallback: string) {
  return process.env[key]?.trim() || fallback;
}

function normalizeRunningHubUrl(fileUrl: string) {
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
  return fileUrl.startsWith('/') ? `${BASE_URL}${fileUrl}` : fileUrl;
}

async function getRunningHubWorkflowPrompt(workflowId: string): Promise<Record<string, RunningHubPromptNode>> {
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
    throw new Error(`读取智能PSD工作流失败: ${data.msg || 'unknown'}`);
  }
  const parsed = JSON.parse(data.data.prompt) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('智能PSD工作流格式无效');
  }
  return parsed as Record<string, RunningHubPromptNode>;
}

function setLoadImageFromUrl(workflow: Record<string, RunningHubPromptNode>, nodeId: string, imageUrl: string) {
  const node = workflow[nodeId];
  if (!node) throw new Error(`智能PSD工作流缺少图片节点 ${nodeId}`);
  node.class_type = 'LoadImageFromUrl';
  node.inputs = {
    image: imageUrl,
    keep_alpha_channel: false,
  };
}

function setNodeInput(workflow: Record<string, RunningHubPromptNode>, nodeId: string, fieldName: string, value: unknown) {
  const node = workflow[nodeId];
  if (!node) throw new Error(`智能PSD工作流缺少节点 ${nodeId}`);
  node.inputs = {
    ...(node.inputs || {}),
    [fieldName]: value,
  };
}

function removeSaveNodes(workflow: Record<string, RunningHubPromptNode>) {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === 'SaveImage') {
      delete workflow[nodeId];
    }
  }
}

async function createSmartPsdMaskTask(imageUrl: string) {
  if (!API_KEY) throw new Error('RunningHub API Key 未配置');

  const workflowId = getEnvValue('RUNNINGHUB_CLOWN_WORKFLOW_ID', DEFAULT_WORKFLOW_ID);
  const imageNodeId = getEnvValue('RUNNINGHUB_CLOWN_IMAGE_NODE_ID', DEFAULT_IMAGE_NODE_ID);
  const promptNodeId = getEnvValue('RUNNINGHUB_CLOWN_PROMPT_NODE_ID', DEFAULT_PROMPT_NODE_ID);
  const promptFieldName = getEnvValue('RUNNINGHUB_CLOWN_PROMPT_FIELD_NAME', DEFAULT_PROMPT_FIELD_NAME);
  const maskSourceNodeId = getEnvValue('RUNNINGHUB_CLOWN_MASK_SOURCE_NODE_ID', DEFAULT_MASK_SOURCE_NODE_ID);
  const maskSourceOutputIndex = Number(getEnvValue('RUNNINGHUB_CLOWN_MASK_SOURCE_OUTPUT_INDEX', String(DEFAULT_MASK_SOURCE_OUTPUT_INDEX)));

  const workflow = await getRunningHubWorkflowPrompt(workflowId);
  setLoadImageFromUrl(workflow, imageNodeId, imageUrl);
  setNodeInput(workflow, promptNodeId, promptFieldName, SMART_PSD_PROMPT);
  removeSaveNodes(workflow);

  workflow[MASK_TO_IMAGE_NODE_ID] = {
    class_type: 'MaskToImage',
    inputs: {
      mask: [maskSourceNodeId, Number.isFinite(maskSourceOutputIndex) ? maskSourceOutputIndex : DEFAULT_MASK_SOURCE_OUTPUT_INDEX],
    },
    _meta: {
      title: 'Convert smart PSD instance masks to images',
    },
  };
  workflow[MASK_SAVE_NODE_ID] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'smart_psd_masks',
      images: [MASK_TO_IMAGE_NODE_ID, 0],
    },
    _meta: {
      title: 'Save smart PSD instance masks',
    },
  };

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
  const data = await response.json() as RunningHubCreateTaskResponse;
  if (data.msg !== 'success' || !data.data?.taskId) {
    throw new Error(`创建智能PSD mask任务失败: ${data.msg || JSON.stringify(data).slice(0, 200)}`);
  }
  return data.data.taskId;
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
    return light;
  }
  return dark;
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
      let borderTouches = 0;
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

  return components.sort((a, b) => scoreComponent(b, width, height) - scoreComponent(a, width, height));
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
    name: `Smart Layer ${String(index + 1).padStart(2, '0')}`,
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

async function analyzeMaskUrl(maskUrl: string, width: number, height: number) {
  const { buffer } = await downloadSafeRemoteImage(maskUrl, {
    timeoutMs: 60000,
    maxBytes: 50 * 1024 * 1024,
  });
  const raw = await sharp(buffer, { failOnError: false })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer();
  return extractComponents(thresholdMask(raw), width, height);
}

export async function generateSmartPsdFromImageUrl(imageUrl: string): Promise<SmartPsdResult> {
  const sourceImage = await downloadSafeRemoteImage(imageUrl, {
    timeoutMs: 90000,
    maxBytes: 60 * 1024 * 1024,
    allowLocalMaterialFile: true,
  });
  const metadata = await sharp(sourceImage.buffer, { failOnError: false }).metadata();
  const sourceWidth = metadata.width || 0;
  const sourceHeight = metadata.height || 0;
  if (!sourceWidth || !sourceHeight) {
    throw new Error('无法读取原图尺寸');
  }

  const taskId = await createSmartPsdMaskTask(imageUrl);
  await waitForTaskComplete(taskId, 9);
  const outputs = await getTaskOutputs(taskId);
  const maskUrls = outputs
    .filter((output) => (!output.nodeId || output.nodeId === MASK_SAVE_NODE_ID) && output.fileUrl)
    .map((output) => normalizeRunningHubUrl(output.fileUrl));

  if (!maskUrls.length) {
    throw new Error('智能PSD工作流未返回可用 mask');
  }

  const componentGroups = await Promise.all(maskUrls.map((maskUrl) => analyzeMaskUrl(maskUrl, sourceWidth, sourceHeight)));
  const components = componentGroups
    .flat()
    .sort((a, b) => scoreComponent(b, sourceWidth, sourceHeight) - scoreComponent(a, sourceWidth, sourceHeight))
    .slice(0, MAX_LAYERS);

  if (!components.length) {
    throw new Error('智能PSD未识别到可分层元素');
  }

  const sourceRgba = await sharp(sourceImage.buffer, { failOnError: false })
    .resize(sourceWidth, sourceHeight, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  return {
    psdBuffer: writePsdFromComponents(sourceRgba, components, sourceWidth, sourceHeight),
    taskId,
    maskCount: maskUrls.length,
    layerCount: components.length,
    sourceWidth,
    sourceHeight,
  };
}
