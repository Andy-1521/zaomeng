# 造梦 AI 部署验收流程

最后更新：2026-05-25

## 固定原则

- 所有修改都先在本地完成。
- 每次修改后先备份到 GitHub，方便回滚。
- 每次修改后先部署 Vercel Preview 给用户验收。
- 用户只看可访问的验收结果，不审代码。
- 只有用户明确确认预览没问题后，才能部署 Vercel Production 给真实用户使用。

## 标准步骤

1. 本地修改代码。
2. 执行 `pnpm check`。
3. 执行 `pnpm build`。
4. 用 `backup: YYYY-MM-DD summary` 提交并推送 GitHub。
5. 执行 `pnpm deploy:preview`。
6. 把 Preview URL 发给用户验收。
7. 用户确认后执行 `pnpm deploy:prod`。
8. 生产发布后检查 `/`、`/login`、`/home`、`/profile`、`/plugin`、`/admin/generations`。

## 禁止事项

- 不要跳过 Preview 直接发 Production。
- 不要提交 `.env.local`、`.vercel/`、日志、构建产物或运行生成素材。
- 不要在用户未确认预览前切换生产流量。
- 不要把本地 `MYSQL_URL` / `REDIS_URL` 部署到 Vercel Production。
