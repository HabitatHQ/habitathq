---
scope: apps/hephaestus
applies_to: "apps/hephaestus/**"
last_verified: 2026-10-30
---

# Hephaestus

Local-first workout tracker for independent lifters. The release target is an installable Nuxt 4 PWA using the Palladium engine/client over SQLite WASM + app-scoped OPFS. Capacitor dependencies remain in the repository, but native builds and native database operations are not a supported release surface.

## Product boundary

- Supported sessions: strength/hypertrophy (`gym`), manual run/cardio (`run`), mixed conditioning, and mobility/recovery. Historical `other` rows remain readable.
- One unfinished session and one elected database writer at a time. Browser tabs share that writer through Palladium ownership/failover. The workout page explicitly resumes or discards durable unfinished data.
- Readiness and training load are estimates, not medical advice.
- Backup/restore and exports are local-only. The engine runs without a transport or network endpoint. Cross-device sync remains deferred until account, authorization, deletion, and recovery contracts are approved.
- Body metrics/photos, GPS, health integrations, and native certification are deferred. Preserve legacy tables/data; do not add new UI that implies support.

## Database path

Pages/composables use `useDatabase()` → the Palladium client/typed worker connection → `@palladium/worker` ownership → `createHephaestusBackend()`. The elected worker owns one `BrowserSqliteAdapter` at `/hephaestus/hephaestus.db` and one `PalladiumEngine`. Other tabs forward requests and refresh from committed invalidations; they do not open another database.

All runtime SQL, including multi-step domain operations, executes through the engine-owned capture adapter. Connection-local SQLite triggers collect actual net row changes, including cascades and upserts; savepoint rollback discards preview effects. `captureLocal()` commits those effects, canonical row identities, HLC metadata, and checkpoints together. Use typed domain operations or `batch()` for multi-write behavior; never mutate the engine adapter or OPFS outside owned startup/administrative reset work. Previews and device-local seed bookkeeping are intentionally not replicated entities.

Schema startup preserves unversioned and partially migrated installs. Baseline DDL, additive repair, domain schema, UUIDv7 identity conversion, and the version stamp share a transaction. Natural-key uniqueness remains intact when a table gains a canonical `id`; new durable IDs use `generateUuidV7()`. Remap structured references during migration/import, never user prose.

Clear-data is a confirmed local-only administrative transaction: erase Hephaestus app tables and their row metadata together, retaining engine node/clock identity, preferences, and every sibling-app OPFS directory. Full-backup replacement admits all restored rows and their metadata atomically, even when the backup is identical or contains previously deleted IDs.

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
