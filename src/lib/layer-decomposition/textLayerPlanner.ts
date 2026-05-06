import { Config } from 'coze-coding-dev-sdk';
import type { TextLayerCandidate } from './types';

export interface TextLayerPlannerContext {
  imageUrl: string;
  layerImageUrls: string[];
}

const COZE_API_URL = 'https://integration.coze.cn/api/v3/chat/completions';
const VISION_MODEL = 'doubao-seed-2-0-mini-260215';

async function callVisionModel(apiKey: string, imageUrl: string, prompt: string): Promise<string> {
  const response = await fetch(COZE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      stream: false,
      thinking: { type: 'disabled' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`视觉模型调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.choices?.[0]?.delta?.content) {
          fullContent += parsed.choices[0].delta.content;
        }
      } catch {
        // ignore stream parse error
      }
    }
  }

  return fullContent;
}

function parseTextLayerIndex(raw: string, maxIndex: number): TextLayerCandidate[] {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      sourceIndex?: number;
      confidence?: number;
      label?: string;
      candidates?: Array<{ sourceIndex?: number; confidence?: number; label?: string }>;
    };

    const items = parsed.candidates?.length ? parsed.candidates : [parsed];
    return items
      .filter((item) => typeof item.sourceIndex === 'number' && item.sourceIndex >= 0 && item.sourceIndex < maxIndex)
      .map((item) => ({
        sourceIndex: item.sourceIndex as number,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
        label: item.label || 'Text',
      }));
  } catch {
    const match = cleaned.match(/(\d+)/);
    if (!match) return [];
    const index = Number(match[1]);
    if (!Number.isFinite(index) || index < 0 || index >= maxIndex) {
      return [];
    }
    return [{ sourceIndex: index, confidence: 0.3, label: 'Text' }];
  }
}

export async function detectTextLayerCandidates(
  context: TextLayerPlannerContext
): Promise<TextLayerCandidate[]> {
  const config = new Config();
  const apiKey = config.apiKey;
  if (!apiKey || context.layerImageUrls.length === 0) {
    return [];
  }

  const prompt = `你正在为一张图片的自动分层结果做图层归类。

当前候选图层共有 ${context.layerImageUrls.length} 张，它们的索引从 0 开始。
请判断哪一张图层最像“文字/文案层”。

规则：
- 只识别真正的文字、标题、字母、品牌文案
- 不要把花纹、边框、装饰线条误判成文字
- 如果没有明显文字，返回空 candidates

请只返回 JSON：
{
  "candidates": [
    { "sourceIndex": 0, "confidence": 0.92, "label": "Text" }
  ]
}`;

  try {
    const candidates: TextLayerCandidate[] = [];

    for (let index = 0; index < context.layerImageUrls.length; index += 1) {
      const imageUrl = context.layerImageUrls[index];
      const result = await callVisionModel(apiKey, imageUrl, `${prompt}\n\n当前待判断图层索引：${index}`);
      const parsed = parseTextLayerIndex(result, context.layerImageUrls.length)
        .filter((item) => item.sourceIndex === index);
      candidates.push(...parsed);
    }

    return candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  } catch (error) {
    console.error('[TextLayerPlanner] 识别文字层失败:', error);
    return [];
  }
}
