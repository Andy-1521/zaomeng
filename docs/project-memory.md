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
