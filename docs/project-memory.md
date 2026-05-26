# 造梦项目记忆文档

最后更新：2026-05-23

本文档是当前服务器上的交接基线。旧的“备用目标、降级、回退本地/URL/模板”等说明已经失效，后续接手时以本文档为准。

## 当前结论

- 主项目路径：`/home/ubuntu/Downloads/zaomeng/project/projects`
- 交接根目录：`/home/ubuntu/Downloads/zaomeng`
- 公网入口：`http://124.223.26.206/home`
- 生产服务：`zaomeng-web.service`
- 运行方式：systemd 启动 `next start`，Nginx 反代到 `127.0.0.1:5000`
- 运行配置：`/home/ubuntu/Downloads/zaomeng/project/projects/.env.local`
- 应用日志：`/home/ubuntu/Downloads/zaomeng/project/projects/.coze-logs/systemd-web.log`
- 错误日志：`/home/ubuntu/Downloads/zaomeng/project/projects/.coze-logs/systemd-web-error.log`
- 当前服务状态：已完成构建和重启验证，`zaomeng-web.service` 为 `active`
- 当前核心原则：只有主链路；没有备用、没有降级、没有失败后换路；失败要明确失败并按积分规则补偿

## 目录交接

`/home/ubuntu/Downloads/zaomeng` 是造梦项目交接根目录，当前已归档散落文件。

- `project/projects/`：Next.js 主应用
- `project/projects/docs/project-memory.md`：本文档，当前主记忆文件
- `HANDOFF.md`：顶层交接入口，给下一位接手者先读
- `deployment/nginx-default-zaomeng.conf`：归档的 Nginx 反代配置
- `tools/runninghub/`：已归档 RunningHub、PSD、图层分离调试脚本
- `assets/brand/`：品牌图片和 Logo 原始素材
- `assets/references/`：项目参考图和历史样张
- `assets/samples/caihuitiquyangben/`：彩绘提取样本资料
- `archive/docs/`：历史迁移/重构文档，只作参考
- `archive/log-snapshots/`：大日志清理前保留的最近日志片段

不要再从 `/home/ubuntu` 根目录或 `/tmp/opencode` 旧路径找造梦脚本；已明确属于造梦的文件已归档到上面的目录。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript 5
- Tailwind CSS 4
- pnpm
- MySQL + Drizzle ORM
- Redis
- 阿里云 OSS
- Psydo OpenAI-compatible 图像编辑接口
- Coze workflow，用于彩绘提取相关历史/当前工作流能力
- RunningHub，用于高清放大、PSD 分层等流程

## 产品入口

- `/home`：素材库和所有图片加工的主入口
- `/login`：登录
- `/profile`：个人中心、充值入口
- `/profile?tab=recharge`：充值页固定入口
- `/plugin`：浏览器采图插件下载页
- `/admin/generations`：管理员订单/生成记录后台

首页已收敛为“素材库 + 选图后加工 + 右侧任务中心”的单入口工作流。不要恢复旧的多页面工具导航模式。

## 核心能力

- 素材库：插件采图、本地上传、拖拽上传、收藏、文件夹、日期分组、删除、缩略图大小、预览
- AI生图 / 图生图：基于选中素材和用户提示词生成新图
- 智能改图：画笔/标记局部编辑，后端整理 prompt 并调用图像编辑
- 彩绘提取：从商品图中提取适合打印的平面彩绘稿
- 彩绘 PSD：用户手动点击生成，单独计费
- 高清+扩图：扩图后接高清放大，后台执行
- 任务中心：展示处理中、成功、失败、超时、PSD 状态和下载入口
- 插件采图：Chromium 插件从电商页采集图片回素材库

## 主链路决策

当前明确执行“主链路失败即失败”。后续不要恢复以下模式：

- 图像编辑失败后切换备用目标
- 对象存储上传失败后保存到本地 public 当替代结果
- Coze 文件上传失败后改传 URL 输入
- 彩绘提取镂空模式失败后改跑完整模式
- Prompt Agent 失败后返回模板提示词
- 标记识别模型失败后返回“所选区域”兜底
- 原图尺寸读取失败后使用默认比例继续生成
- 结果持久化失败后保留临时模型 URL 当最终结果

当前行为要求：

- 模型失败：订单失败，已预扣积分退款
- 上传失败：订单失败，已预扣积分退款
- 参数不足：请求直接失败，不继续猜测
- 积分不足：前端拦截，后端也必须原子校验
- 用户侧错误文案保持业务化，不暴露密钥、网关、堆栈、底层模型细节

## 积分策略

所有高成本生成动作采用同一原则：前端余额前置校验，后端原子预扣，失败退款。

- AI生图：提交前查余额，后端模型调用前预扣，失败/超时退款
- 智能改图：提交前查余额，后端后台任务开始前预扣，失败/超时退款
- 彩绘提取：提交前查余额，后端模型调用前预扣，失败/超时退款
- 高清+扩图：提交后立即创建后台订单并预扣，后台失败退款
- 彩绘 PSD：只能用户手动触发，单独预扣，失败单独退款

前端涉及余额同步的关键组件：

- `src/components/QuickCreatePage.tsx`
- `src/components/LocalEditPanel.tsx`
- `src/components/TaskHistory.tsx`

积分价格来源：`src/lib/pricing.ts`

## 彩绘提取和 PSD

彩绘提取当前要点：

- 正式入口：`POST /api/color-extraction/run`
- 实现文件：`src/app/api/color-extraction/run/handler.ts`
- 前端入口：`src/components/QuickCreatePage.tsx`
- 新订单不会自动后台生成 PSD
- 新订单的 PSD 状态初始为 `pending`
- 彩绘结果成功后，用户可在任务中心手动点击生成 PSD

PSD 当前要点：

- 正式入口：`POST /api/color-extraction/generate-psd`
- 实现文件：`src/app/api/color-extraction/generate-psd/handler.ts`
- 前端入口：`src/components/TaskHistory.tsx`
- PSD 生成单独收积分
- PSD 失败只退 PSD 的积分，不影响已成功的彩绘结果
- 镂空模式会保存 `psdAdditionalImageUrl` 给后续 PSD 使用

## 关键代码索引

主应用：

- `src/app/home/page.tsx`：首页入口
- `src/components/QuickCreatePage.tsx`：素材库、AI生图、彩绘提取、高清+扩图入口
- `src/components/LocalEditPanel.tsx`：智能改图入口
- `src/components/TaskHistory.tsx`：任务中心和 PSD 手动生成入口
- `src/components/Navbar.tsx`：顶部账号、插件状态、头像、积分展示
- `src/components/PointsIconLabel.tsx`：积分图标展示

生成和编辑：

- `src/app/api/image-to-image/run/route.ts`：AI生图/图生图
- `src/app/api/material-editor/route.ts`：裁切、标注、智能改图统一入口
- `src/app/api/smart-edit/identify/handler.ts`：智能改图标记识别
- `src/app/api/material-editor/compose-prompt/route.ts`：智能改图 prompt 组合入口
- `src/lib/materialEditorPrompt.ts`：智能改图 prompt agent
- `src/lib/psydoImageEdits.ts`：图像编辑主调用封装
- `src/lib/openaiCompatible.ts`：OpenAI-compatible 主配置读取
- `src/lib/smartEditSize.ts`：AI生图和智能改图比例/尺寸工具

彩绘和 PSD：

- `src/app/api/color-extraction/run/handler.ts`：彩绘提取主实现
- `src/app/api/color-extraction/generate-psd/handler.ts`：PSD 手动生成
- `src/lib/color-extraction-api/cozeWorkflows.ts`：Coze workflow 调用
- `src/lib/layer-decomposition/`：PSD 图层分解映射
- `src/lib/psd-generator/`：PSD 合成
- `src/lib/runningHub.ts`：RunningHub 通用调用
- `src/lib/runningHubWatermark.ts`：高清放大 RunningHub 调用

存储和下载：

- `src/lib/dualStorage.ts`：当前只走阿里云 OSS，失败直接失败
- `src/lib/aliyunOSS.ts`：OSS 上传和签名 URL
- `src/lib/safeRemoteImage.ts`：远程图片安全下载
- `src/lib/localUploadStorage.ts`：本地素材文件读取/历史文件能力，不作为失败替代存储
- `src/app/api/material-file/[...path]/route.ts`：历史本地素材文件读取

上传与插件：

- `src/app/api/upload/file/route.ts`：文件上传
- `src/app/api/upload/image/route.ts`：data URL 图片上传
- `src/app/api/upload/buffer/route.ts`：buffer 上传
- `src/app/api/plugin/capture-image/route.ts`：插件采图入库
- `src/app/api/plugin/download/route.ts`：动态打包插件 zip
- `browser-extension/zaomeng-capture/`：插件模板

订单和用户：

- `src/storage/database/transactionManager.ts`：订单/交易管理
- `src/storage/database/userManager.ts`：用户和积分管理
- `src/storage/database/capturedImageManager.ts`：素材记录管理
- `src/storage/database/materialFolderManager.ts`：素材文件夹管理
- `src/storage/database/shared/schema.ts`：数据库 schema

## API 现状

当前前端应优先使用这些正式路径：

- `POST /api/image-to-image/run`
- `POST /api/material-editor`
- `POST /api/smart-edit/identify`
- `POST /api/color-extraction/run`
- `POST /api/color-extraction/generate-psd`
- `POST /api/outpaint-upsampling/run`
- `POST /api/plugin/capture-image`
- `GET /api/plugin/captured-images`
- `GET /api/task/orders`
- `GET /api/task/check`
- `GET /api/user/profile`

历史兼容路径仍存在时，只用于兼容旧流量，不要给新前端接入：

- `/api/color-extraction2/workflow`
- `/api/color-extraction2/generate-psd`
- `/api/color-extraction2/identify`

删除兼容路径前必须观察 Nginx `access.log*` 和 `.coze-logs/systemd-web.log`，确认旧路径没有真实命中。

## 部署命令

所有命令在主项目目录执行：

```bash
cd /home/ubuntu/Downloads/zaomeng/project/projects
pnpm exec tsc --noEmit --pretty false
git diff --check
pnpm build
sudo systemctl restart zaomeng-web.service
systemctl is-active zaomeng-web.service
```

不要用 `npm` 或 `yarn`。

Nginx 检查：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

日志查看：

```bash
journalctl -u zaomeng-web.service -n 100 --no-pager
```

注意：systemd journal 主要是启停日志，应用输出优先看 `.coze-logs/systemd-web.log` 和 `.coze-logs/systemd-web-error.log`。

## 验证命令

页面 smoke：

```bash
node scripts/verification/real-page-smoke.mjs
```

真实 AI生图 + 智能改图接口验收：

```bash
pnpm exec tsx scripts/verification/real-ai-smart-api-check.ts
```

浏览器测试优先用：

```bash
/snap/bin/chromium
```

当前最近验证结果：

- `pnpm exec tsc --noEmit --pretty false`：通过
- `git diff --check`：通过
- `pnpm build`：通过
- `sudo systemctl restart zaomeng-web.service`：已执行
- `systemctl is-active zaomeng-web.service`：`active`
- `/home` 页面 smoke：`consoleErrors: 0`，`failedRequests: 0`
- `/profile` 页面 smoke：`consoleErrors: 0`，`failedRequests: 0`
- AI生图真实接口：已成功
- 智能改图真实接口：已成功
- 彩绘提取 full 模式真实接口：已成功
- 高清+扩图失败退款路径：已验证

最近可参考订单：

- AI生图：`AIG_REAL_1779548738411`
- 智能改图：`MD1779548832983_4622`
- 彩绘提取：`CE_REAL_1779549053077`
- 高清+扩图退款验证：`HDO-1779436077389_5588`

## 已完成清理

近期已完成以下主链路清理：

- `src/lib/psydoImageEdits.ts`：只保留主图像编辑目标，移除切备用目标相关行为
- `src/lib/openaiCompatible.ts`：移除备用目标环境变量读取
- `src/lib/dualStorage.ts`：对象存储只走阿里云 OSS，上传失败直接抛错
- `src/app/api/image-to-image/run/route.ts`：生成、上传、尺寸读取失败不再继续替代链路
- `src/app/api/material-editor/route.ts`：智能改图上传失败直接失败，不再写本地替代结果
- `src/app/api/color-extraction/run/handler.ts`：不再换模式、不再改传 URL、不再保留临时结果 URL
- `src/lib/materialEditorPrompt.ts`：Prompt Agent 失败直接失败，不再返回模板提示词
- `src/app/api/smart-edit/identify/handler.ts`：识别失败直接失败，不再返回兜底区域
- `src/app/admin/generations/page.tsx`：移除备用目标展示字段
- `src/components/TaskHistory.tsx`：移除降级状态展示，保留 PSD pending 状态
- 上传相关路由：上传失败不再保存本地替代文件

近期已完成以下文件清理：

- 删除旧源码/仓库备份压缩包和 bundle，避免交接目录保留过期代码与潜在敏感副本
- 删除 `assets/users_rows.sql`，该文件包含历史用户邮箱和明文密码
- 删除 `scripts/replace_prod_users.py`，该脚本包含历史用户邮箱和明文密码
- 删除项目 `tmp/` 临时脚本、探针截图、旧 smoke 产物和 `/tmp/opencode` 归档
- 删除 `tsconfig.tsbuildinfo` 并在 `.gitignore` 中加入 `*.tsbuildinfo`
- 将可复用验收脚本整理到 `scripts/verification/`
- 将大运行日志保留最近片段到 `archive/log-snapshots/` 后清空原日志文件

## 工作区注意事项

当前工作区可能存在用户或其它进程留下的脏改动，不能随手回退。

已知需要谨慎对待的路径：

- `browser-extension/zaomeng-capture/manifest.json`
- `browser-extension/zaomeng-capture/taobao-content.js`
- `package.json`
- `public/plugin-capture/`

除非用户明确要求，不要执行破坏性命令，例如 `git reset --hard`、`git checkout -- <file>`。

## 安全和已知风险

- 全站认证仍以客户端 `user` JSON cookie 为核心，存在伪造身份和越权风险；后续应迁移到服务端可信 session/JWT
- 管理员接口依赖同一 cookie 模型，认证改造时要一起处理
- 部分 API 仍混用 body/header/cookie 的用户标识，后续应统一 `getAuthenticatedUser(request)`
- 插件采图和远程图片读取必须继续复用 `src/lib/safeRemoteImage.ts`
- 智能改图 mask 仍以 base64 JSON 提交，Nginx 已放宽 `/api/material-editor` 请求体，但长期建议改 multipart 或先上传 mask
- 支付宝/微信真实支付商户参数、签名、证书、回调密钥仍未完整提供，真实商户回调验收仍阻塞

## 环境变量原则

- `.env.local` 是真实运行配置，不能外泄密钥
- `zaomeng-web.service` 通过 `EnvironmentFile=/home/ubuntu/Downloads/zaomeng/project/projects/.env.local` 注入变量
- 文档里只记录变量用途和变量名，不记录真实值
- 当前图像编辑只使用主配置，不再配置备用图像编辑目标
- `RUNNINGHUB_API_KEY` 存在时才能跑相关流程
- `RUNNINGHUB_WATERMARK_API_KEY` 不存在时不要假设高清放大水印专用链路可用

## 视觉和产品偏好

- 整体视觉偏好：干净、整洁、轻量，偏 iOS Settings 风格
- 避免大卡片、重阴影、强背景、肿大的仪表盘感
- 删除重复性信息，保留必要状态和操作
- 积分展示继续使用 `PointsIconLabel` 和 `points-icon.png`
- 保留 `/profile?tab=recharge` 和现有 `RechargePanel` 充值链路

## 后续优先级

1. 补齐真实支付商户参数并做微信/支付宝回调验收
2. 全站认证改造，替换 raw `user` cookie
3. 继续观察并最终删除 `color-extraction2` 兼容路径
4. 对 AI生图、智能改图、彩绘提取、高清+扩图建立固定真实接口验收脚本
5. 优化智能改图 mask 提交方式，降低大请求体风险
6. 保持主工作台轻量化，不恢复旧多页面工具集合
