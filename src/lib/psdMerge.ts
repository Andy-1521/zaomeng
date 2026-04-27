import * as AgPsd from 'ag-psd';
import sharp from 'sharp';

// 使用ag-psd的接口类型
type Psd = AgPsd.Psd;
type Layer = AgPsd.Layer;

/**
 * PSD图层配置接口
 */
export interface PsdLayerConfig {
  url: string;
  name?: string;
  isBackground?: boolean;
}

/**
 * 合并多张图片为PSD文件
 * @param layers 图层数组（包含URL和可选的名称）
 * @returns PSD文件的Buffer
 */
export async function mergeImagesToPsd(layers: PsdLayerConfig[] | string[]): Promise<Buffer> {
  console.log('[PSD] 开始合并图片到PSD，图片数量:', layers.length);

  // 标准化输入：如果是字符串数组，转换为PsdLayerConfig数组
  const normalizedLayers: PsdLayerConfig[] = layers.map((item, index) =>
    typeof item === 'string'
      ? { url: item, name: `Layer ${index + 1}` }
      : item
  );

  // 读取第一张图片作为基准尺寸
  const firstImageBuffer = await downloadImage(normalizedLayers[0].url);
  const firstImageMetadata = await sharp(firstImageBuffer).metadata();

  const width = firstImageMetadata.width || 1024;
  const height = firstImageMetadata.height || 1024;

  console.log('[PSD] PSD尺寸:', { width, height });

  // 创建PSD对象（使用接口类型）
  const psd: Psd = {
    width,
    height,
    channels: 4, // RGBA
    bitsPerChannel: 8,
    colorMode: 3 as any, // RGB模式（3）
    children: [],
  };

  // 为每张图片创建图层（不反转，保持原顺序）
  // PSD中children数组的第一个元素是最上面的图层，最后一个元素是最下面的图层
  for (let i = 0; i < normalizedLayers.length; i++) {
    const layer = normalizedLayers[i];
    const url = layer.url;
    const layerName = layer.name || `Layer ${i + 1}`;
    console.log(`[PSD] 处理第 ${i + 1} 张图片: ${layerName}`);

    try {
      // 下载图片
      const imageBuffer = await downloadImage(url);

      // 获取图片信息
      const metadata = await sharp(imageBuffer).metadata();

      // 调整图片尺寸到PSD尺寸
      const resizedBuffer = await sharp(imageBuffer)
        .resize(width, height, {
          fit: 'contain',
          position: 'center',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .ensureAlpha()
        .raw()
        .toBuffer();

      // 创建图层对象
      const psdLayer: Layer = {
        name: layerName,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        blendMode: 'normal',
        opacity: 255,
        imageData: {
          data: new Uint8ClampedArray(resizedBuffer),
          width: width,
          height: height,
        },
      };

      // 添加图层
      psd.children!.push(psdLayer);
    } catch (error) {
      console.error(`[PSD] 处理第 ${i + 1} 张图片失败:`, error);
      throw error;
    }
  }

  // 使用writePsdBuffer生成Buffer
  console.log('[PSD] 开始生成PSD文件...');
  const psdBuffer = AgPsd.writePsdBuffer(psd);
  console.log('[PSD] PSD文件生成成功，大小:', psdBuffer.length, 'bytes');
  console.log('[PSD] 图层顺序（从上到下）:', psd.children!.map(l => l.name));

  return psdBuffer;
}

/**
 * 下载图片到Buffer
 */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
