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

**Web**: Pages → `useDatabase()` composable → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (SQLite WASM + OPFS)

**Native**: Same composable → `db-native.ts` (Capacitor SQLite, no worker)

Both paths share the same `WorkerRequest` / `WorkerResponse<T>` message types.

## Key Files

| File | Purpose |
|------|---------|
| `app/workers/database.worker.ts` | SQLite WASM engine, schema, migrations, message handler |
| `app/lib/db-native.ts` | Capacitor SQLite mirror of all worker operations |
| `app/plugins/database.client.ts` | Worker lifecycle, UUID request/response correlation |
| `app/composables/useDatabase.ts` | All DB ops exposed to pages |
| `app/composables/useAppSettings.ts` | Feature flags + UI prefs (localStorage) |
| `app/composables/useNotifications.ts` | Notifications (web + native) |
| `app/types/database.ts` | All types, WorkerRequest union, export types |
| `app/layouts/default.vue` | Header + bottom nav (filtered by settings flags) |

## Schema (user_version = 11)

habits, completions, habit_schedules, habit_logs, checkin_templates, checkin_questions, checkin_responses, checkin_reminders, scribbles, reminders, bored_categories, bored_activities, todos, applied_defaults

Journal entries: localStorage (`journal-YYYY-MM-DD`).

## Adding a DB Operation

1. Add message type to `WorkerRequest` union in `app/types/database.ts`
2. Implement in `database.worker.ts` (SQLite query)
3. Mirror in `db-native.ts` (Capacitor SQLite)
4. Expose in `useDatabase.ts` via `sendToWorker()`

Schema changes: increment `user_version`, add migration ALTER TABLE, mirror in `db-native.ts`.

## Pages

Pass-through parents (`habits.vue`, `checkin.vue`, `bored.vue`) contain only `<NuxtPage />` — required for nested routing. Dynamic children use `[id].vue`.

Routes: `/`, `/week`, `/habits`, `/habits/[id]`, `/health`, `/todos`, `/bored`, `/bored/activities`, `/checkin`, `/checkin/[id]`, `/scribbles`, `/voice`, `/stats`, `/archive`, `/settings`

## Conventions

**TypeScript**: `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` — use bracket notation for index properties, no `as` casts to suppress errors.

**Feature flags**: add to `AppSettings` in `useAppSettings.ts`, gate nav item in `default.vue`.

**Platform guard**: `if (!Capacitor.isNativePlatform())` before any OPFS logic.

## Config

- `nuxt.config.ts` — COOP/COEP headers (required for OPFS/SharedArrayBuffer), conditional PWA via `BUILD_TARGET` env
- `capacitor.config.ts` — appId `com.habitat.app`, webDir `.output/public`
- `app/app.config.ts` — Nuxt UI: primary `cyan`, neutral `slate`
