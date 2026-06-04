# AI 运维交接与高危操作清单

最后更新：2026-06-04 17:44 CST
维护人：Codex AI 运维会话

本文档给后续开发 AI / 运维 AI 每次接手前阅读。目标是避免误动生产、误回退主链路、误覆盖 GitHub 主分支、误泄露密钥或误写生产数据。

## 每次接手必须先读

按顺序阅读：

1. `/Users/andy/Documents/zaomeng/zaomeng/HANDOFF.md`
2. `/Users/andy/Documents/zaomeng/zaomeng/project/projects/AGENTS.md`
3. `/Users/andy/Documents/zaomeng/zaomeng/project/projects/docs/project-memory.md`
4. `/Users/andy/Documents/zaomeng/zaomeng/project/projects/docs/ai-ops-handoff.md`（本文档）

主应用目录：

```text
/Users/andy/Documents/zaomeng/zaomeng/project/projects
```

生产目录：

```text
/home/ubuntu/zaomeng
```

生产公网：

```text
https://zaomengai.icu
```

## 2026-06-04 已完成的运维修复

### 1. 修复 GitHub main 与生产基线分叉

修复前状态：

```text
本地 main...origin/main [ahead 18, behind 18]
本地 HEAD: 8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
origin/main: 89f2a51c6d150d41142e96cfb106f60c80cfd0e3
生产 /home/ubuntu/zaomeng/.deploy-sha: 8aa7a1f
```

结论：生产实际运行本地 `8aa7a1f` 这条 2026-06-04 生产线，而 GitHub `origin/main` 指向 2026-05-29 的实验线。

已执行：

1. 将旧 `origin/main` 备份到远端分支：

```text
backup/2026-06-04-old-origin-main-before-prod-sync
```

备份提交：

```text
89f2a51c6d150d41142e96cfb106f60c80cfd0e3
```

2. 使用 `--force-with-lease` 将 `origin/main` 对齐到当前生产基线：

```text
8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
```

修复后验证：

```text
local HEAD  = 8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
origin/main = 8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
production  = 8aa7a1f
Git ahead/behind = 0 / 0
zaomeng-web.service = active
```

### 2. 本次运维没有改业务代码

本次只做 Git 远端主分支整理和文档补充。没有修改生成、编辑、图库、积分、数据库、生产服务器运行代码。

## 当前基线

截至本文档更新时间：

```text
生产基线短 SHA：8aa7a1f
本地 main：8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
GitHub origin/main：8aa7a1f10d0304579fe235fcfaa12ddff7cab38f
旧 origin/main 备份：backup/2026-06-04-old-origin-main-before-prod-sync
```

如需确认生产基线，只读执行：

```bash
ssh -i /Users/andy/.ssh/id_ed25519_tencent_zaomeng \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new \
  ubuntu@43.129.173.9 \
  'cat /home/ubuntu/zaomeng/.deploy-sha && systemctl is-active zaomeng-web.service'
```

## 高危禁区：未经用户明确确认不得做

### Git 禁区

不得直接执行：

```bash
git reset --hard
git clean -fd
git pull --rebase
git push --force
git checkout .
```

如果必须重写远端主分支，只能在：

1. 确认生产 `.deploy-sha`
2. 备份当前远端分支
3. 用户明确确认
4. 使用 `--force-with-lease`

之后执行。

### 生产数据禁区

排查生产问题先只读。未经用户确认，不得：

- 删除或更新生产 MySQL 数据
- 批量改用户、积分、订单、兑换码
- 执行迁移接口或一次性修复脚本
- 清理生产订单
- 替换 `/home/ubuntu/zaomeng/.env.local`
- 改 Nginx、systemd、证书或防火墙配置

### 密钥与日志禁区

不得输出、提交、复制到对话中的内容：

- `.env.local` 真实值
- MySQL / Redis URL
- OSS AccessKey / Secret
- Psydo / Coze / RunningHub token
- SMTP 密码
- 充值回调密钥
- 用户密码、验证码、完整隐私数据

查看环境文件时必须只看 key 名或脱敏值。

### 产品链路禁区

本项目当前明确执行“主链路失败即失败”。不得恢复或新增：

- 图像编辑失败后切备用模型或备用 API
- OSS 上传失败后保存到本地 `public/` 当正式结果
- Coze 文件上传失败后改用 URL 输入
- 彩绘提取镂空模式或 Coze 去背景分支
- Prompt Agent 失败后返回模板提示词
- 智能识别失败后返回“所选区域”等假成功兜底
- 原图尺寸读取失败后猜默认比例继续执行
- 结果持久化失败后保留临时上游 URL 当最终结果

失败应明确失败，已预扣积分按规则退款。

### 发布禁区

不得未经用户确认直接部署生产。

必须遵守：

1. 本地修改
2. 本地验证
3. 本地预览给用户验收
4. 用户确认
5. GitHub 备份提交
6. 执行生产部署脚本
7. 生产 smoke

## 每次开始任务的安全检查

在主应用目录执行：

```bash
cd /Users/andy/Documents/zaomeng/zaomeng/project/projects
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
pnpm exec tsc --noEmit --pretty false --incremental false
git diff --check
```

如果是发布前，再执行：

```bash
pnpm build
```

注意：当前 `pnpm lint` 已知不通过，属于历史 lint debt，不是本次文档变更引入。详见“已知待修”。

## 已知待修问题

### P0 / P1 建议后续优先处理

1. 高危 API 复核与加固：
   - `/api/debug/orders`
   - `/api/migrations/add-uploaded-image`
   - `/api/user/replace-users`
   - `/api/task/clean-stucked-orders`

2. 构建期数据库初始化副作用：
   - `pnpm build` 会在页面数据收集阶段尝试连接本地 MySQL `127.0.0.1:3307`
   - 当前失败后不阻塞构建，但应改为运行期懒初始化，避免 CI/部署环境不稳定

3. `pnpm lint` 历史失败：
   - React Compiler / React Hooks 新规则错误
   - 部分 `any` 类型
   - 部分无用变量和 `<img>` 警告

4. 认证加固：
   - 当前仍有接口依赖客户端可写 `user` cookie 或 body/header userId
   - 后续应统一可信服务端 session / JWT

5. 生产日志收敛：
   - 减少生产 `console.log`
   - 脱敏邮箱、用户 ID、订单号、OSS 配置摘要、验证码等信息

## 生产部署方式

部署脚本：

```text
/Users/andy/Documents/zaomeng/zaomeng/project/projects/scripts/deploy-production.sh
```

脚本行为摘要：

- 本地跑 `tsc` 和 `git diff --check`
- rsync 源码到远端临时 release 目录
- 复制生产 `.env.local`
- 远端安装依赖、typecheck、build
- 停止 systemd
- 当前 `/home/ubuntu/zaomeng` 移到 `/home/ubuntu/zaomeng-prev-*`
- 新 release 切为 `/home/ubuntu/zaomeng`
- 启动 `zaomeng-web.service`
- 本机和公网 smoke
- 只保留一个 prev 回滚目录

发布前必须确认用户已验收本地预览。

## 回滚原则

如生产故障，先只读确认：

```bash
ssh -i /Users/andy/.ssh/id_ed25519_tencent_zaomeng -o IdentitiesOnly=yes ubuntu@43.129.173.9
systemctl is-active zaomeng-web.service
cat /home/ubuntu/zaomeng/.deploy-sha
ls -dt /home/ubuntu/zaomeng-prev-* | head -1
```

回滚会动生产目录和服务，必须先获得用户确认。

## 文档维护要求

后续每次执行以下行为后，都必须更新本文档的“变更记录”：

- 修复生产 bug
- 改部署/Git/CI 流程
- 新增或删除高危 API
- 改认证、积分、订单、存储、生成主链路
- 改生产服务器配置
- 做过生产数据写入或迁移

变更记录至少写：

- 日期时间
- 操作摘要
- 改动文件
- 验证命令和结果
- 是否部署生产
- 是否需要后续注意

## 变更记录

### 2026-06-04 18:30 CST

- 操作：本地修复 P0/P1 运维安全问题，尚未部署生产。
- 改动文件：
  - `src/app/api/debug/orders/route.ts`：生产环境禁用未鉴权 debug 订单摘要接口。
  - `src/app/api/migrations/add-uploaded-image/route.ts`：生产环境禁用直接调用迁移接口。
  - `src/app/api/task/clean-stucked-orders/route.ts`：生产环境禁用未鉴权卡单清理接口。
  - `src/app/api/user/replace-users/route.ts`：移除默认管理密钥和 Cookie 管理员兜底，仅允许显式配置 `ADMIN_SECRET_KEY` 后用 `X-Admin-Secret` 调用。
  - `src/lib/psydoImageEdits.ts`：删除图像编辑 RunningHub 备用通道，主链路失败直接失败并交由调用方退款。
  - `src/lib/app-init.ts`：`next build` / 静态生成阶段跳过数据库初始化，避免构建期连接 MySQL 或自动迁移。
- 验证：
  - `pnpm exec tsc --noEmit --pretty false --incremental false` 通过。
  - `git diff --check` 通过。
  - `pnpm build` 通过，且不再出现 `[App Init]` / MySQL `127.0.0.1:3307` 连接错误。
  - 本地 `next start -p 5001` 生产模式验证：`/api/debug/orders`、`/api/migrations/add-uploaded-image`、`/api/task/clean-stucked-orders`、`/api/user/replace-users` 均返回 403；`/login`、`/plugin`、`/terms`、`/privacy`、`/home`、`/profile`、`/api/plugin/version` 均返回 200。
- 生产部署：未部署。生产当前仍运行 `8aa7a1f`，本次修复需要用户验收后再按发布流程部署。
- 注意：构建期仍会输出阿里云 OSS 初始化摘要日志，未阻塞构建，但后续可继续收敛模块级初始化日志。


### 2026-06-04 17:44 CST

- 操作：修复 GitHub `origin/main` 与生产基线不一致问题。
- 生产基线：`8aa7a1f`。
- 旧远端 main：`89f2a51`，已备份到 `backup/2026-06-04-old-origin-main-before-prod-sync`。
- 新远端 main：`8aa7a1f10d0304579fe235fcfaa12ddff7cab38f`。
- 验证：本地 `main`、`origin/main`、生产 `.deploy-sha` 一致；`zaomeng-web.service` 为 `active`。
- 业务代码：未改。
- 生产部署：未部署，仅整理 Git 远端主分支。

### 2026-06-04 17:44 CST

- 操作：新增本文档，并在 `AGENTS.md`、顶层 `HANDOFF.md`、`docs/project-memory.md` 中增加必读引用。
- 目的：确保后续开发 AI 接手时读取高危禁区、当前生产基线、Git 整理记录和发布纪律。
- 生产部署：未部署。
