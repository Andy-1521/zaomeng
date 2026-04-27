import axios from 'axios';

const BASE_URL = 'https://www.runninghub.cn';
const API_KEY = process.env.RUNNINGHUB_API_KEY || 'f95a3b89ec9d4f06a0498d27aefac4d2';
const WEBAPP_ID = '2002961339758833665'; // 彩绘提取1
const UPSAMPLING_APP_ID = '1990958565772963841'; // 高清放大

export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  description: string;
}

export interface AccountStatusResponse {
  code: string | null;
  data: {
    remainCoins: string;
    currentTaskCounts: string;
    remainMoney: string;
    currency: string;
    apiType: string;
  };
  msg: string;
}

export interface CreateTaskResponse {
  code: string | null;
  data: {
    taskId: string;
    netWssUrl?: string;
    clientId?: string;
    taskStatus?: string;
  };
  msg: string;
}

export interface TaskStatusResponse {
  code: string | null;
  data: string;
  msg: string;
}

export interface TaskOutput {
  fileType: string;
  fileUrl: string;
  taskCostTime: string;
}

export interface TaskOutputsResponse {
  code: string | null;
  data: TaskOutput[];
  msg: string;
}

/**
 * 查询账号当前状态
 */
export async function getAccountStatus(): Promise<number> {
  try {
    console.log('[RunningHub] 查询账号状态，API_KEY:', API_KEY ? '已配置' : '未配置');

    const response = await axios.post<AccountStatusResponse>(
      `${BASE_URL}/uc/openapi/accountStatus`,
      { apiKey: API_KEY },
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn',
        },
        timeout: 30000, // 30秒超时
      }
    );

    console.log('[RunningHub] 查询账号状态响应:', {
      status: response.status,
      msg: response.data.msg,
      hasData: !!response.data.data,
    });

    if (response.data.msg === 'success') {
      // API返回的是字符串，需要转换为数字
      const currentTaskCounts = parseInt(response.data.data.currentTaskCounts, 10);
      console.log('[RunningHub] 当前运行任务数:', currentTaskCounts);
      return currentTaskCounts;
    } else {
      throw new Error(`查询账号状态失败: ${response.data.msg}`);
    }
  } catch (error: any) {
    console.error('[RunningHub] 查询账号状态异常:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    });
    throw error;
  }
}

/**
 * 等待账号任务数小于3
 * @param maxWaitTime 最大等待时间（分钟）
 */
export async function waitForAvailableAccount(maxWaitTime: number = 10): Promise<void> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 60 * 1000;
  const checkInterval = 5000; // 每5秒检查一次

  console.log('[RunningHub] 开始等待账号可用...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const currentTasks = await getAccountStatus();
      console.log(`[RunningHub] 当前运行任务数: ${currentTasks}`);

      if (currentTasks < 3) {
        console.log('[RunningHub] 账号可用，可以开始任务');
        return;
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error('[RunningHub] 检查账号状态失败，重试中...', error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待账号可用超时，已等待${maxWaitTime}分钟`);
}

/**
 * 创建AI任务
 */
export async function createTask(imageUrl: string): Promise<string> {
  try {
    const nodeInfoList: NodeInfo[] = [
      {
        nodeId: '14',
        fieldName: 'image',
        fieldValue: imageUrl,
        description: '上传需要分层图片',
      },
      {
        nodeId: '26',
        fieldName: 'select',
        fieldValue: '5',
        description: '图层数量',
      },
    ];

    const response = await axios.post<CreateTaskResponse>(
      `${BASE_URL}/task/openapi/ai-app/run`,
      {
        webappId: WEBAPP_ID,
        apiKey: API_KEY,
        nodeInfoList,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn',
        },
        timeout: 600000, // 10分钟超时（创建任务可能需要较长时间）
      }
    );

    if (response.data.msg === 'success') {
      const taskId = response.data.data.taskId;
      console.log(`[RunningHub] 任务创建成功: ${taskId}`);
      return taskId;
    } else {
      throw new Error(`创建任务失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.error('[RunningHub] 创建任务异常:', error);
    throw error;
  }
}

/**
 * 查询任务状态
 */
export async function getTaskStatus(taskId: string): Promise<string> {
  try {
    const response = await axios.post<TaskStatusResponse>(
      `${BASE_URL}/task/openapi/status`,
      { apiKey: API_KEY, taskId },
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn',
        },
        timeout: 30000, // 30秒超时
      }
    );

    if (response.data.msg === 'success') {
      return response.data.data;
    } else {
      throw new Error(`查询任务状态失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.error('[RunningHub] 查询任务状态异常:', error);
    throw error;
  }
}

/**
 * 等待任务完成
 * @param taskId 任务ID
 * @param maxWaitTime 最大等待时间（分钟）
 */
export async function waitForTaskComplete(taskId: string, maxWaitTime: number = 9): Promise<void> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 60 * 1000;
  const checkInterval = 5000; // 每5秒检查一次

  console.log(`[RunningHub] 开始等待任务完成: ${taskId}`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await getTaskStatus(taskId);
      console.log(`[RunningHub] 任务 ${taskId} 当前状态: ${status}`);

      if (status === 'SUCCESS') {
        console.log(`[RunningHub] 任务 ${taskId} 完成`);
        return;
      } else if (status === 'FAILED') {
        throw new Error(`任务 ${taskId} 失败`);
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error(`[RunningHub] 检查任务状态失败，重试中... taskId: ${taskId}`, error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待任务完成超时，已等待${maxWaitTime}分钟`);
}

/**
 * 获取任务输出结果
 */
export async function getTaskOutputs(taskId: string): Promise<TaskOutput[]> {
  try {
    const response = await axios.post<TaskOutputsResponse>(
      `${BASE_URL}/task/openapi/outputs`,
      { apiKey: API_KEY, taskId },
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': 'www.runninghub.cn',
        },
        timeout: 60000, // 60秒超时（获取输出可能需要较长时间）
      }
    );

    if (response.data.msg === 'success') {
      console.log(`[RunningHub] 任务 ${taskId} 输出结果:`, response.data.data);
      return response.data.data;
    } else {
      throw new Error(`获取任务输出失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.error('[RunningHub] 获取任务输出异常:', error);
    throw error;
  }
}

// ==================== 高清放大相关函数 ====================

/**
 * 高清放大任务响应
 */
export interface UpsamplingTaskResponse {
  taskId: string;
  status: string;
  errorCode: string;
  errorMessage: string;
  results: any[];
  clientId: string;
  promptTips: string;
}

/**
 * 高清放大输出结果
 */
export interface UpsamplingOutput {
  url: string;
  outputType: string;
  text: string | null;
}

/**
 * 创建高清放大任务
 * @param imageFileName 图片文件名（不需要完整URL，只需文件名）
 * @returns 任务ID
 */
export async function createUpsamplingTask(imageFileName: string): Promise<string> {
  try {
    console.log('[RunningHub] 开始创建高清放大任务，图片文件名:', imageFileName);

    const response = await axios.post<UpsamplingTaskResponse>(
      `${BASE_URL}/openapi/v2/run/ai-app/${UPSAMPLING_APP_ID}`,
      {
        nodeInfoList: [
          {
            nodeId: '1076',
            fieldName: 'image',
            fieldValue: imageFileName,
            description: 'image',
          },
        ],
        instanceType: 'default',
        usePersonalQueue: 'false',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        timeout: 60000, // 60秒超时
      }
    );

    console.log('[RunningHub] 高清放大任务创建响应:', {
      taskId: response.data.taskId,
      status: response.data.status,
      errorCode: response.data.errorCode,
      errorMessage: response.data.errorMessage,
    });

    if (response.data.errorCode) {
      throw new Error(`创建高清放大任务失败: ${response.data.errorMessage || response.data.errorCode}`);
    }

    const taskId = response.data.taskId;
    console.log(`[RunningHub] 高清放大任务创建成功: ${taskId}`);
    return taskId;
  } catch (error: any) {
    console.error('[RunningHub] 创建高清放大任务异常:', {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

/**
 * 查询高清放大任务状态
 * @param taskId 任务ID
 * @returns 任务状态 (RUNNING, SUCCESS, FAILED)
 */
export async function getUpsamplingTaskStatus(taskId: string): Promise<{
  status: string;
  results?: UpsamplingOutput[];
  errorCode?: string;
  errorMessage?: string;
}> {
  try {
    const response = await axios.post<UpsamplingTaskResponse>(
      `${BASE_URL}/openapi/v2/query`,
      {
        taskId: taskId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        timeout: 30000, // 30秒超时
      }
    );

    const data = response.data;
    console.log('[RunningHub] 高清放大任务状态:', {
      taskId,
      status: data.status,
      hasResults: !!data.results && data.results.length > 0,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
    });

    if (data.errorCode) {
      return {
        status: 'FAILED',
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      };
    }

    return {
      status: data.status,
      results: data.results,
    };
  } catch (error: any) {
    console.error('[RunningHub] 查询高清放大任务状态异常:', error);
    throw error;
  }
}

/**
 * 等待高清放大任务完成
 * @param taskId 任务ID
 * @param maxWaitTime 最大等待时间（分钟）
 * @returns 输出结果URL
 */
export async function waitForUpsamplingTaskComplete(
  taskId: string,
  maxWaitTime: number = 5
): Promise<string> {
  const startTime = Date.now();
  const maxWaitMs = maxWaitTime * 60 * 1000;
  const checkInterval = 5000; // 每5秒检查一次

  console.log(`[RunningHub] 开始等待高清放大任务完成: ${taskId}`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await getUpsamplingTaskStatus(taskId);
      console.log(`[RunningHub] 高清放大任务 ${taskId} 当前状态: ${result.status}`);

      if (result.status === 'SUCCESS') {
        if (result.results && result.results.length > 0) {
          const outputUrl = result.results[0].url;
          console.log(`[RunningHub] 高清放大任务 ${taskId} 完成，结果URL: ${outputUrl.substring(0, 80)}...`);
          return outputUrl;
        } else {
          throw new Error('任务完成但未返回结果');
        }
      } else if (result.status === 'FAILED') {
        throw new Error(result.errorMessage || '任务执行失败');
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error: any) {
      // 如果是已知错误，抛出
      if (error.message && (error.message.includes('失败') || error.message.includes('完成'))) {
        throw error;
      }
      console.error(`[RunningHub] 检查高清放大任务状态失败，重试中... taskId: ${taskId}`, error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待高清放大任务完成超时，已等待${maxWaitTime}分钟`);
}

