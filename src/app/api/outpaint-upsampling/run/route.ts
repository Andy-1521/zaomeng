import { NextRequest } from 'next/server';
import { runOutpaintUpsamplingRoute } from '@/lib/outpaintUpsamplingRunner';

const OUTPAINT_PROMPT = '保持原图中已有主体、构图、比例、透视、颜色、风格与细节完全不变，只对新增画布的四边空白区域进行自然补全。补全内容需要与原图背景、桌面、材质纹理、阴影、高光、反射、边缘过渡和空间关系连续一致，不新增文字、水印、logo、额外主体、重复主体或与原图无关的元素，不改动原图中心已有内容，不裁切、不变形、不重绘主体。';

export async function POST(request: NextRequest) {
  return runOutpaintUpsamplingRoute(request, {
    orderPrefix: 'HDO',
    toolPage: '高清+扩图',
    description: '高清+扩图处理',
    queuedMessage: '高清+扩图任务已提交',
    logPrefix: '高清+扩图',
    workflow: 'gpt-image-2-outpaint-then-upsampling-4k',
    routeStoragePrefix: 'outpaint-upsampling',
    resolvePrompt: async () => ({
      prompt: OUTPAINT_PROMPT,
      summary: '固定通用扩图提示词',
      source: 'fixed',
      model: 'static',
    }),
  });
}
