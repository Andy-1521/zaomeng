import sharp from 'sharp';
import { buildOpenAICompatUrl, getOpenAICompatApiKey } from '@/lib/openaiCompatible';

const OUTPAINT_PROMPT_TIMEOUT_MS = 25000;
const OUTPAINT_PROMPT_MODELS = ['gpt-5.4-mini', 'gpt-5.4'] as const;

export type DynamicOutpaintPromptResult = {
  summary: string;
  prompt: string;
  source: 'json' | 'text';
  model: string;
};

function toDataUrl(buffer: Buffer, contentType = 'image/jpeg') {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function stripCodeFence(text: string) {
  return text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function parsePromptPayload(text: string, model: string): DynamicOutpaintPromptResult {
  const cleaned = stripCodeFence(text);
  if (!cleaned) {
    throw new Error('识图扩图提示词未返回内容');
  }

  try {
    const parsed = JSON.parse(cleaned) as { summary?: string; prompt?: string };
    const prompt = (parsed.prompt || '').trim();
    if (!prompt) {
      throw new Error('识图扩图提示词为空');
    }

    return {
      summary: (parsed.summary || '').trim() || '识图生成扩图提示词',
      prompt,
      source: 'json',
      model,
    };
  } catch {
    return {
      summary: '识图生成扩图提示词',
      prompt: cleaned,
      source: 'text',
      model,
    };
  }
}

async function callVisionModel(apiKey: string, model: string, imageDataUrl: string, width: number, height: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OUTPAINT_PROMPT_TIMEOUT_MS);

  const prompt = `你是一个专业的电商图片扩图提示词 Agent。

请阅读输入图片，为图像编辑模型生成一条中文扩图提示词，用于在更大的空白画布中保留原图中心已有内容，只补全四周新增空白区域。

你的任务不是创意生成，而是根据图片真实内容总结“这张图的四周应该如何自然延展”。

要求：
- 准确识别主体、背景类型、桌面/墙面/天空/空间层次、材质纹理、阴影、高光、反射与透视方向
- 提示词必须强调：主体、构图、比例、颜色、风格、细节保持不变，只补全新增空白区域
- 如果背景简单，强调平滑自然延展；如果背景复杂，强调延续已有材质、纹理、明暗和空间关系
- 禁止新增文字、水印、logo、边框、额外主体、重复主体、无关道具
- 如果局部信息不确定，优先描述为保守、克制、与原图一致的自然延展，不要胡乱编造
- 不要输出解释，不要输出 Markdown

原图尺寸：${width}x${height}

请只返回 JSON：
{
  "summary": "一句话概括这张图应该如何扩图",
  "prompt": "给图像编辑模型的最终中文扩图提示词"
}`;

  try {
    const response = await fetch(buildOpenAICompatUrl('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: 320,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`识图扩图提示词生成失败: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const result = await response.json() as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    return result.choices?.[0]?.message?.content?.trim() || '';
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`识图扩图提示词生成超时（${OUTPAINT_PROMPT_TIMEOUT_MS}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateDynamicOutpaintPrompt(params: {
  imageBuffer: Buffer;
  width: number;
  height: number;
}): Promise<DynamicOutpaintPromptResult> {
  const apiKey = getOpenAICompatApiKey();
  if (!apiKey) {
    throw new Error('缺少环境变量: OPENAI_COMPAT_API_KEY');
  }

  const previewBuffer = await sharp(params.imageBuffer)
    .rotate()
    .resize(1152, 1152, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const previewDataUrl = toDataUrl(previewBuffer, 'image/jpeg');

  let lastError: Error | null = null;

  for (const model of OUTPAINT_PROMPT_MODELS) {
    try {
      const result = await callVisionModel(apiKey, model, previewDataUrl, params.width, params.height);
      return parsePromptPayload(result, model);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('识图扩图提示词生成失败');
      console.warn('[OutpaintVisionPrompt] model-failed', {
        model,
        message: lastError.message,
      });
    }
  }

  throw lastError || new Error('识图扩图提示词生成失败');
}
