# 项目记忆文档

## 项目定位

这是一个基于 Next.js 16 的 AI 图片工具网站，当前重点已经从“多页面工具站”转为“素材管理 + 选图后直接加工”的工作流。

当前对外主能力：

- 素材库
- AI生图（当前先做前端交互占位）
- 彩绘提取
- 去除水印
- 高清放大
- 模板提取 API

当前核心目标：

- 先把前端交互体验完善
- 后端功能接口后续按用户提供的真实 API 再接
- 保持公网入口稳定可访问
- 保持生产构建通过

## 当前产品状态

### 首页主链路

当前首页真实主链路：

- 左侧只保留一个入口：`素材库`
- 主内容固定为 `QuickCreatePage`
- 用户先收集 / 上传图片素材
- 再在素材上进行多选
- 选图后图片区域下方悬浮出加工按钮条
- 任务状态统一去右侧 `TaskHistory` 查看

### 当前首页交互特征

- 整个页面支持拖拽本地图片上传
- 右上角 `+` 按钮支持手动上传素材
- 素材按日期分组显示：
  - 今天
  - 昨天
  - 更早
- 顶部筛选已简化为一个日期下拉框：
  - 全部日期
  - 今天
  - 昨天
  - 更早
- 图片卡片上不再直接压日期浮层
- 日期与时间信息仅在 hover 内容中显示
- 顶部工具条右侧固定放置：
  - 删除重复
  - 删除所选
  - 日期筛选下拉框

### 当前加工按钮条

当前顺序：

1. AI生图
2. 彩绘提取
3. 去除水印
4. 高清放大

说明：

- `AI生图` 当前是前端交互优先模式
- 点击后先弹提示词输入框
- 暂不依赖最终正式后端接口
- 当前可以作为前端交互占位继续完善

### 删除类操作

删除类操作不在悬浮加工按钮条里，而在素材区右下角：

- 删除重复
- 删除所选

当前规则：

- `删除重复` 只有检测到确实存在重复素材时才显示
- 两个删除按钮 hover 都是明显红色反馈

## 当前关键页面与组件状态

### 当前主链路组件

- `src/app/home/page.tsx`
- `src/components/Sidebar.tsx`
- `src/components/Navbar.tsx`
- `src/components/QuickCreatePage.tsx`
- `src/components/TaskHistory.tsx`
- `src/components/ColorExtraction2Page.tsx`
- `src/components/RedrawAnnotation.tsx`
- `src/components/GlobalEventHandler.tsx`
- `src/components/ServiceWorkerRegister.tsx`
- `src/components/ui/ImageThumbnail.tsx`
- `src/components/ui/StatusBadge.tsx`

### QuickCreatePage

文件：

- `src/components/QuickCreatePage.tsx`

当前状态：

- 已从“采集图库”升级为“素材库”语义
- 是当前首页主链路核心组件
- 已支持：
  - 插件采图
  - 本地上传
  - 整页拖拽上传
  - 多选
  - 日期分组
  - 日期下拉筛选
  - 删除重复
  - 删除所选
  - 悬浮加工按钮条
  - AI生图提示词弹窗

当前明确策略：

- 后端接口不作为当前这轮的重点
- 先把前端交互做顺
- `AI生图` 按图生图交互来设计，但接口后续再接真实 API

### TaskHistory

文件：

- `src/components/TaskHistory.tsx`

当前状态：

- 仍是右侧历史记录面板
- 仍负责合并临时前端任务和数据库订单记录
- 提交任务后会自动展开
- 最新任务会高亮数秒
- 状态显示已增强：
  - 处理中、成功、失败、超时、部分成功
  - 不仅有徽章，还有卡片左侧状态色条

### ColorExtraction2Page

文件：

- `src/components/ColorExtraction2Page.tsx`
- `src/app/api/color-extraction2/workflow/route.ts`
- `src/app/api/color-extraction2/regenerate/route.ts`
- `src/app/api/color-extraction2/redraw/route.ts`
- `src/app/api/color-extraction2/identify/route.ts`

当前状态：

- 仍是项目里最完整的功能页实现
- 支持订单读取、局部重绘、重新生成、PSD 下载
- 当前仍是项目中最成熟的主能力页

## 当前技术与数据架构

### 数据层

当前真实主链路：

- MySQL：用户、订单、素材、认证主数据
- Redis：验证码及相关临时状态

关键文件：

- `src/storage/database/client.ts`
- `src/storage/database/shared/schema.ts`
- `src/storage/database/userManager.ts`
- `src/storage/database/transactionManager.ts`
- `src/storage/database/capturedImageManager.ts`
- `src/storage/database/init-db.ts`
- `src/lib/db-init.ts`
- `src/lib/app-init.ts`
- `src/lib/redis.ts`
- `src/utils/verifyCodeStore.ts`

### 对象存储与工作流

当前仍沿用：

- Coze 对象存储
- RunningHub / Coze 工作流

当前原则：

- 不在本轮把旧接口全部重构
- 不把临时可用的老接口当最终产品方案
- 后续按用户提供的正式 API 逐项替换

## 当前部署状态

### 当前公网主入口

- `http://124.223.26.206/home`

### 当前域名状态

- 已绑定：`www.zaomengai.icu`
- 当前不作为正式验收入口
- HTTP 可访问过，但 HTTPS 和正式切换未收口

### Nginx 状态

当前仍是默认 HTTP 反代：

- `80 -> 127.0.0.1:5000`

### 应用进程状态

当前网站仍依赖手动后台启动，不稳定因素较大：

- 当前曾多次出现：
  - 服务器重启后 502
  - 应用进程退出后 502
  - `.next` 构建产物不完整时启动失败

根因：

- 还没有正式启用 `systemd` 或 `pm2` 做进程托管

### 已准备的 systemd 模板

文件：

- `docs/zaomeng-web.service`

作用：

- 为网站提供开机自启和自动重启能力
- 当前模板尚未确认完成系统级启用

## 当前构建状态

- `pnpm build` 当前可通过

这是当前非常重要的基线，说明项目代码已能稳定完成生产构建。

## 当前已完成的重要修复

本轮已完成：

- 修复大量历史 TypeScript / build 问题
- 当前生产构建已通过
- 修复 `template-extract` 脚本路径问题
- 修复多个 migration / admin / profile / API 的类型问题
- 首页结构收缩为单入口素材库主链路
- 完成素材库命名切换
- 完成日期分组显示
- 完成日期下拉筛选简化
- 删除按钮已上移到日期筛选左侧，避免素材较多时被挤到页面下方
- 完成整页拖拽上传
- 恢复悬浮加工按钮条交互
- 删除按钮分离为右下角独立操作区
- 删除重复逻辑已按稳定键归一化处理
- 历史记录自动展开 + 最新任务高亮

## 当前高置信未使用/历史残留候选

### 高置信未进入主链路的旧页面组件

- `src/components/AIGeneratePage.tsx`
- `src/components/CustomPage.tsx`
- `src/components/AutoRemoveBackgroundPage.tsx`
- `src/components/RemoveBackgroundPage.tsx`
- `src/components/RemoveWatermarkPage.tsx`
- `src/components/ImageUpsamplingPage.tsx`

说明：

- 这些大多属于旧的独立功能页模式残留
- 当前首页真实交互已经不依赖它们
- 删除前仍建议人工再确认一次，避免遗漏隐藏引用

### 高置信调试/历史工具残留

- `debug_tmall.py`
- `extractor_server.py`
- `extractor_v2.py`
- `product_image_extractor.py`
- `test-watermark.html`
- `tmp/AI_IMAGE_API_MIGRATION.md`
- `tmp/COLOR_EXTRACTION_CONCURRENT_FIX.md`
- `debug_login.png`

### 当前仍明确使用的脚本

- `scripts/template-extract.mjs`

### 需人工确认的脚本

- `scripts/replace_prod_users.py`

## 备份记录

### Git 备份仓库

- `git@github.com:Andy-1521/zaomeng.git`

### 已知旧备份记录

- Commit: `8d1fafa`
- Time: `2026-04-27 17:14`
- Message: `backup: 2026-04-27 17:14 project snapshot`
- Tag: `backup-2026-04-27-1714`

### 当前本地备份

- `/home/ubuntu/Downloads/zaomeng/project/projects-backup-20260429-zaomengai.tar.gz`
- `/home/ubuntu/Downloads/zaomeng/project/projects-source-backup-20260429.tar.gz`

## 当前工作规则

### 功能修改后的默认动作

每次完成功能修改后，默认需要：

1. 确认本地可访问
2. 确认公网入口可访问
3. 若涉及构建链路，优先保证 `pnpm build` 通过
4. 再交由人工验收

### 当前协作原则

用户已经明确说明：

- 先不要深度依赖后端
- 每个功能的正式 API 后续会再给
- 当前优先完善整个前端交互体验

因此后续实现时应遵守：

- 前端交互优先
- 后端接口占位可临时存在，但不要当最终方案
- 不要为了临时后端可用性破坏页面稳定性

### 关于备份

以后当用户说“先备份”时，默认至少执行源码级备份，并保留：

- 时间
- 备份文件路径
- 如有 Git 提交，则记录 commit / tag / message

## 下一步建议

推荐按下面顺序继续推进：

1. 先把网站进程托管切到 `systemd`
2. 再继续做素材库体验增强：
   - 排序方式
   - 搜索
   - 日期分组折叠
3. 再完善 `AI生图` 的纯前端交互流：
   - 提示词输入体验
   - 示例提示词
   - 提交前确认信息
4. 最后等待用户给正式 API，再接入真正后端

## 接手提醒

后续继续接手时优先记住这些事实：

1. 当前首页已经不是“采集图库 + 多页面功能入口”，而是“素材库 + 选图后直接加工”
2. 当前 `AI生图` 应该先按前端占位式交互处理，不要强绑临时后端
3. 当前生产构建已通过，但运行稳定性仍受“进程未托管”影响
4. 当前公网主验收入口仍应优先使用 `http://124.223.26.206/home`
5. 域名和 HTTPS 暂时不是当前最高优先级
