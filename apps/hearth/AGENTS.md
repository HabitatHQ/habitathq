---
scope: apps/hearth
applies_to: "apps/hearth/**"
last_verified: 2026-05-26
---

# Hearth — Agent Guide

Family expense tracker + envelope budgeting. Local-first PWA (Nuxt 4 SPA + Capacitor 8). Multi-user household. Self-hostable backend (Rust/Axum + Postgres — phase 2).

> Read root `AGENTS.md` first — shared Nuxt+Capacitor architecture, DB-op pattern, schema migrations, and TypeScript conventions live there.

## Verify

```bash
pnpm --filter hearth verify
```

## Offline parity

Native (Capacitor) and the PWA (with assets pre-fetched) work fully offline:

- **Storage**: SQLite (WASM/OPFS on web, Capacitor SQLite on native).
- **Icons**: Lucide bundled at build time via the `habitat-shared` Nuxt layer.
- **OCR**: Tesseract `eng.traineddata.gz` (~10 MB) in `public/tessdata/`.
- **NLP embeddings**: Xenova `all-MiniLM-L6-v2` (~23 MB) + onnxruntime-web wasm (~13 MB) in `public/models/` + `public/onnx-wasm/`.
- **Reset DB**: Settings → Reset closes the connection, deletes the Capacitor SQLite db, reloads.
- **JSON import/export**: round-trips both web and native.

`scripts/fetch-offline-assets.mjs` downloads the ~46 MB binary assets (gitignored). Runs automatically before `build:native` (`prebuild:native`). PWA users opt in via `pnpm fetch:assets`.

## Schema (`user_version = 9`)

users, accounts, categories, transactions, envelopes, envelope_periods, iou_splits, savings_goals, chores, applied_defaults, _palladium_seeds.

## Routes

Bottom tabs: Dashboard `/` · Transactions `/transactions` · Envelopes `/envelopes` · Reports `/reports`.

Sub-pages: `/transactions/add` (FAB), `/household` (IOU balances), `/settings` (avatar menu).

Pass-through parents: `transactions.vue`, `envelopes.vue`.

## Hearth-specific conventions

### Icons (offline-safe)

Use `<AppIcon name="semantic-key" />` from `@habitathq/shared`, **not** `<UIcon name="i-…">` (semgrep warns). For `:icon=` props on `UButton`/`UAlert`, use `resolveIcon('semantic-key')`. Lucide is bundled at build time. Add missing entries to `libs/habitat-utils/src/icons.ts`.

### UI colour semantics (always paired with icon/text — never colour alone)

| Meaning | Class |
|---------|-------|
| Income · positive balance · fully-funded envelope | `text-green-*` / `bg-green-*/10` |
| Warning · envelope < 30% remaining | `text-amber-*` / `bg-amber-*/10` |
| Overspent · expense accent · negative balance | `text-rose-*` / `bg-rose-*/10` |
| Transfer · neutral | `text-(--ui-text-muted)` |

Transaction left stripe (3px): income `border-l-4 border-green-500`, expense `border-l-4 border-(--ui-border-accented)`, transfer `border-l-4 border-dashed border-(--ui-border)`.

Envelope bar: green ≥ 30% remaining · amber 10–30% · rose overspent.

### Other UI rules

- **Financial numbers**: `font-mono`. Large amounts pair `text-2xl font-bold` dollars with `text-sm` cents.
- **Touch targets**: min 44×44px (`min-h-[44px] min-w-[44px]` or `p-3`).
- **Safe areas**: header top `calc(0.75rem + env(safe-area-inset-top))`, bottom nav `env(safe-area-inset-bottom)`.

## Testing layout

`tests/unit/` (vitest + happy-dom) · `tests/integration/` (@vue/test-utils + mocked worker) · `tests/e2e/` (Playwright) · `tests/a11y/` (Playwright + `@axe-core/playwright`, 44px target audit).

## Config

- `capacitor.config.ts` — appId `app.hearth.family`, webDir `.output/public`.
- `app/app.config.ts` — Nuxt UI: primary `amber`, neutral `slate`.
- `biome.json` — single quotes, 2-space, 100-char.
