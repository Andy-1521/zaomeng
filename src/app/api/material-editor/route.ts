import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { uploadToCozeStorage } from '@/lib/dualStorage';
import { capturedImageManager } from '@/storage/database';
import { transactionManager, userManager } from '@/storage/database';
import { runPsydoImageEditFromUrl } from '@/lib/psydoImageEdits';
import { saveBufferToLocalMaterialFile } from '@/lib/localUploadStorage';

const REDRAW_WORKFLOW_URL = 'https://frzr6k4qcc.coze.site/run';
const REDRAW_WORKFLOW_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkOGYxNGZiLTM3M2MtNDRjMS1hZTJjLTcxMmRkMDk3OWFiYyJ9.eyJpc3MiOiJodHRwczovL2FwaS5jb3plLmNuIiwiYXVkIjpbIjE0Sm9lYVpCZkJmaXEzUHRQbWQ5QUlIMm5wbDJSV3RmIl0sImV4cCI6ODIxMDI2Njg3Njc5OSwiaWF0IjoxNzc2MjU5NzQ0LCJzdWIiOiJzcGlmZmU6Ly9hcGkuY296ZS5jbi93b3JrbG9hZF9pZGVudGl0eS9pZDo3NjI4OTE4NjY5NzgyODEwNjcwIiwic3JjIjoiaW5ib3VuZF9hdXRoX2FjY2Vzc190b2tlbl9pZDo3NjI4OTc3NTEzNzcwNzc4NjYwIn0.s5Y1qtl40GwKdVIkFEmYVyc_cpbzem4i1rxpHOfQQUpoeITkCZxSUIT-wz4l1GFBpVHWF4E5ktwZkkfddCt3Ft3cNJfXUql7SL5oZJyVYS0qkkp6gGnhvIykUaQnYrPB9XmOPeQsQumY8GmXLOixx1AQM5wxzlFjYlwibCAndLB-4O2Y4NEsJ571dBiF9cyF2eROVeNBXyhBLA7y9q_tXkAP2cukEDjfdhBTYDrILRMWz53zlVbKD0SYhDUM7xgDJYys3xPkv-VqjHLDrqt7drTyhoJ0GBvRpK_LnX-206KJScSHDQ27eWBuiykaEk3O2U2HrMV33Zrm_9daRClAdA';

const FETCH_TIMEOUT = 600000;

type CropPayload = {
  action?: 'crop';
  imageUrl?: string;
  rotation?: number;
  scale?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  outputSize?: {
    width?: number;
    height?: number;
  };
  crop?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

type AnnotatePayload = {
  action?: 'annotate';
  imageUrl?: string;
  annotationData?: string;
};

type RedrawPayload = {
  action?: 'redraw';
  imageUrl?: string;
  maskImageBase64?: string;
  prompt?: string;
};

type EditorPayload = CropPayload | AnnotatePayload | RedrawPayload;

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user');
  if (!userCookie) return null;

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string };
    return typeof userData.id === 'string' && userData.id ? userData.id : null;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '编辑图片生成失败';
}

function normalizeRotation(rotation: unknown) {
  if (typeof rotation !== 'number' || !Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function normalizeScale(scale: unknown) {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return 1;
  return Math.max(0.5, Math.min(2, scale));
}

function normalizeOutputDimension(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(12000, Math.round(value)));
}

function getCropNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function getContainedCropArea(
  crop: { x?: number; y?: number; width?: number; height?: number },
  canvasWidth: number,
  canvasHeight: number,
  scale: number
) {
  const visibleWidth = canvasWidth / scale;
  const visibleHeight = canvasHeight / scale;
  const cropX = getCropNumber(crop.x, 0);
  const cropY = getCropNumber(crop.y, 0);
  const cropWidth = Math.max(1, getCropNumber(crop.width, 100));
  const cropHeight = Math.max(1, getCropNumber(crop.height, 100));
  const visibleLeft = (canvasWidth - visibleWidth) / 2;
  const visibleTop = (canvasHeight - visibleHeight) / 2;

  return {
    left: Math.max(0, Math.min(canvasWidth - 1, Math.round(visibleLeft + (cropX / 100) * visibleWidth))),
    top: Math.max(0, Math.min(canvasHeight - 1, Math.round(visibleTop + (cropY / 100) * visibleHeight))),
    width: Math.max(1, Math.round((cropWidth / 100) * visibleWidth)),
    height: Math.max(1, Math.round((cropHeight / 100) * visibleHeight)),
  };
}

function resolveImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

async function downloadImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: imageUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`无法读取原图资源 (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parsePngDataUrl(dataUrl: string): Buffer {
  const matched = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!matched) {
    throw new Error('标注画布格式不正确');
  }
  return Buffer.from(matched[1], 'base64');
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function saveToLocalPublic(buffer: Buffer, fileName: string) {
  const filePath = path.join(process.cwd(), 'public', fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `/api/material-file/${fileName.replace(/\\/g, '/')}`;
}

async function persistEditedImage(buffer: Buffer, userId: string, action: 'crop' | 'annotate') {
  const extension = action === 'crop' ? 'jpg' : 'png';
  const contentType = action === 'crop' ? 'image/jpeg' : 'image/png';
  const fileName = `material-editor/${userId}/${Date.now()}-${Math.floor(Math.random() * 10000)}-${action}.${extension}`;

  try {
    return await uploadToCozeStorage(buffer, fileName, contentType);
  } catch (error) {
    console.warn('[素材编辑] 对象存储上传失败，回退到本地 public 存储:', error);
    return saveToLocalPublic(buffer, fileName);
  }
}

async function createMaterialRecord(userId: string, imageUrl: string, action: 'crop' | 'annotate' | 'redraw') {
  return capturedImageManager.createCapturedImage({
    userId,
    imageUrl,
    originalUrl: null,
    pageUrl: null,
    pageTitle: action === 'crop' ? '裁切工具生成' : action === 'annotate' ? '画笔标注生成' : '局部改图生成',
    sourceHost: 'material-editor',
    imageType: 'edited',
  });
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '请先登录后再生成编辑素材' }, { status: 401 });
    }

    const body = await request.json() as EditorPayload;
    if (!body.imageUrl) {
      return NextResponse.json({ success: false, message: '缺少原图地址' }, { status: 400 });
    }

    if (body.action === 'redraw') {
      if (!body.maskImageBase64) {
        return NextResponse.json({ success: false, message: '缺少遮罩图' }, { status: 400 });
      }

      if (!body.prompt?.trim()) {
        return NextResponse.json({ success: false, message: '缺少修改提示词' }, { status: 400 });
      }

      const user = await userManager.getUserById(userId);
      if (!user) {
        return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
      }

      const REQUIRED_POINTS = 30;
      if ((user.points || 0) < REQUIRED_POINTS) {
        return NextResponse.json({ success: false, message: `积分不足，当前积分：${user.points}，需要：${REQUIRED_POINTS}` }, { status: 400 });
      }

      const orderNumber = `MD${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const resultBuffer = await runPsydoImageEditFromUrl({
        imageUrl: resolveImageUrl(body.imageUrl, request),
        prompt: body.prompt.trim(),
        size: '1024x1792',
        quality: 'high',
        maskImageBase64: body.maskImageBase64,
      });

      let editedUrl = '';
      try {
        editedUrl = await uploadToCozeStorage(resultBuffer, `material-editor-redraw/${userId}/${orderNumber}.png`, 'image/png');
      } catch (error) {
        console.warn('[素材编辑] redraw 对象存储失败，回退本地:', error);
        const localUrl = await saveBufferToLocalMaterialFile(resultBuffer, `material-editor/${userId}/${orderNumber}-redraw.png`);
        editedUrl = new URL(localUrl, request.nextUrl.origin).toString();
      }

      const updatedUser = await userManager.deductPointsAtomically(userId, REQUIRED_POINTS);
      if (!updatedUser) {
        return NextResponse.json({ success: false, message: '积分不足' }, { status: 400 });
      }

      await transactionManager.createTransaction({
        userId,
        orderNumber,
        toolPage: '局部改图',
        description: `局部改图: ${body.prompt.trim().substring(0, 50)}`,
        points: REQUIRED_POINTS,
        actualPoints: REQUIRED_POINTS,
        remainingPoints: updatedUser.points,
        status: '成功',
        prompt: body.prompt.trim(),
        resultData: editedUrl,
        uploadedImage: body.imageUrl,
      });

      const record = await createMaterialRecord(userId, editedUrl, 'redraw');

      return NextResponse.json({
        success: true,
        data: {
          id: record.id,
          url: editedUrl,
          remainingPoints: updatedUser.points,
        },
      });
    }

    const sourceBuffer = await downloadImageBuffer(resolveImageUrl(body.imageUrl, request));
    const normalizedBuffer = await sharp(sourceBuffer).rotate().toBuffer();
    const baseImage = sharp(normalizedBuffer);
    const baseMetadata = await baseImage.metadata();
    const imageWidth = baseMetadata.width || 0;
    const imageHeight = baseMetadata.height || 0;

    if (imageWidth <= 0 || imageHeight <= 0) {
      throw new Error('无法读取原图尺寸');
    }

    let outputBuffer: Buffer;
    let action: 'crop' | 'annotate';

    if (body.action === 'crop') {
      const crop = body.crop;
      if (!crop) {
        return NextResponse.json({ success: false, message: '缺少裁切区域' }, { status: 400 });
      }

      const rotation = normalizeRotation(body.rotation);
      const scale = normalizeScale(body.scale);
      let transformed = sharp(normalizedBuffer).flatten({ background: '#ffffff' });

      if (body.flipHorizontal) {
        transformed = transformed.flop();
      }

      if (body.flipVertical) {
        transformed = transformed.flip();
      }

      if (rotation !== 0) {
        transformed = transformed.rotate(rotation, { background: '#ffffff' });
      }

      const transformedBuffer = await transformed.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const transformedMetadata = await sharp(transformedBuffer).metadata();
      const transformedWidth = transformedMetadata.width || imageWidth;
      const transformedHeight = transformedMetadata.height || imageHeight;

      const cropArea = getContainedCropArea(crop, transformedWidth, transformedHeight, scale);
      const left = cropArea.left;
      const top = cropArea.top;
      const width = Math.max(1, Math.min(transformedWidth - left, cropArea.width));
      const height = Math.max(1, Math.min(transformedHeight - top, cropArea.height));

      let outputImage = sharp(transformedBuffer)
        .extract({ left, top, width, height })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, mozjpeg: true });

      const outputWidth = normalizeOutputDimension(body.outputSize?.width);
      const outputHeight = normalizeOutputDimension(body.outputSize?.height);

      if (outputWidth && outputHeight) {
        outputImage = outputImage.resize({ width: outputWidth, height: outputHeight, fit: 'fill' });
      }

      outputBuffer = await outputImage.toBuffer();
      action = 'crop';
    } else if (body.action === 'annotate') {
      if (!body.annotationData) {
        return NextResponse.json({ success: false, message: '缺少标注画布' }, { status: 400 });
      }

      const overlayBuffer = await sharp(parsePngDataUrl(body.annotationData))
        .resize(imageWidth, imageHeight, { fit: 'fill' })
        .png()
        .toBuffer();

      outputBuffer = await sharp(normalizedBuffer)
        .png()
        .composite([{ input: overlayBuffer, left: 0, top: 0 }])
        .toBuffer();
      action = 'annotate';
    } else {
      return NextResponse.json({ success: false, message: '未知编辑动作' }, { status: 400 });
    }

    const editedUrl = await persistEditedImage(outputBuffer, userId, action);
    const record = await createMaterialRecord(userId, editedUrl, action);

    return NextResponse.json({
      success: true,
      data: {
        id: record.id,
        url: editedUrl,
      },
    });
  } catch (error) {
    console.error('[素材编辑] 生成失败:', error);
    return NextResponse.json({ success: false, message: getErrorMessage(error) }, { status: 500 });
  }
}
