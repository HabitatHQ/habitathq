---
scope: apps/hephaestus
applies_to: "apps/hephaestus/**"
last_verified: 2026-10-02
---

# Hephaestus

Local-first workout tracker for independent lifters. The release target is an installable Nuxt 4 PWA using Palladium schema/storage transactions over SQLite WASM + app-scoped OPFS. Capacitor dependencies remain in the repository, but native builds and native database operations are not a supported release surface.

## Product boundary

- Supported sessions: strength/hypertrophy (`gym`), manual run/cardio (`run`), mixed conditioning, and mobility/recovery. Historical `other` rows remain readable.
- One unfinished session and one browser writer at a time. The workout page explicitly resumes or discards durable unfinished data.
- Readiness and training load are estimates, not medical advice.
- Backup/restore and exports are local-only. Palladium cross-device sync remains deferred until account, authorization, identity-conversion, deletion, and recovery contracts are approved.
- Body metrics/photos, GPS, health integrations, and native certification are deferred. Preserve legacy tables/data; do not add new UI that implies support.

## Database path

Pages/composables send serialized requests through `useDatabase()` → `database.client.ts` → `database.worker.ts`. The worker owns `BrowserSqliteAdapter`, the Palladium `DbAdapter` transaction bridge, schema application, and domain dispatchers. Additions must use a typed domain operation or `batch()` for atomic multi-write behavior; never create another connection or mutate OPFS directly.

Schema startup must preserve unversioned and partially migrated installs. Baseline DDL, additive repair, workout/equipment schema, and version stamp share a transaction. Clear-data is a confirmed logical delete of Hephaestus app tables; it keeps Palladium/SQLite metadata, local preference settings, and every sibling-app OPFS directory.

## Commands

```bash
# No-warning package gate: Biome check, tsgo + Vue typechecks, all unit/integration tests.
pnpm --filter hephaestus verify

# Production PWA generation, static COOP/COEP preview, Playwright Chromium tests.
pnpm --filter hephaestus test:e2e

# Individual gates.
pnpm --filter hephaestus check
pnpm --filter hephaestus typecheck:all
pnpm --filter hephaestus test:unit
pnpm --filter hephaestus build:pwa
```

`test:e2e` builds the PWA before launching Playwright. The generated service worker and offline shell are therefore exercised instead of Nuxt development behavior.

## Conventions

- Store weight canonically in kilograms; convert only at input/display boundaries. Equipment profiles round suggestions and never reject manual loads.
- Program weekdays are Monday=1 through Sunday=7.
- Use the saved workout local calendar date for history, PR, and weekly-load grouping; use ISO timestamps for elapsed time.
- PR/e1RM logic accepts completed strength sets only. Cardio, conditioning, mobility, warm-up, and unfinished data must not enter it.
- Programmatic modals use Nuxt UI modal primitives plus `useModalFocus()` so focus traps, Escape close, and opener restoration remain keyboard-safe.
- PWA icons must come from the locally installed Phosphor collection; no remote icon API is available offline.
