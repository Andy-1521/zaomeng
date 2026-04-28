import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

type Platform = 'taobao' | 'pinduoduo';

interface ExtractResult {
  success: boolean;
  platform: string;
  final_url: string;
  title: string;
  main_image: string;
  images: string[];
  error: string;
}

type NormalizedUrlResult = {
  normalizedUrl: string;
  id: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '服务器错误，请稍后重试';
}

function detectPlatform(url: string): Platform | 'unknown' {
  const lower = url.toLowerCase();
  if (lower.includes('tmall.com') || lower.includes('taobao.com')) return 'taobao';
  if (lower.includes('pinduoduo.com') || lower.includes('yangkeduo.com')) return 'pinduoduo';
  return 'unknown';
}

function normalizeUrl(rawUrl: string): NormalizedUrlResult {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();
    const id = url.searchParams.get('id');

    if (host.includes('tmall.com') || host.includes('taobao.com')) {
      const normalizedHost = host.includes('tmall.com') ? 'detail.tmall.com' : 'item.taobao.com';
      const normalized = new URL(`https://${normalizedHost}${url.pathname || '/item.htm'}`);
      if (id) {
        normalized.searchParams.set('id', id);
      }
      const skuId = url.searchParams.get('skuId');
      if (skuId) {
        normalized.searchParams.set('skuId', skuId);
      }
      return { normalizedUrl: normalized.toString(), id };
    }

    if (host.includes('pinduoduo.com') || host.includes('yangkeduo.com')) {
      const goodsId = url.searchParams.get('goods_id') || url.searchParams.get('goodsId');
      return { normalizedUrl: url.toString(), id: goodsId || id };
    }

    return { normalizedUrl: url.toString(), id };
  } catch {
    return { normalizedUrl: rawUrl, id: null };
  }
}

function extractWithNodeScript(url: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const scriptPath = '/home/ubuntu/Downloads/zaomeng/project/projects/scripts/template-extract.mjs';

    const child = spawn('node', [scriptPath, url], {
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (result: ExtractResult) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', () => {
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine) as ExtractResult;
        finish(parsed);
      } catch (error) {
        console.error('[模板提取] Node 脚本结果解析失败:', error);
        finish({
          success: false,
          platform: detectPlatform(url),
          final_url: url,
          title: '',
          main_image: '',
          images: [],
          error: stderr || '提取结果解析失败',
        });
      }
    });

    child.on('error', (error) => {
      console.error('[模板提取] Node 子进程启动失败:', error);
      finish({
        success: false,
        platform: detectPlatform(url),
        final_url: url,
        title: '',
        main_image: '',
        images: [],
        error: `无法启动提取器: ${error.message}`,
      });
    });

    setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        success: false,
        platform: detectPlatform(url),
        final_url: url,
        title: '',
        main_image: '',
        images: [],
        error: '提取超时（90秒）',
      });
    }, 90000);
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url: string; platform?: Platform };

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: '请提供商品链接',
          images: [],
        },
        { status: 400 }
      );
    }

    const { normalizedUrl, id } = normalizeUrl(url);
    const detectedPlatform = detectPlatform(normalizedUrl);

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: '无法从链接中提取商品ID',
          images: [],
        },
        { status: 400 }
      );
    }

    if (detectedPlatform === 'unknown') {
      return NextResponse.json(
        {
          success: false,
          error: '仅支持淘宝、天猫、拼多多商品链接',
          images: [],
        },
        { status: 400 }
      );
    }

    console.log('[模板提取] ===== 开始提取 =====');
    console.log('[模板提取] 原始 URL:', url);
    console.log('[模板提取] 标准化 URL:', normalizedUrl);
    console.log('[模板提取] 检测平台:', detectedPlatform);

    const result = await extractWithNodeScript(normalizedUrl);

    console.log('[模板提取] ===== 提取完成 =====');
    console.log('[模板提取] 成功:', result.success);
    console.log('[模板提取] 图片数量:', result.images.length);
    if (result.error) {
      console.log('[模板提取] 错误:', result.error);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[模板提取] API 错误:', error);
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
        images: [],
      },
      { status: 500 }
    );
  }
}
