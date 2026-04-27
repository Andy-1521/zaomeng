import { NextRequest, NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';
import { userManager } from '@/storage/database';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 修改用户头像接口
 *
 * 功能说明：
 * - 接收头像文件
 * - 上传到对象存储
 * - 更新用户头像URL
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const userId = formData.get('userId') as string;
    const file = formData.get('file') as File;

    if (!userId || !file) {
      return NextResponse.json(
        { success: false, message: '用户ID和头像文件不能为空' },
        { status: 400 }
      );
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, message: '仅支持 JPG、PNG、GIF、WEBP 格式的图片' },
        { status: 400 }
      );
    }

    // 验证文件大小（5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, message: '图片大小不能超过 5MB' },
        { status: 400 }
      );
    }

    // 检查用户是否存在
    const user = await userManager.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: '用户不存在' },
        { status: 404 }
      );
    }

    // 上传头像到对象存储（使用腾讯云COS）
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: process.env.COZE_ACCESS_KEY,
      secretKey: process.env.COZE_SECRET_KEY,
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'ap-guangzhou',
    });

    // 生成文件名：avatar_用户名_UUID.扩展名
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `avatars/${user.username}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

    // 读取文件内容
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // 上传文件
    const fileKey = await storage.uploadFile({
      fileContent: fileBuffer,
      fileName: fileName,
      contentType: file.type,
    });

    // 生成签名 URL
    const avatarUrl = await storage.generatePresignedUrl({
      key: fileKey,
      expireTime: 365 * 24 * 60 * 60, // 1 年
    });

    // 更新用户头像
    await userManager.updateAvatar(userId, avatarUrl);

    return NextResponse.json({
      success: true,
      message: '头像修改成功',
      data: {
        avatar: avatarUrl,
      },
    });
  } catch (error: unknown) {
    console.error('修改头像失败:', error);
    return NextResponse.json(
      { success: false, message: `修改头像失败: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
