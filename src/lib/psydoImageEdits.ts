import sharp from 'sharp';

const PSYDO_BASE_URL = 'https://api.psydo.top/v1';
const PSYDO_IMAGE_MODEL = 'gpt-image-2';

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: imageUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`下载图片失败 (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function decodeImageBase64(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

export async function runPsydoImageEditFromUrl(params: {
  imageUrl: string;
  prompt: string;
  size?: string;
  quality?: string;
  maskImageBase64?: string;
}): Promise<Buffer> {
  const apiKey = getRequiredEnv('PSYDO_API_KEY');
  const sourceBuffer = await fetchImageBuffer(params.imageUrl);
  const normalizedBuffer = await sharp(sourceBuffer).rotate().png().toBuffer();

  const form = new FormData();
  form.append('model', PSYDO_IMAGE_MODEL);
  form.append('prompt', params.prompt);
  const arrayBuffer = normalizedBuffer.buffer.slice(
    normalizedBuffer.byteOffset,
    normalizedBuffer.byteOffset + normalizedBuffer.byteLength,
  ) as ArrayBuffer;
  form.append('image', new Blob([arrayBuffer], { type: 'image/png' }), 'source.png');

  if (params.maskImageBase64) {
    const maskMatch = params.maskImageBase64.match(/^data:image\/png;base64,(.+)$/);
    const maskData = maskMatch ? maskMatch[1] : params.maskImageBase64;
    form.append('mask_image', new Blob([Buffer.from(maskData, 'base64')], { type: 'image/png' }), 'mask.png');
  }

  if (params.size) {
    form.append('size', params.size);
  }
  if (params.quality) {
    form.append('quality', params.quality);
  }

  const response = await fetch(`${PSYDO_BASE_URL}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Psydo 图像编辑失败: ${response.status} ${errorText.substring(0, 200)}`);
  }

  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = data.data?.[0];
  if (!first) {
    throw new Error('Psydo 图像编辑未返回结果');
  }

  if (first.b64_json) {
    return decodeImageBase64(first.b64_json);
  }

  if (first.url) {
    return fetchImageBuffer(first.url);
  }

  throw new Error('Psydo 图像编辑返回格式不支持');
}
