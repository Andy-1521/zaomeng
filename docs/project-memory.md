# 项目记忆文档

## 项目概览

造梦AI是一个基于 Next.js 16 的 AI 图片工作台，当前已经从“多页面工具集合”收敛为“素材库 + 选图后直接加工”的单入口工作流。

当前对外的核心能力：

- 素材库管理
- 彩绘提取
- AI生图 / 图生图
- 智能改图 / 局部编辑
- AI扩图
- 高清放大
- PSD 下载
- 插件采图
- 订单历史与任务中心

当前产品目标：

- 让用户先采集 / 上传素材，再直接在同一页面完成加工
- 保持主入口稳定在 `/home`
- 让所有任务统一进入右侧任务中心
- 让前端交互尽量顺滑，后端工作流按真实 API 逐步接入
- 所有功能以“适合生产 / 适合工厂 / 适合打印”为导向，而不是单纯做展示

## 当前目录结构

### 主应用

- `src/app/home/page.tsx`：主工作台入口
- `src/app/login/page.tsx`：登录页
- `src/app/profile/page.tsx`：个人中心 / 管理员入口
- `src/app/admin/generations/page.tsx`：管理员后台

### 核心组件

- `src/components/QuickCreatePage.tsx`：素材库主页面
- `src/components/TaskHistory.tsx`：右侧任务中心 / 历史记录
- `src/components/CropEditorPanel.tsx`：裁切工具
- `src/components/AnnotateEditorPanel.tsx`：画笔标注
- `src/components/LocalEditPanel.tsx`：智能改图（画笔 / 标记 / Agent）
- `src/components/Navbar.tsx`：顶部导航
- `src/components/Sidebar.tsx`：左侧导航
- `src/components/GlobalEventHandler.tsx`：全局事件初始化
- `src/components/ServiceWorkerRegister.tsx`：服务工作线程注册
- `src/components/ui/ImageThumbnail.tsx`：图片缩略图
- `src/components/ui/StatusBadge.tsx`：状态徽章

### 关键服务与工具

- `src/storage/database/*`：MySQL 数据层
- `src/lib/psydoImageEdits.ts`：Psydo 图像编辑封装
- `src/lib/dualStorage.ts`：对象存储上传 / 回退逻辑
- `src/lib/localUploadStorage.ts`：本地 public 回退存储
- `src/lib/color-extraction-api/*`：彩绘提取 Coze 工作流封装
- `src/lib/layer-decomposition/*`：PSD 分层逻辑
- `src/lib/psd-generator/*`：PSD 合成
- `src/lib/taskPollingManager.ts`：任务轮询管理器
- `src/lib/taskEventHandler.ts`：任务事件全局处理
- `src/lib/globalRecordManager.ts`：历史缓存 / 同步

## 当前功能清单

### 1. 素材库主链路

入口：`src/components/QuickCreatePage.tsx`

能力：

- 插件采图导入素材库
- 本地上传素材
- 整页拖拽上传
- 素材按日期分组
- 日期筛选下拉
- 收藏 / 取消收藏
- 文件夹管理
- 删除重复
- 删除所选
- 缩略图大小滑块
- 素材卡片大图预览
- 选图后出现悬浮加工按钮条
- 任务中心统一展示任务状态

悬浮加工按钮：

1. 彩绘提取
2. AI生图
3. AI扩图
4. 高清放大

编辑类按钮：

1. 裁切工具
2. 画笔标注
3. 智能改图

### 2. 彩绘提取

相关文件：

- `src/components/QuickCreatePage.tsx`
- `src/app/api/color-extraction/run/route.ts`
- `src/app/api/color-extraction/generate-psd/route.ts`

当前定位：

- 当前真实入口在素材库 `src/components/QuickCreatePage.tsx`
- 支持订单记录、智能改图、PSD 下载
- 当前彩绘提取已改为使用 Psydo `gpt-image-2`
- 固定生成参数为 `9:16 / 2K`
- 目标是将商品主图中的手机壳彩绘提取成适合工厂打印的平面稿
- 前端正式请求路径已切到 `/api/color-extraction/run` 和 `/api/color-extraction/generate-psd`
- 正式路径目录下的 `handler.ts` 已持有实际实现，旧 `color-extraction2` 路由仅保留兼容 wrapper
- `生成PSD` 已修复为统一走 `src/lib/dualStorage.ts` 回退链路，不再因为缺少 Coze 对象存储密钥而整体失败

### 3. AI生图 / 图生图

相关文件：

- `src/app/api/image-to-image/run/route.ts`
- `src/lib/psydoImageEdits.ts`
- `src/components/QuickCreatePage.tsx`

当前定位：

- AI生图已经不是前端占位，而是真实接口
- 使用 Psydo `gpt-image-2`
- 结果会写入订单和素材库
- 仍然沿用任务中心统一展示

### 4. 智能改图 / 局部编辑

相关文件：

- `src/components/LocalEditPanel.tsx`
- `src/app/api/smart-edit/identify/route.ts`
- `src/app/api/material-editor/route.ts`
- `src/app/api/material-editor/compose-prompt/route.ts`

当前定位：

- 支持画笔模式和标记模式
- Agent 会把用户输入、识别标记和约束整理成更精准提示词
- 同样走 Psydo `gpt-image-2`
- 智能改图通过 `mask_image` 进行局部编辑
- `src/app/api/smart-edit/identify/route.ts` 已改成更小的点击点 focus crop，并在裁切图上叠加红色标记，继续收紧“点哪识别哪”的准确度
- 标记模式最新交互：点击图片先生成待确认点位和候选，不再自动写入提示词；必须由用户点击候选后才插入 token
- 标记点位使用独立覆盖层取坐标，标记点和图片共用同一基准，避免鼠标点击偏移
- 提交按钮现在放在提示词输入框下方，和模式切换区分离
- 图片展示区改成更高的可滚动容器，避免大图被输入框挤压裁切
- 旧 `RedrawAnnotation` / `ColorExtraction2Page` 前端入口已下线，现网统一走 `LocalEditPanel`
- 前端正式识别路径已切到 `/api/smart-edit/identify`
- 正式识别实现位于 `src/app/api/smart-edit/identify/handler.ts`，旧 `color-extraction2/identify` 仅保留兼容 wrapper

### 5. 任务中心

相关文件：

- `src/components/TaskHistory.tsx`
- `src/lib/taskPollingManager.ts`
- `src/lib/taskEventHandler.ts`

当前职责：

- 统一展示所有加工任务
- 展示处理中 / 成功 / 失败 / 超时 / 部分成功
- 作为右侧固定信息面板
- 支持单条删除 / 清空历史 / 下载 / PSD 下载

当前最新交互原则：

- 处理中任务不能删除
- 工具筛选已改成下拉
- 列表按订单时间倒序展示，并按日期分段
- “工具”筛选放在“订单状态”筛选上方

## 当前技术架构

### 数据层

- MySQL：用户、订单、素材、文件夹、认证主数据
- Redis：验证码 / 临时状态

关键文件：

- `src/storage/database/client.ts`
- `src/storage/database/shared/schema.ts`
- `src/storage/database/userManager.ts`
- `src/storage/database/transactionManager.ts`
- `src/storage/database/capturedImageManager.ts`
- `src/storage/database/materialFolderManager.ts`
- `src/storage/database/init-db.ts`

### 对象存储与回退策略

- 主存储：Coze 对象存储
- 备份存储：腾讯云 COS
- 兜底：本地 `public/` 目录 / `api/material-file`

当前原则：

- 不依赖单一对象存储成功
- 只要生成模型成功，结果必须尽量可持久化
- 若对象存储缺 token，则自动回退本地，保证功能可用
- 腾讯云 COS 当前不能假定匿名公读，写入数据库的 COS 结果图必须使用签名 URL
- PSD 上传链路也必须走同一套回退策略，不能直接绕过到单一 Coze 存储实现

### 工作流与模型

- Psydo：`gpt-image-2`，用于彩绘提取、AI生图、智能改图
- Coze 工作流：保留历史链路和兼容逻辑
- RunningHub：用于 PSD 分层 / 生成流程

## 组件与状态关系

### 首页链路

- `HomePage` 负责整体布局
- `Navbar` 顶部展示账号、插件状态、头像、积分
- `Sidebar` 左侧导航
- `QuickCreatePage` 是素材库主工作区
- `TaskHistory` 作为右侧常驻任务中心

### 任务事件流

- `TaskPollingManager` 定期轮询后台订单状态
- `TaskHistory` 负责读数据库订单并合并本地缓存
- `taskHistoryUpdated` 事件用于触发右侧任务中心刷新
- `taskCompleted` / `taskFailed` / `taskTimeout` 用于任务状态联动

## 当前部署与发布

### 公网主入口

- `http://124.223.26.206/home`

### 服务托管

- `zaomeng-web.service`
- `next start` 由 systemd 托管
- Nginx 反代到 `127.0.0.1:5000`

### 发布规则

固定发布顺序：

1. `pnpm build`
2. `sudo systemctl restart zaomeng-web`
3. 验证 `/login`、`/`、`/home`

注意：

- 不能在构建过程中并行 restart
- 不能未验证 chunk / css 就通知验收
- 浏览器 smoke check 脚本偶发会卡在 Chromium WS 启动，但只要 `curl` 公网页面返回 200，就先按服务已上线处理并单独再做人工验收

### 图像编辑主备配置示例

当前 `zaomeng-web.service` 通过 `EnvironmentFile=/home/ubuntu/Downloads/zaomeng/project/projects/.env.local` 注入运行时变量。

如需为智能改图 / AI生图 / 彩绘提取启用图像编辑备用目标，可在 `.env.local` 中按如下方式配置占位值：

```env
OPENAI_COMPAT_BASE_URL=https://your-primary.example/v1
OPENAI_COMPAT_API_KEY=your_primary_key
OPENAI_COMPAT_IMAGE_MODEL=gpt-image-2

OPENAI_COMPAT_FALLBACK_BASE_URL=https://your-fallback.example/v1
OPENAI_COMPAT_FALLBACK_API_KEY=your_fallback_key
OPENAI_COMPAT_FALLBACK_IMAGE_MODEL=gpt-image-2
```

说明：

- fallback 变量全部缺省时，系统只使用主目标
- 单个图像编辑目标最多等待 `300000ms`
- 主目标超时后，如果 fallback 已配置，则会自动切到 fallback
- 用户侧提示统一只展示业务文案，不展示底层接口、模型或网关细节

## 当前已清理的冗余

已明确清理的旧页面 / 组件：

- `src/components/AIGeneratePage.tsx`
- `src/components/CustomPage.tsx`
- `src/components/AutoRemoveBackgroundPage.tsx`
- `src/components/RemoveBackgroundPage.tsx`
- `src/components/RemoveWatermarkPage.tsx`
- `src/components/ImageUpsamplingPage.tsx`

已清理的部分临时脚本 / 文件：

- `debug_tmall.py`
- `extractor_server.py`
- `extractor_v2.py`
- `product_image_extractor.py`
- `test-watermark.html`
- 若干 `tmp/*` 临时文件

说明：

- `public/plugin-capture/`、`public/material-editor/`、`public/color-extraction/` 这类运行时素材目录不是冗余内容，不能随便删除

## 当前开发约束

1. 首页已收敛为单入口素材库工作流，不再回到旧多页面模式
2. `AI生图` 和 `智能改图` 已经是正式可用功能，不再按占位处理
3. 任务中心必须保留，因为它是用户看进度和结果的主入口
4. 局部编辑优先使用统一的模型入口和 Agent 提示词，不再新增多条复杂分支
5. 发布前必须先确保页面正常和构建通过

## 目前优先级

1. 保持素材库主页面稳定
2. 优化智能改图 / 彩绘提取的提示词和交互
3. 优化任务中心可读性和失败可见性
4. 等用户继续提供正式 API 后，再逐步替换历史兼容逻辑

## 2026-05-08 版本记忆快照

### 项目方向

- 造梦AI当前已经明确收敛为“素材库驱动的 AI 图片工作台”，而不是松散的多工具导航站
- 核心主线是：先采集/上传素材，再在同一工作台中完成彩绘提取、智能改图、去水印、放大、PSD 下载与历史追踪
- 所有体验都围绕电商生产、工厂打样、印刷落地来设计，优先考虑结果可用性、批量流程和回溯能力

### 项目定位

- 面向有真实出图、修图、打印需求的生产型用户，而不是单纯做展示型 AI 图片试玩
- 首页固定收敛在 `/home`，素材库是总入口，任务中心是总反馈面板，局部编辑和生成能力都要回流到同一套任务与素材体系
- 当前最成熟的主业务依然是彩绘提取，其次是围绕素材加工展开的智能改图、AI 生图/图生图、去水印、高清放大

### 产品特征

- 单入口：所有能力尽量从素材库和选图后的悬浮操作条进入，减少页面跳转
- 真接口：生成、识别、局部编辑、PSD、对象存储、订单写库都优先接真实服务，不做长期占位 mock
- 强回退：对象存储失败可回退本地 `public/`，提示词整理失败可 fallback，保证主功能尽量可用
- 任务闭环：任务中心统一承接处理中、成功、失败、超时、部分成功，并作为用户查结果的主入口
- 工程导向：以可部署、可回滚、可追踪、可生产为标准，而不是只追求局部页面好看

### 当前核心功能

- 素材库：插件采图、本地上传、拖拽上传、收藏、文件夹、日期分组、删除、缩略图尺寸调整、大图预览
- 彩绘提取：订单生成、智能改图、PSD 下载、结果入库、任务中心联动
- 智能改图：画笔模式、标记模式、后端整理最终 prompt、`mask_image` 局部编辑、结果写入素材与订单
- AI 生图/图生图：基于 Psydo `gpt-image-2` 的真实生成链路，结果进入任务中心与素材库
- 其他工具：去除水印、高清放大、插件采图、用户中心、管理员后台

### 当前技术与部署特征

- 前端框架：Next.js 16 + React 19 + TypeScript 5
- 数据层：MySQL 为主，Redis 承载验证码/临时状态
- 生成与编辑：Psydo `gpt-image-2` 为主，OpenAI 兼容接口由 `src/lib/openaiCompatible.ts` 统一管理
- 对象存储：优先 Coze，对失败链路保留回退策略，避免结果丢失
- 现网部署：`zaomeng-web.service` 负责 `next start`，Nginx 反代到 `127.0.0.1:5000`，公网入口为 `http://124.223.26.206/home`

### 当前智能改图链路记忆

- `src/components/LocalEditPanel.tsx` 已收敛为当前正式的智能改图入口，支持画笔和标记两种模式
- 旧 `RedrawAnnotation` / `ColorExtraction2Page` 前端入口已删除，不再作为现网路径保留
- `src/app/api/smart-edit/identify/route.ts` 现支持 `prewarm` 预热、图片资产缓存、点击识别缓存、`sessionId` 日志串联
- `src/app/api/material-editor/route.ts` 在提交时由后端调用 `src/lib/materialEditorPrompt.ts` 生成最终 prompt，前端不再暴露 AI 整理结果
- `src/lib/materialEditorPrompt.ts` 是智能改图 prompt 整理的共享服务，负责 agent/fallback 与轻量日志，不记录敏感 prompt 内容

### 2026-05-08 本次关键更新

- 新增 OpenAI 兼容配置入口：`src/lib/openaiCompatible.ts`
- 识别链路增加预热、缓存和 `sessionId` 日志追踪，便于把“打开面板 -> 点击识别 -> 提交改图”串成一条可排查链路
- 智能改图主链路与旧重绘入口统一改为前端只提交原始用户意图，最终 prompt 由后端生成并直接走图像编辑接口
- `docs/project-memory.md` 本文档被补齐为版本级项目记忆，后续可直接作为部署、交接、回滚时的上下文基线

### 当前已知风险

- `OPENAI_COMPAT_BASE_URL/images/edits` 当前存在上游不稳定问题，已在本地与应用层双重验证中出现 `ETIMEDOUT` 与 `502 Upstream request failed`
- 该问题不属于前端交互或后端 prompt 组装链路问题，而是外部图像编辑兼容服务的可用性问题
- 浏览器自动化验收依赖的本地 Chrome 当前不可用，因此现网验收以构建、接口、服务状态和公网 HTTP 检查为主

### 回滚与发布记忆

- 当前仓库长期采用 `backup: YYYY-MM-DD ... snapshot` 风格保留可回滚节点
- 发布时必须遵守固定顺序：停服务、清理 `.next`、构建、拉起服务、验证 `/login`、`/home`
- 回滚优先使用 Git 备份快照，而不是直接依赖运行时 `public/` 目录中的素材文件

## 2026-05-11 部署与验收快照

### 本次上线范围

- RunningHub `openapi/v2` 已作为 `AI扩图` / `高清放大` 的正式调用方式
- 腾讯云 COS bucket 已确认使用 `andy-1521-1390504588`
- `src/lib/tencentCOS.ts` 已改为返回腾讯 COS 官方签名 URL，不再写不可访问的未签名直链
- `src/app/api/color-extraction/run/route.ts` 已去掉把 `workflowInputImageUrl` 持久化进 `request_params` 的做法
- `彩绘提取` 现在不会再把脆弱的本地 `color-extraction` URL 写进新订单记录

### 历史数据修复

- 已把 21 条“成功但结果图文件已丢失”的 `彩绘提取` 历史记录改成 `失败`
- 统一错误信息：`历史结果文件已清理，原始结果图无法恢复`
- 已清理 10 条失败记录中的失效 `workflowInputImageUrl`
- 已清理 4 条失败错误文案里残留的旧 `color-extraction` 本地路径
- 已批量把数据库里旧的未签名腾讯 COS URL 修正为签名 URL：
  - `transactions`：11 条
  - `captured_images`：5 条
- 当前数据库中未签名腾讯 COS URL 残留为 0

### 本次真实烟测结论

- 公网入口 `http://124.223.26.206/home` 返回 200，可直接验收
- `zaomeng-web.service` 当前状态为 `active`
- 已在现网真实跑通以下能力：
  - `AI扩图`
  - `高清放大`
  - `AI生图 / 图生图`
  - 素材编辑裁切
  - 素材编辑标注
  - 智能改图
  - `彩绘提取`
- 本次烟测成功订单可作为验收参考：
  - `RW-1778480169590_9900`：AI扩图成功
  - `HD-1778480169750_688`：高清放大成功
  - `AIG1778479499476_4343`：AI生图成功
  - `MD1778479614762_962`：智能改图成功
  - `ORD1778480295061_4313`：彩绘提取成功

### 2026-05-13 正式路径迁移与浸泡结论

- 已新增正式 API 路径：
  - `src/app/api/smart-edit/identify/route.ts`
  - `src/app/api/color-extraction/run/route.ts`
  - `src/app/api/color-extraction/generate-psd/route.ts`
- 前端已切换到上述正式路径：
  - `src/components/LocalEditPanel.tsx` -> `/api/smart-edit/identify`
  - `src/components/QuickCreatePage.tsx` -> `/api/color-extraction/run`
  - `src/components/TaskHistory.tsx` -> `/api/color-extraction/generate-psd`
- 新路径当前已完成实现层反转：正式路径目录下的 `handler.ts` 持有实际实现，旧 `color-extraction2` 路由仅保留兼容 `export { POST }`
- 当前共享实现文件为：
  - `src/app/api/smart-edit/identify/handler.ts`
  - `src/app/api/color-extraction/run/handler.ts`
  - `src/app/api/color-extraction/generate-psd/handler.ts`
- 日志审计结果显示 `color-extraction2` 的旧活跃兼容路由仍有真实命中，因此当前不能直接删除：
  - `POST /api/color-extraction2/workflow`
  - `POST /api/color-extraction2/generate-psd`
  - 历史轮转日志中也存在 `POST /api/color-extraction2/identify`
- 新正式路径空请求烟测结果：
  - `POST /api/smart-edit/identify` with `prewarm` -> `200`
  - `POST /api/color-extraction/run` with `{}` -> 已修正为缺参失败，不再误报 `500`
  - `POST /api/color-extraction/generate-psd` with `{}` -> `400` / 缺少订单号
- `src/app/api/color-extraction2/workflow/route.ts` 已修复一个低风险参数校验问题：
  - 之前会在校验前调用 `imageUrl.substring(...)`，导致空 body 误返回 `500`
  - 现已调整为先校验 `requestUserId` / `imageUrl`，再输出 `imageUrl` 日志
- 当前结论：继续保留 `color-extraction2` 兼容路由做浸泡观察；由于正式路径已经持有实现，后续确认旧路径无流量后可直接删除这 3 个兼容 wrapper
- 2026-05-13 新一轮 Nginx 日志复查结论：
  - 当前可见真实 `POST` 命中仍出现在旧兼容路径：
    - `POST /api/color-extraction2/workflow`
    - `POST /api/color-extraction2/generate-psd`
  - 历史轮转日志继续能看到 `POST /api/color-extraction2/identify`
  - 当时在 `access.log*` 中尚未观察到正式路径的真实公网 `POST` 命中：
    - `/api/smart-edit/identify`
    - `/api/color-extraction/run`
    - `/api/color-extraction/generate-psd`
  - 因此当时这 3 个 `color-extraction2` 兼容 wrapper 仍不能删除
  - 这轮实现反转上线后，服务重启窗口仍会短暂出现 `127.0.0.1:5000` 连接失败和 Nginx `502 Bad Gateway`，几秒后恢复，属于预期切换窗口
  - 重启恢复后，本机与公网首页、`/login`、`/home` 均返回 `200`，新旧 6 条 API 最小烟测均通过
  - 为了加快后续下线判断，旧兼容 wrapper 现已增加轻量命中日志：
    - `[CompatibilityRoute] legacy color-extraction2/identify hit`
    - `[CompatibilityRoute] legacy color-extraction2/workflow hit`
    - `[CompatibilityRoute] legacy color-extraction2/generate-psd hit`
  - `zaomeng-web.service` 的应用输出不进 `journalctl`，而是写入：
    - `/home/ubuntu/Downloads/zaomeng/project/projects/.coze-logs/systemd-web.log`
    - `/home/ubuntu/Downloads/zaomeng/project/projects/.coze-logs/systemd-web-error.log`
  - 后续要判断旧路径是否还有真实命中，应优先查 Nginx `access.log*` 与 `.coze-logs/systemd-web.log`，不要只看 `journalctl -u zaomeng-web`
  - 2026-05-14 复查补充：`/api/smart-edit/identify` 已经在 Nginx `access.log` 中出现真实公网 `POST` 命中，说明正式路径迁移已经至少部分承接了线上流量；但 `color-extraction2/workflow` 和 `color-extraction2/generate-psd` 的旧兼容路径是否已完全退流，仍需继续观察

### 2026-05-14 PSD 真实故障修复结论

- 真实 `POST /api/color-extraction/generate-psd` 验证曾稳定失败，报错为缺少 `COZE_ACCESS_KEY` / `COZE_SECRET_KEY`
- 根因不是 RunningHub 或 PSD 合成本身，而是 PSD 上传阶段直接调用了 Coze 对象存储实现，绕过了 `src/lib/dualStorage.ts` 的腾讯 COS 回退能力
- 已修复文件：
  - `src/app/api/color-extraction/generate-psd/handler.ts`
  - `src/app/api/color-extraction/run/handler.ts`
- 修复方式：统一改为 `uploadToCozeStorage(...)`，让手动 PSD 与自动 PSD 都走同一套双存储回退路径
- 同时补充了一个非主链路容错：
  - `src/lib/layer-decomposition/textLayerPlanner.ts`
  - 当 Coze workload identity / API key 缺失时，文字层识别直接降级为返回空候选，不再阻断整个 PSD 生成
- 修复后已完成验证：
  - `pnpm build` 通过
  - `sudo systemctl restart zaomeng-web` 后服务恢复正常
  - `curl -I http://127.0.0.1:5000/` 返回 `200`
  - 真实 API 验证脚本返回 `success: true`
  - 返回了有效的腾讯 COS 签名 `psdUrl`
  - 数据库 `transactions.psd_url` 已成功落库
  - Headless 用户流从 `TaskHistory` 点击“生成PSD”后，按钮可切换为“下载PSD”，并能打开有效链接
- 同日继续定位到第二个线上阻塞点：
  - 公网用户从浏览器点击 `POST /api/color-extraction/generate-psd` 时，Nginx 一度返回 `504 Gateway Timeout`
  - 这不是业务代码失败，而是该接口真实执行时间通常在 160-180 秒左右，超过了默认反代等待时长
  - 证据：
    - `access.log` 中存在 `POST /api/color-extraction/generate-psd ... 504`
    - 同一路径在补齐 Nginx 超时后，公网再次验证已返回 `200`
    - 直连 Node 服务的验收脚本在超时修复前后都能成功，说明核心业务链路已通，问题只在反代层
- 已追加的线上配置修复：
  - 文件：`/etc/nginx/sites-available/default`
  - 为以下两个接口单独增加：
    - `location = /api/color-extraction/generate-psd`
    - `location = /api/color-extraction2/generate-psd`
  - 增加超时：
    - `proxy_connect_timeout 30s`
    - `proxy_send_timeout 300s`
    - `proxy_read_timeout 300s`
  - 变更后已执行 `nginx -t` 和 `systemctl reload nginx`
- 修复后公网再次验收结果：
  - 公网域名直调 `POST /api/color-extraction/generate-psd` -> `200`
  - 公网域名下 Headless 前端点击 `TaskHistory` 的“生成PSD”按钮 -> 成功切换为“下载PSD”

### 删除 `color-extraction2` 兼容 wrapper 前检查清单

- 目标删除文件：
  - `src/app/api/color-extraction2/identify/route.ts`
  - `src/app/api/color-extraction2/workflow/route.ts`
  - `src/app/api/color-extraction2/generate-psd/route.ts`
- 删除前必须同时满足以下条件：
  - 前端源码中不再存在对 `color-extraction2` 路径的主动调用
  - 正式路径实现仍位于：
    - `src/app/api/smart-edit/identify/handler.ts`
    - `src/app/api/color-extraction/run/handler.ts`
    - `src/app/api/color-extraction/generate-psd/handler.ts`
  - 最近一轮浸泡观察中，Nginx `access.log*` 不再出现以下真实公网 `POST` 命中：
    - `POST /api/color-extraction2/identify`
    - `POST /api/color-extraction2/workflow`
    - `POST /api/color-extraction2/generate-psd`
  - 最近一轮浸泡观察中，`.coze-logs/systemd-web.log` 不再出现以下兼容命中日志：
    - `[CompatibilityRoute] legacy color-extraction2/identify hit`
    - `[CompatibilityRoute] legacy color-extraction2/workflow hit`
    - `[CompatibilityRoute] legacy color-extraction2/generate-psd hit`
  - 同期能够观察到正式路径至少有一轮真实请求承接证据，优先看 Nginx `access.log*` 中以下路径：
    - `POST /api/smart-edit/identify`
    - `POST /api/color-extraction/run`
    - `POST /api/color-extraction/generate-psd`
- 删除动作应保持最小化：
  - 仅删除上述 3 个兼容 wrapper 文件
  - 不改正式 handler
  - 不改前端请求路径
  - 不改历史数据兼容逻辑，例如 `toolPage === '彩绘提取2'`
- 删除前验证：
  - `pnpm build`
- 删除后发布顺序：
  - `sudo systemctl restart zaomeng-web`
  - `sudo systemctl is-active zaomeng-web`
  - `curl -I http://127.0.0.1:5000/`
  - `curl -I http://124.223.26.206/`
  - `curl -I http://124.223.26.206/login`
  - `curl -I http://124.223.26.206/home`
- 删除后 API 烟测至少执行：
  - `POST /api/smart-edit/identify` 预热 -> 期望 `200`
  - `POST /api/color-extraction/run` with `{}` -> 期望缺参失败，不应 `500`
  - `POST /api/color-extraction/generate-psd` with `{}` -> 期望缺少订单号
- 删除后的重点观察项：
  - Nginx `access.log*` 中是否出现旧路径 `404`
  - 用户侧是否反馈彩绘提取、智能改图识别或 PSD 下载突然失效
  - `.coze-logs/systemd-web-error.log` 是否出现新的 route not found 或 server action 错误

### 当前重要约束

- `HEAD` 请求不能用于判断腾讯 COS 结果图是否可访问，当前应以真实 `GET` 下载结果为准
- 浏览器级自动化验收依然不稳定，当前上线验收以公网 HTTP、真实接口、落库状态和结果图可下载性为主

## 2026-05-19 插件分发、自动比例与安全检查快照

### 插件当前能力

- 站内插件下载页为 `src/app/plugin/page.tsx`，入口由 `src/components/Navbar.tsx` 的插件状态 badge 跳转到 `/plugin`
- 插件下载接口为 `src/app/api/plugin/download/route.ts`，运行时动态打包 `browser-extension/zaomeng-capture` 为 zip
- 下载接口会按当前请求 origin 动态改写插件包内站点配置：
  - `manifest.json` 的站点匹配权限
  - `background.js` 的 `WEBSITE_ORIGIN` / `WEBSITE_PATTERNS` / `isWebsiteUrl`
  - `taobao-content.js` 的 `WEBSITE_HOSTS`
  - `README.md` 的安装路径说明
- 当前支持 Chrome / Edge / Brave / Arc / 360 极速等 Chromium 家族浏览器，Firefox 与 Safari 暂未提供安装包
- 下载参数支持 `chromium` / `chrome` / `edge` / `brave` / `arc` / `360` 等别名，不同按钮使用相同 Manifest V3 插件主体
- 插件工具栏图标点击后会打开或聚焦造梦AI工作台 `/home`
- 内容脚本已增强图片命中能力，支持常见 `<img>`、`srcset`、懒加载 data 属性、`picture` 结构和背景图识别

### 插件采集接口安全与稳定性

- 插件采集接口为 `src/app/api/plugin/capture-image/route.ts`
- 当前已增加的最小安全控制：
  - `imageType` 只允许 `main` / `detail`，非法值回退 `main`
  - 只允许 `http:` / `https:` 图片地址
  - 拦截 localhost、私网 IPv4、私网/链路本地/组播 IPv6、组播 IPv4 地址
  - 下载前解析 DNS，并拒绝解析到私网地址的域名
  - 手动跟随最多 3 次重定向，每次重定向目标都会重新做安全校验
  - 下载超时为 `30000ms`
  - `content-length` 和实际流式读取都限制在 30MB 内
  - 拒绝非 `image/*` 响应，并暂不支持 SVG 采集
  - 本地回退存储统一使用 `saveBufferToLocalMaterialFile(...)`，不再写硬编码绝对路径
- 当前仍需后续单独排期的架构级风险：插件 API 仍依赖未签名的 `user` JSON cookie，根治需要全站迁移到签名 session / JWT 或服务端 session

### AI生图与智能改图比例策略

- `src/lib/smartEditSize.ts` 是 AI生图与智能改图共享的比例/分辨率工具
- 当前比例选项支持 `auto`，中文显示为“自动”
- `AI生图` 请求不再把比例和分辨率拼进 prompt，而是结构化发送：
  - `aspectRatio`
  - `resolution`
  - `sourceSize`
- `src/app/api/image-to-image/run/route.ts` 会用 `sourceSize` 解析最近比例；前端未传尺寸时，后端会读取远程图片尺寸兜底
- `src/lib/psydoImageEdits.ts` 会把最终比例传给 Psydo 的 `aspect_ratio` 参数
- 模型返回后，服务端用 `sharp` 按目标宽高归一化输出尺寸
- `智能改图` 同样支持 `auto` 比例和 `1k` / `2k` / `4k` 分辨率，最终由 `src/app/api/material-editor/route.ts` 解析并落库记录

### 图像模型与环境变量

- 图像编辑主目标与备用目标继续由 `src/lib/openaiCompatible.ts` 统一读取
- 当前 `.env.local` 已使用 Psydo 兼容接口变量，文档和代码中只记录变量名，不记录 Key 原文
- 关键变量：
  - `OPENAI_COMPAT_BASE_URL`
  - `OPENAI_COMPAT_API_KEY`
  - `OPENAI_COMPAT_FALLBACK_BASE_URL`
  - `OPENAI_COMPAT_FALLBACK_API_KEY`
  - `PSYDO_API_KEY`
  - `PSYDO_FALLBACK_API_KEY`
- RunningHub Key 不再保留源码硬编码回退值，必须通过环境变量显式配置：
  - `RUNNINGHUB_API_KEY`
  - `RUNNINGHUB_WATERMARK_API_KEY`

### 低风险修复记录

- `src/app/api/image-to-image/run/route.ts` 的本地回退 URL 不再拼死 `http://124.223.26.206`，改为基于当前请求 origin 生成绝对 URL
- `src/app/api/plugin/capture-image/route.ts` 不再使用 `/home/ubuntu/Downloads/.../public` 硬编码路径
- 源码检索已清空旧公网 IP 与硬编码 RunningHub Key 的直接引用

### 全站检查结论

- P0：当前全站认证模型仍以客户端可写的 `user` JSON cookie 为核心，多处 API 直接信任 cookie / body / header 中的用户标识，存在伪造身份与越权风险
- P0：管理员接口也基于同一 cookie 模型判断身份，若 cookie 可伪造，管理员权限判断会被连带影响
- P1：上传、素材、订单、插件列表等接口需要统一收口到服务端可信 session 后再逐项补授权校验
- P1：外部 URL 下载类能力需要继续复用 SSRF 防护策略，不应在各接口内重复裸 `fetch`
- P2：错误响应应继续保持用户友好，不向用户暴露底层 API、网关、模型、堆栈或密钥配置细节

### 后续建议

- 单独排期全站认证改造：引入签名 session / JWT / 服务端 session，并逐步替换所有读取 raw `user` cookie 的 API
- 建立统一 `getAuthenticatedUser(request)` 和 `requireAdmin(request)` helper，避免每个 route 自己解析 cookie
- 建立统一远程资源下载 helper，默认包含协议限制、DNS 私网拦截、重定向复检、timeout、content-type 与大小限制
- 插件真实浏览器自动化仍受当前环境缺少 X server / headful Chromium 限制，最终安装链路建议用人工 Chrome / Edge / Brave 各跑一遍

### 备份仓库操作记忆

- 备份仓库用途是保存“已验证、可部署、可回滚”的代码版本，不是把服务器当前目录所有文件都上传
- 远端仓库：`git@github.com:Andy-1521/zaomeng.git`
- 当前主分支：`main`
- 最近备份提交风格：`backup: YYYY-MM-DD ... snapshot`
- 2026-05-19 已推送备份提交：`a13e933 backup: 2026-05-19 plugin and image workflow snapshot`
- 服务器上可用的 GitHub SSH key 不是默认文件名：`/home/ubuntu/.ssh/id_ed25519_andy_1521`
- 该 key 的公开指纹：`SHA256:v/k3z55UbXatQa+1Go3f+lx0TYPhrD1wZ0VmpDNmbXA Andy-1521-backup`
- 普通 `git push origin main` 可能失败，因为当前 shell 没有 ssh-agent，且 SSH 默认不会自动使用这个非默认 key
- 推送备份时使用一次性命令，不要改全局 git 配置：

```bash
GIT_SSH_COMMAND='ssh -i "/home/ubuntu/.ssh/id_ed25519_andy_1521" -o IdentitiesOnly=yes' git push origin main
```

- 备份提交应纳入：
  - `src/` 代码
  - `browser-extension/` 插件模板
  - 必要配置文件，例如 `package.json`、`eslint.config.mjs`、`.env.local.example`
  - 必要公开静态代码，例如 `public/sw.js`
  - 必要项目文档，例如 `docs/project-memory.md`、`AGENTS.md`
- 备份提交不应纳入：
  - 真实 `.env.local`
  - `.next`、`tsconfig.tsbuildinfo` 等构建缓存
  - `tmp/`、`/tmp/opencode`、下载测试 zip、临时冒烟脚本
  - `public/plugin-capture/`、`public/ai-generate/`、`public/material-editor/`、`public/uploads/` 等运行时素材和用户生成文件
  - 日志、数据库 dump、真实密钥、第三方 token
- 提交前固定检查：
  - `git status --short`
  - `git diff --cached --name-only`
  - `git diff --cached --check`
  - 确认 staged 清单没有运行时素材、临时文件、真实环境变量或密钥

### API 路由索引说明

- 以下索引记录当前代码的真实行为，不代表接口已经完成理想鉴权
- “主调用”优先写当前前端或插件中能看到的调用点；未看到直接调用的接口会标为手工、兼容或调试用途
- 多数旧接口仍存在是为了兼容历史数据或旧调用路径，新增前端不要继续接入旧路径
- 当前 P0 风险仍是 raw `user` JSON cookie 和 body/header `userId` 混用，后续应统一到服务端可信 session

### API 索引：认证与用户

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | 邮箱密码登录并写入 `user` cookie | 登录页 | `email`, `password` | 无登录要求；当前密码按明文比对；cookie 有效期 7 天 |
| POST | `/api/auth/register` | 邮箱验证码注册并自动登录 | 登录页 | `verifyCode`, `email`, `username`, `password` | 无登录要求；验证码有效后创建用户，初始 100 积分 |
| POST | `/api/auth/refresh` | 刷新当前登录 cookie | 首页、个人中心、管理页刷新会话 | `userId` | 需要已有 `user` cookie，且 cookie 内 `id` 等于 body 的 `userId` |
| POST | `/api/auth/send-email` | 发送邮箱验证码 | 登录/注册/找回密码 | `email` | 无登录要求；验证码约 5 分钟有效；mock 模式会返回验证码 |
| POST | `/api/auth/send-sms` | 发送短信验证码 | 当前前端未见稳定调用 | `phone` | 无登录要求；依赖短信配置；mock 模式会返回验证码 |
| POST | `/api/auth/reset-password` | 用验证码重置密码 | 找回密码 | `email`, `verifyCode`, `newPassword` | 无登录要求；验证码成功后更新密码并删除验证码 |
| GET | `/api/user/profile` | 读取用户资料和积分 | `UserContext`、首页积分校验、个人中心 | query `userId` 或 cookie | 查他人时要求与 cookie 一致；头像为空时回默认图 |
| POST | `/api/user/update-username` | 修改用户名 | 个人中心 | `userId`, `newUsername` | 当前无强 session 归属校验；后续需补 |
| POST | `/api/user/update-password` | 修改密码 | 个人中心 | `userId`, `oldPassword`, `newPassword` | 当前无强 session 归属校验；旧密码明文比对 |
| POST | `/api/user/update-avatar` | 上传并更新头像 | 个人中心 | FormData `userId`, `file` | 当前无强 session 归属校验；限制常见图片类型和 5MB；对象存储失败回退本地 |
| GET | `/api/user/users` | 管理端读取用户列表 | 管理后台用户列表 | `keyword` | 需要管理员 cookie，并重新查库确认 `isAdmin` |
| POST | `/api/user/replace-users` | 批量替换用户表 | 手工迁移/导入 | `users[]` | 需要 `X-Admin-Secret` 或管理员 cookie；会先清空用户表，破坏性强 |

### API 索引：订单、任务与交易

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/user/transactions` | 读取用户消费/订单记录 | `TaskHistory`、个人中心 | `userId`, `limit`, `cursor` | requestedUserId 存在时需与 cookie 一致；limit 上限 200 |
| POST | `/api/user/transactions` | 扣点并创建消费记录 | 偏内部/旧链路 | `userId`, `description`, `points`, `toolPage` 等 | 无强鉴权；扣点与写记录不是完整事务 |
| POST | `/api/user/transactions/delete` | 删除单条订单历史 | `TaskHistory`、首页历史操作 | `orderNumber`, 可选 `userId` | 归属校验强度不一致，后续需统一 |
| POST | `/api/user/transactions/clear` | 清空当前用户历史 | `TaskHistory` 清空历史 | `userId` 可来自 body/query/cookie | 来源混用，后续需统一只信服务端 session |
| GET | `/api/task/orders` | 读取当前用户任务/订单列表 | `QuickCreatePage` 主页面项目区 | `userId`, `toolPage` | 需要 cookie；查询别人订单会 403；会 reconcile 处理中订单 |
| GET | `/api/task/check` | 查询单个订单状态 | `taskPollingManager` | `orderId` | 当前无登录校验；知道订单号即可查状态 |
| POST | `/api/task/clean-stucked-orders` | 清理超时处理中订单 | 运维/手工 | `userId`, `maxAgeMinutes` | 当前无登录校验；只更新状态，不退积分 |
| POST | `/api/transaction/create-pending` | 预创建处理中订单 | 内部任务链路/旧链路 | `userId`, `orderId`, `toolPage`, `description` | 无强鉴权；`orderId` 实际写入订单号 |
| POST | `/api/transaction/create` | 幂等创建订单 | 内部任务链路/旧链路 | `userId`, `orderNumber`, `toolPage` 等 | 无强鉴权；重复订单直接返回已有记录 |
| GET | `/api/transaction/[orderNumber]` | 查询单个订单详情 | 调试/旧链路 | 路径参数 `orderNumber` | 当前无登录校验；知道订单号即可查 |
| POST | `/api/transaction/update` | 更新订单状态/结果 | 旧任务更新链路 | `orderId`, `updateData` | 当前无强鉴权；可更新多个字段，后续需收口 |

### API 索引：素材库、文件夹与上传

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/plugin/captured-images` | 读取素材库图片记录 | `QuickCreatePage` 素材库加载 | cookie | 需要 `user` cookie；会过滤明显视频扩展 |
| DELETE | `/api/plugin/captured-images` | 删除单条素材记录或清空素材记录 | `QuickCreatePage` 删除/清空/去重 | `id` 或 `clearAll` | 只删数据库记录，不删对象存储或本地实际文件 |
| POST | `/api/plugin/capture-image` | 插件把远程图片保存到当前账号素材库 | 浏览器插件 `background.js` | `imageUrl`, `pageUrl`, `pageTitle`, `sourceHost`, `imageType` | 需要 `user` cookie；已有 SSRF/大小/超时/重定向防护；不支持 SVG |
| GET | `/api/material-folders` | 获取素材文件夹列表 | `QuickCreatePage` 文件夹管理 | cookie | 需要 `user` cookie |
| POST | `/api/material-folders` | 创建素材文件夹 | `QuickCreatePage` 文件夹管理 | `name` | 用户内名称唯一；最长 80 |
| PATCH | `/api/material-folders` | 重命名素材文件夹 | `QuickCreatePage` 文件夹管理 | `id`, `name` | 只允许当前用户自己的文件夹 |
| DELETE | `/api/material-folders` | 删除素材文件夹 | `QuickCreatePage` 文件夹管理 | `id` | 删除前把素材移到未分类，不删图片文件 |
| POST | `/api/materials/update` | 批量移动素材/收藏/取消收藏 | `QuickCreatePage` 收藏和批量移动 | `ids`, `folderId`, `isFavorite` | 需要 cookie；只更新当前用户素材；校验文件夹归属 |
| POST | `/api/upload/file` | multipart 文件上传到对象存储/本地回退，可选建素材记录 | 首页本地上传、AI 参考图上传 | FormData `file`, `folder`, `createMaterial`, `materialFolderId` | 上传本身未强制登录；`createMaterial=true` 时需 cookie 才建素材记录 |
| POST | `/api/upload/buffer` | 上传 base64 buffer 到对象存储/本地回退 | `imageUploader.uploadBuffer` | FormData `buffer`, `fileName`, `contentType`, `folder` | 当前无登录校验；服务端大小/类型限制不足；返回 debug 信息需后续收敛 |
| POST | `/api/upload/image` | 上传 data URL 图片到对象存储/本地回退 | 旧上传入口/当前少用 | `imageData`, `folder` | 当前无登录校验；不建素材记录；服务端大小限制不足 |
| GET | `/api/material-file/[...path]` | 读取本地 public 回退存储图片 | 本地回退 URL 展示 | 路径首段必须是允许根目录 | 无登录校验；只允许图片 content-type；视频扩展返回 415 |

### API 索引：彩绘提取、PSD 与智能编辑

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/color-extraction/run` | 彩绘提取主流程，生成结果图并后台尝试 PSD 分层 | `QuickCreatePage` 彩绘提取 | `userId`, `imageUrl`, `orderId`, `extractionMode` | 当前按 body `userId` 查用户和积分；成功扣 30；失败/超时不扣 |
| POST | `/api/color-extraction/generate-psd` | 给已有彩绘提取订单手动补 PSD | `TaskHistory` 的“生成PSD” | `orderNumber` | 当前未校验登录/订单所属；已有 PSD 直接返回 |
| POST | `/api/color-extraction2/workflow` | 旧兼容入口，转发正式彩绘提取 | 历史调用兼容 | 同 `/api/color-extraction/run` | 新前端不要接入；保留用于浸泡观察 |
| POST | `/api/color-extraction2/generate-psd` | 旧兼容入口，转发正式 PSD 生成 | 历史调用兼容 | 同 `/api/color-extraction/generate-psd` | 新前端不要接入；保留用于浸泡观察 |
| POST | `/api/color-extraction2/identify` | 旧兼容入口，转发智能改图识别 | 历史调用兼容 | 同 `/api/smart-edit/identify` | 新前端不要接入；保留用于浸泡观察 |
| POST | `/api/smart-edit/identify` | 智能改图标记点识别和图片预热 | `LocalEditPanel` | `action`, `imageUrl`, `clickX`, `clickY`, `imageWidth`, `imageHeight`, `sessionId` | 当前无登录校验；有图片缓存；远程下载 SSRF 防护不足，需后续复用统一 helper |
| POST | `/api/material-editor` | 素材编辑统一入口：裁切、标注、智能改图重绘 | 裁切面板、标注面板、智能改图面板 | `action`, `imageUrl`, 裁切/标注/遮罩/提示词/尺寸参数 | 需要 `user` cookie；`redraw` 成功扣 30；裁切/标注不扣 |
| POST | `/api/material-editor/compose-prompt` | 单独生成智能改图最终 prompt | 当前前端少直接调用，主流程内置 | `imageUrl`, `mode`, `instruction`, `regions`, `sessionId` | 当前无登录/积分校验；只生成 prompt，不实际改图 |

### API 索引：AI生图、扩图与缩略图

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/image-to-image/run` | AI生图/图生图，按比例和分辨率生成并入素材库 | `QuickCreatePage` AI生图面板 | `userId`, `imageUrl`, `prompt`, `aspectRatio`, `resolution`, `sourceSize`, `orderId` | 当前按 body `userId` 查用户和积分；成功扣 30；失败/超时写回订单且不扣 |
| POST | `/api/outpaint-upsampling/run` | 高清+扩图主入口，后台执行扩图和 4K 放大 | `QuickCreatePage` 高清+扩图 | `userId`, `imageUrl` | 当前不扣积分；立即返回 queued，后台更新订单 |
| POST | `/api/outpaint-upsampling-2/run` | 高清+扩图2实验/对比入口 | 当前主页面已下线，后端保留 | `userId`, `imageUrl` | 仍走同一共享 runner；不是 RunningHub `AI扩图` 降级 |
| POST | `/api/image/thumbnail` | 远程图生成 JPEG 缩略图并上传 | 当前前端少用 | `imageUrl`, `width`, `height`, `quality` | 当前无登录校验；远程下载 SSRF 防护不足 |
| POST | `/api/template/extract` | 从淘宝/天猫/拼多多链接提取商品标题和图片 | 当前前端少用/模板提取实验 | `url` | 无登录校验；通过子进程脚本执行，90 秒超时 |

### API 索引：插件下载与站点桥接

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/plugin/download` | 动态生成 Chromium 插件 zip | `/plugin` 下载按钮 | query `browser` | 无登录校验；支持 `chromium/chrome/edge/brave/arc/360`；只打包白名单文件 |
| POST | `/api/plugin/capture-image` | 插件采图入库 | 浏览器插件 | `imageUrl` 等采集信息 | 需要 cookie；服务器端下载远程图片并上传存储；已有基础 SSRF 防护 |
| GET | `/api/plugin/captured-images` | 素材库读取插件/上传/生成记录 | 首页素材库 | cookie | 需要 cookie；按当前用户返回 |
| DELETE | `/api/plugin/captured-images` | 删除或清空素材记录 | 首页素材库 | `id` 或 `clearAll` | 需要 cookie；只删记录，不删文件 |

### API 索引：管理、迁移与调试

| 方法 | 路径 | 用途 | 主要调用 | 关键输入 | 当前鉴权/注意事项 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/generations` | 管理员查看生成/订单记录和统计 | 管理后台 | `skip`, `limit`, `keyword`, `toolPage`, `status`, 日期参数 | 需要管理员 cookie 并查库确认 `isAdmin` |
| POST | `/api/admin/update-user` | 管理员修改用户积分/头像 | 管理后台用户编辑 | `userId`, `points`, `avatar` | 需要管理员 cookie |
| POST | `/api/admin/set-admin` | 设置/取消管理员 | 管理后台 | `targetUserId`, `isAdmin` | 需要管理员 cookie；可修改任意目标用户 |
| POST | `/api/migrations/add-uploaded-image` | 给订单表补 `uploaded_image` 并迁移部分历史数据 | 手工迁移 | 无 | 当前无登录校验；会执行 `ALTER TABLE`，仅手工使用 |
| GET | `/api/debug/orders` | 查看最近彩绘提取订单摘要 | 手工调试 | 无 | 当前无登录校验；只返回少量摘要 |
| POST | `/api/debug/create-test-user` | 开发环境创建测试用户 | 开发调试 | `email`, `password`, `username`, `points` | 仅开发环境；生产 403 |
| DELETE | `/api/debug/delete-test-user` | 开发环境软删除测试用户 | 开发调试 | `email` | 仅开发环境；生产 403 |

### 接口维护原则

- 新前端优先接入正式路径：`/api/color-extraction/run`、`/api/color-extraction/generate-psd`、`/api/smart-edit/identify`
- 不再为新功能接入 `color-extraction2` 兼容路径
- 不再恢复已下线的去水印、自动去背景、旧高清放大页面级入口
- 新增外部 URL 下载接口时，必须先抽统一安全下载 helper，不要复制裸 `fetch`
- 新增扣积分接口时，必须先明确“创建订单、调用模型、扣分、写结果”的失败补偿策略
- 新增管理接口时，必须使用统一管理员校验，不能只信 body/header/cookie 的用户字段
