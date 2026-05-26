# Habitat — Agent Guide

Offline-first habit tracker PWA (Nuxt 4 SPA + Capacitor 8). All data on-device.

## Commands

```bash
pnpm dev              # Dev server (PWA)
pnpm build:pwa        # Build PWA
pnpm build:native     # Build + cap sync
pnpm check:fix        # Lint + format (run before finishing)
pnpm typecheck        # TypeScript check
pnpm cap:run:ios      # Run on iOS
pnpm cap:run:android  # Run on Android
```

## Architecture

**Web**: Pages → `useDatabase()` composable → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (`BrowserSqliteAdapter` via `@palladium/sqlite-browser`, `opfs-sah-pool` VFS)

**Native**: Same composable → `db-native.ts` (`CapacitorSqliteAdapter` via `@palladium/sqlite-capacitor`, no worker)

Both paths share `WorkerRequest` / `WorkerResponse<T>` message types and use `DbAdapter` / `toDbAdapter` / `toCapacitorDbAdapter` from `@palladium/core`. Schema migrations and seeds are managed via Palladium's `SchemaConfig` + `applySchema()`.

**Blob storage**: Voice and image note binary data is stored in IndexedDB via `IDBBlobAdapter` from `@palladium/core` (DB name: `habitat-blobs`). Metadata (mime type, duration, filename, timestamps) lives in SQLite tables (`voice_notes`, `image_notes`).

## Key Files

| File | Purpose |
|------|---------|
| `app/lib/db-shared.ts` | All ~80 DB operations as `async fn(db: DbAdapter, ...)` — single source of truth |
| `app/workers/database.worker.ts` | SQLite WASM engine, schema, migrations; `WorkerDbAdapter` + compact switch |
| `app/lib/db-native.ts` | Capacitor SQLite; `NativeDbAdapter` + compact switch — delegates to db-shared |
| `app/lib/db-parsers.ts` | Shared row-to-type parsers used by db-shared.ts |
| `app/plugins/database.client.ts` | Worker lifecycle, UUID request/response correlation |
| `app/composables/useDatabase.ts` | All DB ops exposed to pages |
| `app/composables/useAppSettings.ts` | Feature flags + UI prefs (localStorage) |
| `app/composables/useNotifications.ts` | Notifications (web + native) |
| `app/composables/useTimer.ts` | Timer/Focus feature (stopwatch, countdown, pomodoro) |
| `app/composables/useLongPress.ts` | Long-press handler (pointerdown + timeout, cancels on move/up) |
| `app/components/AppModal.vue` | Reusable modal (v-model, title prop, #default + #footer slots) |
| `app/composables/useCrudForm.ts` | Generic add/edit form state (item ref, open/close, isEditing) |
| `app/utils/icons.ts` | Habitat-specific icon picker constants (`HABIT_PICKER_CATEGORIES`, `HABIT_COLORS`). Shared registry (`iconRegistry`, `resolveIcon`, `<AppIcon>`) is in the `@habitathq/shared` Nuxt layer / `@habitathq/utils` package — auto-imported. |
| `app/types/database.ts` | All types, WorkerRequest union, DbAdapter interface, export types |
| `app/layouts/default.vue` | Header + bottom nav (filtered by settings flags) |
| `app/utils/` | Pure helpers: `format.ts`, `scribble.ts`, `habit-helpers.ts`, `checkin-helpers.ts`, `todos-helpers.ts`, `error.ts` |
| `app/assets/css/main.css` | Tailwind v4 + Nuxt UI entry, `@theme` font-stack overrides, global utilities |
| `app/assets/css/typography.css` | Semantic typography classes: `type-timer`, `type-duration`, `type-code`, `type-numeric` |
| `app/assets/css/themes.css` | Forest / Ocean / Habitat colour themes, sprout logo animation |

## Schema (user_version = 19, managed by Palladium SchemaConfig)

habits, completions, habit_schedules, habit_logs, checkin_templates, checkin_questions, checkin_responses, checkin_reminders, checkin_completions, scribbles, reminders, bored_categories, bored_activities, todos, voice_notes, image_notes, applied_defaults, _palladium_seeds

Journal entries: localStorage (`journal-YYYY-MM-DD`).
Voice/image binary data: `IDBBlobAdapter` (`habitat-blobs` IndexedDB). Metadata in SQLite.

## Adding a DB Operation

1. Add message type to `WorkerRequest` union in `app/types/database.ts`
2. Implement as `export async function myOp(db: DbAdapter, ...)` in `app/lib/db-shared.ts`
3. Add `case 'MY_OP': result = await shared.myOp(adapter, req.payload); break` in `database.worker.ts`
4. Mirror the same case in `db-native.ts` `dispatchNative` switch
5. Expose in `useDatabase.ts` via `sendToWorker()`

Schema changes: increment `version` in `SCHEMA_CONFIG` (in `db-schema.ts`), add migration SQL/callback to the `migrations` map. Both worker and native paths use `applySchema(storage, SCHEMA_CONFIG)` automatically.

## Pages

Pass-through parents (`habits.vue`, `checkin.vue`, `bored.vue`, `jots.vue`, `settings.vue`) contain only `<NuxtPage />` — required for nested routing. Dynamic children use `[id].vue`.

Routes: `/`, `/matrix`, `/habits`, `/habits/[id]`, `/health`, `/todos`, `/bored`, `/bored/activities`, `/checkin`, `/checkin/[id]`, `/jots`, `/jots/new`, `/jots/edit-[id]`, `/stats`, `/archive`, `/settings`, `/settings/display`, `/settings/features`, `/settings/notifications`, `/settings/permissions`, `/settings/data`, `/settings/more`

## Conventions

**TypeScript**: `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` — use bracket notation for index properties, no `as` casts to suppress errors.

**Feature flags**: add to `AppSettings` in `useAppSettings.ts`, gate nav item in `default.vue`. Current flags: `enableToday`, `enableJournalling` (gates `/checkin` + `/jots`), `enableHealth`, `enableTodos`, `enableBored`, `enableContextFilter`, `enableTimer`.

**Platform guard**: `if (!Capacitor.isNativePlatform())` before any OPFS logic.

**Modals**: use `<AppModal v-model="show" title="…">` with optional `#footer` slot. Avoid manual `Teleport` + fixed overlay patterns.

**CRUD forms**: use `useCrudForm<T>()` composable — returns `{ item, isEditing, open(item?), close() }`.

**Long press**: use `useLongPress(ms, callback)` — returns `{ onPointerdown, onPointerup, onPointermove }` event handlers to spread on the element.

**Error logging**: use `logError(context, err)` from `~/utils/error.ts` instead of `console.error`.

**DB operations in db-shared.ts**: use `db.queryAll` for all fetches (including post-write re-reads). Never use `db.queryOne` in functions that tests may override with call-counter mocks.

**Typography**: use semantic classes from `typography.css` instead of raw `font-mono`/`tabular-nums` combos. `type-timer` — large timer displays; `type-duration` — inline time/duration values (mono + tabular); `type-code` — technical/code text; `type-numeric` — tabular number alignment (keeps sans font). Font stacks are defined via `@theme` in `main.css`.

**Reduced motion**: guard animations with both `@media (prefers-reduced-motion: reduce)` and `:global(html.reduce-motion)`. JS animations: gate with `isMotionReduced()`.

**Guardrails**: see root `CLAUDE.md` → Guardrails for the mechanically-enforced rules. Habitat-specific semgrep rules: `console.error` outside `utils/error.ts` and `db.queryOne` in `db-shared.ts` are blocking errors.

## Config

- `nuxt.config.ts` — COOP/COEP headers (required for OPFS/SharedArrayBuffer), conditional PWA via `BUILD_TARGET` env
- `capacitor.config.ts` — appId `com.habitat.app`, webDir `.output/public`
- `app/app.config.ts` — Nuxt UI: primary `cyan`, neutral `slate`
