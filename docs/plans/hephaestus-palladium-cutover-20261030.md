# Hephaestus full local-only Palladium cutover

## Approved scope

Extend PR #100 with the full Palladium engine/client path, local-only. No transport, server polling, account dependency, or cross-device-sync claim. Preserve existing OPFS location, all durable application data, units, captured intent, finish receipts, backup/restore, correction previews, and transactional read-your-writes behavior.

## Design

- **Engine ownership:** one `PalladiumEngine` per elected database owner. Queries execute through the engine. All application SQL mutations execute in an engine-owned transaction and produce canonical captured row operations committed with HLC/row metadata. No app write may escape capture after startup.
- **SQL transaction capture:** add a trusted low-level `captureLocal` engine operation accepting an async transaction-scoped storage callback that returns its result and already-applied canonical operations. The engine owns serialization, commit/rollback, metadata/checkpoints, and post-commit invalidation. Existing synchronous `tx` retains its contract. This layered interface preserves SQLite upsert/cascade/savepoint semantics without writing a second SQL parser or preparing transactions against stale reads.
- **SQLite capture adapter:** TEMP change-log triggers capture actual row effects, including cascades. Reduce each row's first-before/last-after snapshots into its net insert/update/delete; savepoint rollback naturally rolls back capture. Exclude Palladium metadata and device-local seed bookkeeping. No full-table copies on each write.
- **Identities:** migrate legacy entity IDs to stable UUIDv7 identities in one deferred-FK transaction, remapping SQL references and structured JSON identities without rewriting user prose. Natural/composite-key tables retain their uniqueness and gain a canonical UUIDv7 `id`. Generate new application row IDs as UUIDv7. Preserve immutable revision/captured-intent semantics and recompute structural fingerprints where identity conversion changes their inputs. Current-schema backups and supported portable formats round-trip; pre-interval version-2 backups have the accepted compatibility limitation below.
- **Client/runtime:** use `@palladium/worker` leadership and typed connection/client operations for query/mutate/domain dispatch. Keep async request failure visible, allow startup recovery and tab failover, and broadcast post-commit invalidations. Do not retain the UUID-message worker path or a second raw application connection.

## Ownership contracts

- `PalladiumEngine.captureLocal<T>()` owns serialization, transaction admission, row metadata, HLC/checkpoints, rollback, and post-commit notifications. Its trusted callback returns accurate, already-applied canonical net operations and must not retain the adapter or re-enter engine methods.
- `db-identity.ts` owns startup/restore conversion and reference remapping. Schema version 4 includes canonical surrogate identities while preserving natural uniqueness and immutable captured facts. Ordinary current-schema startup preserves applicable correction previews; conversion removes previews invalidated by changed identities.
- `sql-change-capture.ts` owns TEMP change-log triggers. Administrative reset suspends only its known DELETE triggers inside the reset transaction, then reinstalls them. Unknown trigger side effects still fail the ownership guard; failure restores the capture triggers with the transaction rollback.
- `createHephaestusBackend(storage, { invalidate? })` returns `{ dispatch, query, mutate, close }`. The worker owns the backend and OPFS lifecycle; `@palladium/worker` elects one owner. All client calls use the shared typed connection, and committed invalidations refresh sibling views without replacing uncommitted active-workout drafts.

## Verification criteria

1. Existing and interrupted legacy databases migrate without losing SQL/JSON references or captured facts; migration is idempotent and rolls back on injected failure.
2. Writes, cascading deletes, upserts, savepoint previews, imports, reset and corrections update real Palladium metadata atomically; failures leave both application rows and metadata unchanged.
3. No network requests or outbox transport start in local-only mode.
4. Actual generated PWA preserves unfinished workout/interval recovery, backup/restore and portability; two tabs share one writer and recover after leader termination without stale transaction reads.
5. Run affected app/core/worker checks and generated-PWA suite; inspect actual browser surface. Report exact evidence and any existing root-wide gate failure.
6. Update architecture instructions and PR evidence, commit and push to the same PR; no merge or deployment.

## Implemented verification

- `pnpm --filter hephaestus verify`: Biome, TypeScript/Vue typechecks, **549 unit/integration tests in 50 files** passed.
- `pnpm --filter @palladium/core verify`: **498 tests**, typecheck and lint passed; three existing cognitive-complexity warnings remain.
- `pnpm --filter @palladium/worker verify`: **21 tests**, typecheck and lint passed. SQLite browser adapter build/typecheck/lint passed.
- `just build-palladium-ts typecheck-palladium-ts test-ts`: maintained package builds/typechecks and **930 tests** passed, including the core and worker totals above.
- Generated production PWA: **111 Chromium tests passed with retries disabled**, including paused intervals, shared writer/owner termination, cross-tab invalidation, offline reload, backup/reset/restore, portability, correction and training workflows. The multi-tab test keeps its original owner mounted until explicit close, so it actually tests owner loss rather than accidentally replacing the owner by navigating it.
- `@palladium/example-multitab`: **3 real Chromium/SQLite-WASM/OPFS tests** passed. Adapter lifecycle coverage includes close/reopen, another live worker acquiring the same pool, failed-start cleanup, and scoped physical reset.
- Direct backend smoke observed a legacy-shaped natural-key table gain UUIDv7 identities and correctly capture a new insert and upsert into real engine metadata. Permanent regressions cover this path, reset rollback/capture restoration, old backup import, migration rollback, reference preservation, and applicable preview survival.
- Interactive generated-PWA smoke preserved the unfinished session across reload and service-worker update without clearing storage, resumed it, added Barbell Squat, completed **80 kg × 6**, and rendered the saved set and **Good** mood in History. Screenshots confirmed the mobile surface; `crossOriginIsolated` was true and document/viewport widths were both 390 px.
- Final icon-bundle rebuild passed all **6 focused PWA/recovery tests with retries disabled**. Bundling the dynamic `ph:circle-notch` loading icon removed the observed Iconify fallback request. After activating the final service worker, interactive Workout/History navigation preserved saved data, made no observed external resource requests, and reported no browser errors.
- `pnpm lint:deps` passed (813 modules / 604 dependencies); `pnpm lint:semgrep` passed for Hephaestus and changed shared runtime sources. Dependency-cruiser excludes generated Playwright reports/results rather than interpreting report-vendor JavaScript as application dependencies.

## Limits

- `pnpm dedupe:check` remains non-green on the existing Nuxt UI/Vite/plugin dependency resolution. No automatic dedupe was applied. Root-wide `pnpm ci`, Rust/server suites, physical devices, Safari/iOS, and native builds were not run.
- Known backup compatibility defect: version-2 full backups created before `workout_interval_sessions` existed are rejected for the missing table. Compatibility repair is intentionally deferred; current-schema backup restoration remains supported.
- The application uses local-only engine capture: no sync transport, server endpoint, account, upload queue, or cross-device guarantee is introduced.
- Browser tests qualify controlled Chromium lifecycle behavior, not power loss, filesystem corruption, or every browser scheduler. An earlier example close-handoff run missed a live-list refresh; the isolated rerun and final complete three-test run passed without an implementation change. This observation is not evidence of physical data loss.
- No merge or deployment is part of this change.
