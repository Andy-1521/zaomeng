import { after, NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { transactionManager, userManager } from '@/storage/database';
import { uploadFromUrlToCozeStorage } from '@/lib/dualStorage';
import { getRemoveBackgroundPoints } from '@/lib/pricing';
import { tryCreateAndUploadResultThumbnailFromUrl } from '@/lib/resultThumbnail';
import { getCookieUserId, isBodyUserMismatch } from '@/lib/serverAuth';

type BackgroundRemovalRequest = {
  userId?: string;
  imageUrl?: string;
};

type RunningHubOutput = {
  url?: string;
  outputType?: string;
  text?: string | null;
};

type RunningHubTaskResponse = {
  taskId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  results?: RunningHubOutput[] | null;
};

const RUNNINGHUB_BASE_URL = 'https://www.runninghub.cn';
const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY || '';
const REMOVE_BACKGROUND_APP_ID = process.env.RUNNINGHUB_REMOVE_BACKGROUND_APP_ID || '1944679834197086210';
const REMOVE_BACKGROUND_IMAGE_NODE_ID = process.env.RUNNINGHUB_REMOVE_BACKGROUND_IMAGE_NODE_ID || '3';
const REMOVE_BACKGROUND_IMAGE_FIELD_NAME = process.env.RUNNINGHUB_REMOVE_BACKGROUND_IMAGE_FIELD_NAME || 'image';

function getResolvedImageUrl(imageUrl: string, request: NextRequest) {
  if (imageUrl.startsWith('/')) {
    return new URL(imageUrl, request.nextUrl.origin).toString();
  }
  return imageUrl;
}

function isTimeoutLikeError(error: unknown) {
  return error instanceof Error && /timeout|超时|ETIMEDOUT|AbortError/i.test(error.message || '');
}

function getUserFacingMessage(error: unknown) {
  if (isTimeoutLikeError(error)) return '移除背景处理超时，请稍后重试';
  return '移除背景暂时未能完成，请稍后重试';
}

function getAxiosErrorDetails(error: unknown) {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    };
  }

  return {
    message: error instanceof Error ? error.message : 'RunningHub请求失败',
    code: undefined,
    response: undefined,
  };
}

function assertRunningHubBackgroundRemovalConfigured() {
  if (!RUNNINGHUB_API_KEY) {
    throw new Error('缺少 RUNNINGHUB_API_KEY');
  }
  if (!REMOVE_BACKGROUND_APP_ID || !REMOVE_BACKGROUND_IMAGE_NODE_ID) {
    throw new Error('移除背景API未配置');
  }
}

function isRunningHubBackgroundRemovalConfigured() {
  return Boolean(RUNNINGHUB_API_KEY && REMOVE_BACKGROUND_APP_ID && REMOVE_BACKGROUND_IMAGE_NODE_ID);
}

async function createBackgroundRemovalTask(imageUrl: string) {
  assertRunningHubBackgroundRemovalConfigured();
  const response = await axios.post<RunningHubTaskResponse>(
    `${RUNNINGHUB_BASE_URL}/openapi/v2/run/ai-app/${REMOVE_BACKGROUND_APP_ID}`,
    {
      nodeInfoList: [
        {
          nodeId: REMOVE_BACKGROUND_IMAGE_NODE_ID,
          fieldName: REMOVE_BACKGROUND_IMAGE_FIELD_NAME,
          fieldValue: imageUrl,
          description: 'image',
        },
      ],
      instanceType: 'default',
      usePersonalQueue: 'false',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
      },
      timeout: 60000,
    },
  );

  if (response.data.errorCode) {
    throw new Error(`创建移除背景任务失败: ${response.data.errorMessage || response.data.errorCode}`);
  }

  if (!response.data.taskId) {
    throw new Error('移除背景API未返回任务ID');
  }

  return response.data.taskId;
}

async function queryBackgroundRemovalTask(taskId: string) {
  const response = await axios.post<RunningHubTaskResponse>(
    `${RUNNINGHUB_BASE_URL}/openapi/v2/query`,
    { taskId },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
      },
      timeout: 30000,
    },
  );

  if (response.data.errorCode) {
    return {
      status: 'FAILED',
      errorMessage: response.data.errorMessage || response.data.errorCode,
      results: [],
    };
  }

  return {
    status: response.data.status || '',
    errorMessage: response.data.errorMessage || '',
    results: response.data.results || [],
  };
}

async function waitForBackgroundRemovalTaskComplete(taskId: string, maxWaitMinutes = 5) {
  const startedAt = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  const checkIntervalMs = 5000;

  while (Date.now() - startedAt < maxWaitMs) {
    const result = await queryBackgroundRemovalTask(taskId);
    console.log('[移除背景] RunningHub任务状态:', {
      taskId,
      status: result.status,
      hasResults: result.results.length > 0,
    });

    if (result.status === 'SUCCESS') {
      const outputUrl = result.results.find((item) => item.url)?.url;
      if (!outputUrl) throw new Error('移除背景任务完成但未返回结果图');
      return outputUrl;
    }

    if (result.status === 'FAILED') {
      throw new Error(result.errorMessage || '移除背景任务失败');
    }

    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  throw new Error(`等待移除背景任务完成超时，已等待${maxWaitMinutes}分钟`);
}

export async function runBackgroundRemovalRoute(request: NextRequest) {
  let orderId = '';
  let chargedPoints = 0;
  let chargedUserId = '';

  try {
    const body = await request.json() as BackgroundRemovalRequest;
    const cookieUserId = getCookieUserId(request);
    if (!cookieUserId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }
    if (isBodyUserMismatch(body.userId, cookieUserId)) {
      return NextResponse.json({ success: false, message: '无权使用其他用户积分' }, { status: 403 });
    }

    const userId = cookieUserId;
    const imageUrl = body.imageUrl?.trim();

    if (!imageUrl) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/')) {
      return NextResponse.json({ success: false, message: '图片URL格式不正确' }, { status: 400 });
    }

    if (!isRunningHubBackgroundRemovalConfigured()) {
      return NextResponse.json({ success: false, message: '移除背景API未配置' }, { status: 400 });
    }

    const user = await userManager.getUserById(userId);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    const currentPoints = user.points || 0;
    const requiredPoints = getRemoveBackgroundPoints();
    if (currentPoints < requiredPoints) {
      return NextResponse.json({ success: false, message: `积分不足，当前积分：${currentPoints}，需要：${requiredPoints}` }, { status: 400 });
    }

    orderId = `RB-${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await transactionManager.createTransaction({
      userId,
      orderNumber: orderId,
      toolPage: '移除背景',
      description: '移除背景处理',
      points: requiredPoints,
      actualPoints: 0,
      remainingPoints: currentPoints,
      resultData: '',
      uploadedImage: imageUrl,
      requestParams: JSON.stringify({
        imageUrl,
        workflow: 'runninghub-remove-background-api',
        appId: REMOVE_BACKGROUND_APP_ID,
        imageNodeId: REMOVE_BACKGROUND_IMAGE_NODE_ID,
        imageFieldName: REMOVE_BACKGROUND_IMAGE_FIELD_NAME,
        requiredPoints,
      }),
      status: '处理中',
    });

    const chargedUser = await userManager.deductPointsAtomically(userId, requiredPoints);
    if (!chargedUser) {
      await transactionManager.updateTransaction(orderId, {
        status: '失败',
        resultData: JSON.stringify({ error: '积分不足' }),
        actualPoints: 0,
      });
      return NextResponse.json({ success: false, message: `积分不足，当前积分：${currentPoints}，需要：${requiredPoints}` }, { status: 400 });
    }

    chargedUserId = userId;
    chargedPoints = requiredPoints;
    await transactionManager.updateTransaction(orderId, {
      actualPoints: requiredPoints,
      remainingPoints: chargedUser.points,
    });

    const response = NextResponse.json({
      success: true,
      message: '移除背景任务已提交',
      data: {
        orderId,
        remainingPoints: chargedUser.points,
      },
    });

    const resolvedInputImageUrl = getResolvedImageUrl(imageUrl, request);

    after(async () => {
      try {
        console.log('[移除背景] ========== 后台API任务开始 ==========', { orderId });
        const taskId = await createBackgroundRemovalTask(resolvedInputImageUrl);
        const outputUrl = await waitForBackgroundRemovalTaskComplete(taskId, 8);
        const finalResultUrl = await uploadFromUrlToCozeStorage(outputUrl, `remove-background/${orderId}.png`, 'image/png');
        const thumbnailUrl = await tryCreateAndUploadResultThumbnailFromUrl(
          finalResultUrl,
          `thumbnails/remove-background/${orderId}.webp`,
          '移除背景',
        );

        await transactionManager.updateTransaction(orderId, {
          status: '成功',
          points: requiredPoints,
          actualPoints: requiredPoints,
          remainingPoints: chargedUser.points,
          resultData: finalResultUrl,
          requestParams: JSON.stringify({
            imageUrl,
            workflow: 'runninghub-remove-background-api',
            appId: REMOVE_BACKGROUND_APP_ID,
            imageNodeId: REMOVE_BACKGROUND_IMAGE_NODE_ID,
            imageFieldName: REMOVE_BACKGROUND_IMAGE_FIELD_NAME,
            requiredPoints,
            runningHubTaskId: taskId,
            runningHubOutputUrl: outputUrl,
            thumbnailUrl,
          }),
        });
        console.log('[移除背景] ========== 后台API任务完成 ==========', { orderId });
      } catch (error: unknown) {
        console.error('[移除背景] ========== 后台API任务失败 ==========', getAxiosErrorDetails(error));
        let refundedPoints: number | undefined;
        if (chargedPoints > 0 && chargedUserId) {
          try {
            const refundedUser = await userManager.addPointsAtomically(chargedUserId, chargedPoints);
            refundedPoints = refundedUser?.points;
            chargedPoints = 0;
          } catch (refundError) {
            console.error('[移除背景] 后台任务失败退款异常:', refundError);
          }
        }

        await transactionManager.updateTransaction(orderId, {
          status: isTimeoutLikeError(error) ? '超时' : '失败',
          actualPoints: 0,
          remainingPoints: refundedPoints,
          resultData: JSON.stringify({ error: getUserFacingMessage(error) }),
        });
      }
    });

    return response;
  } catch (error: unknown) {
    console.error('[移除背景] 创建任务失败:', getAxiosErrorDetails(error));

    let refundedPoints: number | undefined;
    if (chargedPoints > 0 && chargedUserId) {
      try {
        const refundedUser = await userManager.addPointsAtomically(chargedUserId, chargedPoints);
        refundedPoints = refundedUser?.points;
        chargedPoints = 0;
      } catch (refundError) {
        console.error('[移除背景] 创建任务失败退款异常:', refundError);
      }
    }

    if (orderId) {
      await transactionManager.updateTransaction(orderId, {
        status: isTimeoutLikeError(error) ? '超时' : '失败',
        actualPoints: 0,
        remainingPoints: refundedPoints,
        resultData: JSON.stringify({ error: getUserFacingMessage(error) }),
      });
    }

    return NextResponse.json(
      { success: false, message: getUserFacingMessage(error) },
      { status: isTimeoutLikeError(error) ? 504 : 500 },
    );
  }
}
