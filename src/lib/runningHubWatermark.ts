import axios from 'axios';

const BASE_URL = 'https://www.runninghub.cn';
// 高清放大和去除水印专用的API密钥
const API_KEY = process.env.RUNNINGHUB_WATERMARK_API_KEY || '5b7d5cd68cbf4c91807126bdeda7bc73';
const WATERMARK_APP_ID = '1941300071155789825';
const UPSAMPLING_APP_ID = '1990958565772963841';

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
    console.log('[去水印RunningHub] 查询账号状态，API_KEY:', API_KEY ? '已配置' : '未配置');

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

    console.log('[去水印RunningHub] 查询账号状态响应:', {
      status: response.status,
      msg: response.data.msg,
      hasData: !!response.data.data,
    });

    if (response.data.msg === 'success') {
      // API返回的是字符串，需要转换为数字
      const currentTaskCounts = parseInt(response.data.data.currentTaskCounts, 10);
      console.log('[去水印RunningHub] 当前运行任务数:', currentTaskCounts);
      return currentTaskCounts;
    } else if (response.data.msg === 'APIKEY_UNSUPPORTED_FREE_USER') {
      throw new Error('当前API密钥为免费用户，不支持去水印功能');
    } else {
      throw new Error(`查询账号状态失败: ${response.data.msg}`);
    }
  } catch (error: any) {
    console.error('[去水印RunningHub] 查询账号状态异常:', {
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

  console.log('[去水印RunningHub] 开始等待账号可用...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const currentTasks = await getAccountStatus();
      console.log(`[去水印RunningHub] 当前运行任务数: ${currentTasks}`);

      if (currentTasks < 3) {
        console.log('[去水印RunningHub] 账号可用，可以开始任务');
        return;
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error('[去水印RunningHub] 检查账号状态失败，重试中...', error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待账号可用超时，已等待${maxWaitTime}分钟`);
}

/**
 * 创建去水印任务
 */
export async function createWatermarkRemovalTask(imageUrl: string): Promise<string> {
  try {
    const nodeInfoList: NodeInfo[] = [
      {
        nodeId: '209',
        fieldName: 'image',
        fieldValue: imageUrl,
        description: 'image',
      },
    ];

    console.log('[去水印RunningHub] 创建去水印任务');
    console.log('[去水印RunningHub] App ID:', WATERMARK_APP_ID);
    console.log('[去水印RunningHub] 图片URL:', imageUrl.substring(0, 80) + '...');

    const response = await axios.post<CreateTaskResponse>(
      `${BASE_URL}/task/openapi/ai-app/run`,
      {
        webappId: WATERMARK_APP_ID,
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

    console.log('[去水印RunningHub] 创建任务响应:', {
      status: response.status,
      msg: response.data.msg,
      hasData: !!response.data.data,
      fullData: response.data,
    });

    if (response.data.msg === 'success' && response.data.data) {
      const taskId = response.data.data.taskId;
      console.log(`[去水印RunningHub] 任务创建成功: ${taskId}`);
      return taskId;
    } else {
      throw new Error(`创建任务失败: ${response.data.msg || '未知错误'}`);
    }
  } catch (error) {
    console.error('[去水印RunningHub] 创建任务异常:', error);
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
    console.error('[去水印RunningHub] 查询任务状态异常:', error);
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

  console.log(`[去水印RunningHub] 开始等待任务完成: ${taskId}`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const status = await getTaskStatus(taskId);
      console.log(`[去水印RunningHub] 任务 ${taskId} 当前状态: ${status}`);

      if (status === 'SUCCESS') {
        console.log(`[去水印RunningHub] 任务 ${taskId} 完成`);
        return;
      } else if (status === 'FAILED') {
        throw new Error(`任务 ${taskId} 失败`);
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    } catch (error) {
      console.error(`[去水印RunningHub] 检查任务状态失败，重试中... taskId: ${taskId}`, error);
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
      console.log(`[去水印RunningHub] 任务 ${taskId} 输出结果:`, response.data.data);
      return response.data.data;
    } else {
      throw new Error(`获取任务输出失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.error('[去水印RunningHub] 获取任务输出异常:', error);
    throw error;
  }
}

// ==================== 高清放大相关函数 ====================

/**
 * 上传图片到RunningHub并获取文件名
 * @param imageBuffer 图片Buffer
 * @returns 图片文件名（如：585556aad48da2f52309ecd5b0c3745a15fdd84a2f72fd3e3b9abc79985d0777.png）
 */
export async function uploadImageToRunningHub(imageBuffer: Buffer): Promise<string> {
  try {
    console.log('[RunningHub] 开始上传图片到RunningHub，大小:', imageBuffer.length, 'bytes');

    const formData = new FormData();
    // 使用File代替Blob，避免类型问题
    const file = new File([imageBuffer as any], 'image.png', { type: 'image/png' });
    formData.append('file', file);

    const response = await axios.post(
      `${BASE_URL}/openapi/v2/upload`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        timeout: 60000, // 60秒超时
      }
    );

    console.log('[RunningHub] 上传响应状态:', response.status);
    console.log('[RunningHub] 上传响应数据:', JSON.stringify(response.data));

    // 检查响应数据
    if (!response.data) {
      throw new Error('上传图片失败：响应数据为空');
    }

    // 尝试从不同位置获取文件名
    const filename = response.data.filename || response.data.fileName || response.data.file_name;
    
    if (filename) {
      console.log('[RunningHub] 图片上传成功，文件名:', filename);
      return filename;
    } else {
      console.error('[RunningHub] 响应数据结构不正确，缺少文件名:', response.data);
      throw new Error('上传图片失败：未返回文件名');
    }
  } catch (error: any) {
    console.error('[RunningHub] 上传图片异常:', {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

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
 * @param imageInput 图片输入，可以是文件名或完整URL
 * @returns 任务ID
 */
export async function createUpsamplingTask(imageInput: string): Promise<string> {
  try {
    console.log('[RunningHub] 开始创建高清放大任务，图片输入:', imageInput.substring(0, 80) + '...');

    // 判断是URL还是文件名
    const isUrl = imageInput.startsWith('http://') || imageInput.startsWith('https://');
    const imageValue = isUrl ? imageInput : imageInput;
    
    console.log('[RunningHub] 使用图片:', isUrl ? 'URL' : '文件名');

    const response = await axios.post<UpsamplingTaskResponse>(
      `${BASE_URL}/openapi/v2/run/ai-app/${UPSAMPLING_APP_ID}`,
      {
        nodeInfoList: [
          {
            nodeId: '1076',
            fieldName: 'image',
            fieldValue: imageValue,
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
 * @returns 任务状态和结果
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

