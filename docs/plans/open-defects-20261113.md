# Selected open-issue repairs

## Scope and baseline

Base: `d684a069984463385a55fc8120a21e7ab898cf01` (current origin/main). Isolated branch `fix/open-defects-20261113`; primary dirty checkout is preserved. User selected issues #57, #76, #93, #95, #104 and authorized commits, push, PR, and merge after green checks. Issues #52, #53, #55 are explicitly out of scope. No existing tests or verification assets will be altered to make checks pass.

## Execution order and ownership

1. Install locked dependencies and build baseline maintained TypeScript packages with `pnpm install --frozen-lockfile && just build-palladium-ts`.
2. Reproduce each issue before its production changes. Read relevant source and symbol references. Independent slices share one integration branch; the parent owns engine.ts and this plan.
3. #57: inspect `apps/habitat/app/components/TodoFormModal.vue`, `apps/habitat/app/pages/bored/activities.vue`, and `libs/habitat-shared/app/components/AppBottomSheet.vue`. Determine whether current aria-label bindings reach the actual dialog. Repair missing naming only; verify create/edit TODO, Category, Activity through actual browser accessibility/DOM evidence and existing accessibility checks.
4. #76: inspect `libs/palladium/core/src/tx.ts`, row write boundaries in `engine.ts`, and sqlite-node/browser/capacitor adapters. Select one consistent persistence contract without adding implicit schema assumptions. Preserve scalar/binary behavior and pre-write atomicity; verify actual engine and adapters, restart, and rejection leaves rows/metadata/outbox unchanged. The engine performance owner integrates any engine validation change.
5. #93: implement terminal deleted-root attachment access policy in `libs/palladium/crates/atrium/src/db.rs` and blob routes as required. Atomically record deletion with accepted changes; deny owner/grantee blob GET and post-delete PUT while retaining ACL provenance and stored bytes. Verify actual HTTP/Router owner and reader access before/after delete, duplicate replay, rollback, restart, legacy handling, and unrelated roots.
6. #95: extend `libs/palladium/core/src/blob-handle.ts` and narrow blob options/types as needed for caller-declared MIME conversion. Keep generic Axum download bytes opaque; document receipt MIME as caller-owned metadata. Verify bytes/blob/object-URL conversions, cancellation, and revocation; exercise generic multipart receipt vs download headers/bytes.
7. #104: add ordered lookup/cleanup index to pending-update sync initialization in `libs/palladium/core/src/engine.ts`. Investigate bounded row-scoped metadata reads and batched writes in `#winningCols`/`#stampCols`, retaining per-column HLC and node tie-breaks, tombstones, pending replay, parameter limits, and transaction semantics. Source-supported Atrium authorization/live-query leads are independent profiling follow-ups, not prerequisites in the issue.
8. Repeat all runtime probes; run maintained package checks, full engine/LWW modules, affected adapter/Rust tests and lint/types, Habitat checks and existing a11y checks, architecture checks. Never change verification expectations to hide failures. Document observed performance and limitations, not unmeasured production claims.
9. Review the integrated production diff, commit specific paths, push, open linked PR, obtain review and green CI, merge without bypassing branch protection, and verify all five selected issues are CLOSED on GitHub.

## Performance acceptance

Compare complete ordered pending results with/without index including equal HLC ties and unrelated rows/tables. Use persistent local SQLite storage; measure index creation and incremental storage, inserts/maintenance, lookup, cleanup, and real engine replay. Record query plans and both small/large workloads. Verify fresh and legacy database initialization is idempotent and preserves buffered updates, canonical aliases, rollback, cleanup, restart, and bounded batched SQL parameters. Query-count reduction is not sufficient to claim a production latency win.

### Observed benchmark

Node v24.21.0 `node:sqlite` `DatabaseSync`, file-backed SQLite, 100,000 buffered updates over 1,000 row IDs split across `notes` and `tasks`. The lookup returns 100 ordered rows for `notes`/`row-0`, including 50 rows tied on HLC. The complete ordered results were byte-for-byte equivalent before and after indexing.

| Measurement | Unindexed | Indexed |
| --- | ---: | ---: |
| Median lookup (7 runs) | 5.106 ms | 0.143 ms |
| Query plan | Full table scan + temp B-tree sort | Lookup index search |
| Delete/cleanup | 13.82 ms | 7.39 ms |
| 10,000-row insert transaction (one sample) | 204.98 ms | 124.19 ms |
| Database size after index creation | 9,302,016 B | 14,118,912 B |

Index creation took 100.66 ms and added 4,816,896 B (about 52% of the unindexed database size). The write and cleanup timings are single samples, not evidence of a general write-speed improvement. A real-engine five-column remote update emitted two `_sync_row_meta` SELECTs (tombstone check plus one row-scoped read) and one multi-row metadata upsert; all five user columns had the remote value. A 130-column row crossed the 128-column batch boundary with all 131 register rows intact and no value mismatches. An on-disk legacy initialization retained and replayed its buffered update, and the query plan used the new index.

The benchmark used synthetic, local SQLite data; it does not establish production latency, persistent-storage behavior across browser/Capacitor devices, or representative workload write amplification.


## Verification commands

- `just build-palladium-ts`, `just test-ts`, `just typecheck-palladium-ts`, `just lint-palladium-ts`.
- `pnpm --filter habitat check:fix`, `pnpm --filter habitat typecheck`, `pnpm test:unit`; app's existing accessibility invocation as declared by its package/config.
- `cargo fmt --all -- --check`, `cargo test -p atrium -p palladium-axum`, relevant workspace Clippy and CI-required integration targets.
- `pnpm lint:deps`, `pnpm dedupe:check`, scoped Semgrep.
- Actual runtime reproduction scripts and browser interactions supplement existing tests. Synthetic native adapter evidence is not device evidence.

## Verification results observed

- Maintained Palladium TypeScript build, all maintained unit suites, and TypeScript typechecks passed. Final core: 507 tests; Node SQLite: 25; Capacitor SQLite: 62. `just lint-palladium-ts` reported existing non-fatal complexity/static-only-class warnings; no changes were made to silence them.
- Habitat typecheck and unit suite passed: 61 test files, 720 passed, 1 skipped. `check:fix` made no changes; it reported existing warnings/infos. The full accessibility suite still reports an unrelated critical Settings-page naming violation; the three selected TODO/category/activity modal flows were separately exercised in Chromium and exposed their visible names.
- Final Rust `atrium` + `palladium-axum` tests passed (100); Clippy with `-D warnings` and `cargo fmt --all -- --check` passed. Regression coverage includes terminal root/child deletion delivery, earlier child deletions without historical-content disclosure, and unrelated-member denial.
- Scoped Semgrep and `pnpm lint:deps` passed. `pnpm dedupe:check` remains red because it proposes unrelated workspace dependency/lockfile changes (`vue-router`, `@nuxt/ui`, Nuxt peer resolution, and `magic-string`). No dependency or lockfile changes were made.
- The issue #104 persistent-SQLite benchmark and legacy-index replay probes are recorded above. Synthetic local SQLite/native-adapter probes are not production-device measurements.
- A built-package Node/SQLite smoke confirmed that legacy pending replay commits row arrival, applies a winning scalar field, archives the incompatible nested field intact, and clears the pending row. Both stale and winning nested-value regressions passed.

## Risks and policy

No physical erasure/garbage-collection promise for retained blobs. MIME metadata never authorizes inline active content. Nested JSON behavior must be explicit and consistent across adapters. Preserve HLC ordering, per-column winners, remove-wins tombstones, atomic rollback, schema upgrades, user data, and unrelated worktrees. Do not close local-only fixes; closure follows upstream merge.
