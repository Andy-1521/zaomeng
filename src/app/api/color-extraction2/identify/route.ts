import { NextRequest, NextResponse } from 'next/server';
import { Config } from 'coze-coding-dev-sdk';

// Coze OpenAI-compatible API endpoint (uses SDK config)
const COZE_API_URL = 'https://integration.coze.cn/api/v3/chat/completions';

// Vision model - doubao-seed-2-0-mini supports multimodal understanding
const VISION_MODEL = 'doubao-seed-2-0-mini-260215';
const MAX_CANDIDATES = 4;

interface IdentifyRequest {
  imageUrl: string;
  clickX: number;
  clickY: number;
  imageWidth: number;
  imageHeight: number;
}

interface IdentifyResult {
  description: string;
  candidates: string[];
}

/**
 * 调用视觉模型识别图片中指定位置的内容
 * 使用 doubao-seed-2-0-mini-260215 模型，支持多模态输入
 */
async function callVisionModel(
  apiKey: string,
  imageUrl: string,
  prompt: string
): Promise<string> {
  const response = await fetch(COZE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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
      // 关闭思考模式，将识别耗时从 ~27s 降至 ~3.5s
      thinking: { type: 'disabled' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  // 处理 SSE 流式响应
  const reader = response.body!.getReader();
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
        // 忽略解析错误
      }
    }
  }

  return fullContent;
}

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/^[。、！？，：;；""''【】\s]+/, '')
    .replace(/[。、！？，：;；""''【】\s]+$/, '')
    .replace(/\n/g, '')
    .substring(0, 30);
}

function normalizeCandidates(values: string[], fallback: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of [...values, fallback]) {
    const cleaned = cleanLabel(value);
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);

    if (result.length >= MAX_CANDIDATES) {
      break;
    }
  }

  return result.length > 0 ? result : ['所选区域'];
}

function parseIdentifyResult(raw: string): IdentifyResult {
  const cleanedRaw = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleanedRaw);
    const description = cleanLabel(parsed.description || parsed.primary || parsed.label || '');
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.map(String) : [];
    const fallback = description || cleanLabel(candidates[0] || '所选区域');

    if (fallback) {
      return {
        description: fallback,
        candidates: normalizeCandidates(candidates, fallback),
      };
    }
  } catch {
    // 模型未严格返回 JSON 时走下面的兜底逻辑
  }

  const fallback = cleanLabel(cleanedRaw.split(/\r?\n/)[0] || '所选区域');

  return {
    description: fallback || '所选区域',
    candidates: normalizeCandidates([fallback], fallback || '所选区域'),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: IdentifyRequest = await request.json();
    const { imageUrl, clickX, clickY, imageWidth, imageHeight } = body;

    if (!imageUrl || clickX === undefined || clickY === undefined) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 计算点击位置占比
    const ratioX = imageWidth ? clickX / imageWidth : 0;
    const ratioY = imageHeight ? clickY / imageHeight : 0;

    // 获取 API 凭证
    const config = new Config();
    const apiKey = config.apiKey;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'API认证失败，请联系管理员配置API密钥' },
        { status: 500 }
      );
    }

    const prompt = `观察图片中位置(${Math.round(ratioX * 100)}%, ${Math.round(ratioY * 100)}%)附近的内容。

请只返回一个 JSON 对象，不要输出 Markdown，不要解释：
{
  "description": "最准确的单个标签",
  "candidates": ["候选1", "候选2", "候选3"]
}

规则：
- 优先识别该位置本身最可能的物体、图案、人物部位或文字
- 如果该位置是文字，候选词可以同时包含“文字ABC”和“ABC”这种更短的叫法
- 如果有歧义，给出 2 到 4 个从最可能到次可能的候选标签
- 每个标签不超过 12 个字
- 不要把图案、花纹、纹理误认为文字`;

    let identifyResult: IdentifyResult = {
      description: '所选区域',
      candidates: ['所选区域'],
    };

    try {
      const result = await callVisionModel(apiKey, imageUrl, prompt);
      if (result) {
        identifyResult = parseIdentifyResult(result);
      }
    } catch (error) {
      console.error('[识别区域] 模型调用失败:', error);
    }

    return NextResponse.json({
      success: true,
      description: identifyResult.description,
      candidates: identifyResult.candidates,
      position: { x: clickX, y: clickY, ratioX, ratioY },
    });
  } catch (error) {
    console.error('[识别区域] 失败:', error);
    return NextResponse.json(
      { success: false, error: '识别失败' },
      { status: 500 }
    );
  }
}