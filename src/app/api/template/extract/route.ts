import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '服务器错误，请稍后重试';
}

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

// URL 验证
function normalizeUrl(rawUrl: string): { normalizedUrl: string; id: string | null } {
  try {
    const url = new URL(rawUrl);
    const id = url.searchParams.get('id');
    
    // 去掉追踪参数
    const paramsToRemove = [
      'ali_refid', 'ali_trackid', 'spm', 'utparam', 'xxc',
      'mi_id', 'mm_sceneid', 'priceTId', '_t', 'ttid', 'timestamp',
    ];
    paramsToRemove.forEach(p => url.searchParams.delete(p));
    
    // 重建 URL
    const normalized = new URL(url.pathname, 'https://detail.tmall.com');
    if (id) normalized.searchParams.set('id', id);
    const skuId = new URL(rawUrl).searchParams.get('skuId');
    if (skuId) normalized.searchParams.set('skuId', skuId);
    
    return { normalizedUrl: normalized.toString(), id };
  } catch {
    return { normalizedUrl: rawUrl, id: null };
  }
}

function detectPlatform(url: string): Platform | 'unknown' {
  const lower = url.toLowerCase();
  if (lower.includes('tmall.com') || lower.includes('taobao.com')) return 'taobao';
  if (lower.includes('pinduoduo.com') || lower.includes('yangkeduo.com')) return 'pinduoduo';
  return 'unknown';
}

// 调用 Python 提取器
function extractWithPython(url: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const pythonScript = '/workspace/projects/extractor_server.py';
    
    console.log(`[模板提取] 调用 Python 脚本: ${pythonScript}`);
    console.log(`[模板提取] 提取 URL: ${url}`);
    
    const child = spawn('python3', [pythonScript, url], {
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      console.log(`[模板提取] Python 脚本退出码: ${code}`);
      
      if (stderr) {
        console.log(`[模板提取] stderr: ${stderr.substring(0, 500)}`);
      }
      
      try {
        // stdout 的最后一行应该是 JSON 结果
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const result = JSON.parse(lastLine);
        resolve(result);
      } catch (e) {
        console.error('[模板提取] JSON 解析失败:', e);
        resolve({
          success: false,
          platform: detectPlatform(url),
          final_url: url,
          title: '',
          main_image: '',
          images: [],
          error: `提取失败: ${stderr || '未知错误'}`,
        });
      }
    });

    child.on('error', (err) => {
      console.error('[模板提取] 子进程错误:', err);
      resolve({
        success: false,
        platform: 'unknown',
        final_url: url,
        title: '',
        main_image: '',
        images: [],
        error: `无法启动提取器: ${err.message}`,
      });
    });

    // 超时处理
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        success: false,
        platform: 'unknown',
        final_url: url,
        title: '',
        main_image: '',
        images: [],
        error: '提取超时（90秒）',
      });
    }, 90000);
  });
}

// API Route
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url: string; platform?: Platform };

    if (!url) {
      return NextResponse.json({
        success: false,
        error: '请提供商品链接',
        images: [],
      }, { status: 400 });
    }

    // URL 标准化
    const { normalizedUrl, id } = normalizeUrl(url);
    
    if (!id) {
      return NextResponse.json({
        success: false,
        error: '无法从链接中提取商品ID',
        images: [],
      }, { status: 400 });
    }

    // 验证平台
    const detectedPlatform = detectPlatform(normalizedUrl);
    if (detectedPlatform === 'unknown') {
      return NextResponse.json({
        success: false,
        error: '仅支持淘宝、天猫、拼多多商品链接',
        images: [],
      }, { status: 400 });
    }

    console.log(`[模板提取] ===== 开始提取 =====`);
    console.log(`[模板提取] 原始 URL: ${url}`);
    console.log(`[模板提取] 标准化 URL: ${normalizedUrl}`);
    console.log(`[模板提取] 检测平台: ${detectedPlatform}`);

    const result = await extractWithPython(normalizedUrl);

    console.log(`[模板提取] ===== 提取完成 =====`);
    console.log(`[模板提取] 成功: ${result.success}`);
    console.log(`[模板提取] 图片数量: ${result.images?.length || 0}`);
    if (result.error) {
      console.log(`[模板提取] 错误: ${result.error}`);
    }

    return NextResponse.json(result);

  } catch (error: unknown) {
    console.error('[模板提取] API 错误:', error);
    return NextResponse.json({
      success: false,
      error: getErrorMessage(error),
      images: [],
    }, { status: 500 });
  }
}
