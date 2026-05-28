# 造梦项目记忆文档

最后更新：2026-05-28

本文档是当前项目交接基线。旧的“备用目标、降级、回退本地/URL/模板”、旧服务器路径和 Vercel 发布说明已经失效，后续接手时以本文档为准。

## 当前结论

- 本地主项目路径：`/Users/andy/Documents/zaomeng/zaomeng/project/projects`
- 本地交接根目录：`/Users/andy/Documents/zaomeng/zaomeng`
- 生产项目路径：`/home/ubuntu/zaomeng`
- 公网入口：`https://zaomengai.icu`
- 生产服务：`zaomeng-web.service`
- 运行方式：systemd 启动 `next start`，Nginx 反代到 `127.0.0.1:5000`
- 运行配置：`/home/ubuntu/zaomeng/.env.local`
- 应用日志：`/home/ubuntu/zaomeng/.coze-logs/systemd-web.log`
- 错误日志：`/home/ubuntu/zaomeng/.coze-logs/systemd-web-error.log`
- 当前服务状态：已完成构建和重启验证，`zaomeng-web.service` 为 `active`
- 当前正式生产基线：公网入口 `https://zaomengai.icu`，服务器 `/home/ubuntu/zaomeng/.deploy-sha` 记录当前发布的 Git commit
- 当前核心原则：只有主链路；没有备用、没有降级、没有失败后换路；失败要明确失败并按积分规则补偿
- 当前发布原则：先本地预览给用户验收，再备份 GitHub，最后部署腾讯云香港生产服务器
- 当前数据原则：后续优化尽量不动生产数据；排查生产问题先只读查询，任何修复性写入必须先得到用户确认

## 网站作用

造梦 AI 是图片素材采集、素材管理和 AI 图片生产工作台。它面向需要批量处理商品图、参考图、彩绘稿和手机壳/周边图案素材的用户，核心体验集中在 `/home`：

- 用浏览器插件从网页采集图片到当前账号素材库
- 本地上传、拖拽上传、收藏、分组、预览和管理素材
- 基于选中素材执行 AI 生图、智能改图、彩绘提取、手动 PSD、高清+扩图、高清放大
- 在任务中心查看处理进度、失败原因、退款结果和下载入口
- 用积分计费高成本功能；自动支付暂时隐藏，当前使用管理员生成的一次性兑换码充值

## 图库和插件存储原则

图库是本项目的核心能力。当前约定必须保持：

- 新上传素材默认由浏览器直传阿里云 OSS，服务端只签发上传凭证、校验对象存在、写入 `captured_images` 元数据。
- 插件采图默认由插件读取图片并直传阿里云 OSS，再调用服务端完成入库。
- 插件遇到跨站图片读取限制时，可走服务端兼容保存，但服务端也只能下载远程图片后上传 OSS，再写入数据库 URL；不得改成本地 `public/` 持久存储。
- 数据库只保存素材 URL、来源页面、分组、收藏等元数据，不保存图片二进制。
- AI 生成结果、订单结果原图和订单缩略图都必须上传 OSS；服务器不保存结果图片，不把 `public/` 当正式存储。
- 新订单成功时会用结果 buffer 生成一张 512px WebP 缩略图，上传到 OSS `thumbnails/...`，并把 `thumbnailUrl` 写入订单 `requestParams`。
- 旧订单没有 `thumbnailUrl` 时，只允许走一次兼容缩略图生成：生成 WebP 后上传 OSS 并写回订单，之后接口直接返回 OSS 缩略图。
- 前端收到上传或插件采集成功返回的 `material` 后必须立即插入图库；慢列表刷新只作为校准，不应要求用户手动刷新才能看到图片。
- OSS 图片首次读取偶发失败时前端会自动短间隔重试，不应立刻显示“图片不可用”。
- 上传刷新中断后，前端会用 sessionStorage 记录未完成 OSS key，并在重新进入页面后尝试补完成入库。

## 页面加载和同步逻辑

`/home` 的主界面由 `src/components/QuickCreatePage.tsx` 驱动，当前页面加载分为三条并行链路：

- 用户信息：`UserContext` 调 `/api/auth/refresh` 和 `/api/user/profile` 保持顶部头像、积分和管理员状态同步。
- 图库列表：进入图库视图时调用 `/api/plugin/captured-images`，按 `scope`、日期、文件夹和分页 `limit/offset` 加载；初次加载显示“素材加载中”，后续“加载更多”只追加新页，不清空已加载内容。
- 订单结果：进入订单视图或任务状态变化时调用 `/api/task/orders` / `/api/user/transactions` 相关链路刷新订单卡片；右侧 `TaskHistory` 展开时也会主动拉取数据库记录。

图库显示方案：

- 图片实际存储在阿里云 OSS，数据库 `captured_images` 只保存签名 URL、来源、分组、收藏和时间等元数据。
- 前端先按瀑布流尺寸渲染缩略图，图片加载失败时会用短间隔重试；不要把首次 OSS 慢响应直接当成素材失败。
- 缩略图大小由本地 `material-library:thumbnail-size` 保存，页面刷新后沿用用户上次选择。
- 上传和插件采集成功后，后端返回完整 `material`，前端用 `prependUploadedMaterials` 立即插入当前图库；之后的列表刷新只负责校准总数和排序。
- 订单记录里的小图优先使用订单 `requestParams.thumbnailUrl` 中已保存的 OSS WebP 缩略图，避免加载 2K/4K 原图。
- 普通小图缺少持久化缩略图时可走 `/api/image/thumbnail-url` 获取 OSS 图片处理签名 URL；旧的大图订单可走 `/api/image/thumbnail-proxy` 兼容生成一次并回写 OSS 缩略图。
- 订单记录下载按钮优先走 `/api/image/download-url` 生成 OSS 附件下载签名 URL，浏览器直接从 OSS 下载大图；非 OSS 图片再回退到 `/api/image/download` 同源代理。
- 订单记录点击缩略图的大图预览使用普通 `img` 和 `object-contain`，保持原图比例完整显示。
- 图库“订单结果”只显示成功或部分成功且有真实结果图的订单；失败、超时、处理中和无结果图订单不作为图片卡展示。

上传/采集状态方案：

- 本地上传先压缩大图但不改变像素尺寸，再优先走 `/api/upload/oss-policy` 浏览器直传 OSS，最后调 `/api/upload/complete-material` 入库。
- 插件采图优先由插件直传 OSS，再调 `/api/plugin/complete-capture` 入库；跨站限制下才走 `/api/plugin/capture-image` 服务端兼容保存。
- 上传过程中会在图库位置显示占位卡片，状态包括准备中、上传中、已上传、写入图库、恢复中、失败。
- 页面刷新或关闭导致直传完成但入库未确认时，sessionStorage 会记录未完成 OSS key；重新进入页面后自动调用完成入库，用户也可以点击“重试入库”。

## 目录交接

`/Users/andy/Documents/zaomeng/zaomeng` 是本地造梦项目交接根目录。生产服务器只运行 `/home/ubuntu/zaomeng`。

- `project/projects/`：Next.js 主应用，也是 Git 工作区
- `project/projects/docs/project-memory.md`：本文档，当前主记忆文件
- `HANDOFF.md`：顶层交接入口，给下一位接手者先读
- `deployment/nginx-default-zaomeng.conf`：归档的 Nginx 反代配置
- `tools/runninghub/`：已归档 RunningHub、PSD、图层分离调试脚本
- `assets/brand/`：品牌图片和 Logo 原始素材
- `assets/references/`：项目参考图和历史样张
- `assets/samples/caihuitiquyangben/`：彩绘提取样本资料
- `archive/docs/`：历史迁移/重构文档，只作参考
- `archive/log-snapshots/`：大日志清理前保留的最近日志片段

不要再从旧的 `/home/ubuntu/Downloads/zaomeng`、`/tmp/opencode` 或 Vercel 配置里找当前生产入口；当前以本地 Git 工作区和腾讯云香港 `/home/ubuntu/zaomeng` 为准。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript 5
- Tailwind CSS 4
- pnpm
- MySQL + Drizzle ORM
- Redis
- 阿里云 OSS 香港区域
- Psydo OpenAI-compatible 图像编辑接口
- Coze workflow 仅保留历史兼容代码；新彩绘提取主链路不走 Coze 去背景或镂空模式
- RunningHub，用于高清放大、PSD 分层等流程

## 产品入口

- `/home`：素材库和所有图片加工的主入口
- `/login`：登录
- `/profile`：个人中心和积分入口
- `/profile?tab=recharge`：积分兑换码入口
- `/plugin`：浏览器采图插件下载页
- `/admin/generations`：管理员订单/生成记录、用户管理、兑换码后台
- `/terms`：用户服务协议
- `/privacy`：隐私政策

首页已收敛为“素材库 + 选图后加工 + 右侧任务中心”的单入口工作流。不要恢复旧的多页面工具导航模式。

## 核心能力

- 素材库：插件采图、本地上传、拖拽上传、收藏、文件夹、日期分组、删除、缩略图大小、预览
- AI生图 / 图生图：基于选中素材和用户提示词生成新图
- 智能改图：画笔/标记局部编辑，后端整理 prompt 并调用图像编辑
- 彩绘提取：从商品图中提取适合打印的平面彩绘稿
- 彩绘 PSD：用户手动点击生成，单独计费
- 高清+扩图：Psydo `gpt-image-2` 补全四周并输出 4K 长边，后台执行
- 高清放大：RunningHub 高清放大，后台执行，5 积分
- 任务中心：展示处理中、成功、失败、超时、PSD 状态和下载入口
- 插件采图：浏览器插件从网页采集图片回素材库；网站会检测插件版本并提示更新
- 积分兑换码：管理员生成一次性兑换码，用户在个人中心兑换积分

## 主链路决策

当前明确执行“主链路失败即失败”。后续不要恢复以下模式：

- 图像编辑失败后切换备用目标
- 对象存储上传失败后保存到本地 public 当替代结果
- Coze 文件上传失败后改传 URL 输入
- 彩绘提取镂空模式或 Coze 去背景分支
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
- 高清+扩图：提交后立即创建后台订单并预扣，后台只做扩图和 4K 输出，失败退款
- 高清放大：提交后立即创建后台订单并预扣 5 积分，后台调用 RunningHub 高清放大，失败退款
- 彩绘 PSD：只能用户手动触发，单独预扣，失败单独退款
- 彩绘 Clown：只能用户手动触发，单独预扣 10 积分，失败单独退款；未配置 RunningHub Clown 工作流时不扣积分

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
- 当前只走 Psydo 图生图 API，不再保留镂空模式，不再调用 Coze 去背景工作流
- 提交接口只做参数校验、创建订单、原子预扣积分并快速返回订单号；真实彩绘提取在后台并发执行
- 批量彩绘提取不排队，前端按短间隔提交多个订单，订单状态通过轮询刷新
- 失败或超时订单标记失败/超时并退款；失败订单保留在右侧订单记录用于重试和删除，但不显示在图库订单结果页
- 新订单不会自动后台生成 PSD
- 新订单的 PSD 状态初始为 `pending`
- 彩绘结果成功后，用户可在任务中心手动点击生成 PSD
- 彩绘结果成功后，用户也可在任务中心手动点击生成 Clown 彩色选区图；Clown 图基于彩绘结果图，不基于原商品图

PSD 当前要点：

- 正式入口：`POST /api/color-extraction/generate-psd`
- 实现文件：`src/app/api/color-extraction/generate-psd/handler.ts`
- 前端入口：`src/components/TaskHistory.tsx`
- PSD 生成单独收积分
- PSD 失败只退 PSD 的积分，不影响已成功的彩绘结果
- PSD 当前只基于彩绘结果图做 RunningHub 图层分解和 PSD 合成，不再读取镂空模式的额外图层

Clown 当前要点：

- 正式入口：`POST /api/color-extraction/generate-clown`
- 实现文件：`src/app/api/color-extraction/generate-clown/route.ts`
- 前端入口：`src/components/TaskHistory.tsx`
- 价格来源：`getGenerateClownPoints()`，当前固定 10 积分
- 只允许 `彩绘提取` / `彩绘提取2` 成功订单调用
- 已生成过 `clownUrl` 的订单重复点击直接返回已有图，不重复扣积分
- RunningHub 配置变量：`RUNNINGHUB_CLOWN_WEBAPP_ID`、`RUNNINGHUB_CLOWN_IMAGE_NODE_ID`、`RUNNINGHUB_CLOWN_IMAGE_FIELD_NAME`，可选 prompt 节点变量为 `RUNNINGHUB_CLOWN_PROMPT_NODE_ID`、`RUNNINGHUB_CLOWN_PROMPT_FIELD_NAME`
- 未配置 Clown 工作流时接口返回“Clown 分割工作流未配置”，不扣积分
- RunningHub 输出 PNG 会原样以 `image/png` 上传 OSS，避免 JPEG 压缩破坏 PS 选区所需的纯色块；订单列表另存一张 WebP 缩略图到 `clownThumbnailUrl`
- Clown 失败、超时、无输出或 OSS 上传失败只退款 Clown 积分，不影响原彩绘结果和 PSD 状态

## 智能改图流程

智能改图是“前端选图和标记 + 后端 prompt agent + 图像编辑模型 + OSS 持久化 + 订单记录”的链路：

- 前端入口在 `src/components/LocalEditPanel.tsx` 和 `src/components/QuickCreatePage.tsx`，用户从图库或订单结果中选择 1 张图进入智能改图。
- 标记识别入口是 `POST /api/smart-edit/identify`，实现位于 `src/app/api/smart-edit/identify/handler.ts`。前端保留预识别 `prewarm`，实际识别会发送更小的 JPEG 裁切图，当前超时控制为 16 秒。
- prompt 组合入口是 `POST /api/material-editor/compose-prompt`，核心逻辑在 `src/lib/materialEditorPrompt.ts`。Prompt Agent 失败时直接失败，不返回模板提示词。
- 正式提交入口是 `POST /api/material-editor`，智能改图会创建订单、记录 requestParams、预扣积分，然后后台执行编辑任务。
- 后台任务调用 `composePromptFromImage` 形成最终提示词，再通过 `src/lib/psydoImageEdits.ts` 调主图像编辑接口；当前没有备用模型目标。
- 编辑结果下载成 buffer 后上传阿里云 OSS，订单 `resultData` 保存最终 OSS URL，同时生成 WebP 缩略图上传 OSS 并保存到 `requestParams.thumbnailUrl`。AI 生图和智能改图结果只进入订单记录，不自动写入图库。
- 成功后通过 `taskHistoryUpdated` 和订单轮询刷新右侧任务中心；失败、超时、上传失败或结果缺失时，订单标记失败并按预扣规则退款。
- 当前 mask 仍以 base64 JSON 提交，Nginx 已放宽 `/api/material-editor` 请求体；长期建议改 multipart 或先上传 mask 到 OSS。

## 关键代码索引

主应用：

- `src/app/home/page.tsx`：首页入口
- `src/components/QuickCreatePage.tsx`：素材库、AI生图、彩绘提取、高清+扩图、高清放大入口
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
- `src/app/api/image/download/route.ts`：订单记录同源下载代理，解决浏览器直连 OSS 的 CORS 下载问题
- `src/app/api/image/download-url/route.ts`：OSS 附件下载签名 URL，订单和图库下载优先使用，避免服务器中转大图
- `src/app/api/hd-upscale/run/route.ts`：高清放大入口，RunningHub 放大结果上传 OSS
- `src/lib/localUploadStorage.ts`：本地素材文件读取/历史文件能力，不作为失败替代存储
- `src/app/api/material-file/[...path]/route.ts`：历史本地素材文件读取

上传与插件：

- `src/app/api/upload/file/route.ts`：文件上传
- `src/app/api/upload/oss-policy/route.ts`：浏览器/插件 OSS 直传凭证
- `src/app/api/upload/complete-material/route.ts`：本地素材直传后入库
- `src/app/api/upload/image/route.ts`：data URL 图片上传
- `src/app/api/upload/buffer/route.ts`：buffer 上传
- `src/app/api/plugin/complete-capture/route.ts`：插件 OSS 直传后入库
- `src/app/api/plugin/capture-image/route.ts`：插件服务端兼容保存，仍上传 OSS 后入库
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
- `POST /api/color-extraction/generate-clown`
- `POST /api/outpaint-upsampling/run`
- `POST /api/upload/oss-policy`
- `POST /api/upload/complete-material`
- `POST /api/plugin/complete-capture`
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

## 本地开发和验收方式

接手者必须按这个顺序工作：

1. 只在本地 Git 工作区修改代码：`/Users/andy/Documents/zaomeng/zaomeng/project/projects`。
2. 启动本地预览给用户验收，默认端口 `5001`，不要直接改生产。
3. 用户只看本地预览结果，不看代码；验收没问题后才能进入生产发布。
4. 生产发布前先跑类型检查、空白字符检查、构建检查。
5. 检查通过后提交并推送 GitHub，提交信息用 `backup: YYYY-MM-DD 摘要`。
6. GitHub 备份完成后，再部署到腾讯云香港生产服务器。

本地命令：

```bash
cd /Users/andy/Documents/zaomeng/zaomeng/project/projects
pnpm dev --port 5001
pnpm exec tsc --noEmit --pretty false --incremental false
git diff --check
pnpm build
```

不要用 `npm` 或 `yarn`。

## 生产服务器和发布方式

生产环境只在腾讯云香港服务器运行：

- SSH：`ubuntu@43.129.173.9`
- 应用目录：`/home/ubuntu/zaomeng`
- 服务名：`zaomeng-web`
- Next.js 端口：`127.0.0.1:5000`
- 公网域名：`https://zaomengai.icu`
- Nginx：80/443 反代到本机 5000
- 对象存储：阿里云 OSS 香港区域，生产桶 `zaomengai-hk-20260527`

发布时使用 `scripts/deploy-production.sh` 从本地 rsync 到服务器临时构建目录，排除 `.git`、`.DS_Store`、`node_modules`、`.next`、`.vercel`、`.env.local`、日志和运行生成素材。服务器上的 `/home/ubuntu/zaomeng/.env.local` 必须保留并复制到新版本目录。

发布脚本部署成功后只保留最近 1 个 `/home/ubuntu/zaomeng-prev-*` 回滚目录。当前服务器已清理为：

- 当前生产：`/home/ubuntu/zaomeng`
- 最近回滚：服务器只保留最近 1 个 `/home/ubuntu/zaomeng-prev-*` 目录，用 `ls -dt /home/ubuntu/zaomeng-prev-* | head -1` 查看

不要手动删除当前生产目录、`.env.local`、数据库文件、Redis 数据或 OSS 素材。确实需要清理时，只清理旧 release、`.DS_Store`、`.next`、日志和可重新生成的构建产物。

不要手写远程 `rm` / `mv` 拼路径发布。所有远程发布路径必须先通过脚本里的 guard 检查，避免空变量把 `/home/ubuntu/$name` 拼成 `/home/ubuntu/`。

生产检查命令：

```bash
ssh ubuntu@43.129.173.9
cd /home/ubuntu/zaomeng
systemctl is-active zaomeng-web.service
curl -fsSI http://127.0.0.1:5000/
curl -fsS http://127.0.0.1:5000/api/plugin/version
```

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

本地浏览器测试优先使用 Codex in-app browser 或 Chrome。生产发布后必须用公网域名再做一次 smoke。

当前最近验证结果：

- `pnpm exec tsc --noEmit --pretty false --incremental false`：通过
- `git diff --check`：通过
- `pnpm build`：通过
- `scripts/deploy-production.sh`：已执行
- `systemctl is-active zaomeng-web.service`：`active`
- `https://zaomengai.icu/home`：HTTP 200
- `https://zaomengai.icu/api/plugin/version`：返回 v0.1.9
- AI生图真实接口：已成功
- 智能改图真实接口：已成功
- 彩绘提取 full 模式真实接口：已成功
- 高清+扩图失败退款路径：已验证

最近可参考订单：

- AI生图：`AIG_REAL_1779548738411`
- 智能改图：`MD1779548832983_4622`
- 彩绘提取：`CE_REAL_1779549053077`
- 高清+扩图退款验证：`HDO-1779436077389_5588`
- 2026-05-26 本地新增验证：登录、注册接口、用户资料刷新、素材上传到阿里云 OSS、插件采图、插件版本接口、兑换码生成和兑换、管理员兑换码记录均通过
- 2026-05-27 修复插件采图和素材上传状态同步：采图接口返回完整素材记录，前端收到插件保存成功后立即插入图库并保留慢列表同步结果；图库可显示过滤补充 AVIF；上传刷新导致的中断不再记录为真实失败。生产 smoke 已验证插件采图、本地上传、图库列表可查、插件包 v0.1.7 域名配置正确。
- 2026-05-27 进一步恢复图库主链路：本地素材上传和插件采图均优先浏览器/插件直传阿里云 OSS，服务端只签名、校验和写数据库；插件包升级到 v0.1.9，补充插件采集成功/失败进度提示，修复 OSS 图片首次加载失败后必须刷新才显示的问题。本地真实验证通过：本地素材直传入库、插件直传入库、重复完成入库幂等、图库 API 可见、真实浏览器上传后即时插入、首次 OSS GET 被拦截后自动恢复、插件失败提示可见、插件下载包生产域名正确。
- 2026-05-27 生产对象存储从阿里云上海切到香港桶 `zaomengai-hk-20260527`：上海 OSS 在腾讯云香港服务器上多次 `ECONNRESET` / 90s timeout，香港 OSS 验证通过。生产真实 smoke 通过：本地素材直传 OSS 126ms、素材入库 118ms、插件直传 OSS 28ms、插件入库 20ms、旧插件服务端兼容采集 452ms；AI 生图成功写入香港 OSS；智能改图成功写入香港 OSS，最终订单状态“成功”。
- 2026-05-27 本地预览修复：AI 生图和智能改图结果只保留在订单记录，不再自动写入图库；PSD 生成中的状态超过 12 分钟可重新生成，避免旧请求中断后永久卡住；右侧选图浮层改为视口定位并上下左右夹紧；AI 生图和智能改图输入区支持 Enter 提交、Shift+Enter 换行；标记识别仍保留预识别 `prewarm`，实际识别请求改用更小 JPEG 裁切图和 16 秒超时以减少等待。验证：`pnpm exec tsc --noEmit --pretty false --incremental false`、`git diff --check`、`pnpm build`、本地 5011 Playwright 浮层/Enter 检查通过。
- 2026-05-28 正式生产基线：彩绘提取改为后台并发处理，提交接口快速返回订单；取消镂空模式和 Coze 去背景分支；图库订单结果只展示成功结果图；订单记录下载改为 `/api/image/download` 同源代理；删除订单不再自动滚到失败订单；订单记录大图按比例完整显示；本地和服务器清理 `.DS_Store`、`.next`、日志和旧 release，生产只保留最近 1 个回滚目录。当前生产 commit 以服务器 `/home/ubuntu/zaomeng/.deploy-sha` 为准。

## 已完成清理

近期已完成以下主链路清理：

- `src/lib/psydoImageEdits.ts`：只保留主图像编辑目标，移除切备用目标相关行为
- `src/lib/openaiCompatible.ts`：移除备用目标环境变量读取
- `src/lib/dualStorage.ts`：对象存储只走阿里云 OSS，上传失败直接抛错
- `src/app/api/image-to-image/run/route.ts`：生成、上传、尺寸读取失败不再继续替代链路
- `src/app/api/material-editor/route.ts`：智能改图上传失败直接失败，不再写本地替代结果
- `src/app/api/color-extraction/run/handler.ts`：不再换模式、不再改传 URL、不再保留临时结果 URL
- `src/app/api/color-extraction/run/handler.ts`：取消镂空模式，只保留 Psydo 图生图 full 主链路
- `src/app/api/color-extraction/generate-psd/handler.ts`：PSD 不再读取镂空额外图层
- `src/app/api/image/download/route.ts`：新增订单记录同源下载代理
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
- 2026-05-28 清理本地 `.next`、`.DS_Store` 和空日志；服务器只保留当前 `/home/ubuntu/zaomeng` 与最近一个 `/home/ubuntu/zaomeng-prev-*` 回滚目录
- 将可复用验收脚本整理到 `scripts/verification/`
- 将大运行日志保留最近片段到 `archive/log-snapshots/` 后清空原日志文件

## 工作区注意事项

当前工作区可能存在用户或其它进程留下的脏改动，不能随手回退。

已知需要谨慎对待的路径：

- `browser-extension/zaomeng-capture/manifest.json`
- `browser-extension/zaomeng-capture/taobao-content.js`
- `package.json`
- `public/plugin-capture/`

当前正式生产基线要求本地和生产代码保持一致。后续修改前先看 `git status --short`；如只剩本次要改的文件，才开始开发。不要把本地临时调试文件、构建产物或旧运行素材混进备份提交。

除非用户明确要求，不要执行破坏性命令，例如 `git reset --hard`、`git checkout -- <file>`。

## 安全和已知风险

- 全站认证仍以客户端 `user` JSON cookie 为核心，存在伪造身份和越权风险；后续应迁移到服务端可信 session/JWT
- 管理员接口依赖同一 cookie 模型，认证改造时要一起处理
- 部分 API 仍混用 body/header/cookie 的用户标识，后续应统一 `getAuthenticatedUser(request)`
- 插件服务端兼容采图和远程图片读取必须继续复用 `src/lib/safeRemoteImage.ts`
- 智能改图 mask 仍以 base64 JSON 提交，Nginx 已放宽 `/api/material-editor` 请求体，但长期建议改 multipart 或先上传 mask
- 支付宝/微信真实支付商户参数、签名、证书、回调密钥仍未完整提供，真实商户回调验收仍阻塞

## 环境变量原则

- `.env.local` 是真实运行配置，不能外泄密钥
- `zaomeng-web.service` 通过 `/home/ubuntu/zaomeng/.env.local` 注入变量
- 文档里只记录变量用途和变量名，不记录真实值
- 当前图像编辑只使用主配置，不再配置备用图像编辑目标
- `RUNNINGHUB_API_KEY` 存在时才能跑相关流程
- `RUNNINGHUB_WATERMARK_API_KEY` 不存在时不要假设高清放大水印专用链路可用

## 充值和兑换码

- 自动微信/支付宝支付暂时隐藏，相关 API 代码保留但前端不暴露给普通用户。
- 用户充值路径是 `/profile?tab=recharge`，页面只展示管理员微信 `Kzai-1224`，不展示管理员二维码。
- 管理员路径是 `/admin/generations`，进入“兑换码”标签后输入充值额度生成一次性兑换码。
- 兑换成功后用户积分立即到账，管理员记录中会显示已兑换、兑换用户和兑换时间。
- 生图记录接口会排除 `积分充值` 交易，充值记录只在兑换码/用户交易里看，不混进生成记录。

## 合规页面

- 用户服务协议页面：`/terms`，说明服务内容、账号规则、用户内容、积分兑换、插件使用、责任限制和联系方式。
- 隐私政策页面：`/privacy`，说明账号信息、素材和创作信息、积分记录、插件采图、Cookie、本地存储、第三方处理和数据删除方式。
- 登录/注册页会显示“登录/注册即表示同意用户服务协议和隐私政策”。
- 个人中心底部保留协议和隐私政策入口。
- 当前没有正式企业主体和自动支付主体时，不要在文档里编造公司名称、客服电话或商户信息；后续主体确定后再更新协议文本。

## 插件版本和下载

- 插件下载页是 `/plugin`，当前面向用户只展示“下载最新版插件”和安装步骤，不暴露服务器、域名迁移等内部信息。
- 插件版本接口是 `GET /api/plugin/version`。
- 插件下载接口是 `GET /api/plugin/download`。
- 网站导航栏会识别插件是否连接、版本是否过旧；用户看到“插件需更新”时重新下载最新版即可。
- 如果未来换域名或服务器，对用户文案仍应保持“安装最新版插件”，不要暴露迁移细节。

## 视觉和产品偏好

- 整体视觉偏好：干净、整洁、轻量，偏 iOS Settings 风格
- 避免大卡片、重阴影、强背景、肿大的仪表盘感
- 删除重复性信息，保留必要状态和操作
- 积分展示继续使用 `PointsIconLabel` 和 `points-icon.png`
- 保留 `/profile?tab=recharge` 和现有 `RechargePanel` 充值链路
- 订单记录面板必须适配笔记本高度：展开后避开顶部导航，内部滚动，不让卡片或底部按钮溢出视口。
- 订单记录缩略图不直接拉 OSS 原图，使用 `/api/image/thumbnail-url` 生成带 OSS 图片处理参数的签名小图，降低 88px 缩略图加载体积。
- 订单记录下载必须优先走 `/api/image/download-url`，非 OSS 图片才回退 `/api/image/download`，不要恢复成前端直接 `fetch(OSS URL)` 后 blob 下载。
- 删除或清空订单记录时，刷新事件必须带 `{ highlight: false }`，避免自动滚动到其它失败订单。
- 订单记录大图预览必须完整按比例展示，不要用裁切式 `object-cover`。
- 用户侧和管理员侧工具筛选只保留当前主工具：彩绘提取、AI生图、智能改图、高清+扩图、高清放大；旧的 AI扩图、去水印记录统一显示/归类为高清+扩图。
- 高清+扩图当前价格为 30 积分，前端按钮和后端扣费都应通过 `getOutpaintUpsamplingPoints()` 读取，不要写死数字。
- 高清放大当前价格为 5 积分，前端按钮和后端扣费都应通过 `getHdUpscalePoints()` 读取，不要写死数字。

## 后续优先级

1. 补齐真实支付商户参数并做微信/支付宝回调验收
2. 全站认证改造，替换 raw `user` cookie
3. 继续观察并最终删除 `color-extraction2` 兼容路径和已失效 Coze 去背景历史代码
4. 对 AI生图、智能改图、彩绘提取、高清+扩图建立固定真实接口验收脚本
5. 优化智能改图 mask 提交方式，降低大请求体风险
6. 保持主工作台轻量化，不恢复旧多页面工具集合
