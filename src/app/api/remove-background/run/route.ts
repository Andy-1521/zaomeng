import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

type RunningHubOutput = {
  fileUrl?: string;
  url?: string;
  image_url?: string;
};

type RunningHubResponse<T> = {
  msg: string;
  data?: T;
};

type CreateTaskData = {
  taskId?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function getAxiosErrorPayload(error: unknown) {
  if (axios.isAxiosError(error)) {
    return error.response?.data;
  }

  return undefined;
}

function getRunningHubOutputUrl(output: RunningHubOutput) {
  return output.fileUrl || output.url || output.image_url || null;
}

// RunningHub API 配置（去除背景）
const RUNNINGHUB_BASE_URL = 'https://www.runninghub.cn';
const RUNNINGHUB_REMOVE_BG_APP_ID = '1988785910097522689';
const RUNNINGHUB_API_KEY = 'f95a3b89ec9d4f06a0498d27aefac4d2';

// 超时配置
const POLLING_INTERVAL = 2000; // 轮询间隔2秒
const MAX_POLLING_TIME = 540000; // 最大轮询时间9分钟（540秒）
const MAX_POLLING_ATTEMPTS = Math.floor(MAX_POLLING_TIME / POLLING_INTERVAL); // 270次轮询

/**
 * 查询账号当前状态
 */
async function getAccountStatus(): Promise<number> {
  try {
    console.log('[去除背景] 查询账号状态');

    const response = await axios.post(
      `${RUNNINGHUB_BASE_URL}/uc/openapi/accountStatus`,
      { apiKey: RUNNINGHUB_API_KEY },
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn',
        },
        timeout: 30000,
      }
    );

    console.log('[去除背景] 查询账号状态响应:', {
      status: response.status,
      msg: response.data.msg,
      hasData: !!response.data.data,
    });

    if (response.data.msg === 'success') {
      const currentTaskCounts = parseInt(response.data.data.currentTaskCounts, 10);
      console.log('[去除背景] 当前运行任务数:', currentTaskCounts);
      return currentTaskCounts;
    } else {
      throw new Error(`查询账号状态失败: ${response.data.msg}`);
    }
  } catch (error: unknown) {
    console.error('[去除背景] 查询账号状态异常:', getErrorMessage(error));
    throw error;
  }
}

/**
 * 等待账号任务数小于3
 */
async function waitForAvailableAccount(maxWaitTime: number = 10): Promise<void> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 60 * 1000;
  const checkInterval = 5000;

  console.log('[去除背景] 开始等待账号可用...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const currentTasks = await getAccountStatus();
      console.log(`[去除背景] 当前运行任务数: ${currentTasks}`);

      if (currentTasks < 3) {
        console.log('[去除背景] 账号可用，可以开始任务');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error('[去除背景] 检查账号状态失败，重试中...', error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待账号可用超时，已等待${maxWaitTime}分钟`);
}

/**
 * 查询任务状态
 */
async function getTaskStatus(taskId: string): Promise<{ status: string; outputs?: RunningHubOutput[] }> {
  console.log(`[去除背景] 查询任务状态: ${taskId}`);

  const response = await axios.post(
    `${RUNNINGHUB_BASE_URL}/task/openapi/status`,
    {
      apiKey: RUNNINGHUB_API_KEY,
      taskId: taskId,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn',
      },
      timeout: 30000,
    }
  );

  console.log('[去除背景] 查询任务状态响应:', response.data);

  // 解析状态
  let status = 'unknown';
  let outputs: RunningHubOutput[] = [];

  if (response.data.msg === 'success' && response.data.data) {
    // RunningHub API返回data是字符串，表示状态
    status = response.data.data;
    console.log(`[去除背景] 解析的状态: ${status}`);

    // 注意：RunningHub的/task/openapi/status只返回状态字符串，不返回结果
    // 需要调用另一个API来获取结果
    if (status === 'SUCCESS' || status === 'success') {
      console.log('[去除背景] 任务完成，调用getTaskOutputs获取结果');
      outputs = await getTaskOutputs(taskId);
    }
  } else {
    console.error('[去除背景] 查询任务状态失败:', response.data.msg);
    throw new Error(`查询任务状态失败: ${response.data.msg}`);
  }

  console.log(`[去除背景] 解析的状态: ${status}, 输出数量: ${outputs.length}`);
  return { status, outputs };
}

/**
 * 获取任务输出结果
 */
async function getTaskOutputs(taskId: string): Promise<RunningHubOutput[]> {
  console.log(`[去除背景] 获取任务输出: ${taskId}`);

  const response = await axios.post(
    `${RUNNINGHUB_BASE_URL}/task/openapi/outputs`,
    {
      apiKey: RUNNINGHUB_API_KEY,
      taskId: taskId,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Host': 'www.runninghub.cn',
      },
      timeout: 30000,
    }
  );

  console.log('[去除背景] 获取任务输出响应:', response.data);

  if (response.data.msg === 'success' && response.data.data) {
    return response.data.data;
  } else {
    console.error('[去除背景] 获取任务输出失败:', response.data.msg);
    throw new Error(`获取任务输出失败: ${response.data.msg}`);
  }
}

/**
 * 轮询任务状态直到完成
 */
async function waitForTaskComplete(taskId: string, maxWaitMinutes: number = 9): Promise<string[]> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  let attempts = 0;

  console.log(`[去除背景] 开始轮询任务状态，最多等待 ${maxWaitMinutes} 分钟`);

  while (Date.now() - startTime < maxWaitMs && attempts < MAX_POLLING_ATTEMPTS) {
    attempts++;
    const elapsed = Date.now() - startTime;
    console.log(`[去除背景] 轮询第 ${attempts} 次，已耗时 ${Math.floor(elapsed / 1000)} 秒`);

    try {
      const { status, outputs } = await getTaskStatus(taskId);

      // 检查状态
      const normalizedStatus = status.toLowerCase();

      if (['success', 'completed', 'finished', 'succeeded'].includes(normalizedStatus)) {
        console.log(`[去除背景] ========== 任务完成 ==========`);
        console.log(`[去除背景] 输出数量: ${outputs?.length || 0}`);

        // 提取结果图片URL
        const imageUrls = (outputs || [])
          .map(getRunningHubOutputUrl)
          .filter((url): url is string => Boolean(url));

        if (imageUrls.length === 0) {
          throw new Error('任务完成但未返回任何图片');
        }

        console.log(`[去除背景] 提取到 ${imageUrls.length} 张图片URL`);
        return imageUrls;
      } else if (['failed', 'error', 'timeout', 'failure'].includes(normalizedStatus)) {
        console.error(`[去除背景] ========== 任务失败 ==========`);
        throw new Error('任务执行失败');
      }

      // 继续等待
      console.log(`[去除背景] 任务状态: ${status}，继续轮询...`);
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    } catch (error: unknown) {
      console.error(`[去除背景] 轮询失败（第 ${attempts} 次）:`, getErrorMessage(error));
      
      // 如果是网络错误，继续重试
      if (getErrorMessage(error).includes('查询任务失败')) {
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
        continue;
      }
      
      throw error;
    }
  }

  throw new Error(`任务执行超时，已等待 ${maxWaitMinutes} 分钟`);
}

export async function POST(request: NextRequest) {
  console.log('[去除背景] ========== 开始处理请求 ==========');
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { imageUrl, fileName } = body;

    console.log('[去除背景] ========== 请求参数 ==========');
    console.log('[去除背景] imageUrl:', imageUrl ? imageUrl.substring(0, 80) + '...' : 'none');
    console.log('[去除背景] fileName:', fileName || 'none');

    // 验证参数
    if (!imageUrl) {
      console.error('[去除背景] ========== 错误：缺少图片URL ==========');
      return NextResponse.json(
        {
          success: false,
          message: '图片URL不能为空',
        },
        { status: 400 }
      );
    }

    // 步骤1: 查询账号状态，等待任务数小于3
    console.log('[去除背景] 步骤1: 查询账号状态，等待任务数小于3');
    try {
      await waitForAvailableAccount(10); // 最多等待10分钟
      console.log('[去除背景] 账号可用，可以开始任务');
    } catch (error) {
      console.error('[去除背景] 等待账号可用失败:', error);
      return NextResponse.json(
        {
          success: false,
          message: '当前任务排队过多，请稍后重试',
        },
        { status: 503 }
      );
    }

    // 步骤2: 创建任务
    console.log('[去除背景] 步骤2: 创建去除背景任务');
    console.log('[去除背景] imageUrl:', imageUrl);
    console.log('[去除背景] fileName:', fileName);

    console.log('[去除背景] ========== 创建任务请求 ==========');
    console.log('[去除背景] 请求URL:', `${RUNNINGHUB_BASE_URL}/task/openapi/ai-app/run`);
    console.log('[去除背景] webappId:', RUNNINGHUB_REMOVE_BG_APP_ID);
    console.log('[去除背景] imageUrl:', imageUrl);
    console.log('[去除背景] ============================================');

    let taskId: string;
    try {
      const response = await axios.post(
        `${RUNNINGHUB_BASE_URL}/task/openapi/ai-app/run`,
        {
          webappId: RUNNINGHUB_REMOVE_BG_APP_ID,
          apiKey: RUNNINGHUB_API_KEY,
          nodeInfoList: [
            {
              nodeId: '3',
              fieldName: 'image',
              fieldValue: imageUrl,
              description: '上传需要去除背景的图片',
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Host': 'www.runninghub.cn',
          },
          timeout: 60000, // 60秒超时
        }
      );

      console.log('[去除背景] ========== 创建任务响应详情 ==========');
      console.log('[去除背景] HTTP 状态:', response.status);
      console.log('[去除背景] 响应数据:', JSON.stringify(response.data, null, 2));
      console.log('[去除背景] 响应字段列表:', Object.keys(response.data));
      console.log('[去除背景] ============================================');

      const data = response.data as RunningHubResponse<CreateTaskData>;

      // 检查是否成功
      if (data.msg !== 'success') {
        console.error('[去除背景] ✗ API 返回错误:', data.msg);
        return NextResponse.json(
          {
            success: false,
            message: `去除背景处理失败: ${data.msg}`,
            debug: {
              response: data,
            },
          },
          { status: 500 }
        );
      }

      // 提取任务ID
      taskId = data.data?.taskId;

      if (!taskId || taskId === '') {
        console.error('[去除背景] ✗ taskId 为空');
        console.error('[去除背景] 完整响应数据:', JSON.stringify(data, null, 2));
        return NextResponse.json(
          {
            success: false,
            message: '创建任务失败：taskId 为空',
            debug: {
              response: data,
            },
          },
          { status: 500 }
        );
      }

      console.log('[去除背景] ✓ 任务创建成功:', taskId);

    } catch (error: unknown) {
      console.error('[去除背景] 创建任务失败:', error);
      console.error('[去除背景] 错误详情:', getAxiosErrorPayload(error) || getErrorMessage(error));
      return NextResponse.json(
        {
          success: false,
          message: (getAxiosErrorPayload(error) as { errorMessage?: string } | undefined)?.errorMessage || getErrorMessage(error) || '创建任务失败',
        },
        { status: 500 }
      );
    }

    // 步骤3: 轮询查询任务状态，直到成功（最多9分钟）
    console.log('[去除背景] 步骤3: 轮询查询任务状态');
    const imageUrls = await waitForTaskComplete(taskId, 9);
    
    console.log('[去除背景] ========== 任务执行完成 ==========');
    console.log('[去除背景] 结果图片数量:', imageUrls.length);
    console.log('[去除背景] 总耗时:', Math.floor((Date.now() - startTime) / 1000), '秒');

    // 返回第一张图片URL（去除背景只返回一张图）
    return NextResponse.json({
      success: true,
      data: {
        resultUrl: imageUrls[0],
        taskId: taskId,
      },
    });

  } catch (error: unknown) {
    console.error('[去除背景] 处理失败:', error);
    return NextResponse.json(
      {
        success: false,
        message: getErrorMessage(error) || '去除背景失败，请稍后重试',
      },
      { status: 500 }
    );
  }
}
