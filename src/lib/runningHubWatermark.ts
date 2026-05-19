import axios from 'axios';

const BASE_URL = 'https://www.runninghub.cn';
// 优先使用共享可调用 key；旧的 watermark key 可通过环境变量显式配置。
const API_KEY = process.env.RUNNINGHUB_API_KEY || process.env.RUNNINGHUB_WATERMARK_API_KEY || '';
const UPSAMPLING_APP_ID = '1990958565772963841';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'RunningHub请求失败';
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
    message: getErrorMessage(error),
    code: undefined,
    response: undefined,
  };
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
  results: UpsamplingOutput[];
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
  } catch (error: unknown) {
    console.error('[RunningHub] 创建高清放大任务异常:', getAxiosErrorDetails(error));
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
  } catch (error: unknown) {
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
    } catch (error: unknown) {
      // 如果是已知错误，抛出
      if (error instanceof Error && (error.message.includes('失败') || error.message.includes('完成'))) {
        throw error;
      }
      console.error(`[RunningHub] 检查高清放大任务状态失败，重试中... taskId: ${taskId}`, error);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  throw new Error(`等待高清放大任务完成超时，已等待${maxWaitTime}分钟`);
}
