import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { transactionManager, userManager } from '@/storage/database';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { runPsydoImageEditWithMetaFromUrl, isImageEditTimeoutError } from '@/lib/psydoImageEdits';
import { createUpsamplingTask, waitForUpsamplingTaskComplete } from '@/lib/runningHubWatermark';
import { buildBrowserImageHeaders } from '@/lib/browserFetch';

export type OutpaintUpsamplingRequest = {
  userId?: string;
  imageUrl?: string;
};

type EditCanvasSpec = {
  width: number;
  height: number;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  aspectRatio: number;
};

type Final4kResult = Awaited<ReturnType<typeof ensure4kLongEdge>>;

type PromptResolution = {
  prompt: string;
  summary?: string;
  source?: string;
  model?: string;
};

type RouteOptions = {
  orderPrefix: string;
  toolPage: string;
  description: string;
  queuedMessage: string;
  logPrefix: string;
  workflow: string;
  routeStoragePrefix: string;
  resolvePrompt: (params: {
    sourceBuffer: Buffer;
    sourceWidth: number;
    sourceHeight: number;
    imageUrl: string;
    request: NextRequest;
  }) => Promise<PromptResolution>;
};

const FINAL_LONG_EDGE_TARGET = 4096;
const EDIT_CANVAS_SPECS: EditCanvasSpec[] = [
  { width: 1024, height: 1024, size: '1024x1024', aspectRatio: 1 },
  { width: 1024, height: 1536, size: '1024x1536', aspectRatio: 1024 / 1536 },
  { width: 1536, height: 1024, size: '1536x1024', aspectRatio: 1536 / 1024 },
];

function isTimeoutLikeError(error: unknown) {
  return isImageEditTimeoutError(error)
    || (error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message || ''));
}

function getUserFacingMessage(error: unknown) {
  if (isTimeoutLikeError(error)) {
    return '处理时间较长，请稍后重试';
  }

  return '暂时未能完成处理，请稍后重试';
}

function getResolvedImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

async function downloadImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl, {
    headers: buildBrowserImageHeaders(imageUrl),
  });

  if (!response.ok) {
    throw new Error(`无法读取原图资源 (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function resolveEditCanvasSpec(width: number, height: number): EditCanvasSpec {
  if (width <= 0 || height <= 0) {
    return EDIT_CANVAS_SPECS[0];
  }

  const sourceAspectRatio = width / height;
  return EDIT_CANVAS_SPECS.reduce((best, spec) => {
    const currentDifference = Math.abs(Math.log(sourceAspectRatio / spec.aspectRatio));
    const bestDifference = Math.abs(Math.log(sourceAspectRatio / best.aspectRatio));
    return currentDifference < bestDifference ? spec : best;
  }, EDIT_CANVAS_SPECS[0]);
}

async function buildOutpaintBuffers(sourceBuffer: Buffer, canvas: EditCanvasSpec) {
  const insetWidth = Math.max(1, Math.round(canvas.width * 0.76));
  const insetHeight = Math.max(1, Math.round(canvas.height * 0.76));

  const resized = await sharp(sourceBuffer)
    .rotate()
    .resize(insetWidth, insetHeight, {
      fit: 'contain',
      position: 'center',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const resizedMetadata = await sharp(resized).metadata();
  const contentWidth = resizedMetadata.width || insetWidth;
  const contentHeight = resizedMetadata.height || insetHeight;
  const left = Math.max(0, Math.floor((canvas.width - contentWidth) / 2));
  const top = Math.max(0, Math.floor((canvas.height - contentHeight) / 2));

  const sourceCanvasBuffer = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();

  const preserveMaskTile = await sharp({
    create: {
      width: contentWidth,
      height: contentHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const maskBuffer = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: preserveMaskTile, left, top }])
    .png()
    .toBuffer();

  return {
    sourceCanvasBuffer,
    maskBuffer,
    placement: {
      left,
      top,
      width: contentWidth,
      height: contentHeight,
    },
  };
}

function toPngDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function resolveFinalOutputSize(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return {
      width: FINAL_LONG_EDGE_TARGET,
      height: FINAL_LONG_EDGE_TARGET,
    };
  }

  const aspectRatio = width / height;
  if (aspectRatio >= 1) {
    return {
      width: FINAL_LONG_EDGE_TARGET,
      height: Math.max(1, Math.round(FINAL_LONG_EDGE_TARGET / aspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(FINAL_LONG_EDGE_TARGET * aspectRatio)),
    height: FINAL_LONG_EDGE_TARGET,
  };
}

async function ensure4kLongEdge(buffer: Buffer, targetSize: { width: number; height: number }) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width === targetSize.width && height === targetSize.height) {
    return {
      buffer,
      width,
      height,
      normalized: false,
    };
  }

  const normalizedBuffer = await sharp(buffer)
    .resize({
      width: targetSize.width,
      height: targetSize.height,
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  const normalizedMetadata = await sharp(normalizedBuffer).metadata();
  return {
    buffer: normalizedBuffer,
    width: normalizedMetadata.width || width,
    height: normalizedMetadata.height || height,
    normalized: true,
  };
}

export async function runOutpaintUpsamplingRoute(request: NextRequest, options: RouteOptions) {
  let orderId = '';

  try {
    const body = await request.json() as OutpaintUpsamplingRequest;
    const userId = body.userId?.trim();
    const imageUrl = body.imageUrl?.trim();

    if (!userId || !imageUrl) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/')) {
      return NextResponse.json({ success: false, message: '图片URL格式不正确' }, { status: 400 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    const currentPoints = user.points || 0;
    orderId = `${options.orderPrefix}-${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await transactionManager.createTransaction({
      userId,
      orderNumber: orderId,
      toolPage: options.toolPage,
      description: options.description,
      points: 0,
      remainingPoints: currentPoints,
      resultData: '',
      uploadedImage: imageUrl,
      requestParams: JSON.stringify({
        imageUrl,
        workflow: options.workflow,
        targetLongEdge: FINAL_LONG_EDGE_TARGET,
      }),
      status: '处理中',
    });

    const response = NextResponse.json({
      success: true,
      message: options.queuedMessage,
      data: {
        orderId,
      },
    });

    const resolvedInputImageUrl = getResolvedImageUrl(imageUrl, request);

    (async () => {
      try {
        console.log(`[${options.logPrefix}] ========== 后台任务开始 ==========`);
        console.log(`[${options.logPrefix}] 订单号:`, orderId);

        const sourceBuffer = await downloadImageBuffer(resolvedInputImageUrl);
        const sourceMetadata = await sharp(sourceBuffer).metadata();
        const sourceWidth = sourceMetadata.width || 0;
        const sourceHeight = sourceMetadata.height || 0;
        if (sourceWidth <= 0 || sourceHeight <= 0) {
          throw new Error('无法读取原图尺寸');
        }

        const promptResolution = await options.resolvePrompt({
          sourceBuffer,
          sourceWidth,
          sourceHeight,
          imageUrl: resolvedInputImageUrl,
          request,
        });

        const canvas = resolveEditCanvasSpec(sourceWidth, sourceHeight);
        const finalOutputSize = resolveFinalOutputSize(sourceWidth, sourceHeight);
        const { sourceCanvasBuffer, maskBuffer, placement } = await buildOutpaintBuffers(sourceBuffer, canvas);

        console.log(`[${options.logPrefix}] 步骤1: 上传 outpaint 输入画布`);
        const sourceCanvasUrl = await uploadToCozeStorage(sourceCanvasBuffer, `${options.routeStoragePrefix}/${orderId}-source.png`, 'image/png');

        let outpaintResultUrl = '';
        let upsamplingTaskId = '';
        let upsamplingResultUrl = '';
        let finalResultUrl = '';
        let final4kResult: Final4kResult | null = null;
        let imageEditMeta: {
          model: string;
          targetName: 'primary' | 'fallback';
          baseUrl: string;
          usedFallback: boolean;
        } | null = null;
        console.log(`[${options.logPrefix}] 步骤2: 调用 gpt-image-2 扩图`);
        const imageEditResult = await runPsydoImageEditWithMetaFromUrl({
          imageUrl: sourceCanvasUrl,
          prompt: promptResolution.prompt,
          size: canvas.size,
          quality: 'high',
          maskImageBase64: toPngDataUrl(maskBuffer),
        });

        imageEditMeta = imageEditResult.meta;

        console.log(`[${options.logPrefix}] 步骤3: 上传扩图结果供放大使用`);
        outpaintResultUrl = await uploadToCozeStorage(imageEditResult.buffer, `${options.routeStoragePrefix}/${orderId}-outpaint.png`, 'image/png');

        console.log(`[${options.logPrefix}] 步骤4: 基于扩图结果做高清放大`);
        upsamplingTaskId = await createUpsamplingTask(outpaintResultUrl);
        upsamplingResultUrl = await waitForUpsamplingTaskComplete(upsamplingTaskId, 5);

        console.log(`[${options.logPrefix}] 步骤5: 下载放大结果并规范到 4K 长边`);
        const upsamplingBuffer = await downloadImageBuffer(upsamplingResultUrl);
        final4kResult = await ensure4kLongEdge(upsamplingBuffer, finalOutputSize);
        finalResultUrl = await uploadToCozeStorage(final4kResult.buffer, `${options.routeStoragePrefix}/${orderId}.png`, 'image/png');

        if (!final4kResult || !imageEditMeta) {
          throw new Error(`${options.toolPage}任务未生成完整结果`);
        }

        await transactionManager.updateTransaction(orderId, {
          status: '成功',
          resultData: finalResultUrl,
          requestParams: JSON.stringify({
            imageUrl,
            workflow: options.workflow,
            prompt: promptResolution.prompt,
            promptSummary: promptResolution.summary || '',
            promptSource: promptResolution.source || '',
            promptModel: promptResolution.model || '',
            targetLongEdge: FINAL_LONG_EDGE_TARGET,
            sourceWidth,
            sourceHeight,
            outpaintCanvasWidth: canvas.width,
            outpaintCanvasHeight: canvas.height,
            outpaintCanvasSize: canvas.size,
            sourcePlacement: placement,
            outpaintInputUrl: sourceCanvasUrl,
            outpaintResultUrl,
            upsamplingTaskId,
            upsamplingResultUrl,
            targetOutputWidth: finalOutputSize.width,
            targetOutputHeight: finalOutputSize.height,
            finalWidth: final4kResult.width,
            finalHeight: final4kResult.height,
            final4kNormalized: final4kResult.normalized,
            editModel: imageEditMeta.model,
            editTarget: imageEditMeta.targetName,
            editBaseUrl: imageEditMeta.baseUrl,
            usedFallback: imageEditMeta.usedFallback,
          }),
        });

        console.log(`[${options.logPrefix}] ========== 后台任务完成 ==========`);
      } catch (error: unknown) {
        console.error(`[${options.logPrefix}] ========== 后台任务失败 ==========` , error);
        await transactionManager.updateTransaction(orderId, {
          status: isTimeoutLikeError(error) ? '超时' : '失败',
          resultData: JSON.stringify({
            error: getUserFacingMessage(error),
          }),
        });
      }
    })();

    return response;
  } catch (error: unknown) {
    console.error(`[${options.logPrefix}] 创建任务失败:`, error);

    if (orderId) {
      await transactionManager.updateTransaction(orderId, {
        status: isTimeoutLikeError(error) ? '超时' : '失败',
        resultData: JSON.stringify({
          error: getUserFacingMessage(error),
        }),
      });
    }

    return NextResponse.json(
      { success: false, message: getUserFacingMessage(error) },
      { status: isTimeoutLikeError(error) ? 504 : 500 }
    );
  }
}
