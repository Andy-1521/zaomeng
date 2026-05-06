import { NextRequest, NextResponse } from 'next/server';
import { Config } from 'coze-coding-dev-sdk';

const COZE_API_URL = 'https://integration.coze.cn/api/v3/chat/completions';
const VISION_MODEL = 'doubao-seed-2-0-mini-260215';

type PromptRegion = {
  id?: string;
  type?: 'brush' | 'tag';
  naturalX?: number;
  naturalY?: number;
  description?: string;
  candidates?: string[];
  selectedCandidate?: string;
  customTarget?: string;
};

type ComposePromptBody = {
  imageUrl?: string;
  mode?: 'brush' | 'tag';
  instruction?: string;
  regions?: PromptRegion[];
};

function resolveImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

function buildRegionText(regions: PromptRegion[]) {
  if (regions.length === 0) return '无明确标签，仅以遮罩区域为准。';

  return regions
    .map((region, index) => {
      const target = (region.customTarget || region.selectedCandidate || region.description || `区域${index + 1}`).trim();
      const point = typeof region.naturalX === 'number' && typeof region.naturalY === 'number'
        ? `(${region.naturalX}, ${region.naturalY})`
        : '';
      return `${index + 1}. ${target}${point ? ` ${point}` : ''}`;
    })
    .join('\n');
}

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
    throw new Error(`Agent 调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

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
        // ignore parse error
      }
    }
  }

  return fullContent;
}

function fallbackPrompt(body: Required<Pick<ComposePromptBody, 'mode'>> & ComposePromptBody) {
  const regions = body.regions || [];
  const regionText = buildRegionText(regions);
  const instruction = (body.instruction || '').trim();

  const base = body.mode === 'brush'
    ? '请仅修改遮罩区域内的内容，保持其余区域不变。'
    : `请仅修改以下局部区域：${regionText}，保持其余区域不变。`;

  const editInstruction = instruction
    ? `${base}${instruction}`
    : `${base}边缘自然融合，风格与光影保持一致。`;

  return {
    summary: body.mode === 'brush' ? '基于遮罩的局部改图' : '基于标签的局部改图',
    prompt: editInstruction,
    negativePrompt: '不要改动未选区域，不要改变整体构图、背景和风格，不要生成多余元素。',
    source: 'fallback',
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ComposePromptBody;
    const imageUrl = body.imageUrl?.trim();
    const mode = body.mode === 'brush' ? 'brush' : 'tag';
    const instruction = (body.instruction || '').trim();
    const regions = Array.isArray(body.regions) ? body.regions : [];

    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少图片地址' }, { status: 400 });
    }

    const config = new Config();
    const apiKey = config.apiKey;
    if (!apiKey) {
      return NextResponse.json({ success: true, data: fallbackPrompt({ imageUrl, mode, instruction, regions }) });
    }

    const prompt = `你是一个专业的电商图片局部改图 Agent。

请根据输入图片、选区模式和用户要求，生成可直接提交给局部改图模型的最终提示词。

要求：
- 只修改选中的局部区域
- 未选中的区域必须保持不变
- 保持整体构图、光影、色调、风格一致
- 边缘自然融合，尽量像原图的一部分
- 不要输出多余解释，不要输出 Markdown

选区模式：${mode === 'brush' ? '画笔遮罩' : '标签点选'}

选区信息：
${buildRegionText(regions)}

用户原始要求：
${instruction || '用户未填写额外要求，请根据图片内容做自然合理的局部修复/替换。'}

请只返回 JSON：
{
  "summary": "一句话概括改图目标",
  "prompt": "给局部改图模型的最终中文提示词",
  "negativePrompt": "不要改动..."
}`;

    try {
      const result = await callVisionModel(apiKey, resolveImageUrl(imageUrl, request), prompt);
      const cleaned = result.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

      try {
        const parsed = JSON.parse(cleaned) as { summary?: string; prompt?: string; negativePrompt?: string };
        const data = {
          summary: (parsed.summary || '').trim() || fallbackPrompt({ imageUrl, mode, instruction, regions }).summary,
          prompt: (parsed.prompt || '').trim() || fallbackPrompt({ imageUrl, mode, instruction, regions }).prompt,
          negativePrompt: (parsed.negativePrompt || '').trim() || fallbackPrompt({ imageUrl, mode, instruction, regions }).negativePrompt,
          source: 'agent',
        };

        return NextResponse.json({ success: true, data });
      } catch {
        const data = fallbackPrompt({ imageUrl, mode, instruction, regions });
        return NextResponse.json({ success: true, data });
      }
    } catch (error) {
      console.error('[MaterialEditorAgent] 生成提示词失败:', error);
      return NextResponse.json({ success: true, data: fallbackPrompt({ imageUrl, mode, instruction, regions }) });
    }
  } catch (error) {
    console.error('[MaterialEditorAgent] 请求失败:', error);
    return NextResponse.json({ success: false, message: '提示词生成失败' }, { status: 500 });
  }
}
