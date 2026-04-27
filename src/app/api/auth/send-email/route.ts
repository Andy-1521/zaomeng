import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { verifyCodeStore } from '@/utils/verifyCodeStore';

/**
 * 邮箱验证码发送接口
 *
 * 功能说明：
 * - 集成SMTP服务实现真实的验证码发送
 * - 支持模拟模式和真实模式切换
 * - 验证码5分钟有效期
 *
 * 使用方式：
 * 1. 模拟模式（默认）：只在控制台打印验证码，不发送邮件
 *    - 无需配置SMTP参数
 *    - 适合开发测试
 *    - 默认启用（USE_EMAIL_MOCK未设置或为true）
 *
 * 2. 真实模式：发送真实邮件到用户邮箱
 *    - 需配置SMTP相关参数（.env.local）
 *    - 设置 USE_EMAIL_MOCK=false
 *    - 支持QQ邮箱、163邮箱等SMTP服务
 *
 * 前置条件（使用真实模式时）：
 * 1. 已在.env.local中配置SMTP相关参数
 * 2. 邮箱需开启SMTP服务并获取授权码
 */

function getErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    // 验证邮箱
    if (!email) {
      return NextResponse.json(
        { success: false, message: '邮箱不能为空' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, message: '请输入有效的邮箱地址' },
        { status: 400 }
      );
    }

    // 检查环境变量配置
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFromName = process.env.SMTP_FROM_NAME;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      console.error('SMTP配置不完整，请检查 .env.local 文件');
      return NextResponse.json(
        {
          success: false,
          message: '邮件服务配置不完整，请联系管理员',
        },
        { status: 500 }
      );
    }

    // 生成6位验证码
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 判断是否使用模拟模式（默认true，设置为false时发送真实邮件）
    const useEmailMock = process.env.USE_EMAIL_MOCK !== 'false';

    // 模拟模式：在控制台输出验证码（方便测试）
    if (useEmailMock) {
      console.log('========================================');
      console.log('模拟模式：邮箱验证码');
      console.log('========================================');
      console.log(`邮箱: ${email}`);
      console.log(`验证码: ${verifyCode}`);
      console.log(`有效期: 5分钟`);
      console.log('========================================');

      // 存储验证码
      await verifyCodeStore.set(email, verifyCode, 5);

      return NextResponse.json({
        success: true,
        message: '验证码已发送（模拟模式：请查看服务器控制台）',
        data: {
          email,
          verifyCode, // 仅模拟模式返回
        },
      });
    }

    // 真实模式：调用邮件发送服务
    try {
      // 创建邮件传输器
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: false, // QQ邮箱使用TLS，不使用SSL
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      // 邮件内容
      const mailOptions = {
        from: `${smtpFromName} <${smtpUser}>`,
        to: email,
        subject: '造梦AI - 验证码',
        html: `
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">造梦AI</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">开启你的AI创作之旅</p>
            </div>
            <div style="background: #f9f9f9; padding: 40px 30px; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                您好，欢迎使用造梦AI！
              </p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                您的验证码是：
              </p>
              <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <span style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${verifyCode}</span>
              </div>
              <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
                验证码有效期为 5 分钟，请尽快使用。
              </p>
              <p style="font-size: 14px; color: #666; margin-bottom: 20px;">
                如果这不是您的操作，请忽略此邮件。
              </p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              <p style="font-size: 12px; color: #999; margin: 0;">
                此邮件由系统自动发送，请勿回复。
              </p>
            </div>
          </div>
        `,
      };

      // 发送邮件
      const info = await transporter.sendMail(mailOptions);

      console.log('邮件发送成功:', info.messageId);

      // 发送成功，存储验证码
      await verifyCodeStore.set(email, verifyCode, 5);

      return NextResponse.json({
        success: true,
        message: '验证码已发送',
        data: {
          email,
        },
      });
    } catch (emailError: unknown) {
      console.error('邮件发送异常:', emailError);

      // 详细的错误处理
      let errorMessage = '发送验证码失败，请稍后重试';
      const errorCode = getErrorCode(emailError);

      if (errorCode === 'EAUTH') {
        errorMessage = '邮箱认证失败，请检查SMTP配置';
      } else if (errorCode === 'ECONNECTION') {
        errorMessage = '无法连接到邮件服务器';
      } else if (errorCode === 'ETIMEDOUT') {
        errorMessage = '连接邮件服务器超时';
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
