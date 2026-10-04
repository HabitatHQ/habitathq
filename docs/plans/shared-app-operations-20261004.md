# Shared app operations cutover

## Goal and decisions

Standardise export/restore, user-facing feature toggles, maintenance operations, date/time utilities, database reset, and media storage across Habitat, Hearth, Halcyon, and Hephaestus. Apps declare domain policy and resource ownership; shared code implements mechanics. Media uses one shared API with centrally maintained SQLite and IndexedDB implementations, retaining existing persisted data placement and SQLite cascade guarantees. Delivery includes rebasing onto latest `main` and publishing a PR; merging is not authorised.

Implementation base: default branch `cde2a24`, isolated worktree `.worktrees/shared-app-operations-20261004`, branch `refactor/shared-app-operations-20261004`. Primary checkout and existing worktrees remain untouched. Locked dependency setup completed independently in this worktree.

## Vocabulary

- Calendar date: a valid Gregorian `YYYY-MM-DD` without an implied timezone.
- Instant: a timestamp identifying a point on the timeline.
- Duration: an explicitly named numeric unit, not a calendar-day count.
- Reload: restart presentation without deleting durable data.
- Refresh assets: invalidate only the current app's registrations/caches, preserving records and sibling apps.
- Reset preferences: restore app-owned preference defaults independently of database records.
- Logical database reset: transactional clearing of owned data while preserving declared metadata/schema.
- Physical database reset: storage-owner teardown, app-scoped deletion, and schema reinitialisation.
- Media store: common binary API and lifecycle with configured storage backend and domain-owned metadata.

## Execution order and ownership

1. Inspect updated guides and existing shared helpers. Query LSP references before exported contract changes. Establish one integration owner and disjoint date, storage/media, and operation/UI implementation slices.
2. Extend `libs/habitat-utils/src/format-date.ts` and exports with explicit calendar-date arithmetic, strict parsing, instant/time formatting and duration presentation. Migrate all four apps' duplicated utilities and date/time callers. Preserve app-specific date presentation using shared primitives/options, and distinguish intentional UTC arithmetic from local day-key creation. Settings/data pages are integrated by the operation/UI slice; shared database-dispatcher date edits are integrated centrally to avoid concurrent file ownership.
3. Add centrally maintained database reset mechanisms under Palladium core/browser/Capacitor adapters. Migrate each app's workers/native dispatch and `useDatabase` facade from `NUKE_OPFS`/`nukeOpfs` or `RESET_LOCAL_DATA`/`clearLocalData` to `RESET_DATABASE`/`resetDatabase`, preserving each app's declared logical/physical reset policy. Delete obsolete teardown/delete implementations, including origin-root iteration and ignored deletion failures.
4. Extend Palladium blob lifecycle and SQLite media storage without changing persisted backend placement. Habitat exposes its common media handle as `getMediaStore()`; existing page/share consumers migrate completely. SQLite receipt metadata and bytes remain transactionally linked. Central clear/close and object-URL ownership replace app-local IndexedDB deletion and URL bookkeeping.
5. Add icon-independent shared headless operation controllers and reusable data-action/feature-toggle controls in `libs/habitat-shared`. Share browser download, file selection and app-scoped cache/reload mechanics through framework-independent helpers where appropriate. Adopt in all four apps' settings/data/import-export/profile pages. Preserve every existing format and restore mode, feature dependency rule, confirmation and preference migration. Hephaestus imports the isolated shared primitives without adopting the shared Lucide/CSS layer.
6. Integrate the slices and run formatting, builds, typechecks, tests and browser proofs once implementation settles. Fix contract failures rather than weakening verification assets.

## Shared interfaces

- All four app database facades expose `resetDatabase()` and dispatch `RESET_DATABASE`; storage details remain below the facade.
- Habitat media consumers use `getMediaStore()`, not direct `IDBBlobAdapter` access. The shared handle supports existing binary operations plus clear/close lifecycle.
- Shared operation controllers expose reactive execution/error state and prevent overlapping execution. Destructive confirmation remains a distinct state/action, not an automatically executed callback.
- Reusable feature controls take typed app setting keys/values and app declarations; switching features does not delete data.
- Shared browser maintenance requires explicit app scope/cache ownership. Never enumerate-and-delete all origin resources.

## Preservation and edge cases

- Dates: invalid/leap dates, early/late local day versus UTC, DST transitions, month/year rollover, future relative times, explicit units and locale/hour-cycle options.
- Reset: cancellation is side-effect-free; an injected logical-reset failure rolls back all deleted records; owned metadata and sibling stores survive; repeated reset and post-reset writes work.
- Physical storage: close/release ownership before deletion, including SAH-pool resources; native deletion targets only the configured database. Do not report success for blocked/failed deletion.
- Media: retain existing keys, tables and bytes; preserve receipt foreign-key cascade; invalidate/revoke URLs on close/reset; handle open/blocked IndexedDB teardown explicitly. Cross-SQLite/IndexedDB operations must not claim impossible cross-store atomicity.
- Export/restore: preserve selected Habitat JSON, SQLite database download, Jots ZIP, Hearth JSON, Halcyon JSON/vCard/JSContact, Hephaestus backup/CSV/portable formats and existing restore contracts. Validate at the data boundary, not with type assertions.
- Assets: select registrations by app scope and caches by declared ownership; preserve isolation-header service-worker startup and offline shell functionality.
- Existing user data and unrelated work remain untouched. Browser scenarios use synthetic data in a fresh automation profile.

## Verification gates and expected evidence

- Shared utility/core targeted tests: invalid date rejection, timezone/calendar arithmetic, operation state transitions, storage reset rollback/isolation, media lifecycle and SQLite byte round trips.
- Rebuild Palladium TypeScript packages before app verification so package imports execute new code.
- `pnpm --filter <app> check:fix`, then explicit `pnpm --filter <app> run ci` for habitat/hearth/halcyon/hephaestus; expected formatting/typecheck/unit gates pass without altering tests merely to silence failures.
- `pnpm --filter @habitathq/utils verify`; maintained changed Palladium package lint/typecheck/test scripts.
- `pnpm lint:deps`, `pnpm dedupe:check`, changed-source Semgrep ERROR scan.
- Production/browser smoke: export actual synthetic records in all supported formats; exercise restore/import where exposed; cancel then confirm reset; verify settings/media survive or reset according to the declared policy; reload and write again; exercise feature toggles and app-scoped asset refresh. Use fresh screenshots/accessibility evidence for shared controls.
- Report native device execution separately from adapter/mock verification; do not infer device success from Node tests.

## Completion checklist

- [x] Define shared contracts and app-owned storage/reset policy.
- [x] Centralise calendar-date, instant, time and unit-labelled duration utilities; migrate all four apps' consumers.
- [x] Centralise physical/logical reset and media lifecycle; verify SQLite rollback, namespace isolation and byte preservation.
- [x] Adopt shared operation, confirmation, feature-toggle and download primitives across all four apps.
- [x] Complete final package gates and production-browser export/import/reset/offline scenarios.
- [x] Rebase onto latest `main`, resolve conflicts, rerun affected verification and publish the PR: [#64](https://github.com/HabitatHQ/habitathq/pull/64). No merge performed.

## Completed verification

- Rebased the feature onto `b00a3b8` (`main`'s Habitat correctness fixes); integrated overlapping local-day changes through the canonical calendar-date API. The final Habitat gate caught a missing matrix formatting import, which was corrected.
- App `check:fix` and explicit `run ci` passed: Habitat 687 tests, Hearth 321, Halcyon 232, Hephaestus 519. These gates include native TypeScript and Vue typechecks. Shared utilities passed lint/typecheck and 28 tests; Palladium core passed lint/typecheck and 368 tests. SQLite-browser and SQLite-Capacitor lint/typecheck passed. Dependency-cruiser, dedupe, and changed-source Semgrep ERROR checks passed. All four production PWA builds passed.
- Habitat production: created and exported a real habit; SQLite download had the valid database header; merged the actual JSON export through the file input. Persisted a text Jot and a PNG through the Gallery UI; reload rendered the stored image, and the actual ZIP contained the text and 13,853 PNG bytes. Reset cancellation preserved habit/text/media; confirmed reset cleared records, media stores, and owned journal keys while preserving the complete settings value and an unrelated key. A new habit persisted after reset/reload. The shared Health switch persisted. Asset refresh deleted the exact deployment-owned cache while retaining a sibling cache and the new habit; offline reload retained the habit and cross-origin isolation.
- Hearth production: created a USD 42.37 expense, inspected JSON and queried the SQLite download, then reimported the actual JSON and verified all transaction values. Reset cancellation preserved the expense; confirmed reset preserved preferences and reset Cash to zero. A new USD 7.89 expense survived reload and asset refresh. The sibling cache survived. Runtime caught the shared icon button's unregistered loading glyph; it now uses the existing `arrow-path` glyph, and the rebuilt refresh flow produced no console/page diagnostics.
- Halcyon production: JSON, vCard, and JSContact exports contained actual synthetic contact names; both exposed contact import formats persisted records across reload. Reset cancellation preserved contacts; confirmed reset recreated Personal with a new vault ID, and a new contact persisted after reload/asset refresh. Preferences and a sibling cache survived. No final runtime diagnostics were observed.
- Hephaestus production: authored a 123.5 kg × 7 template with 210-second rest and a completed workout. Actual backup, CSV, and portable downloads contained the exact values. Portable import created distinct IDs without replacing history. Backup restore returned the exact workout, notes, mood/energy, and preferences. Cancellation preserved data; data-only reset preserved settings; the explicitly selected preference reset restored defaults. App/sibling caches and service-worker control survived restore/reset. An 88 kg × 8 post-reset template persisted; the offline shell and unfinished-session resume worked. No runtime diagnostics were observed.
- Fresh screenshots/accessibility evidence covered shared destructive confirmation, feature switches, feedback, and maintenance controls. Synthetic automation tabs were closed; no real user data was exercised.
- PR CI caught Hephaestus lint discovery following its tracked `dist` symlink before `.output/public` exists. Its Biome configuration now explicitly excludes generated `dist` output from traversal. A disposable copy of the actual configuration passed `biome check --error-on-warnings .` with a dangling `dist` symlink; the real app's `check:fix` and explicit `run ci` then passed, including both typechecks and all 519 unit tests.
- The next Hephaestus CI run reached the browser release gate and exposed five obsolete `aria-checked` attribute assertions. The shared native checkbox supplies checked-state semantics without that explicit attribute. Replaced the assertions with keyboard operation and four preference change/restore round trips across reload. The full rebuilt PWA browser suite passed all 112 tests. A separate production-browser smoke observed RPE state through accessibility, toggled it with Space, verified the changed state survived reload, restored it with Space, and captured the checked control without page errors.
- CodeRabbit skipped both review attempts: the initial 173-file head and the subsequent 174-file head exceeded its 100-file limit; the initial notice also cited unavailable review capacity. No review or inline finding was submitted. The user explicitly authorised waiving this review gate if the retry was skipped and merging only after all final-head CI checks pass.

### Existing limitations and verification boundary

- Halcyon's existing vCard/JSContact parser collects email fields, but its unchanged contact-creation mapping does not persist them. This was observed with actual imported files and confirmed against `main`; the import-format mapping is not expanded by this shared-mechanics cutover. Its production contact-edit URL also rendered the detail page during smoke; the root cause was not established. Name-only contact round trips and all changed maintenance paths were verified.
- Native/device execution was not performed. Adapter types, transactional storage tests, and browser WASM/IndexedDB evidence do not establish physical Capacitor device success. Hephaestus remains PWA-only.
