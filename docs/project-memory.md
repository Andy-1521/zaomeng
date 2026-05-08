# 项目记忆文档

## 项目概览

造梦AI是一个基于 Next.js 16 的 AI 图片工作台，当前已经从“多页面工具集合”收敛为“素材库 + 选图后直接加工”的单入口工作流。

当前对外的核心能力：

- 素材库管理
- 彩绘提取
- AI生图 / 图生图
- 局部改图 / 局部编辑
- 局部重绘
- 去除水印
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
- `src/components/ColorExtraction2Page.tsx`：彩绘提取工作页
- `src/components/CropEditorPanel.tsx`：裁切工具
- `src/components/AnnotateEditorPanel.tsx`：画笔标注
- `src/components/LocalEditPanel.tsx`：局部改图（画笔 / 标签 / Agent）
- `src/components/RedrawAnnotation.tsx`：局部重绘标注
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
3. 去除水印
4. 高清放大

编辑类按钮：

1. 裁切工具
2. 画笔标注
3. 局部改图

### 2. 彩绘提取

相关文件：

- `src/components/ColorExtraction2Page.tsx`
- `src/app/api/color-extraction2/workflow/route.ts`
- `src/app/api/color-extraction2/redraw/route.ts`
- `src/app/api/color-extraction2/regenerate/route.ts`
- `src/app/api/color-extraction2/identify/route.ts`

当前定位：

- 这是项目里最完整、最成熟的核心业务页
- 支持订单记录、局部重绘、重新生成、PSD 下载
- 当前彩绘提取已改为使用 Psydo `gpt-image-2`
- 固定生成参数为 `9:16 / 2K`
- 目标是将商品主图中的手机壳彩绘提取成适合工厂打印的平面稿
- `src/app/api/color-extraction2/identify/route.ts` 已改成更小的点击点 focus crop，并在裁切图上叠加红色标记，继续收紧“点哪识别哪”的准确度

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

### 4. 局部改图 / 局部编辑

相关文件：

- `src/components/LocalEditPanel.tsx`
- `src/app/api/material-editor/route.ts`
- `src/app/api/material-editor/compose-prompt/route.ts`

当前定位：

- 支持画笔模式和标签模式
- Agent 会把用户输入、识别标签和约束整理成更精准提示词
- 同样走 Psydo `gpt-image-2`
- 局部改图通过 `mask_image` 进行局部编辑
- 标签模式最新交互：点击图片先生成待确认点位和候选，不再自动写入提示词；必须由用户点击候选后才插入 token
- 标签点位使用独立覆盖层取坐标，标记点和图片共用同一基准，避免鼠标点击偏移
- 提交按钮现在放在提示词输入框下方，和模式切换区分离
- 图片展示区改成更高的可滚动容器，避免大图被输入框挤压裁切

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
- 失败任务优先显示，避免被埋掉

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

### 工作流与模型

- Psydo：`gpt-image-2`，用于彩绘提取、AI生图、局部改图
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

1. `sudo systemctl stop zaomeng-web`
2. `rm -rf .next`
3. `pnpm build`
4. `sudo systemctl start zaomeng-web`
5. 验证 `/login`、`/`、`/home`

注意：

- 不能在构建过程中并行 restart
- 不能一边运行一边删除 `.next`
- 不能未验证 chunk / css 就通知验收
- 浏览器 smoke check 脚本偶发会卡在 Chromium WS 启动，但只要 `curl` 公网页面返回 200，就先按服务已上线处理并单独再做人工验收

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
2. `AI生图` 和 `局部改图` 已经是正式可用功能，不再按占位处理
3. 任务中心必须保留，因为它是用户看进度和结果的主入口
4. 局部编辑优先使用统一的模型入口和 Agent 提示词，不再新增多条复杂分支
5. 发布前必须先确保页面正常和构建通过

## 目前优先级

1. 保持素材库主页面稳定
2. 优化局部改图 / 彩绘提取的提示词和交互
3. 优化任务中心可读性和失败可见性
4. 等用户继续提供正式 API 后，再逐步替换历史兼容逻辑

## 2026-05-08 版本记忆快照

### 项目方向

- 造梦AI当前已经明确收敛为“素材库驱动的 AI 图片工作台”，而不是松散的多工具导航站
- 核心主线是：先采集/上传素材，再在同一工作台中完成彩绘提取、局部改图、去水印、放大、PSD 下载与历史追踪
- 所有体验都围绕电商生产、工厂打样、印刷落地来设计，优先考虑结果可用性、批量流程和回溯能力

### 项目定位

- 面向有真实出图、修图、打印需求的生产型用户，而不是单纯做展示型 AI 图片试玩
- 首页固定收敛在 `/home`，素材库是总入口，任务中心是总反馈面板，局部编辑和生成能力都要回流到同一套任务与素材体系
- 当前最成熟的主业务依然是彩绘提取，其次是围绕素材加工展开的局部改图、局部重绘、AI 生图/图生图、去水印、高清放大

### 产品特征

- 单入口：所有能力尽量从素材库和选图后的悬浮操作条进入，减少页面跳转
- 真接口：生成、识别、局部编辑、PSD、对象存储、订单写库都优先接真实服务，不做长期占位 mock
- 强回退：对象存储失败可回退本地 `public/`，提示词整理失败可 fallback，保证主功能尽量可用
- 任务闭环：任务中心统一承接处理中、成功、失败、超时、部分成功，并作为用户查结果的主入口
- 工程导向：以可部署、可回滚、可追踪、可生产为标准，而不是只追求局部页面好看

### 当前核心功能

- 素材库：插件采图、本地上传、拖拽上传、收藏、文件夹、日期分组、删除、缩略图尺寸调整、大图预览
- 彩绘提取：订单生成、重新生成、局部重绘、PSD 下载、结果入库、任务中心联动
- 局部改图：画笔模式、标签模式、后端整理最终 prompt、`mask_image` 局部编辑、结果写入素材与订单
- 局部重绘：点选区域、识别标签、生成 mask、继续沿用历史局部重绘入口兼容链路
- AI 生图/图生图：基于 Psydo `gpt-image-2` 的真实生成链路，结果进入任务中心与素材库
- 其他工具：去除水印、高清放大、插件采图、用户中心、管理员后台

### 当前技术与部署特征

- 前端框架：Next.js 16 + React 19 + TypeScript 5
- 数据层：MySQL 为主，Redis 承载验证码/临时状态
- 生成与编辑：Psydo `gpt-image-2` 为主，OpenAI 兼容接口由 `src/lib/openaiCompatible.ts` 统一管理
- 对象存储：优先 Coze，对失败链路保留回退策略，避免结果丢失
- 现网部署：`zaomeng-web.service` 负责 `next start`，Nginx 反代到 `127.0.0.1:5000`，公网入口为 `http://124.223.26.206/home`

### 当前局部改图链路记忆

- `src/components/LocalEditPanel.tsx` 已收敛为当前正式的局部改图入口，支持画笔和标签两种模式
- `src/components/RedrawAnnotation.tsx` 作为旧局部重绘入口继续保留，并补齐与主链路一致的识别预热与会话日志能力
- `src/app/api/color-extraction2/identify/route.ts` 现支持 `prewarm` 预热、图片资产缓存、点击识别缓存、`sessionId` 日志串联
- `src/app/api/material-editor/route.ts` 在提交时由后端调用 `src/lib/materialEditorPrompt.ts` 生成最终 prompt，前端不再暴露 AI 整理结果
- `src/lib/materialEditorPrompt.ts` 是局部改图 prompt 整理的共享服务，负责 agent/fallback 与轻量日志，不记录敏感 prompt 内容

### 2026-05-08 本次关键更新

- 新增 OpenAI 兼容配置入口：`src/lib/openaiCompatible.ts`
- 识别链路增加预热、缓存和 `sessionId` 日志追踪，便于把“打开面板 -> 点击识别 -> 提交改图”串成一条可排查链路
- 局部改图与旧局部重绘入口统一改为前端只提交原始用户意图，最终 prompt 由后端生成并直接走图像编辑接口
- `docs/project-memory.md` 本文档被补齐为版本级项目记忆，后续可直接作为部署、交接、回滚时的上下文基线

### 当前已知风险

- `OPENAI_COMPAT_BASE_URL/images/edits` 当前存在上游不稳定问题，已在本地与应用层双重验证中出现 `ETIMEDOUT` 与 `502 Upstream request failed`
- 该问题不属于前端交互或后端 prompt 组装链路问题，而是外部图像编辑兼容服务的可用性问题
- 浏览器自动化验收依赖的本地 Chrome 当前不可用，因此现网验收以构建、接口、服务状态和公网 HTTP 检查为主

### 回滚与发布记忆

- 当前仓库长期采用 `backup: YYYY-MM-DD ... snapshot` 风格保留可回滚节点
- 发布时必须遵守固定顺序：停服务、清理 `.next`、构建、拉起服务、验证 `/login`、`/home`
- 回滚优先使用 Git 备份快照，而不是直接依赖运行时 `public/` 目录中的素材文件
