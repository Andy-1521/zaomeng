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

4. 认证加固后续项：
   - 当前已用 `src/lib/serverAuth.ts` 签名 `user` cookie 替代服务端 raw cookie 解析。
   - 后续仍建议迁移到更完整的服务端 session / JWT，并保留积分/订单/兑换码链路的所有权校验。
   - 生产必须显式配置高强度 `AUTH_COOKIE_SECRET`；不要在生产开启 `ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true`。

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

### 2026-06-04 19:01 CST

- 操作：本地加固积分盗刷、兑换码、订单越权和上传滥用风险，尚未部署生产。
- 改动摘要：
  - 新增 `src/lib/serverAuth.ts`，统一解析/签发带 HMAC 签名的 `user` cookie；生产默认拒绝旧 unsigned JSON cookie。
  - 登录、注册、刷新、改用户名、改头像都会重新写入签名 cookie；本地 `localhost/127.0.0.1` 预览不会强制 `Secure`，生产会使用 Secure Cookie。
  - 管理员、用户资料、素材、插件、缩略图、下载、充值订单等服务端接口改为统一 `getCookieUserId(request)` / `getCookieUser(request)`，删除 raw `JSON.parse(user cookie)` 权限解析。
  - `/api/user/transactions` POST 通用扣积分接口禁用；GET 去掉 `x-user-id` 和无 cookie 查询他人记录。
  - `/api/transaction/create`、`/api/transaction/create-pending` 生产禁用。
  - `/api/transaction/update` 现在必须登录、校验订单归属，只允许客户端更新 `status` / `resultData` 白名单字段，拒绝改 points/remaining/psdUrl/requestParams。
  - `/api/transaction/[orderNumber]`、订单删除、清空历史、PSD 生成均校验登录用户拥有订单。
  - AI 生图、彩绘提取、高清放大、高清+扩图、移除背景等扣积分入口不再信任 body.userId，只使用签名 cookie 用户，body userId 不一致返回 403。
  - 兑换码兑换使用签名 cookie 用户；管理员兑换码接口使用签名 cookie + DB `isAdmin`。
  - 充值回调入账积分不再信任回调 `paidPoints` 任意值，而以已创建订单积分为准，并校验可选回调金额/积分一致性。
  - 上传接口 `/api/upload/file`、`/api/upload/buffer`、`/api/upload/image`、头像更新均要求登录；上传路径加入用户 ID 前缀；上传 500 响应不再返回 stack/debug。
  - `.env.local.example` 增加 `AUTH_COOKIE_SECRET` 示例。
- 主要改动文件：
  - `src/lib/serverAuth.ts`
  - `src/app/api/auth/login/route.ts`、`register/route.ts`、`refresh/route.ts`
  - `src/app/api/user/profile/route.ts`、`users/route.ts`、`update-username/route.ts`、`update-password/route.ts`、`update-avatar/route.ts`
  - `src/app/api/user/transactions/**`、`src/app/api/transaction/**`
  - `src/app/api/recharge/redeem/route.ts`、`orders/route.ts`、`notify/route.ts`、`src/app/api/admin/recharge-codes/route.ts`
  - `src/app/api/image-to-image/run/route.ts`、`src/app/api/color-extraction/run/handler.ts`、`src/app/api/color-extraction/generate-psd/handler.ts`
  - `src/lib/hdUpscaleRunner.ts`、`src/lib/outpaintUpsamplingRunner.ts`、`src/lib/backgroundRemovalRunner.ts`
  - `src/app/api/upload/**`、素材/插件/图片下载相关 API、`.env.local.example`
- 验证：
  - `pnpm exec tsc --noEmit --pretty false --incremental false` 通过。
  - `git diff --check` 通过。
  - `pnpm build` 通过。
  - 本地 `next start -p 5001` 生产模式 smoke：公共页 `/home`、`/login`、`/plugin`、`/privacy`、`/terms`、`/profile`、`/api/plugin/version` 返回 200（根路径 307 重定向）；未登录访问高风险积分/订单/扣费/兑换码接口返回 401/403；伪造 unsigned `user={...}` cookie 访问用户资料、交易、兑换码、管理员兑换码均被拒绝。
  - 用本机 Chrome/Puppeteer 打开 `/home`、`/login`、`/plugin`、`/privacy`、`/terms`、`/profile`，页面 200 且无 console error。
- 生产部署：未部署。只读检查发现当前生产 `.env.local` 仍缺少 `AUTH_COOKIE_SECRET`，部署前必须先补高强度随机值（可用 `openssl rand -base64 32` 生成）；`scripts/deploy-production.sh` 已加闸门，缺少该变量或开启 `ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true` 会拒绝部署。部署后旧登录态会失效、用户需重新登录。
- 高危注意：不要为了兼容旧登录态在生产设置 `ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true`；不要恢复 body/header userId 作为积分、订单、兑换码、上传或管理员权限来源。

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

### 2026-06-04 21:10 CST

- 操作：上线前全站巡检、依赖安全升级和素材删除误触保护修复。
- 背景：本地浏览器巡检首页、素材库、订单、个人中心、管理员、插件、隐私/协议页面时，发现素材卡片“删除图片”按钮存在误触直接删除风险；同时 `pnpm audit --prod` 发现 Next.js、axios、nodemailer 等生产依赖存在已知高危/中危漏洞。
- 改动摘要：
  - 升级生产依赖：`next` 16.0.10 → 16.2.7、`axios` → 1.17.0、`coze-coding-dev-sdk` → 0.7.24、`nodemailer` → 8.0.10。
  - 升级 `eslint-config-next` 到 16.2.7。
  - 将 `drizzle-kit` 从生产 dependencies 移到 devDependencies。
  - 增加 pnpm overrides：`postcss`、`qs` 使用已修复版本，确保 `pnpm audit --prod` 无已知漏洞。
  - 素材删除前端增加二次确认；单张删除、批量删除、重复图删除都会带 `confirmDelete: true`。
  - `/api/plugin/captured-images` DELETE 后端增加强制确认闸门：未携带 `confirmDelete: true` 的删除请求返回 400，不执行删除；用于防止旧前端、误请求或脚本直接删素材。
- 改动文件：
  - `package.json`
  - `pnpm-lock.yaml`
  - `src/app/api/plugin/captured-images/route.ts`
  - `src/components/QuickCreatePage.tsx`
  - `docs/ai-ops-handoff.md`
- 验证：
  - `pnpm exec tsc --noEmit --pretty false --incremental false` 通过。
  - `git diff --check` 通过。
  - `pnpm build` 通过。
  - `pnpm audit --prod` 显示 `No known vulnerabilities found`。
  - 本地 `next start -p 5001` 使用 Next 16.2.7 正常启动。
  - 浏览器巡检：`/login`、`/home`、`/plugin`、`/profile`、`/profile?tab=recharge`、`/admin/generations`、`/privacy`、`/terms` 页面加载正常且无 console error/warn。
  - 接口安全回归：未登录资料/交易/扣费/兑换/上传接口返回 401/403；伪造 unsigned user cookie 被拒绝；登录后资料接口正常；素材 DELETE 未携带 `confirmDelete: true` 返回 400 且素材总数不变。
- 生产部署：准备部署。部署前必须确保生产 `.env.local` 有非空 `AUTH_COOKIE_SECRET` 且未开启 `ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true`。部署后旧登录 Cookie 会失效，用户需要重新登录。
- 高危注意：不要移除素材删除的 `confirmDelete` 前后端双重闸门；不要恢复无确认直接删除素材；不要降级 Next.js/axios 到有已知高危漏洞的版本。

### 2026-06-04 21:30 CST

- 操作：排查“所有功能无法成功”的根因，尚未部署生产。
- 结论：基础页面、登录、素材、订单等接口正常；AI 图像类失败集中在旧 Psydo/OpenAI-compatible 图像编辑通道。
- 真实错误：旧默认 `gpt-image-2` 已不可用；改测 Psydo 当前图像模型 `gpt-image-1` / `gpt-image-1.5` 后，直连 `/images/edits` 和 `/v1/images/edits` 仍返回 `502 Upstream service temporarily unavailable`。
- 积分安全回归：测试订单失败后 `actual_points=0`，用户积分已退回。
- 本地环境：验证码/注册/找回密码依赖 Redis；本机未运行 Redis，已临时建立 SSH 隧道 `127.0.0.1:6379 -> 生产 127.0.0.1:6379` 后 Redis `PING` 正常。
- 生产注意：生产 `.env.local` 当前缺少 `AUTH_COOKIE_SECRET`，部署脚本会拒绝上线；部署前必须补高强度随机值。

### 2026-06-04 21:45 CST

- 操作：按用户要求撤掉旧 `gpt-image-2` 路线，恢复 RunningHub 图像通道。
- 新图像通道：`https://www.runninghub.cn/openapi/v2/rhart-image-n-g31-flash/image-to-image`，鉴权使用 `RUNNINGHUB_API_KEY`。
- 代码入口仍是 `src/lib/psydoImageEdits.ts`（历史命名未改），但当 `RUNNINGHUB_API_KEY` 存在时优先走 RunningHub `rhart-image-n-g31-flash`，不再先请求 Psydo/OpenAI-compatible `images/edits`。
- 覆盖范围：AI 生图、彩绘提取、智能改图、高清+扩图等所有调用 `runPsydoImageEdit*` 的功能。
- 高危注意：继续保留订单失败退款逻辑；RunningHub 失败/超时不得扣积分，订单必须标记失败或超时并回写 `actual_points=0`。

### 2026-06-04 21:55 CST

- 操作：按用户指定 curl 方案，将 RunningHub 图像通道切到 `rhart-image-n-g31-flash/image-to-image` 并做真实直连测试。
- 直连测试结果：RunningHub API 返回 HTTP 200，但业务错误：`errorCode=812`、`errorMessage=CORPAPIKEY_INSUFFICIENT_FUNDS`、`taskId=""`。
- 结论：当前 `RUNNINGHUB_API_KEY` 对应企业账户余额不足，无法创建真实图像任务；不是前端问题，也不是请求格式问题。
- 部署状态：未部署生产。用户要求“没问题就部署”，但当前外部图像通道因余额不足无法通过真实验证，不能上线承诺功能恢复。
- 后续处理：需要先给 RunningHub 账户充值，或提供有余额的 `RUNNINGHUB_API_KEY`；然后重新执行直连 RunningHub 测试和网站业务订单测试，确认订单成功、结果图回传、积分扣费正常后再部署。
