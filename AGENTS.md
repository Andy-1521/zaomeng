# AGENTS.md

## Project Overview
AI-powered image tool application built with Next.js. Currently supports **Color Extraction (彩绘提取)** as the primary feature, with Smart Background Removal, Watermark Removal, and Custom tools as secondary features.

## Tech Stack
- **Framework**: Next.js 16 (App Router) with Turbopack
- **Core**: React 19, TypeScript 5
- **Database**: Drizzle ORM (PostgreSQL via `coze-coding-dev-sdk`)
- **UI**: Tailwind CSS 4, shadcn/ui components
- **Package Manager**: pnpm (strict - never use npm or yarn)

## Build & Run Commands
- **Dev**: `pnpm dev` (runs on port 5000 via `.coze` config)
- **Build**: `pnpm build`
- **Lint**: `pnpm lint`
- **Start (prod)**: `pnpm start`

## Project Structure
```
src/
├── app/
│   ├── home/           # Main home page (Color Extraction)
│   ├── admin/          # Admin dashboard (generations management)
│   ├── api/            # API routes (transaction, user, upload, etc.)
│   ├── login/          # Login page
│   └── profile/        # User profile page
├── components/
│   ├── TaskHistory.tsx  # Task history sidebar with filter/tabs
│   ├── ColorExtraction2Page.tsx  # Main color extraction feature
│   ├── CustomPage.tsx   # Custom tools placeholder
│   ├── Navbar.tsx       # Navigation bar
│   └── ui/              # shadcn/ui components
├── lib/
│   ├── globalRecordManager.ts  # Record caching & server sync
│   └── toast.ts                # Toast notification utility
└── storage/
    └── database/
        ├── transactionManager.ts  # Transaction CRUD & stats
        ├── userManager.ts         # User management
        └── shared/                # Drizzle schema & migrations
```

## Key Types
- `TabType`: `'color-extraction' | 'auto-remove-bg' | 'watermark' | 'custom'`
- `FilterType`: `'all' | TabType` (used in TaskHistory filter UI)
- `RecordType`: `'watermark' | 'remove-bg' | 'color-extraction'` (used in globalRecordManager)

## Code Style
- Use `@/` path aliases for imports
- Chinese strings in UI, English in code comments
- All async DB operations use `transactionManager` or `userManager`
- Never mock API calls - always use real integrations

## Important Notes
- The `ai-image` and `quick-create` tab types have been removed. Historical data with `toolPage='去除水印'` maps to `TabType='watermark'`, `toolPage='高清放大'` maps to `TabType='custom'`
- The `generate-image` and `optimize-prompt` API routes have been removed (AI image generation feature fully deprecated)
- The `chat-messages` API has been removed (was only used by AI image feature)
- Admin dashboard stats no longer track `aiImageCount`

## Vision Model Integration

### 局部重绘标注点识别
- **模型**: `doubao-seed-2-0-mini-260215` (支持多模态理解)
- **API**: 使用 OpenAI 兼容端点 `https://integration.coze.cn/api/v3/chat/completions`
- **特点**: 
  - 支持图片 URL 直接输入
  - 不需要 Bot ID，直接通过 SDK 的 apiKey 认证
  - 返回 SSE 流式响应，需要客户端解析
- **实现文件**: `src/app/api/color-extraction2/identify/route.ts`

### 模型能力说明
- `doubao-seed-2-0-mini-260215`: 面向低时延、高并发场景，支持 256k 上下文、多模态理解，适合成本和速度优先的轻量级任务
