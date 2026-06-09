# Local UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve local frontend interaction quality for `/home`, `/market`, and shared navigation without touching production deployment or backend generation chains.

**Architecture:** Make small, reversible UI-only changes on top of the local backup snapshot. Prioritize responsive layout, toolbar clarity, lighter visual density, and safer custom confirmations while avoiding broad business-logic rewrites.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4.

---

### Task 1: Mobile shell spacing and navigation ergonomics

**Files:**
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/app/home/page.tsx`
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/components/Sidebar.tsx`
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/components/TaskHistory.tsx`

- [ ] Make `/home` remove fixed desktop side padding on small screens.
- [ ] Move sidebar to a bottom, compact mobile bar while preserving desktop sidebar.
- [ ] Ensure task center floating button does not collide with bottom nav on mobile.
- [ ] Run `pnpm exec tsc --noEmit --pretty false --incremental false`.

### Task 2: Gallery toolbar visual consolidation

**Files:**
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/components/QuickCreatePage.tsx`

- [ ] Reduce top vertical whitespace above gallery.
- [ ] Make filter/action toolbar denser on mobile and less fragmented on desktop.
- [ ] Keep upload, library view, folder/date/filter, and thumbnail controls functionally unchanged.
- [ ] Run TypeScript check.

### Task 3: Replace highest-impact native confirmations with styled modal

**Files:**
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/components/QuickCreatePage.tsx`
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/components/CropEditorPanel.tsx` only if low-risk.

- [ ] Add a local reusable confirmation state in `QuickCreatePage`.
- [ ] Replace delete material, delete folder, delete order, batch delete material/order native confirms.
- [ ] Preserve exact destructive behavior after user confirms.
- [ ] Run TypeScript check.

### Task 4: Market hero and toolbar refinement

**Files:**
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/app/market/page.tsx`
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/app/globals.css` if motion utility is needed.

- [ ] Reduce mobile hero height and clarify primary/secondary CTA hierarchy.
- [ ] Improve toolbar layout so slider/search controls are easier to scan.
- [ ] Respect reduced-motion for hero image flow.
- [ ] Run TypeScript check.

### Task 5: Global visual polish

**Files:**
- Modify: `/Users/andy/Documents/zaomeng/zaomeng/project/projects/src/app/globals.css`
- Modify: small component class names as needed.

- [ ] Align global font stack with Geist + Chinese UI fonts.
- [ ] Slightly reduce heavy background and shadow intensity where safe.
- [ ] Run `pnpm check` if local DB-independent, otherwise run TypeScript and `git diff --check`.

### Task 6: Local preview handoff

**Files:**
- No source changes expected.

- [ ] Start local preview on `http://localhost:5001`.
- [ ] Capture visible result or confirm known blocker if MySQL is not running.
- [ ] Summarize rollback command and changed files.
