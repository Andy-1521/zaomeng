import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '隐私政策 - 造梦AI',
  description: '造梦AI隐私政策',
};

const sections = [
  {
    title: '1. 我们收集的信息',
    paragraphs: [
      '账号信息：邮箱、用户名、头像、密码加密结果、验证码发送和登录状态，用于注册、登录、找回密码和账号展示。',
      '素材和创作信息：用户上传图片、插件采集图片、来源页面信息、提示词、标记区域、生成参数、生成结果、PSD链接和订单记录，用于提供素材管理、AI处理、下载和历史追踪。',
      '积分和兑换信息：积分余额、消费记录、兑换码使用记录、管理员生成记录和兑换时间，用于完成积分扣减、退款、兑换和账务核对。',
      '设备和日志信息：访问时间、接口请求、错误日志、浏览器基础信息和必要的安全日志，用于排查故障、保障服务安全和优化体验。',
    ],
  },
  {
    title: '2. 我们如何使用信息',
    paragraphs: [
      '我们使用上述信息提供登录认证、图库加载、插件采图、图片上传、AI生成、智能改图、彩绘提取、订单记录、积分兑换和客服处理等功能。',
      '当任务失败、超时、上传异常或订单状态异常时，我们会使用订单和日志信息定位问题、修复状态并按规则处理退款。',
    ],
  },
  {
    title: '3. 存储和第三方处理',
    paragraphs: [
      '图片素材和生成结果主要存储在阿里云 OSS；数据库保存图片 URL、订单、分组、收藏、积分和用户资料等元数据。',
      'AI生图、智能改图、彩绘提取、PSD和高清+扩图等功能会将必要的图片、提示词或处理参数发送给对应的模型、工作流或图像处理服务商完成任务。',
      '邮件验证码会通过邮件服务发送；服务器、数据库、Redis、对象存储和日志系统会处理运行所需的数据。我们不会主动出售用户个人信息。',
    ],
  },
  {
    title: '4. 插件采图相关说明',
    paragraphs: [
      '浏览器插件只用于用户主动触发的图片采集和上传。插件会把用户选择的图片、来源页面标题、来源地址和图片类型等必要信息保存到当前账号素材库。',
      '用户应确认自己有权采集和使用相关图片。插件不会要求用户提供目标网站账号密码。',
    ],
  },
  {
    title: '5. Cookie 和本地存储',
    paragraphs: [
      '网站会使用 Cookie 保存登录状态，并使用 localStorage 或 sessionStorage 保存部分界面状态，例如缩略图大小、上传恢复记录、临时任务状态等。',
      '清除浏览器数据可能导致登录状态、上传恢复记录或界面偏好丢失，但不会删除已经入库的云端素材和订单记录。',
    ],
  },
  {
    title: '6. 数据保留和删除',
    paragraphs: [
      '账号、素材、订单和积分记录会在账号存续期间保留，以便用户继续使用图库、下载结果和核对积分。',
      '如需删除素材，可在图库中执行删除操作；如需处理账号或其他个人信息问题，可联系管理员微信 Kzai-1224。',
    ],
  },
  {
    title: '7. 安全措施',
    paragraphs: [
      '我们会采用访问控制、服务端校验、对象存储签名 URL、日志审计和必要的故障监控来保护服务运行安全。',
      '互联网服务无法保证绝对安全。用户也应妥善保管账号密码、验证码和兑换码，避免在不可信环境中登录或转发敏感信息。',
    ],
  },
  {
    title: '8. 政策更新',
    paragraphs: [
      '我们可能根据功能、服务商、法律法规或运营方式变化更新本政策。重要变更会通过页面展示等方式提示。',
      '继续使用造梦AI，即表示你了解并接受更新后的隐私政策。',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <header className="border-b border-white/10 pb-6">
          <Link href="/login" className="text-sm text-violet-200/70 transition hover:text-violet-100">
            返回造梦AI
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">隐私政策</h1>
          <p className="mt-3 text-sm leading-6 text-white/46">最后更新：2026年5月27日</p>
        </header>

        <section className="rounded-2xl border border-violet-300/14 bg-violet-500/[0.04] px-5 py-5 text-sm leading-7 text-white/58">
          本政策说明造梦AI在提供图片素材管理和 AI 图片处理服务时，如何收集、使用、存储和保护相关信息。
        </section>

        <div className="space-y-7">
          {sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-5">
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-white/58">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-6 text-sm text-white/42">
          <Link href="/terms" className="transition hover:text-white">用户服务协议</Link>
          <span>/</span>
          <Link href="/login" className="transition hover:text-white">返回登录</Link>
        </footer>
      </div>
    </main>
  );
}
