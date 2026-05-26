# AGENTS.md

## Project Overview

造梦AI is a production Next.js image-workbench application. The current product is centered on `/home`: a material library, selected-image actions, and a right-side task center.

Current active capabilities:

- Material library and browser-extension image capture
- AI生图 / image-to-image generation
- 智能改图 / local smart editing
- 彩绘提取
- Manual 彩绘 PSD generation
- 高清+扩图
- User profile, recharge-code entry, admin generation records, and admin recharge-code management

Read `docs/project-memory.md` before doing non-trivial work. It is the current handoff baseline.

## Tech Stack

- Framework: Next.js 16 App Router
- Core: React 19, TypeScript 5
- Database: Drizzle ORM over MySQL (`mysql2/promise`)
- Cache / temp state: Redis
- UI: Tailwind CSS 4, shadcn/ui components
- Package manager: pnpm only; never use npm or yarn
- Storage: Aliyun OSS as the active object-storage path
- Model/workflow integrations: Psydo OpenAI-compatible image edits, Coze workflows, RunningHub

## Build & Run Commands

- Dev: `pnpm dev`
- Typecheck: `pnpm exec tsc --noEmit --pretty false`
- Diff whitespace check: `git diff --check`
- Combined local check: `pnpm check`
- Build: `pnpm build`
- Start locally: `pnpm start`
- Restart production: `sudo systemctl restart zaomeng-web.service`
- Check production status: `systemctl is-active zaomeng-web.service`

Local project path: `/Users/andy/Documents/zaomeng/zaomeng/project/projects`
Production project path: `/home/ubuntu/zaomeng`
Production URL: `https://zaomengai.icu`

## Release Workflow

Every change must follow this release order:

1. Make and verify changes locally.
2. Run `pnpm check` and `pnpm build`.
3. Commit a GitHub backup snapshot with a `backup: YYYY-MM-DD summary` message and push it.
4. Start or update local preview on `http://localhost:5001` and send the visible result to the user for acceptance.
5. Do not deploy Production until the user confirms the local preview result is acceptable.
6. After acceptance, deploy to Tencent Cloud Hong Kong server at `/home/ubuntu/zaomeng`, then smoke test public pages and core flows.

The user reviews visible results, not code. Keep local preview URLs, production URLs, and validation status clear in handoff messages.

## Project Structure

```text
src/
├── app/
│   ├── home/           # Main workbench page
│   ├── admin/          # Admin generation dashboard
│   ├── api/            # API routes
│   ├── login/          # Login page
│   ├── plugin/         # Browser extension download page
│   └── profile/        # Profile and recharge page
├── components/
│   ├── QuickCreatePage.tsx  # Material library and generation actions
│   ├── LocalEditPanel.tsx   # Smart edit UI
│   ├── TaskHistory.tsx      # Right-side task center
│   ├── Navbar.tsx           # Top navigation and points display
│   └── ui/                  # Shared UI components
├── lib/
│   ├── psydoImageEdits.ts        # Primary image edit call
│   ├── openaiCompatible.ts       # Primary OpenAI-compatible config
│   ├── dualStorage.ts            # OSS upload wrapper; failures are hard failures
│   ├── safeRemoteImage.ts        # Safe remote image downloader
│   ├── materialEditorPrompt.ts   # Smart edit prompt agent
│   └── pricing.ts                # Points pricing
└── storage/
    └── database/
        ├── transactionManager.ts
        ├── userManager.ts
        └── shared/
```

## Active API Paths

Use these paths for current frontend work:

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

Legacy `color-extraction2` routes may still exist as compatibility wrappers only. Do not add new frontend calls to them.

## No-Fallback Policy

The project currently has a strict no-backup/no-degrade/no-fallback policy for generation and persistence paths.

Do not reintroduce:

- Switching image edits to a fallback target
- Falling back to local `public/` storage after OSS upload failure
- Falling back from Coze file upload to URL input
- Falling back from hollow color extraction to full extraction
- Returning template prompts when the prompt agent fails
- Returning generic selected-area labels when smart identify fails
- Continuing with default aspect ratio when source size parsing fails
- Keeping temporary upstream model URLs as final persisted results

Expected behavior:

- Fail clearly when the primary path fails
- Refund already-precharged points on failed paid work
- Keep user-facing errors business-friendly and do not expose secrets, gateways, stack traces, or raw model details

## Points Policy

Paid high-cost tasks must use:

- Frontend balance precheck
- Backend atomic precharge
- Refund on failed/timeout backend work

Manual 彩绘 PSD generation is a separate paid action and must only happen after the user clicks the PSD action.

## Recharge Policy

- Automated WeChat/Alipay payment is hidden until merchant credentials and compliance are ready.
- Users recharge through `/profile?tab=recharge` by contacting admin WeChat `Kzai-1224` for a one-time recharge code.
- Admins generate and review recharge codes in `/admin/generations` under the `兑换码` tab.
- Recharge transactions should not appear in admin generation records.

## Code Style

- Use `@/` path aliases for imports
- UI copy is Chinese
- Keep code comments concise and useful
- Prefer the smallest correct change
- Do not add compatibility code unless there is persisted data, shipped behavior, an external consumer, or an explicit requirement
- Never mock real integrations for production behavior

## Frontend Design Notes

- Preserve the current clean, lightweight, iOS Settings-like style
- Avoid heavy cards, strong shadows, busy dashboards, or duplicated status text
- Keep `/profile?tab=recharge` and the existing `RechargePanel`
- Points display should continue to use `PointsIconLabel` and `points-icon.png`

## Operational Notes

- Local runtime env file: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/.env.local`
- Production runtime env file: `/home/ubuntu/zaomeng/.env.local`
- Do not leak real environment values or keys
- Production main app logs: `/home/ubuntu/zaomeng/.coze-logs/systemd-web.log`
- Production error logs: `/home/ubuntu/zaomeng/.coze-logs/systemd-web-error.log`
- `journalctl -u zaomeng-web.service` mostly shows systemd start/stop logs
- Browser smoke tests should use the Codex in-app browser for local preview, then public domain checks after production deploy

## Known Risks

- Authentication still relies heavily on a client-writable `user` JSON cookie; future work should migrate to trusted server-side sessions or JWT
- Some APIs still mix user identity from body/header/cookie and need consolidation
- Payment merchant parameters for real WeChat/Alipay callback verification are still incomplete
- Smart-edit masks are still submitted as base64 JSON; multipart or pre-uploaded mask references would be more robust
