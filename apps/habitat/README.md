# Habitat

A habit tracker that lives entirely on your device. No accounts, no servers, no sync — just your data, stored locally using SQLite in the browser.

## Philosophy

Habit tracking shouldn't require trusting a third party with your personal data. Habitat takes the opposite approach: all data is stored on-device using SQLite WASM with the browser's Origin Private File System (OPFS). There's no backend, no analytics, and nothing leaves your device unless you explicitly export it.

The same codebase ships as a PWA (installable web app) and as native iOS/Android apps via Capacitor, with zero changes to the core logic.

## Features

- **Habits** — daily/custom frequency, streaks, completion history
- **Check-ins** — templated questionnaires for reflection (morning, evening, weekly)
- **Journal** — daily freeform notes (stored in localStorage)
- **TODOs** — recurring and one-off tasks
- **Stats** — completion trends and streaks
- **Export/Import** — full JSON backup, voice notes ZIP

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Nuxt 4 (SPA mode, no SSR) |
| UI | Nuxt UI 4 (Tailwind v4) |
| Database | SQLite WASM + OPFS (web) / `@capacitor-community/sqlite` (native) |
| Native | Capacitor 8 (iOS + Android) |
| PWA | `@vite-pwa/nuxt` |
| Linter | Biome |

## Architecture

All database work runs in a **Web Worker** to keep the main thread unblocked. Pages communicate through a typed message bus: `useDatabase()` composable → `database.client.ts` plugin (UUID-correlated request/response) → `database.worker.ts` (SQLite WASM).

On native, the same message types are dispatched directly to `@capacitor-community/sqlite` instead of the worker.

```
app/
  pages/          # File-based routes
  layouts/        # default.vue — header + bottom nav
  composables/    # useDatabase, useHaptics, usePlatform
  plugins/        # database.client.ts — worker/native bridge
  workers/        # database.worker.ts — SQLite WASM engine
  types/          # Shared types (Habit, Completion, worker messages)
  lib/            # db-native.ts — Capacitor SQLite implementation
  assets/css/     # Tailwind + safe-area utilities
```

## Getting Started

**Prerequisites:** Node.js 20+, pnpm

```bash
pnpm install
pnpm dev         # dev server at localhost:3000
```

Build for production:

```bash
pnpm build:pwa        # static PWA output → .output/public/
pnpm build:native     # build + sync to Capacitor native projects
```

Run on device:

```bash
pnpm cap:run:ios
pnpm cap:run:android
```

Code quality:

```bash
pnpm check        # lint + format check
pnpm check:fix    # auto-fix
pnpm typecheck    # TypeScript
```

## Notes

- No tests exist in this project.
- OPFS requires `Cross-Origin-Isolation` headers (`COOP`/`COEP`), handled by `coi-serviceworker` in dev and the PWA service worker in production.
- The `BUILD_TARGET` env var (`pwa` | `native`) controls whether the PWA manifest/service worker are bundled.
