# Hearth — Agent Guide

Family expense tracker + envelope budgeting. Local-first PWA (Nuxt 4 SPA + Capacitor 8). Multi-user household. Self-hostable backend (Rust/Axum + Postgres — phase 2).

## Commands

```bash
pnpm dev              # Dev server (PWA)
pnpm build:pwa        # Build PWA
pnpm build:native     # Build + cap sync
pnpm check:fix        # Lint + format (run before finishing)
pnpm typecheck        # TypeScript check
pnpm test:unit        # Vitest unit tests
pnpm test:e2e         # Playwright e2e tests
pnpm test:a11y        # Playwright a11y audit
pnpm cap:run:ios      # Run on iOS
pnpm cap:run:android  # Run on Android
```

## Architecture

**Web**: Pages → `useDatabase()` composable → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (SQLite WASM + OPFS)

**Native**: Same composable → `db-native.ts` (Capacitor SQLite, no worker)

Both paths share the same `WorkerRequest` / `WorkerResponse` message types defined in `app/types/database.ts`.

## Key Files

| File | Purpose |
|------|---------|
| `app/workers/database.worker.ts` | SQLite WASM engine, full Hearth schema, migrations, message handler |
| `app/lib/db-native.ts` | Capacitor SQLite mirror (native only) |
| `app/plugins/database.client.ts` | Worker lifecycle, UUID request/response bus |
| `app/composables/useDatabase.ts` | All DB operations exposed to pages |
| `app/composables/useAppSettings.ts` | UI prefs + feature flags (localStorage) |
| `app/types/database.ts` | All types, `WorkerRequest` union, export/import types |
| `app/layouts/default.vue` | Header + bottom nav (Dashboard / Transactions / Envelopes / Reports) |
| `app/utils/format.ts` | Currency formatting, date helpers |

## Schema (user_version = 1)

**Tables**: users, accounts, categories, transactions, envelopes, envelope_periods, iou_splits, savings_goals

**Seed data**: Applied once on first run via `applied_defaults` table. Includes 2 household members (Alex + Sam), common accounts, categories hierarchy, 3 months of sample transactions, 4 envelopes, 3 savings goals.

## Adding a DB Operation

1. Add message type to `WorkerRequest` union in `app/types/database.ts`
2. Implement in `database.worker.ts` (SQL query in the `switch` handler)
3. Mirror in `db-native.ts` (Capacitor SQLite)
4. Expose in `useDatabase.ts` via `sendToWorker()`

Schema changes: increment `user_version`, add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration after the `CREATE TABLE` block, mirror in `db-native.ts`.

## Navigation

Bottom tabs: `Dashboard` (`/`) · `Transactions` (`/transactions`) · `Envelopes` (`/envelopes`) · `Reports` (`/reports`)

Sub-pages (no tab):
- `/transactions/add` — Add transaction (FAB)
- `/household` — IOU balances (linked from dashboard widget)
- `/settings` — App settings (avatar menu in header)

Pass-through parent pages (`transactions.vue`, `envelopes.vue`) contain `<NuxtPage />` for nested routing.

## UI Conventions

**Color meaning** (must be paired with icon/text, never color alone):
- `text-green-*` / `bg-green-*/10` — income, positive balance, fully funded envelope
- `text-amber-*` / `bg-amber-*/10` — warning, envelope < 30% remaining
- `text-rose-*` / `bg-rose-*/10` — overspent envelope, expense accent, negative balance
- `text-(--ui-text-muted)` / no stripe — transfer, neutral

**Transaction left stripe** (3px left border):
- Income: `border-l-4 border-green-500`
- Expense: `border-l-4 border-(--ui-border-accented)` (muted)
- Transfer: `border-l-4 border-dashed border-(--ui-border)` (neutral)

**Envelope bar**: `<progress>` or `<div>` with animated width. Colors:
- `bg-green-500` when ≥30% remaining
- `bg-amber-500` when 10–30% remaining
- `bg-rose-500` when overspent

**Financial numbers**: `font-mono` class for precision. Large amounts pair `text-2xl font-bold` dollars with `text-sm` cents.

**Touch targets**: Minimum 44×44px on all interactive elements. Use `min-h-[44px] min-w-[44px]` or `p-3` to meet requirement.

**Safe areas**: Header top: `calc(0.75rem + env(safe-area-inset-top))`. Bottom nav: `env(safe-area-inset-bottom)`.

## Config

- `nuxt.config.ts` — COOP/COEP headers (required for OPFS/SharedArrayBuffer), `BUILD_TARGET` env for pwa vs native
- `capacitor.config.ts` — appId `app.hearth.family`, webDir `.output/public`
- `app/app.config.ts` — Nuxt UI: primary `amber`, neutral `slate`
- `biome.json` — linter + formatter (single quotes, 2-space indent, 100 char line width)

## Testing (TDD)

Write failing tests first (red), then implement (green).

**Unit tests** (`tests/unit/`): Pure functions (format.ts, date helpers). Use `vitest` + `happy-dom`.

**Integration tests** (`tests/integration/`): DB composable with mocked worker. `@vue/test-utils` + vitest.

**E2E tests** (`tests/e2e/`): Full navigation flow, dashboard render, add transaction form. Playwright.

**A11y tests** (`tests/a11y/`): axe-core on every page, touch target audit (44px), keyboard navigation. Playwright + `@axe-core/playwright`.
