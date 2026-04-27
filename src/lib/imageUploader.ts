/**
 * 图片上传工具
 * 通过API将图片上传到对象存储并返回HTTP URL
 */

/**
 * 上传图片到对象存储
 * @param file - 图片文件
 * @param folder - 存储文件夹（默认：'uploads'）
 * @returns 签名URL（有效期30天）
 */
export async function uploadImage(
  file: File,
  folder: string = 'uploads'
): Promise<string> {
  try {
    console.log(`[图片上传] 开始上传: ${file.name}, 大小: ${file.size} bytes`);

    // 创建FormData
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);

    // 调用服务端API上传
    const response = await fetch('/api/upload/file', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '上传失败');
    }

    const data = await response.json();
    if (!data.success || !data.data?.url) {
      throw new Error('上传失败：未返回URL');
    }

    console.log(`[图片上传] 上传成功，URL: ${data.data.url.substring(0, 80)}...`);
    return data.data.url;
  } catch (error: any) {
    console.error('[图片上传] 失败:', error);
    throw new Error(error.message || '图片上传失败，请重试');
  }
}

/**
 * 从 FileList 上传多张图片
 * @param files - 文件列表
 * @param folder - 存储文件夹
 * @returns 签名URL数组（有效期30天）
 */
export async function uploadImages(
  files: FileList,
  folder: string = 'uploads'
): Promise<string[]> {
  const uploadPromises = Array.from(files).map(file => uploadImage(file, folder));
  return Promise.all(uploadPromises);
}

/**
 * 上传Buffer到对象存储（用于处理后的图片）
 * @param buffer - 图片Buffer
 * @param fileName - 文件名（如 'result-1234567890.png'）
 * @param contentType - 内容类型（如 'image/png'）
 * @param folder - 存储文件夹（默认：'grsai'）
 * @returns 签名URL（有效期30天）
 */
export async function uploadBuffer(
  buffer: Buffer,
  fileName: string,
  contentType: string = 'image/png',
  folder: string = 'grsai'
): Promise<string> {
  try {
    console.log(`[Buffer上传] 开始上传: ${fileName}, 大小: ${buffer.length} bytes`);

    // 将Buffer转换为Base64字符串
    const base64String = buffer.toString('base64');

    // 创建FormData
    const formData = new FormData();
    formData.append('buffer', base64String);
    formData.append('fileName', fileName);
    formData.append('contentType', contentType);
    formData.append('folder', folder);

    // 调用服务端API上传
    const response = await fetch('/api/upload/buffer', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || '上传失败');
    }

    const data = await response.json();
    if (!data.success || !data.data?.url) {
      throw new Error('上传失败：未返回URL');
    }

    console.log(`[Buffer上传] 上传成功，URL: ${data.data.url.substring(0, 80)}...`);
    return data.data.url;
  } catch (error: any) {
    console.error('[Buffer上传] 失败:', error);
    throw new Error(error.message || '图片上传失败，请重试');
  }
}
