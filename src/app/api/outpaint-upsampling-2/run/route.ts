import { NextRequest } from 'next/server';
import { runOutpaintUpsamplingRoute } from '@/lib/outpaintUpsamplingRunner';
import { generateDynamicOutpaintPrompt } from '@/lib/outpaintVisionPrompt';

export async function POST(request: NextRequest) {
  return runOutpaintUpsamplingRoute(request, {
    orderPrefix: 'HDO2',
    toolPage: '高清+扩图2',
    description: '高清+扩图2处理',
    queuedMessage: '高清+扩图2任务已提交',
    logPrefix: '高清+扩图2',
    workflow: 'gpt-image-2-outpaint-vision-prompt-then-upsampling-4k',
    routeStoragePrefix: 'outpaint-upsampling-2',
    resolvePrompt: async ({ sourceBuffer, sourceWidth, sourceHeight }) => {
      return generateDynamicOutpaintPrompt({
        imageBuffer: sourceBuffer,
        width: sourceWidth,
        height: sourceHeight,
      });
    },
  });
}
