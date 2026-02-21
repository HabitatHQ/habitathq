# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev              # Start dev server (PWA mode)

# Build
pnpm build:pwa        # Build PWA (nuxt generate)
pnpm build:native     # Build PWA + sync to Capacitor native projects

# Code quality
pnpm lint             # Run Biome linter
pnpm lint:fix         # Auto-fix lint issues
pnpm format           # Format with Biome
pnpm check            # Biome check (lint + format combined)
pnpm check:fix        # Auto-fix lint + format
pnpm typecheck        # TypeScript type checking

# Native (Capacitor)
pnpm cap:run:ios      # Build and run on iOS
pnpm cap:run:android  # Build and run on Android
pnpm cap:sync         # Sync web assets to native projects
```

There are no tests in this project.

## Architecture

Habitat is an offline-first habit tracker PWA with Capacitor support for native iOS/Android. Data lives entirely on-device.

### Data Layer

All database operations run in a **Web Worker** (`app/workers/database.worker.ts`) using SQLite WASM with OPFS (Origin Private File System) for persistence. The worker pattern keeps the main thread unblocked.

Communication flow:
1. Pages/composables call functions from `useDatabase()` composable
2. `useDatabase` sends typed messages to the worker via the plugin's message bus
3. `app/plugins/database.client.ts` manages the Worker instance, correlates requests/responses with UUIDs, and resolves pending Promises
4. The worker handles messages, executes SQLite queries, and `postMessage`s results back

**Database schema** (two tables):
- `habits` — id, name, description, color, icon, frequency, created_at, archived_at, tags, annotations
- `completions` — id, habit_id, date, completed_at, notes, tags, annotations

Journal entries are stored separately in **localStorage** (key: `journal-YYYY-MM-DD`), not in SQLite.

### App Structure

```
app/
  pages/         # File-based routes (index, habits, journal, voice, stats)
  layouts/       # default.vue — header + bottom nav tabs
  composables/   # useDatabase, useHaptics, usePlatform
  plugins/       # database.client.ts — Worker lifecycle + message bus
  workers/       # database.worker.ts — SQLite WASM engine
  types/         # database.ts (Habit, Completion, worker messages), journal.ts
  assets/css/    # main.css — Tailwind + Nuxt UI, safe-area utilities
```

### Build Targets

The `BUILD_TARGET` env var (`pwa` or `native`, defaults to `pwa`) controls whether the PWA manifest and service worker are included. SSR is disabled; the app generates as a static SPA.

### Platform Detection

`usePlatform()` composable detects native vs. web runtime. `useHaptics()` wraps Capacitor haptic feedback and is a no-op on web.

### Key Config Files

- `nuxt.config.ts` — PWA manifest, Vite worker ES module format, WASM exclusions from esbuild optimization
- `biome.json` — Linting rules (cognitive complexity max 20, strict unused var/import errors)
- `tsconfig.json` — Strict TypeScript with `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- `capacitor.config.ts` — App ID `com.habitat.app`, web dir `.output/public`
