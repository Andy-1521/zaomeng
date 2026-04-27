/**
 * 图片下载工具
 * 统一的跨域图片下载解决方案
 */

/**
 * 下载图片（支持跨域URL）
 * @param url - 图片URL（支持签名URL、公共URL）
 * @param fileName - 下载的文件名
 */
export async function downloadImage(url: string, fileName: string): Promise<void> {
  try {
    console.log('[图片下载] 开始下载:', url.substring(0, 80), '...', fileName);

    // 使用 fetch 获取图片数据（支持跨域）
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    // 转换为 Blob
    const blob = await response.blob();

    // 创建临时 URL
    const blobUrl = window.URL.createObjectURL(blob);

    // 创建下载链接
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;

    // 触发下载
    document.body.appendChild(link);
    link.click();

    // 清理
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);

    console.log('[图片下载] 下载成功:', fileName);
  } catch (error: any) {
    console.error('[图片下载] 失败:', error);
    throw new Error(error.message || '图片下载失败，请重试');
  }
}

/**
 * 批量下载图片
 * @param urls - 图片URL数组
 * @param fileNames - 文件名数组（与urls一一对应）
 */
export async function downloadImages(urls: string[], fileNames: string[]): Promise<void> {
  if (urls.length !== fileNames.length) {
    throw new Error('URLs和文件名数量不匹配');
  }

  // 逐个下载
  for (let i = 0; i < urls.length; i++) {
    try {
      await downloadImage(urls[i], fileNames[i]);
      // 添加延迟，避免浏览器阻止多个下载
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`[图片下载] 第${i + 1}张图片下载失败:`, error);
    }
  }
}
