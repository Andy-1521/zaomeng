# 造梦 AI 部署验收流程

最后更新：2026-05-28

## 固定原则

- 所有修改都先在本地完成。
- 用户只看可访问、可操作的验收结果，不审代码。
- 每次修改后先启动本地预览给用户验收，默认地址为 `http://localhost:5001`。
- 用户明确确认本地预览没问题后，才能部署生产给真实用户使用。
- 每次生产发布前都要备份到 GitHub，提交信息使用 `backup: YYYY-MM-DD 摘要`。
- 当前生产部署在腾讯云香港服务器，不再走 Vercel Preview / Production。
- 生产数据优先保护：不直接改生产数据库、不清空生产素材、不覆盖 `/home/ubuntu/zaomeng/.env.local`。
- 当前正式生产基线：生产地址 `https://zaomengai.icu`，服务器 `/home/ubuntu/zaomeng/.deploy-sha` 记录当前发布的 Git commit。

## 网站作用

造梦 AI 是图片素材采集与 AI 图片生产工作台。用户在 `/home` 统一完成素材采集、上传、整理、AI 生图、智能改图、彩绘提取、手动 PSD、高清+扩图和任务查看。浏览器插件负责把网页图片保存到当前账号素材库。用户通过积分使用高成本功能，失败或超时按后端规则退款。

## 图库主链路

- 本地素材上传：浏览器优先直传阿里云 OSS，再调用 `/api/upload/complete-material` 写入图库记录。
- 插件采图：插件优先直传阿里云 OSS，再调用 `/api/plugin/complete-capture` 写入图库记录。
- 插件因网页跨站限制无法直读图片时，可走 `/api/plugin/capture-image` 服务端兼容保存，但最终仍必须上传 OSS 并保存 OSS URL。
- 生产服务器不应承担素材持久化，不应把新图库文件写进 `public/` 当作正式存储。
- 上传或插件采集成功后，页面必须立即插入返回的素材记录；列表刷新只用于校准。
- 图库页面通过 `/api/plugin/captured-images` 分页加载，上传中显示占位卡片；刷新中断后会根据 sessionStorage 中的 OSS key 自动补完成入库。
- 订单记录缩略图通过 `/api/image/thumbnail-url` 获取 OSS 处理后的小图签名 URL，不应直接加载原始大图。
- 订单结果页只展示成功或部分成功且有真实结果图的订单；失败、超时、处理中和无结果图订单不显示为图片卡片。
- 右侧订单记录面板保留失败/超时记录，用于查看失败原因、删除、重新提交和退款排查。
- 订单记录下载按钮走同源 `/api/image/download`，由服务器读取 OSS 图片并作为附件返回，避免浏览器跨域下载失败。

## 智能改图主链路

- 前端入口在 `/home` 的智能改图面板，相关组件是 `QuickCreatePage.tsx` 和 `LocalEditPanel.tsx`。
- 标记识别调用 `/api/smart-edit/identify`，保留预识别 `prewarm`，实际识别发送压缩裁切图。
- prompt 组合由 `/api/material-editor/compose-prompt` 和 `src/lib/materialEditorPrompt.ts` 处理。
- 正式生成调用 `/api/material-editor`，后端创建订单、预扣积分、调用图像编辑主接口、上传结果到 OSS，再把结果 URL 写回订单。
- AI 生图和智能改图结果只显示在订单记录，不自动加入图库。
- 失败、超时、上传失败或结果缺失时，订单失败并按积分规则退款。

## 彩绘提取和 PSD 主链路

- 彩绘提取入口是 `/api/color-extraction/run`，前端从 `/home` 选中素材后提交。
- 接口只负责校验用户、创建订单、原子预扣积分并快速返回订单号；真实图片处理在后台并发执行。
- 当前只保留 Psydo 图生图彩绘提取模式，不再保留镂空模式，不再走 Coze 去背景分支。
- 彩绘结果只保存到 OSS，并写入订单 `resultData`；不会自动加入图库。
- 彩绘提取成功后 PSD 状态为 `pending`，用户在右侧订单记录中手动点击生成 PSD。
- PSD 入口是 `/api/color-extraction/generate-psd`，单独预扣积分，失败只退 PSD 积分，不影响已成功彩绘结果。

## 其他功能流程

- AI 生图：`/api/image-to-image/run` 创建订单、预扣积分、调用 Psydo 图像接口、结果上传 OSS、订单成功；失败或超时退款。
- 高清+扩图：`/api/outpaint-upsampling/run` 创建后台订单、预扣积分、执行扩图和放大、结果上传 OSS；当前价格通过 `getOutpaintUpsamplingPoints()` 读取，不写死。
- 素材下载/订单下载：图库下载和订单记录下载均应优先通过同源站点处理，不依赖 OSS 跨域能力。
- 插件更新：用户只看到“下载最新版插件”，不要向用户暴露服务器、域名、迁移细节。

## 标准步骤

1. 本地修改代码。
2. 启动本地预览：`pnpm dev --port 5001`。
3. 在浏览器验证 `/login`、`/home`、`/profile`、`/plugin`、`/admin/generations`。
4. 执行 `pnpm exec tsc --noEmit --pretty false --incremental false`。
5. 执行 `git diff --check`。
6. 执行 `pnpm build`。
7. 用 `backup: YYYY-MM-DD summary` 提交并推送 GitHub。
8. 用户确认可上线后，运行 `scripts/deploy-production.sh` 部署到 `ubuntu@43.129.173.9:/home/ubuntu/zaomeng`。
9. 发布后检查 `https://zaomengai.icu`、`/login`、`/home`、`/profile`、`/plugin`、`/admin/generations`。

## 生产环境

- 公网入口：`https://zaomengai.icu`
- 服务器：腾讯云香港 `43.129.173.9`
- SSH 用户：`ubuntu`
- 应用目录：`/home/ubuntu/zaomeng`
- systemd 服务：`zaomeng-web`
- Next.js 监听：`127.0.0.1:5000`
- Nginx：80/443 反代到本机 5000，HTTPS 已启用
- 数据库和 Redis：生产服务器本机服务
- 对象存储：阿里云 OSS 香港区域，生产桶 `zaomengai-hk-20260527`

## 生产发布要点

- 生产发布统一使用 `scripts/deploy-production.sh`，不要手写 `rm` / `mv` 拼路径发布。
- 发布脚本必须先在远程临时目录构建成功，再短暂停服务切换到 `/home/ubuntu/zaomeng`。
- 发布时保留生产服务器上的 `/home/ubuntu/zaomeng/.env.local`。
- 发布时保留 `/home/ubuntu/zaomeng/.coze-logs`。
- 不同步 `.git`、`node_modules`、`.next`、`.vercel`、日志、构建产物和运行生成素材。
- 生产发布失败时优先恢复 `/home/ubuntu/zaomeng-prev-*` 上一个目录，并重启 `zaomeng-web`。
- 发布脚本部署后只保留最近 1 个 `/home/ubuntu/zaomeng-prev-*` 回滚目录，避免服务器堆积旧版本。
- 禁止执行空变量拼出的远程路径，例如 `/home/ubuntu/$name` 在 `$name` 为空时会变成 `/home/ubuntu/`，这是生产事故级风险。

## 当前充值方式

- 自动微信/支付宝支付暂时隐藏。
- 用户在 `/profile?tab=recharge` 联系管理员微信 `Kzai-1224` 获取一次性兑换码。
- 用户侧不展示管理员二维码。
- 管理员在 `/admin/generations` 的“兑换码”标签输入充值额度生成兑换码。
- 兑换码只能使用一次，后台记录会显示生成额度、积分、生成者、兑换用户和兑换时间。

## 合规入口

- `/terms` 为用户服务协议。
- `/privacy` 为隐私政策。
- 登录/注册页展示同意提示，个人中心底部提供协议入口。
- 如后续补齐企业主体、客服邮箱、自动支付主体或支付服务商信息，必须同步更新协议和隐私政策。

## 禁止事项

- 不要跳过本地预览和用户确认直接切生产。
- 不要提交 `.env.local`、`.vercel/`、日志、构建产物或运行生成素材。
- 不要把测试账号、测试兑换码或临时数据留到生产数据库。
- 不要在用户未确认前影响生产线上用户。
- 不要恢复本地 public 作为 OSS 上传失败后的替代存储。
- 不要为了调试直接改生产数据；需要排查时先只读查询，确认方案后再让用户授权。
