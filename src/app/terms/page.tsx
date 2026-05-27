import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '用户服务协议 - 造梦AI',
  description: '造梦AI用户服务协议',
};

const sections = [
  {
    title: '1. 服务内容',
    paragraphs: [
      '造梦AI提供图片素材采集、素材管理、AI生图、智能改图、彩绘提取、PSD生成、高清+扩图和订单记录等功能。用户可通过网站和浏览器插件上传或采集图片，并使用积分提交处理任务。',
      '部分功能依赖第三方模型服务、对象存储、邮件服务和服务器基础设施。因网络、服务商限制、维护或异常导致服务暂时不可用时，平台会尽力恢复，但不承诺服务永不中断。',
    ],
  },
  {
    title: '2. 账号和使用规则',
    paragraphs: [
      '用户应使用真实可用的邮箱注册和接收验证码，并妥善保管账号、密码和兑换码。因用户主动泄露账号或兑换码造成的损失，由用户自行承担。',
      '用户不得上传、生成、传播违法违规、侵权、色情低俗、暴力恐怖、诈骗引流、侵犯他人隐私或其他不适宜内容。平台发现异常使用时，有权限制相关功能、删除违规内容或暂停账号。',
    ],
  },
  {
    title: '3. 用户内容和生成结果',
    paragraphs: [
      '用户应确保上传图片、采集图片、提示词和其他输入内容拥有合法来源和必要授权。用户使用生成结果前，应自行确认该结果不会侵犯第三方权益或违反适用规则。',
      'AI生成结果具有不确定性，可能存在瑕疵、错误或不符合预期。平台会按照已公开的积分规则处理失败、超时和退款，但不保证每次生成都满足特定商业用途。',
    ],
  },
  {
    title: '4. 积分、兑换码和退款',
    paragraphs: [
      '当前自动支付暂未开放，用户通过联系管理员获取一次性兑换码并在个人中心兑换积分。兑换码只能使用一次，请勿转发给他人。',
      '高成本任务通常采用提交前余额校验、后端原子预扣和失败退款机制。若任务因模型错误、上传失败、超时或结果缺失而失败，系统会按当前规则退还对应预扣积分。',
    ],
  },
  {
    title: '5. 插件使用',
    paragraphs: [
      '浏览器插件用于将网页中的图片保存到当前账号素材库。用户应仅采集自己有权使用的图片，并遵守目标网站规则和相关法律法规。',
      '插件版本可能随网站能力更新而调整。网站提示插件需要更新时，用户应下载最新版插件以保证采图、上传和兼容性正常。',
    ],
  },
  {
    title: '6. 责任限制',
    paragraphs: [
      '在法律允许范围内，平台不对用户使用本服务产生的间接损失、商业机会损失、数据误删、第三方索赔或用户违规使用导致的后果承担责任。',
      '因不可抗力、基础运营商故障、云服务商故障、第三方模型服务异常、攻击事件或用户设备网络问题造成的影响，平台会尽力处理但不承担超出法律规定的责任。',
    ],
  },
  {
    title: '7. 协议更新和联系',
    paragraphs: [
      '平台可能根据功能变化、法律法规要求或运营需要更新本协议。重要变更会通过页面展示等方式提示，用户继续使用服务即表示接受更新后的内容。',
      '如对账号、积分、内容处理或本协议有疑问，可通过个人中心展示的管理员微信 Kzai-1224 联系处理。',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <header className="border-b border-white/10 pb-6">
          <Link href="/login" className="text-sm text-violet-200/70 transition hover:text-violet-100">
            返回造梦AI
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">用户服务协议</h1>
          <p className="mt-3 text-sm leading-6 text-white/46">最后更新：2026年5月27日</p>
        </header>

        <section className="rounded-2xl border border-violet-300/14 bg-violet-500/[0.04] px-5 py-5 text-sm leading-7 text-white/58">
          欢迎使用造梦AI。使用、注册、登录或继续访问本服务，即表示你已阅读并同意本协议。
          本协议为基础运营版本，后续如接入正式支付主体、企业主体或新增功能，将同步更新。
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
          <Link href="/privacy" className="transition hover:text-white">隐私政策</Link>
          <span>/</span>
          <Link href="/login" className="transition hover:text-white">返回登录</Link>
        </footer>
      </div>
    </main>
  );
}
