# 项目记忆文档

## 项目定位

这是一个基于 Next.js 的 AI 图片工具项目，当前主要面向以下能力：

- 彩绘提取
- 智能抠图
- 去除水印
- 高清放大
- 模板提取

当前阶段的核心目标不是重构整套后端协议，而是：

- 保持前端页面可验收
- 保持用户、订单、积分主链路稳定
- 继续清理历史遗留的类型、状态同步和交互问题

## 协作规则

这是后续继续协作时必须遵守的工作规则。

### 1. 备份规则

后续只要你说“备份”，就默认按 GitHub 备份流程执行。

备份时必须保留并可追溯以下信息：

- Git 提交版本号
- 提交日期
- 提交时间
- 提交备注信息
- 如有 tag，还要记录对应 tag 名称

后续当你要回滚时，我需要把这些信息列给你看，你再明确指定要回滚到哪个版本。

当前备份仓库:

- `git@github.com:Andy-1521/zaomeng.git`

当前已存在的备份记录:

- Commit: `8d1fafa`
- Time: `2026-04-27 17:14`
- Message: `backup: 2026-04-27 17:14 project snapshot`
- Tag: `backup-2026-04-27-1714`

### 2. 每次功能更新后的验收规则

后续每次我完成一轮功能修改后，都需要：

1. 保证本地服务可访问
2. 保证公网入口可访问
3. 把公网访问地址发给你
4. 等你验收结果

当前长期公网入口:

- `http://124.223.26.206/home`

说明:

- 当前已通过 Nginx 将公网 `80` 端口反向代理到 `127.0.0.1:5000`
- 后续每次更新功能后，默认用这个公网地址给你验收

## 工作目录

- 当前项目目录: `/home/ubuntu/Downloads/zaomeng/project/projects`
- 参考旧版前端包: `/home/ubuntu/Downloads/zaomeng/project_20260427_120107.zip`

说明:

- 旧版压缩包用于恢复原始页面结构和交互风格
- 当前项目代码不是完全等同于压缩包内容，已经做过多轮修复和迁移

## 技术栈

- Next.js 16
- React 19
- TypeScript 5
- Tailwind CSS 4
- pnpm

## 当前真实架构

### 数据层

当前真实主链路为：

- MySQL: 用户、订单、积分、认证主链路
- Redis: 验证码存储

关键目录与文件：

- `src/storage/database/client.ts`
- `src/storage/database/shared/schema.ts`
- `src/storage/database/userManager.ts`
- `src/storage/database/transactionManager.ts`
- `src/storage/database/init-db.ts`
- `src/lib/db-init.ts`
- `src/lib/app-init.ts`
- `src/lib/redis.ts`
- `src/utils/verifyCodeStore.ts`

### 对象存储与工作流

当前仍沿用：

- Coze 对象存储
- 现有后端工作流调用方式

当前没有做的事：

- 没有替换对象存储供应商
- 没有重构后端工作流协议

## 当前前端基线

### 已确认与旧版一致或已恢复到旧版结构的部分

- `src/app/home/page.tsx` 基本延续当前既有首页框架
- `src/components/Sidebar.tsx` 基本保持现有侧边导航结构
- `src/components/ColorExtraction2Page.tsx` 已恢复为参考压缩包里的旧版前端结构

当前 `ColorExtraction2Page.tsx` 的页面特征：

- 顶部上传区
- 使用提示区
- 下方订单记录列表
- 图片大图预览
- 重新生成 / 高清下载 / 局部重绘 / 下载 PSD 按钮布局

### 当前仍使用“修复后版本”的部分

- `src/components/TaskHistory.tsx`
- `src/components/QuickCreatePage.tsx`
- `src/components/RemoveWatermarkPage.tsx`

说明:

- `TaskHistory.tsx` 保留了稳定性修复，没有直接回退成旧版
- `QuickCreatePage.tsx` 保留了上传接口修复，没有直接回退成旧版 `/api/upload`
- `RemoveWatermarkPage.tsx` 保留了本轮做过的类型和弹窗修复

## 当前关键业务页面状态

### 彩绘提取

文件:

- `src/components/ColorExtraction2Page.tsx`
- `src/app/api/color-extraction2/workflow/route.ts`
- `src/app/api/color-extraction2/regenerate/route.ts`
- `src/app/api/color-extraction2/redraw/route.ts`
- `src/components/RedrawAnnotation.tsx`

当前状态:

- 前端页面结构已恢复为旧版风格
- 订单仍从数据库读取
- 轮询管理仍通过 `taskPollingManager` 处理
- 成功后可走局部重绘和 PSD 下载链路

已修复的关键问题:

- 彩绘提取失败时不再把所有处理中记录一起标成失败
- 彩绘提取成功后订单 `remainingPoints` 已回写为真实扣费后余额

### 任务历史

文件:

- `src/components/TaskHistory.tsx`

当前状态:

- 仍然作为右侧历史记录面板存在
- 仍负责临时任务记录与后端订单记录的合并显示
- 当前实现保留了稳定性修复版本，而不是完全旧版

当前修复点:

- 临时缓存按用户隔离
- 不再直接依赖危险的文件级原地可变写法
- 清空 / 删除历史记录时状态更稳定
- 当前文件 lint 无 error

### 去除水印

文件:

- `src/components/RemoveWatermarkPage.tsx`

当前状态:

- 页面功能可用
- 已完成一轮稳定性修复

当前修复点:

- 图片预览弹窗不再在 render 内定义
- 用户初始化方式已调整
- 关键 `any` 已清理一部分
- 当前文件 lint 无 error

### 高清放大

文件:

- `src/components/ImageUpsamplingPage.tsx`

当前状态:

- 仍保留旧版风格和旧问题模式
- 尚未做和去水印页同等级别的修复

已确认问题类型:

- `any` 较多
- 用户初始化仍是旧写法
- render 内定义图片预览弹窗组件
- 多处事件同步和订单状态更新逻辑较旧

### 智能抠图

文件:

- `src/components/AutoRemoveBackgroundPage.tsx`

当前状态:

- 仍保留旧版风格和旧问题模式
- 尚未做和去水印页同等级别的修复

已确认问题类型:

- `any` 较多
- render 内定义图片预览弹窗组件
- 失败状态更新逻辑仍偏旧

### 快速制作

文件:

- `src/components/QuickCreatePage.tsx`

当前状态:

- 页面主体可用
- 模板提取上传已对齐当前真实接口 `/api/upload/file`

说明:

- 不能直接回退成旧版文件，否则会恢复到调用不存在的 `/api/upload`

## 当前接口与安全状态

### 已补强的用户相关接口

以下接口已经补了“只能操作当前登录用户数据”的校验：

- `src/app/api/user/transactions/route.ts`
- `src/app/api/user/transactions/clear/route.ts`
- `src/app/api/user/transactions/delete/route.ts`
- `src/app/api/user/profile/route.ts`
- `src/app/api/auth/refresh/route.ts`

当前结果:

- 不能再仅靠前端传 `userId` 越权读取或修改其他用户数据
- 用户数据相关接口已以登录 cookie 归属为主

## 当前开发与验收入口

### 本地与局域网

- 首页: `http://localhost:5000/home`
- 首页: `http://10.0.4.6:5000/home`
- 管理页: `http://10.0.4.6:5000/admin/generations`
- 个人页: `http://10.0.4.6:5000/profile`

### 当前公网地址

- 长期公网入口: `http://124.223.26.206/home`

说明:

- 当前已经不依赖临时隧道作为主要验收方式
- 如需临时备用外链，可再临时起隧道

## 当前验证情况

已确认:

- 本地 `http://127.0.0.1:5000/home` 返回 `200 OK`
- 公网 `http://124.223.26.206/home` 返回 `200 OK`
- `src/components/ColorExtraction2Page.tsx` 当前 lint 无 error
- `src/components/TaskHistory.tsx` 当前 lint 无 error
- `src/components/RemoveWatermarkPage.tsx` 当前 lint 无 error

当前常见剩余项主要是:

- `@next/next/no-img-element` warning
- 旧工具页中的 `any`
- 旧工具页中的 render 内组件和状态同步问题

## 当前未完成事项

### 前端恢复

当前还没有继续决定是否要把这些文件在视觉和交互上进一步向旧版靠拢：

- `src/components/QuickCreatePage.tsx`
- `src/components/TaskHistory.tsx`

注意:

- `QuickCreatePage.tsx` 若继续回退，必须保留 `/api/upload/file` 修复
- `TaskHistory.tsx` 若继续回退，不能退掉现有稳定性修复

### 相邻工具页修复

仍建议继续处理:

1. `src/components/ImageUpsamplingPage.tsx`
2. `src/components/AutoRemoveBackgroundPage.tsx`

### 复杂工作流 API 类型收尾

仍然是后续可继续清理的重点:

1. `src/app/api/color-extraction2/workflow/route.ts`
2. `src/app/api/color-extraction2/regenerate/route.ts`
3. `src/app/api/color-extraction2/redraw/route.ts`

## 建议的下一步顺序

推荐按下面顺序继续推进：

1. 先验收当前已恢复的彩绘提取前端页面
2. 再处理 `ImageUpsamplingPage.tsx`
3. 然后处理 `AutoRemoveBackgroundPage.tsx`
4. 最后再决定是否继续恢复 `QuickCreatePage.tsx` / `TaskHistory.tsx` 的旧版前端表现

## 接手提醒

后续继续接手时，优先记住这些事实：

1. 当前后端主链路是 MySQL + Redis，不是旧的 PostgreSQL / 内存方案
2. 当前彩绘提取前端已经恢复成旧版风格
3. 当前 `TaskHistory` 和 `RemoveWatermarkPage` 已经做过稳定性修复，不建议直接原样回退
4. 当前下一批最值得继续修的是 `ImageUpsamplingPage.tsx` 和 `AutoRemoveBackgroundPage.tsx`
5. 后续每次完成功能修改后，都要部署到公网地址给用户验收
6. 后续每次执行备份时，都要记录版本号、日期时间、备注和 tag 信息
