# 造梦 AI 部署验收流程

最后更新：2026-05-27

## 固定原则

- 所有修改都先在本地完成。
- 用户只看可访问、可操作的验收结果，不审代码。
- 每次修改后先启动本地预览给用户验收，默认地址为 `http://localhost:5001`。
- 用户明确确认本地预览没问题后，才能部署生产给真实用户使用。
- 每次生产发布前都要备份到 GitHub，提交信息使用 `backup: YYYY-MM-DD 摘要`。
- 当前生产部署在腾讯云香港服务器，不再走 Vercel Preview / Production。

## 网站作用

造梦 AI 是图片素材采集与 AI 图片生产工作台。用户在 `/home` 统一完成素材采集、上传、整理、AI 生图、智能改图、彩绘提取、手动 PSD、高清+扩图和任务查看。浏览器插件负责把网页图片保存到当前账号素材库。用户通过积分使用高成本功能，失败或超时按后端规则退款。

## 图库主链路

- 本地素材上传：浏览器优先直传阿里云 OSS，再调用 `/api/upload/complete-material` 写入图库记录。
- 插件采图：插件优先直传阿里云 OSS，再调用 `/api/plugin/complete-capture` 写入图库记录。
- 插件因网页跨站限制无法直读图片时，可走 `/api/plugin/capture-image` 服务端兼容保存，但最终仍必须上传 OSS 并保存 OSS URL。
- 生产服务器不应承担素材持久化，不应把新图库文件写进 `public/` 当作正式存储。
- 上传或插件采集成功后，页面必须立即插入返回的素材记录；列表刷新只用于校准。

## 标准步骤

1. 本地修改代码。
2. 启动本地预览：`pnpm dev --port 5001`。
3. 在浏览器验证 `/login`、`/home`、`/profile`、`/plugin`、`/admin/generations`。
4. 执行 `pnpm exec tsc --noEmit --pretty false --incremental false`。
5. 执行 `git diff --check`。
6. 执行 `pnpm build`。
7. 用 `backup: YYYY-MM-DD summary` 提交并推送 GitHub。
8. 用户确认可上线后，部署到 `ubuntu@43.129.173.9:/home/ubuntu/zaomeng`。
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
- 对象存储：阿里云 OSS

## 生产发布要点

- 生产发布统一使用 `scripts/deploy-production.sh`，不要手写 `rm` / `mv` 拼路径发布。
- 发布脚本必须先在远程临时目录构建成功，再短暂停服务切换到 `/home/ubuntu/zaomeng`。
- 发布时保留生产服务器上的 `/home/ubuntu/zaomeng/.env.local`。
- 发布时保留 `/home/ubuntu/zaomeng/.coze-logs`。
- 不同步 `.git`、`node_modules`、`.next`、`.vercel`、日志、构建产物和运行生成素材。
- 生产发布失败时优先恢复 `/home/ubuntu/zaomeng-prev-*` 上一个目录，并重启 `zaomeng-web`。
- 禁止执行空变量拼出的远程路径，例如 `/home/ubuntu/$name` 在 `$name` 为空时会变成 `/home/ubuntu/`，这是生产事故级风险。

## 当前充值方式

- 自动微信/支付宝支付暂时隐藏。
- 用户在 `/profile?tab=recharge` 联系管理员微信 `Kzai-1224` 获取一次性兑换码。
- 管理员在 `/admin/generations` 的“兑换码”标签输入充值额度生成兑换码。
- 兑换码只能使用一次，后台记录会显示生成额度、积分、生成者、兑换用户和兑换时间。

## 禁止事项

- 不要跳过本地预览和用户确认直接切生产。
- 不要提交 `.env.local`、`.vercel/`、日志、构建产物或运行生成素材。
- 不要把测试账号、测试兑换码或临时数据留到生产数据库。
- 不要在用户未确认前影响生产线上用户。
- 不要恢复本地 public 作为 OSS 上传失败后的替代存储。
