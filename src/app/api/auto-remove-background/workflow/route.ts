import { NextRequest } from 'next/server';

// Coze Workflow API 配置
const COZE_WORKFLOW_API = 'https://api.coze.cn/v1/workflow/stream_run';
const WORKFLOW_ID = process.env.COZE_REMOVE_BG_WORKFLOW_ID || '7595182347349704747';
const COZE_API_TOKEN = process.env.COZE_WORKFLOW_TOKEN;

// 超时配置
const API_TIMEOUT = 300000; // 5分钟超时

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function POST(request: NextRequest) {
  console.log('[智能抠图Workflow] ========== 开始处理请求 ==========');

  // 验证环境变量
  if (!COZE_API_TOKEN) {
    console.error('[智能抠图Workflow] COZE_WORKFLOW_TOKEN 环境变量未设置');
    return new Response(
      JSON.stringify({ success: false, message: '系统配置错误' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  console.log('[智能抠图Workflow] 环境变量已配置:', {
    workflowId: WORKFLOW_ID,
    hasToken: !!COZE_API_TOKEN,
  });

  try {
    // 解析请求参数
    const requestBody = await request.json();
    const { imageUrl } = requestBody;

    console.log('[智能抠图Workflow] 接收到请求参数:', {
      hasImageUrl: !!imageUrl,
      imageUrlLength: imageUrl ? imageUrl.length : 0,
      imageUrlValue: imageUrl,
      imageUrlPreview: imageUrl ? imageUrl.substring(0, 80) : 'none',
      requestTime: new Date().toISOString(),
    });

    // 参数验证
    if (!imageUrl) {
      console.error('[智能抠图Workflow] 参数验证失败: 缺少imageUrl');
      return new Response(
        JSON.stringify({ success: false, message: '缺少必要参数' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 验证imageUrl是否为有效的HTTP URL
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return new Response(
        JSON.stringify({ success: false, message: '图片URL格式不正确，必须为HTTP/HTTPS地址' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('[智能抠图Workflow] 开始调用 Coze Workflow API...');

    // 创建超时控制器
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('[智能抠图Workflow] 请求超时');
      controller.abort();
    }, API_TIMEOUT);

    try {
      // 调用 Coze Workflow API
      // 正确的参数格式：parameters.input（根据测试结果确认）
      const workflowRequestBody = {
        workflow_id: WORKFLOW_ID,
        parameters: {
          input: imageUrl,  // 使用 input 作为参数名
        },
      };

      console.log('[智能抠图Workflow] 请求体:', JSON.stringify(workflowRequestBody, null, 2));

      const response = await fetch(COZE_WORKFLOW_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${COZE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflowRequestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[智能抠图Workflow] API 调用失败:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        return new Response(
          JSON.stringify({
            success: false,
            message: `智能抠图处理失败，请稍后重试`,
          }),
          { status: response.status, headers: { 'Content-Type': 'application/json' } }
        );
      }

      console.log('[智能抠图Workflow] ✓ API 调用成功，开始流式处理...');

      // 设置流式响应
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Transfer-Encoding': 'chunked',
        },
      });
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);

      if (isAbortError(fetchError)) {
        console.error('[智能抠图Workflow] 请求超时');
        return new Response(
          JSON.stringify({
            success: false,
            message: '请求超时，请重试',
          }),
          { status: 408, headers: { 'Content-Type': 'application/json' } }
        );
      }

      console.error('[智能抠图Workflow] API 调用异常:', fetchError);
      return new Response(
        JSON.stringify({
          success: false,
          message: `请求失败: ${getErrorMessage(fetchError)}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: unknown) {
    console.error('[智能抠图Workflow] 处理请求异常:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: `处理失败: ${getErrorMessage(error)}`,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
