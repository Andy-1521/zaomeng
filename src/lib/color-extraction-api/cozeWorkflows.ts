import type { CozeWorkflowInputImage } from '@/lib/cozeOpenApiFiles';

type WorkflowSuccessResult = {
  success: true;
  resultUrl?: string;
  removedBgUrl?: string;
  processedImageUrl?: string;
};

type WorkflowFailureResult = {
  success: false;
  errorMsg: string;
  isTimeout?: boolean;
};

export type ColorExtractionWorkflowResult = WorkflowSuccessResult | WorkflowFailureResult;

const FETCH_TIMEOUT = 60_000;
const WORKFLOW_TIMEOUT = 600_000;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
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
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout}ms）: ${url}`);
    }
    throw error;
  }
}

function getTimeoutFlag(error: unknown) {
  return error instanceof Error && (error.message.includes('超时') || error.name === 'AbortError');
}

async function runCozeWorkflow(
  workflowUrl: string,
  workflowToken: string,
  inputImage: CozeWorkflowInputImage
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    workflowUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workflowToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input_image: inputImage }),
    },
    WORKFLOW_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`工作流调用失败: ${response.status} ${response.statusText} ${errorText}`.trim());
  }

  return await response.json() as Record<string, unknown>;
}

function getObjectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractOutputObject(payload: Record<string, unknown>) {
  const data = getObjectValue(payload.data);
  if (!data) return null;
  return getObjectValue(data.output);
}

export async function runColorExtractionWorkflow(inputImage: CozeWorkflowInputImage): Promise<ColorExtractionWorkflowResult> {
  const workflowUrl = getRequiredEnv('COLOR_EXTRACTION_WORKFLOW_URL');
  const workflowToken = getRequiredEnv('COLOR_EXTRACTION_WORKFLOW_TOKEN');

  try {
    const payload = await runCozeWorkflow(workflowUrl, workflowToken, inputImage);

    const directResultUrl = getStringValue(payload.result_url);
    if (directResultUrl) {
      return { success: true, resultUrl: directResultUrl };
    }

    const output = extractOutputObject(payload);
    if (output) {
      const resultUrl =
        getStringValue(output.image_url)
        || getStringValue(output.imageUrl)
        || getStringValue(output.url)
        || getStringValue(output.result_url);

      if (resultUrl) {
        return { success: true, resultUrl };
      }
    }

    return {
      success: false,
      errorMsg: '彩绘提取工作流返回格式异常，未找到图片URL',
    };
  } catch (error: unknown) {
    return {
      success: false,
      errorMsg: error instanceof Error ? error.message : '彩绘提取工作流调用失败',
      isTimeout: getTimeoutFlag(error),
    };
  }
}

export async function runRemoveBgWorkflow(inputImage: CozeWorkflowInputImage): Promise<ColorExtractionWorkflowResult> {
  const workflowUrl = getRequiredEnv('COLOR_EXTRACTION_REMOVE_BG_WORKFLOW_URL');
  const workflowToken = getRequiredEnv('COLOR_EXTRACTION_REMOVE_BG_WORKFLOW_TOKEN');

  try {
    const payload = await runCozeWorkflow(workflowUrl, workflowToken, inputImage);

    const directRemovedBgUrl = getStringValue(payload.removed_bg_url);
    const directProcessedImageUrl = getStringValue(payload.processed_image_url);
    const directResultUrl = getStringValue(payload.result_url);

    if (directRemovedBgUrl || directProcessedImageUrl) {
      return {
        success: true,
        resultUrl: directResultUrl,
        removedBgUrl: directRemovedBgUrl,
        processedImageUrl: directProcessedImageUrl,
      };
    }

    const output = extractOutputObject(payload);
    if (output) {
      const removedBgUrl = getStringValue(output.removed_bg_url);
      const processedImageUrl = getStringValue(output.processed_image_url);
      const resultUrl = getStringValue(output.result_url);

      if (removedBgUrl || processedImageUrl) {
        return {
          success: true,
          resultUrl,
          removedBgUrl,
          processedImageUrl,
        };
      }
    }

    return {
      success: false,
      errorMsg: '去背景工作流返回格式异常，未找到图片URL',
    };
  } catch (error: unknown) {
    return {
      success: false,
      errorMsg: error instanceof Error ? error.message : '去背景工作流调用失败',
      isTimeout: getTimeoutFlag(error),
    };
  }
}
