import { NextRequest, NextResponse } from 'next/server';
import { composePromptFromImage, type PromptRegion } from '@/lib/materialEditorPrompt';

type ComposePromptBody = {
  imageUrl?: string;
  mode?: 'brush' | 'tag';
  instruction?: string;
  regions?: PromptRegion[];
  sessionId?: string;
};

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

    const data = await composePromptFromImage({ request, imageUrl, mode, instruction, regions, sessionId: body.sessionId });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[MaterialEditorAgent] 请求失败:', error);
    return NextResponse.json({ success: false, message: '提示词生成失败' }, { status: 500 });
  }
}
