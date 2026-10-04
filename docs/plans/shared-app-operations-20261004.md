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
- [ ] Complete final package gates and production-browser export/import/reset/offline scenarios.
- [ ] Rebase onto latest `main`, resolve conflicts, rerun affected verification and publish the PR.
