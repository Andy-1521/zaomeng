import { NextRequest } from 'next/server';
import { buildOpenAICompatUrl, getOpenAICompatApiKey } from '@/lib/openaiCompatible';

const PROMPT_AGENT_TIMEOUT_MS = 25000;

export type PromptRegion = {
  id?: string;
  type?: 'brush' | 'tag';
  naturalX?: number;
  naturalY?: number;
  description?: string;
  candidates?: string[];
  selectedCandidate?: string;
  customTarget?: string;
};

export type ComposePromptResult = {
  summary: string;
  prompt: string;
  negativePrompt: string;
  source: 'agent' | 'fallback';
};

function resolveImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

function buildRegionText(regions: PromptRegion[]) {
  if (regions.length === 0) return '无明确标记，仅以遮罩区域为准。';

  return regions
    .map((region, index) => {
      const target = (region.customTarget || region.selectedCandidate || region.description || `区域${index + 1}`).trim();
      const point = typeof region.naturalX === 'number' && typeof region.naturalY === 'number'
        ? `(${region.naturalX}, ${region.naturalY})`
        : '';
      const candidates = Array.isArray(region.candidates) && region.candidates.length
        ? `；候选：${region.candidates.map((item) => item.trim()).filter(Boolean).join('、')}`
        : '';
      return `${index + 1}. ${target}${point ? ` ${point}` : ''}${candidates}`;
    })
    .join('\n');
}

async function callVisionModel(apiKey: string, imageUrl: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROMPT_AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(buildOpenAICompatUrl('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 400,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Agent 调用失败: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const result = await response.json() as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    return result.choices?.[0]?.message?.content?.trim() || '';
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Agent 调用超时（${PROMPT_AGENT_TIMEOUT_MS}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function fallbackComposePrompt(params: {
  imageUrl: string;
  mode: 'brush' | 'tag';
  instruction: string;
  regions: PromptRegion[];
}): ComposePromptResult {
  const { imageUrl, mode, instruction, regions } = params;
  void imageUrl;
  const regionText = buildRegionText(regions);

  const base = mode === 'brush'
    ? '请仅修改遮罩区域内的内容，保持其余区域不变。'
    : `请仅修改以下局部区域：${regionText}，保持其余区域不变。`;

  const editInstruction = instruction
    ? `${base}${instruction}`
    : `${base}边缘自然融合，风格与光影保持一致。`;

  return {
    summary: mode === 'brush' ? '基于遮罩的智能改图' : '基于标记的智能改图',
    prompt: editInstruction,
    negativePrompt: '不要改动未选区域，不要改变整体构图、背景、主体姿态、镜头视角与原有风格，不要生成多余元素。',
    source: 'fallback',
  };
}

export async function composePromptFromImage(params: {
  request: NextRequest;
  imageUrl: string;
  mode: 'brush' | 'tag';
  instruction: string;
  regions: PromptRegion[];
  sessionId?: string;
}): Promise<ComposePromptResult> {
  const { request, imageUrl, mode, instruction, regions, sessionId } = params;
  const fallback = fallbackComposePrompt({ imageUrl, mode, instruction, regions });
  const apiKey = getOpenAICompatApiKey();
  const startedAt = Date.now();

  if (!apiKey) {
    console.info('[MaterialEditorPrompt] skip-agent', {
      sessionId: sessionId || 'unknown',
      mode,
      regionCount: regions.length,
      durationMs: Date.now() - startedAt,
      source: fallback.source,
      reason: 'missing_api_key',
    });
    return fallback;
  }

  const prompt = `你是一个专业的电商图片智能改图 Agent。

请根据输入图片、选区模式和用户要求，生成可直接提交给智能改图模型的最终提示词。

先准确理解图片当前内容、局部对象关系和用户真实意图，再整理成适合提交的中文提示词，不要擅自改写用户目标。

要求：
- 只修改选中的局部区域
- 未选中的区域必须保持不变
- 保持整体构图、光影、色调、风格一致
- 边缘自然融合，尽量像原图的一部分
- 如果用户要求不完整，允许补足必要的约束，但不能偏离原意
- 如果标记与用户自然语言一起出现，要优先结合图片语义整理成更准确的执行提示词
- 不要输出多余解释，不要输出 Markdown

选区模式：${mode === 'brush' ? '画笔遮罩' : '标记点选'}

选区信息：
${buildRegionText(regions)}

用户原始要求：
${instruction || '用户未填写额外要求，请根据图片内容做自然合理的局部修复/替换。'}

请只返回 JSON：
{
  "summary": "一句话概括改图目标",
  "prompt": "给智能改图模型的最终中文提示词",
  "negativePrompt": "不要改动..."
}`;

  try {
    const result = await callVisionModel(apiKey, resolveImageUrl(imageUrl, request), prompt);
    const cleaned = result.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

    try {
      const parsed = JSON.parse(cleaned) as { summary?: string; prompt?: string; negativePrompt?: string };
      return {
        summary: (parsed.summary || '').trim() || fallback.summary,
        prompt: (parsed.prompt || '').trim() || fallback.prompt,
        negativePrompt: (parsed.negativePrompt || '').trim() || fallback.negativePrompt,
        source: 'agent',
      };
    } catch {
      console.warn('[MaterialEditorPrompt] parse-fallback', {
        sessionId: sessionId || 'unknown',
        mode,
        regionCount: regions.length,
        durationMs: Date.now() - startedAt,
      });
      return fallback;
    }
  } catch (error) {
    console.error('[MaterialEditorAgent] 生成提示词失败:', error);
    console.warn('[MaterialEditorPrompt] agent-fallback', {
      sessionId: sessionId || 'unknown',
      mode,
      regionCount: regions.length,
      durationMs: Date.now() - startedAt,
    });
    return fallback;
  } finally {
    console.info('[MaterialEditorPrompt] completed', {
      sessionId: sessionId || 'unknown',
      mode,
      regionCount: regions.length,
      durationMs: Date.now() - startedAt,
    });
  }
}
