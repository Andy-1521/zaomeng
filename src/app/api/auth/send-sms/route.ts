import { NextRequest, NextResponse } from 'next/server';
import { verifyCodeStore } from '@/utils/verifyCodeStore';

/**
 * 阿里云短信验证码发送接口
 *
 * 功能说明：
 * - 集成阿里云短信服务实现真实的验证码发送
 * - 支持开发模式和生产环境切换
 * - 验证码5分钟有效期
 *
 * 前置条件：
 * 1. 已在阿里云短信服务控制台配置短信签名和模板
 * 2. 已在 .env.local 中配置 AccessKey、签名名称、模板ID
 * 3. 确保账户有足够的短信额度
 *
 * 阿里云短信服务文档：https://help.aliyun.com/zh/sms/
 */

function getErrorName(error: unknown) {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return String(error.name);
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body;

    // 验证手机号
    if (!phone) {
      return NextResponse.json(
        { success: false, message: '手机号不能为空' },
        { status: 400 }
      );
    }

    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { success: false, message: '请输入有效的手机号码' },
        { status: 400 }
      );
    }

    // 检查环境变量配置
    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
    const signName = process.env.ALIYUN_SMS_SIGN_NAME;
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;

    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      console.error('阿里云短信配置不完整，请检查 .env.local 文件');
      return NextResponse.json(
        {
          success: false,
          message: '短信服务配置不完整，请联系管理员',
        },
        { status: 500 }
      );
    }

    // 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 判断是否使用模拟模式
    const useSmsMock = process.env.USE_SMS_MOCK === 'true';
    const isDevelopment = process.env.NODE_ENV === 'development';

    // 模拟模式：在控制台输出验证码（方便测试）
    if (useSmsMock || isDevelopment) {
      // 开发模式：在控制台输出验证码（方便调试）
      console.log('========================================');
      console.log('开发模式：短信验证码');
      console.log('========================================');
      console.log(`手机号: ${phone}`);
      console.log(`验证码: ${verifyCode}`);
      console.log(`有效期: 5分钟`);
      console.log('========================================');

      // 存储验证码
      await verifyCodeStore.set(phone, verifyCode, 5);

      return NextResponse.json({
        success: true,
        message: '验证码已发送（模拟模式：请查看服务器控制台）',
        data: {
          phone,
          verifyCode, // 仅模拟模式返回
        },
      });
    }

    // 生产模式：调用阿里云短信服务
    try {
      // 动态导入阿里云 SDK（仅在服务端使用）
      const Dysmsapi20170525 = await import('@alicloud/dysmsapi20170525');
      const OpenApi = await import('@alicloud/openapi-client');

      const config = new OpenApi.Config({
        accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
        endpoint: 'dysmsapi.aliyuncs.com',
      });

      const client = new Dysmsapi20170525.default(config);

      const sendSmsRequest = new Dysmsapi20170525.SendSmsRequest({
        phoneNumbers: phone,
        signName: process.env.ALIYUN_SMS_SIGN_NAME,
        templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
        templateParam: JSON.stringify({ code: verifyCode }),
      });

      const response = await client.sendSms(sendSmsRequest);

      console.log('阿里云短信发送响应:', response.body);

      // 检查发送结果
      if (response.body?.code !== 'OK') {
        console.error('发送短信失败:', response.body);
        return NextResponse.json(
          {
            success: false,
            message: `发送验证码失败：${response.body?.message || '未知错误'}`,
          },
          { status: 500 }
        );
      }

      // 发送成功，存储验证码
      await verifyCodeStore.set(phone, verifyCode, 5);

      return NextResponse.json({
        success: true,
        message: '验证码已发送',
        data: {
          phone,
        },
      });
    } catch (smsError: unknown) {
      console.error('阿里云短信服务调用异常:', smsError);

      // 详细的错误处理
      let errorMessage = '发送验证码失败，请稍后重试';
      const errorName = getErrorName(smsError);

      if (errorName === 'AuthFailure') {
        errorMessage = '短信服务认证失败，请检查 AccessKey 配置';
      } else if (errorName === 'InvalidParameter') {
        errorMessage = '短信参数配置错误，请检查签名和模板';
      } else if (errorName === 'SignatureDoesNotMatch') {
        errorMessage = 'AccessKey Secret 不正确';
      }

      return NextResponse.json(
        {
          success: false,
          message: errorMessage,
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error('发送验证码接口异常:', error);
    return NextResponse.json(
      {
        success: false,
        message: '服务异常，请稍后重试',
      },
      { status: 500 }
    );
  }
}
