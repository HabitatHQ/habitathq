---
scope: apps/habitat
applies_to: "apps/habitat/**"
last_verified: 2026-05-26
---

# Habitat — Agent Guide

Offline-first habit tracker PWA (Nuxt 4 SPA + Capacitor 8). All data on-device.

> Read root `AGENTS.md` first — shared Nuxt+Capacitor architecture, DB-op pattern, schema migrations, and TypeScript conventions live there. This file only covers what's habitat-specific.

## Verify

```bash
pnpm --filter habitat verify
```

## Key files (habitat-specific)

| File | Purpose |
|------|---------|
| `app/lib/db-shared.ts` | All ~80 DB ops as `async fn(db: DbAdapter, …)` — single source of truth. **Use `db.queryAll` for every fetch; never `db.queryOne` (tests override it).** |
| `app/lib/db-parsers.ts` | Row-to-type parsers used by db-shared. |
| `app/composables/useTimer.ts` | Stopwatch / countdown / pomodoro. |
| `app/composables/useLongPress.ts` | `{ onPointerdown, onPointerup, onPointermove }` for long-press; cancels on move/up. |
| `app/composables/useCrudForm.ts` | Generic add/edit form state: `{ item, isEditing, open(item?), close() }`. |
| `app/components/AppModal.vue` | `<AppModal v-model title>` + `#footer` slot. Replaces manual Teleport+overlay. |
| `app/utils/icons.ts` | Habitat-specific picker constants (`HABIT_PICKER_CATEGORIES`, `HABIT_COLORS`). Shared `<AppIcon>` + `resolveIcon` come from `@habitathq/shared` / `@habitathq/utils`. |
| `app/assets/css/typography.css` | Semantic classes: `type-timer`, `type-duration`, `type-code`, `type-numeric`. Use these instead of raw `font-mono`/`tabular-nums`. |
| `app/assets/css/themes.css` | Forest / Ocean / Habitat themes + sprout logo animation. |

## Schema (`user_version = 19`)

habits, completions, habit_schedules, habit_logs, checkin_templates, checkin_questions, checkin_responses, checkin_reminders, checkin_completions, scribbles, reminders, bored_categories, bored_activities, todos, voice_notes, image_notes, applied_defaults, _palladium_seeds.

- Journal entries: `localStorage` (`journal-YYYY-MM-DD`).
- Voice/image binary data: `IDBBlobAdapter` (`habitat-blobs` IndexedDB). Metadata stays in SQLite.

## Routes

`/`, `/matrix`, `/habits`, `/habits/[id]`, `/health`, `/todos`, `/bored`, `/bored/activities`, `/checkin`, `/checkin/[id]`, `/jots`, `/jots/new`, `/jots/edit-[id]`, `/stats`, `/archive`, `/settings`, `/settings/{display,features,notifications,permissions,data,more}`.

Pass-through parents: `habits.vue`, `checkin.vue`, `bored.vue`, `jots.vue`, `settings.vue`.

## Habitat-specific conventions

- **Feature flags** (gate nav in `app/layouts/default.vue`): `enableToday`, `enableJournalling` (gates `/checkin` + `/jots`), `enableHealth`, `enableTodos`, `enableBored`, `enableContextFilter`, `enableTimer`. Add new flags to `AppSettings` in `useAppSettings.ts`.
- **Platform guard**: `if (!Capacitor.isNativePlatform())` before any OPFS logic.
- **Error logging**: use `logError(context, err)` from `~/utils/error.ts` — `console.error` outside that file is a semgrep error.
- **`db.queryOne` is banned** in `db-shared.ts` (tests override with call counters; queryAll is safe).
- **Reduced motion**: guard CSS animations with both `@media (prefers-reduced-motion: reduce)` and `html.reduce-motion`; gate JS animations with `isMotionReduced()`.

## Config

- `capacitor.config.ts` — appId `com.habitat.app`, webDir `.output/public`.
- `app/app.config.ts` — Nuxt UI: primary `cyan`, neutral `slate`.
