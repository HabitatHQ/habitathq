# Hephaestus Completion Plan

**Date:** 2026-10-02  
**Repository baseline:** `0ea7eb9c86241afb8cb277f9b4406a0447695003` (`main`, updated from `origin/main`)  
**Status:** Local-PWA milestones 1–6 implemented in `feat/hephaestus-completion`; package, production-browser, and installed/offline acceptance verified. Workspace dedupe remains a reproduced baseline guardrail failure. Optional cross-device sync remains a separate milestone with prerequisites documented.

## Product decisions

- Audience: independent lifters.
- Training modes: strength/hypertrophy, running/cardio, mixed conditioning, and mobility/recovery.
- First completion milestone: local-first installable PWA; no native-device release gate.
- Data: Palladium is the required data layer for local persistence and the later optional cross-device sync. Complete local correctness first; sync is a later milestone.
- Workout experience: fast, flexible logger, editable suggestions; refine the current Hephaestus/Forge visual direction.
- Programming: multi-week programs and transparent progression suggestions that are user-overridable; no fitted strength-curve model in this milestone.
- Sessions: recover active workouts locally after reload; one device writes an active session at a time.
- Progress: lifting progression, cardio/conditioning trends, and training-load/readiness estimates. Measurements/bodyweight are deferred.
- Data portability for local release: complete backup/restore, workout-history CSV, portable templates/programs, and workout summary image cards.
- Equipment: manual weight entry remains available; optional per-exercise equipment profiles inform suggestions and round loads to available increments.
- Out of scope for local completion: native release, GPS route tracking, body measurements, research-grade adaptive strength curves, concurrent active-workout multi-device edits, and external health integrations.

## Baseline and evidence

- `apps/hephaestus/app/pages/index.vue` displays Today metrics and a start-workout link; `/workout` displays template selection and empty-session start.
- Browser smoke: started an empty session, then reloaded `/workout`; the rendered page returned to the template/start screen without offering to resume. This establishes a consumer-visible local recovery gap.
- `apps/hephaestus/app/composables/useWorkout.ts`: `startWorkout()` inserts a gym session and starts in-memory elapsed-time state (lines 42–81); `finishWorkout()` separately writes completion, PRs, weekly aggregate, then clears memory (288–368). Completion is not one recoverable atomic operation.
- `apps/hephaestus/app/workers/database.worker.ts` `NUKE_OPFS` (54–68) iterates the origin OPFS root and recursively removes every entry; source comment explicitly identifies sibling-app data loss. `apps/hephaestus/app/lib/db-native.ts` must be audited alongside it for reset parity.
- `apps/hephaestus/app/components/workout/TemplatePreviewSheet.vue` emits scale/excluded exercise options (15–19, 39–44); `apps/hephaestus/app/pages/templates/[id].vue` `handleStartConfirm` ignores them (54–64).
- `apps/hephaestus/app/composables/usePrograms.ts` `getProgress()` compares `program_days.day_num` to `Date.getDay()` (84–107); validate the intended day numbering and Sunday boundary as part of schedule semantics.
- `apps/hephaestus/app/composables/usePrograms.ts` built-in seed writes multiple records and marker separately (109–128); `useWorkout.ts` finish and `useTemplates.ts` create/clone also have multi-write boundaries. Partial-failure behavior needs explicit acceptance and transactional implementation.
- `apps/hephaestus/app/lib/db-schema.ts` executes squashed DDL plus add-column migrations (worker lines 41–42); migration tests exist, but startup interruption, adapter parity, and legacy fixtures require release-level coverage.
- PWA setup, OPFS, Capacitor path, service worker, many workout/template/program/cardio/progress features are already present. `design.md`, `template-improvements.md`, and `issues.md` are historical sources, not authoritative backlog; reconcile them after implementation decisions.
- `pnpm --filter hephaestus run ci` passed `biome check`, `tsgo --noEmit`, and all 465 unit/integration tests; Biome reported 27 warnings. It did not run Playwright.
- `pnpm --filter hephaestus verify` fails because its script runs `pnpm ci`, invoking pnpm’s built-in unsupported command rather than this package’s `ci` script. `pnpm --filter hephaestus test:unit` initially failed resolving Vitest while package dependencies were being installed; the subsequent package `run ci` completed all 465 tests.
- Browser UI was exercised on a 390×844 viewport. CurveFit inspiration reviewed: equipment-aware increments, quick RIR entry, editable suggestions, explicit modeling limits. Adopt UX patterns only; no claim or commitment to its statistical model.

## Ordered completion work

### 1. Establish a trustworthy package gate

**Targets:** `apps/hephaestus/package.json`, applicable workspace/package command docs, CI references if present.

- Fix `verify` so it invokes the package’s own `ci` script rather than `pnpm ci`.
- Resolve all 27 observed Biome warnings rather than leave a permanently noisy release gate.
- Confirm `verify` runs check, TypeScript typecheck, and the complete unit/integration suite. Keep Playwright as a separate explicit PWA E2E gate or deliberately include it only when browser installation/runtime is available.

**Acceptance:** `pnpm --filter hephaestus verify` exits zero and reports its executed commands; no warning-only escape hatch; package documentation lists actual behavior.

### 2. Protect data and define adapter/platform behavior

**Targets:** `apps/hephaestus/app/workers/database.worker.ts` (`NUKE_OPFS`), `app/lib/db-native.ts` dispatcher, `app/plugins/database.client.ts`, `app/composables/useDatabase.ts`, `app/lib/db-schema.ts`, profile/data-management UI, and corresponding integration tests; integrate through the applicable `@palladium/core` schema/engine APIs and SQLite adapters.

- Make reset strictly target Hephaestus-owned database files/directory, never the origin OPFS root or sibling app directories. Add explicit confirmation and define whether settings/local preferences are also reset.
- Make reset behavior real and equivalent on each supported code path; remove native no-op behavior if native remains in supported app surface, or label native unavailability honestly.
- Review browser-only Web Locks use against the actual native initialization path; avoid starting a PWA worker for native if the adapter contract doesn't require it.
- Document the PWA-only release constraint and isolate unsupported native behavior rather than implying feature parity.
- Establish Palladium as the local persistence/schema boundary—not merely a sync client. Inventory direct-SQL composable calls and migrate data operations to the appropriate Palladium engine/transaction/schema APIs while retaining the existing browser/native SQLite adapters as storage backends where supported. Do not design app behavior around an invented Palladium API; first verify current exports/capabilities and identify genuine gaps.
- Verify schema initialization and retry across current schema, older partial schemas, and interrupted add-column migrations for the local adapter path; preserve existing user data when adopting Palladium schema management.

**Acceptance:** reset removes only Hephaestus data; a sentinel file/database in another app's OPFS directory remains readable. Reset is confirmed and reports completion/failure. Startup/migration retries do not corrupt or strand a valid prior database. Browser PWA works in clean and upgraded profiles. Local read/write/schema operations use the agreed Palladium boundary and tests prove the app-visible behavior.

### 3. Make local workout logging durable and resumable

**Targets:** `app/composables/useWorkout.ts` (`startWorkout`, set logging, timer state, `finishWorkout`), `app/pages/workout/index.vue`, `app/types/database.ts`, schema only if required, `tests/integration/workouts.test.ts`, `tests/e2e/workout.spec.ts`, `finish-workout.spec.ts`.

- Hydrate the newest unfinished session, its exercises, sets, and elapsed-time basis on app/workout startup; offer a clear resume/discard decision and never silently start a second active session.
- Persist timer start/stop timestamps rather than treating interval tick count as durable time; define background/reload behavior for PWA, and make rest-timer remaining time recoverable or explicitly ephemeral.
- Make finish idempotent and failure-safe: session completion, PR writes, and weekly aggregates must not double-count on retry or remain falsely complete after a failed write. Use the existing adapter transaction capability where it is actually supported; otherwise design a Palladium-backed transaction boundary before splitting mutations.
- Maintain one active writer: a second tab/device must not silently overwrite or duplicate active session state. Define local tab locking/handoff without attempting concurrent sync editing.
- Retain per-set immediate persistence and make post-write UI state reflect committed database state.

**Acceptance:** log a set, reload, and resume with the same session, exercise/set data, and credible elapsed time; finish once and retry safely without duplicate PR/load totals; simulated operation failure yields either a fully recoverable unfinished session or a fully committed completed workout.

### 4. Complete fast logging, mode semantics, and training-plan actions

**Targets:** `app/composables/useWorkout.ts`, `app/pages/workout/index.vue`, set-entry and exercise components, `app/lib/progression.ts`, `app/lib/set-schemes.ts`, `app/composables/usePrograms.ts`, program and interval pages, `app/lib/pace.ts`, `app/lib/db-schema.ts`/types as needed.

- Treat workout session type as a real domain value rather than always inserting `'gym'`; ensure manual running/cardio and interval/circuit/mobility sessions have usable capture paths instead of only schema fields.
- Provide quick logging with unit-aware manual entry, optional RIR, correction/edit, and clear user override of suggestions.
- Add optional per-exercise equipment profiles (minimum/increment/maximum and configurable additional available loads), profile CRUD, and unit conversion between kg/lb without rewriting stored canonical values incorrectly. Profiles improve suggestion rounding, never block manual overrides.
- Implement the template preview’s declared scaling and exercise exclusion choices or remove misleading controls; carry selected options through session exercise creation and planned sets.
- Complete program lifecycle: schedule day numbering contract including Sunday, bounded week advancement/completion, deload/intensity/volume modifiers, attach/start assigned workout, and explainable progression suggestions. Missed days remain flexible; suggestions can be edited, skipped, or disabled.
- Implement interval/circuit progression/session flow for mixed conditioning and mobility/recovery where absent. Keep cardio data out of resistance-only e1RM models.

**Acceptance:** strength template with included/excluded exercises and changed scale starts with exactly those options; machine-profile suggestions land on configured loads while manual overrides remain valid; weekly schedule gives correct day at every weekday boundary; strength, cardio/interval, and mobility sessions can be logged, completed, and filtered without wrong-mode statistics.

### 5. Finish progress, backup/restore, and exports

**Targets:** `app/composables/useProgress.ts`, `app/pages/progress/index.vue`, history pages, `app/lib/analytics.ts`, `training-load.ts`, `readiness.ts`, template import/export utilities/components, data-management UI, schema and tests.

- Define and test date/timezone, incomplete session, missing-data, and mode boundaries for lifting, cardio/conditioning, training load, and readiness. Present readiness/load as estimates, not diagnosis or authoritative recovery prescriptions.
- Implement full versioned local backup and validated restore with preview and failure-safe replacement; include templates/programs and supported local state, exclude transient runtime state. Validate format/version/content before mutation; a failed restore must leave the existing database intact. Exercise filesystem/database scope isolation.
- Add workout-history CSV export with documented column/unit/date semantics and proper quoting; include empty and comma/newline/unicode values in tests.
- Add portable template/program export/import with preflight validation and duplicate/conflict handling; do not silently create partially imported content.
- Add completed workout image card generation with privacy-conscious defaults and accessible non-image summary alternative.

**Acceptance:** backup→clear test profile→restore reproduces workouts, sets, templates/programs, and history; malformed/unsupported backup leaves existing data unchanged; CSV imports in standard spreadsheet readers and preserves escaped fields; exported template/program imports function; card agrees with saved summary.

### 6. Refine PWA interface and release readiness

**Targets:** `app/layouts/default.vue`, app navigation, `app/pages/index.vue`, workout/template/history/progress/profile routes, shared UI components, `nuxt.config.ts`, `app/workers/sw.ts`, icons/manifest assets, `tests/e2e/**`, `tests/a11y/**` if present.

- Refine forge visual hierarchy and gym ergonomics, retaining existing brand: one-hand controls, clear active-set feedback, legible timer, responsive keyboard/screen-reader semantics, usable empty/error/offline states.
- Keep installed PWA manifest, offline shell, OPFS COOP/COEP requirements, and scope-aware service-worker behavior intact.
- Add populated-data E2E for create template → start → log/edit sets → reload/resume → finish → inspect history/progress → export/restore. Add reset-isolation, profile rounding, cardio/interval, backup-invalid input, and date-boundary regression coverage.
- Run axe and mobile viewport checks on key routes, then execute PWA static generation/build and manual installed-PWA/offline smoke.
- Update app `AGENTS.md`, `design.md`, `template-improvements.md`, `issues.md` or replace obsolete status content only after source behavior has changed; state implemented vs deferred accurately.

**Acceptance:** full local PWA user journey works across reload, offline shell launch, and restore; no broken actionable controls; key screens pass keyboard/a11y checks and mobile viewport review; production PWA generation succeeds with headers/manifest/service worker verified.

### 7. Optional Palladium cross-device sync (follow-on milestone)

**Targets:** Hephaestus database schema/operation model, Palladium integration point in `app/plugins/database.client.ts` and browser storage worker/native adapter, account/auth integration (to be designed), sync status/recovery UI, isolated Palladium integration tests and server configuration only after prerequisites are known.

- First inventory Hephaestus entities and ownership/deletion semantics and classify which data syncs. No body-measurement sync is needed because measurements are deferred.
- Design schema identity, UUIDv7 replicated-row IDs, canonical Palladium Changes, durable outbox, server authorization/scope, conflict policy, quarantine/retry/discard UX, and one-writer active-session handoff. Do not invent an Hephaestus-specific parallel wire protocol.
- Keep local-only use functional without sign-in; sync is explicit opt-in with data scope, deletion, account loss, and recovery behavior disclosed.
- Validate through Palladium’s current `SYNC-PROTOCOL-v1.md` and `TESTING-SYNC.md`, plus Hephaestus application-level two-device scenarios; do not claim engine-level simulation alone proves full app correctness.

**Acceptance:** two authorized devices converge on supported workout/template/program data after offline edits and restart; malformed page/receipt or server loss does not lose local writes or advance unsafe checkpoints; conflicting edits follow documented policy; opt-out and local-only mode remain usable. This is a separate milestone after the local release.

#### Sync prerequisite inventory

No Hephaestus account provider, authorized server scope, or account/deletion/recovery contract is configured. The local release does not attach a `SyncTransport`, create an outbox, or imply cross-device convergence.

| Data class | Follow-on classification |
| --- | --- |
| Completed workouts, exercise snapshots, sets, runs/splits, workout tags | Private user-owned training history; parents and children require atomic canonical Changes and explicit deletion semantics. |
| Custom exercises, templates/exercises/groups, folders/membership, tags, programs/weeks/days, equipment profiles, interval templates, training blocks | Private user-owned planning/reference data; define collision and deletion policy before replication. Built-in seeds need stable identity instead of independent random local IDs. |
| Active workouts, timer basis, active program position | One-writer state; server-enforced ownership/handoff must be designed before another device can mutate an active session. Local Web Locks are not cross-device authorization. |
| Personal records and weekly load | Derived values; recompute from authoritative completed sessions rather than independently merge additive totals. |
| Theme/units/feature preferences, seed markers, worker lifecycle, modal/rest-timer UI | Device-local by default; do not sync runtime state or copy seed markers between independent installations. |
| Legacy body metric/photo tables | Preserved locally for data compatibility; no new measurement UI or sync scope in this release. |

The follow-on must adopt canonical UUIDv7 replicated-row identities and Palladium engine schema identity, not reinterpret existing local UUIDv4 rows as sync-ready. It must use Palladium's authenticated v1 receipts, append-position pages, `_sync_outbox`, and quarantine/recovery lifecycle from [`SYNC-PROTOCOL-v1.md`](../../libs/palladium/docs/SYNC-PROTOCOL-v1.md). Authorization is server-derived; a replica ID is not a credential. Design identity conversion, FK preservation, account loss/opt-out, and one-owner handoff together after the provider/server prerequisites are approved.

Two-device application tests and the real-server gates in [`TESTING-SYNC.md`](../../libs/palladium/docs/TESTING-SYNC.md) are mandatory for that milestone. Local-PWA tests and engine simulations are not substitutes for that evidence.

## Sequencing and dependencies

1. Fix package gate and perform safety audit; both are prerequisites for trustworthy release work.
2. Establish data ownership/reset and migration behavior before adding more persisted fields.
3. Define stable session/type/profile schema and recovery semantics before sync-facing schema identity.
4. Implement workout lifecycle and logging before mode analytics and export summaries.
5. Complete programs/equipment profiles and cross-mode sessions before final progress calculations.
6. Implement backup/restore and import/export after local schema and ownership settle.
7. Refine UI, add full populated-path E2E, and release only after local PWA acceptance.
8. Start optional Palladium sync only after local behavior/schema is stable and auth/server prerequisites are specified.

## Release gates

- `pnpm --filter hephaestus verify` (check, typecheck, all unit/integration tests).
- `pnpm --filter hephaestus test:e2e` (Playwright Chromium; required for release workflow).
- PWA production generation/build plus actual browser smoke at mobile viewport, including installed/offline shell and backup/restore.
- Reset isolation sentinel proof and legacy-schema startup/upgrade tests.
- No unresolved known data-loss bugs, silent non-resumable active sessions, misleading dead controls, or unlabelled unsupported workflows.
- Full Palladium sync protocol/real-server validation is a gate for the later sync milestone, not the local-only PWA milestone.

## Implementation evidence

- The worker uses Palladium schema/storage transactions for startup, durable session operations, and atomic transfer/reset operations. Native database operations reject explicitly; no native release is claimed.
- `verify` now runs the no-warning Biome gate, tsgo and Vue template typechecks, and unit/integration tests. The package run passed 488 tests across 42 files.
- A production mobile browser exercised strength logging, reload/resume, completion, offline history, and valid backup export/preview/confirmed database-and-settings restore. Browser verification exposed and fixed reactive-object cloning at both worker transfer and settings validation boundaries, including nested warm-up arrays after preferences change. The final populated browser regression verifies restored history, templates, PRs, theme, and edited warm-up preferences after reset and reload.
- A real installed Chrome PWA reproduced an offline navigation defect: Nuxt precaches the index shell as the registration scope root, not `index.html`. The service worker now resolves the canonical root cache key; the browser regression covers offline start and reload recovery.
- Root dependency-cruiser and severity-ERROR Semgrep checks passed. Workspace dedupe remains a baseline guardrail failure: `pnpm dedupe --check` reports dependency/peer snapshot changes across the workspace. In a disposable export of baseline `0ea7eb9`, `corepack pnpm@11.13.1 dedupe --lockfile-only --ignore-scripts --offline` removed 61 existing older package entries and added no package versions. These include Vue/compiler/runtime 3.5.33, 3.5.34, 3.5.40, and 3.5.41 consolidated onto the already-locked 3.5.43, plus older Babel, PostCSS, semver, and YAML entries. The check fails because this graph consolidation would change the lockfile; that workspace-wide rewrite was not applied as part of the app release.
- With explicit approval for an isolated privileged Chrome debugging pipe, the actual PWA was installed and launched in standalone mode. After stopping its HTTP server, a cold standalone launch recovered the stored session and resumed it with `online=false`, `crossOriginIsolated=true`, and a service-worker controller. The temporary app was uninstalled and its isolated profile removed afterward.
- Final verification passed: `pnpm --filter hephaestus verify` (zero Biome warnings, tsgo + Vue typechecks, 488 unit/integration tests), `pnpm --filter hephaestus build:pwa`, and the complete production Chromium suite via `pnpm --filter hephaestus exec playwright test --retries=0` (121 tests). Browser coverage includes all three themes, mobile accessibility, reset isolation, offline recovery, session modes, equipment suggestions/manual overrides, and the populated backup/reset/restore journey. Obsolete wording/default-only tests were removed rather than repinned.
- Integration with current `main` (`1bd6b08`) rebuilt the Palladium core/browser/Nuxt dependencies, then passed the same package gate, production build, and all 121 production-browser tests again. Publication uses `[skip ci]` by explicit request; this suppresses new push-triggered Actions runs without disabling repository workflows permanently.

## Deferred backlog

Native Capacitor release/device certification; GPS/background route tracking; health integrations; fitted per-exercise strength curves and statistical confidence UI; multi-device concurrent active session editing; bodyweight/measurements; public social/sharing feed; account service/auth selection for sync. Revisit only with an explicit product decision.
