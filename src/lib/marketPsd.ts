import { initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';
import { uploadToCozeStorage } from '@/lib/dualStorage';

initializeCanvas(
  ((width: number, height: number) => ({
    width,
    height,
    getContext: () => ({
      createImageData: (imageWidth: number, imageHeight: number) => ({
        width: imageWidth,
        height: imageHeight,
        data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
      }),
    }),
  })) as never,
  ((width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  })) as never
);

export type MarketPsdLayerPreview = {
  id: string;
  name: string;
  visible: boolean;
  width: number;
  height: number;
  left: number;
  top: number;
  previewUrl?: string;
};

const MAX_PSD_PARSE_BYTES = 120 * 1024 * 1024;
const MAX_LAYER_PREVIEWS = 24;

type PsdLayerNode = {
  name?: string;
  hidden?: boolean;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  imageData?: {
    data?: Uint8ClampedArray | Uint8Array | Buffer;
    width?: number;
    height?: number;
  };
  children?: PsdLayerNode[];
};

function flattenLayers(nodes: PsdLayerNode[] | undefined, output: PsdLayerNode[] = []) {
  if (!Array.isArray(nodes)) return output;
  for (const node of nodes) {
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenLayers(node.children, output);
    } else {
      output.push(node);
    }
  }
  return output;
}

async function createLayerPreview(layer: PsdLayerNode, keyPrefix: string, index: number) {
  const data = layer.imageData?.data;
  const width = Number(layer.imageData?.width || 0);
  const height = Number(layer.imageData?.height || 0);

  if (!data || width <= 0 || height <= 0) return undefined;
  const channelCount = Math.round(data.length / (width * height));
  const channels = channelCount === 1 || channelCount === 2 || channelCount === 3 || channelCount === 4 ? channelCount : 4;

  const previewBuffer = await sharp(Buffer.from(data), {
    raw: {
      width,
      height,
      channels,
    },
  })
    .ensureAlpha()
    .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  return uploadToCozeStorage(previewBuffer, `${keyPrefix}/layer-${index + 1}.webp`, 'image/webp');
}

export async function inspectMarketPsd(buffer: Buffer, options: { keyPrefix: string }) {
  if (buffer.length > MAX_PSD_PARSE_BYTES) {
    return {
      layers: [],
      layerCount: 0,
      warning: 'PSD文件较大，已跳过图层预览解析',
    };
  }

  const psd = readPsd(buffer, {
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  }) as PsdLayerNode;

  const layers = flattenLayers(psd.children).slice(0, MAX_LAYER_PREVIEWS);
  const previews: MarketPsdLayerPreview[] = [];

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const width = Math.max(0, Number(layer.right ?? 0) - Number(layer.left ?? 0));
    const height = Math.max(0, Number(layer.bottom ?? 0) - Number(layer.top ?? 0));
    let previewUrl: string | undefined;

    try {
      previewUrl = await createLayerPreview(layer, options.keyPrefix, index);
    } catch (error) {
      console.warn('[图市PSD] 图层预览生成失败:', layer.name, error);
    }

    previews.push({
      id: `${index + 1}`,
      name: layer.name || `图层 ${index + 1}`,
      visible: layer.hidden !== true,
      width,
      height,
      left: Number(layer.left ?? 0),
      top: Number(layer.top ?? 0),
      ...(previewUrl ? { previewUrl } : {}),
    });
  }

  return {
    layers: previews,
    layerCount: flattenLayers(psd.children).length,
  };
}

export async function inspectMarketPsdFromUrl(url: string, options: { keyPrefix: string }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`PSD下载失败: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_PSD_PARSE_BYTES) {
      return {
        layers: [],
        layerCount: 0,
        warning: 'PSD文件较大，已跳过图层预览解析',
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return inspectMarketPsd(buffer, options);
  } finally {
    clearTimeout(timeoutId);
  }
}
