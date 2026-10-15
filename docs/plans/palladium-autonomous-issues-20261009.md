# Sequential autonomous Palladium issue fixes

Baseline: origin/main ad84837, isolated worktree .worktrees/palladium-issues-20261009. Existing dirty app files and audit fixture are untouched. Initial implementation was local-only; subsequent authorization covers committing, pushing a dedicated branch, opening a PR, and merging after checks and review gates pass. Dependency installation and unrelated issue closures remain out of scope.

## Queue

- #86: fix(palladium): separate post-commit observer failures from mutation results. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #87: fix(palladium): prevent public HLC references from mutating the engine clock. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #88: fix(palladium): keep transport fingerprint overrides from overwriting local schema identity. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #89: fix(palladium): invalidate live queries using quoted and schema-qualified SQL tables. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #77: fix(palladium): use canonical SQL identities for LWW metadata and tombstones. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #69: fix(palladium): keep blocked IndexedDB deletion pending until it actually settles. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #70: fix(palladium): prevent logical reset from cascading into preserved or unowned tables. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #71: fix(palladium): normalize reset table identities before duplicate and preservation checks. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #72: fix(palladium): coordinate pending IndexedDB opens and operations with disposal. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #73: fix(palladium): reject empty localStorage blob prefixes before destructive clear. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #74: fix(palladium): invalidate SQLite blob table readiness across database replacement. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #75: fix(palladium): avoid duplicate native database open after physical reset. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #90: fix(palladium): isolate stored MemoryBlobAdapter bytes from caller mutation. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #91: fix(palladium): preserve rows for Capacitor CTE and commented SQL queries. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #92: fix(palladium): avoid replaying committed worker mutations after RPC timeout. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #82: fix(palladium): reject database RPCs after terminal worker or native startup failure. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #79: fix(palladium): clear or key React blob hook state when the requested blob changes. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #80: fix(palladium): refresh Svelte sync status when its readable store becomes active. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #81: fix(palladium): propagate notification permission changes to React and Svelte consumers. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #78: fix(palladium): map Capacitor notification IDs into the Android signed 32-bit range. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #83: fix(palladium): check Web Push backend registration responses before reporting success. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #84: fix(palladium): discover persisted Web Push subscriptions before unsubscribing. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #85: fix(palladium): honor configured foreground notification delivery policy. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #65: fix(palladium): return HTTP 400 for Atrium clock skew so client recovery works. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #66: fix(palladium): reject malformed insert payloads before appending sync history. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #67: fix(palladium): prevent PostgreSQL cursor advancement past uncommitted lower append positions. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #68: fix(palladium): apply the declared 16 MiB body limit to Atrium blob uploads. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.
- #94: fix(palladium): reject or restore blob writes to tombstoned filesystem IDs. Reproduce with contract-focused regression, implement through one sub-agent at a time, then run regression plus runtime smoke.

## Deferred prerequisites

- #52: Requires approval to install pinned Turbo dependency; benchmark and graph experiment must precede adoption.
- #53: Requires aligned warm-main CI benchmark and authorized workflow runs; cannot honestly substitute local timings.
- #55: Provider, cadence, identity UX, encryption/authenticity and platform setup decisions remain open.
- #76: Requires scalar-only versus lossless schema-aware nested JSON contract and migration decision.
- #93: Requires note-deletion/blob retention and ACL lifecycle decision.
- #95: Requires raw-byte versus MIME-aware retrieval API decision.
- #57: current main already contains the accessible-dialog fix; no duplicate code changes or unauthorized issue closure.

## Verification

Parent owns all execution. Agents first add failing behavioral regressions, then implement after parent observes failure. Run affected package tests, runtime probes, lint/typechecks, maintained Palladium full suites, dependency architecture, Rust tests/fmt/Clippy and available Docker-gated integrations. Do not weaken existing tests or guardrails. Update existing docs after verified behavior.

## Progress

Locally implemented and individually exercised: #65–#75, #77–#92, and #94 (28 issues).
The #82 startup path was exercised through queued and future calls against a
failing real browser worker. Native checks so far use compatible SQLite-backed
fixtures, not a physical device.

### #65 — Atrium clock recovery

Additionally exercised with a rebuilt loopback Atrium server and the
actual TypeScript transport: HTTP `400 clock_skew` retained blocking quarantine;
`recoverClock()` reauthored the change; a subsequent sync uploaded it and reached
`caught_up`.

### #66 — Insert admission

Malformed inserts are now rejected before history admission. Before the fix,
the shared Rust validator classified them as valid, the SQLite store accepted
them, and Atrium returned HTTP `201` instead of `400`. Full core/SQLite/Atrium
suites passed (132 tests), as did the live PostgreSQL admission regression and
the real transport fixture-consumer regression. A rebuilt Atrium TCP smoke
rejected nine malformed payloads without cursor/bound movement, then a valid
upload was fetched into a real Node SQLite-backed client with its checkpoint
matching the upload receipt.


### #67 — PostgreSQL append ordering

Reproduced against native PostgreSQL 16.14: a page checkpointed writer
B while lower-position writer A was still in flight, and continuation after A
committed omitted A. Per-scope row locking now precedes sequence allocation.
All seven PostgreSQL unit/integration tests and its doc test passed, including
independent-scope progress, identical retry, and rollback releasing the lock.
A public-API CLI smoke with 64 concurrent writes and seven-item pages delivered
all 64 unique committed change IDs and accepted an identical duplicate retry.
The Docker fixture stopped responding; native PostgreSQL provided the isolated
replacement without restarting unrelated Docker workloads.

Device availability was checked: `adb devices` showed no connected device, and
`xcrun simctl` was unavailable. Android/iOS physical handle observations remain
outside the local fixture evidence.

### #68 — Blob upload limits

Reproduced the unintended HTTP 413 at 16 MiB before the method-specific
body-limit fix. The full Atrium suites passed (48 tests). A rebuilt TCP server
accepted 2 MiB, 2 MiB + 1, and 16 MiB with exact byte round-trips; 16 MiB + 1
returned 413 and remained absent. An oversized overwrite left existing bytes
intact, and a valid oversized JSON change still returned 413.

### #94 — Filesystem tombstones

Reproduced successful replacement of a soft-deleted filesystem blob before
the fix. The retained-tombstone guard now returns the existing NotFound error
without replacing original bytes. The blob crate suites passed (23 tests), and
a standalone filesystem program proved rejection, retained original bytes,
purge removal, and readable fresh-ID writes.

### #75 — Native open lifecycle

Fixed by CapacitorSqliteAdapter: open() is single-flight, publishes #db only
on a successful physical open, retries on failure without leaking the partial
state, and close() awaits any in-flight open before releasing the handle. The
optional isDBOpen() provider check avoids needless physical reopens when the
underlying connection is still open. Seven behavioral regressions covering
reset/reseed/open cycles, overlapping opens, retrieved connections, externally
closed handles, opening failures, and close-while-opening now pass alongside
the existing 47 tests in the same file (54 of 54). No physical-device evidence
because no `adb` and no `xcrun simctl` were available.

## Final integration results

- Blocked IndexedDB deletion stays pending until success or terminal error;
  reads/writes queue behind it. Removed the obsolete immediate-rejection test,
  retained behavioral lifecycle coverage, and exercised real Chromium:
  blocked request observed, no early settlement, queued write completed after
  the blocker closed, stale blob removed, and replacement blob survived reopen.
- Maintained TypeScript builds and package typechecks passed, including worker,
  Nuxt, bindings, notification channels, and E2E.
- Maintained package unit suites passed (852 tests total); core 448, Capacitor SQLite 54, worker
  10, Nuxt 8, React 17, Svelte 4, Vue 3. The foreground-policy integration
  regressions live in notifications-toast, which may depend on notification
  core—not the reverse. All notification suites passed.
- Real Rust-server TypeScript E2E: 50 passed. Valid insert fixtures now include
  an `id` matching `row_id`; malformed payload rejection remains covered.
- Rust workspace with PostgreSQL integration and Docker OIDC features:
  217 tests passed, including all seven PostgreSQL tests and the live OIDC
  Testcontainers case. Rust formatting and all-feature/all-target Clippy with
  warnings denied passed.
- Public Capacitor adapter smoke against file-backed Node SQLite: three
  reset/reseed/write cycles, four physical opens and four closes, concurrent
  opens shared the handle, and all post-reset reads/writes succeeded. This is
  compatibility evidence, not a physical Android/iOS run.
- Owned TypeScript Biome and scoped Semgrep passed with no errors. Biome
  reports eight non-fatal warnings (complexity and an existing static-only
  notification mock); no suppressions were added. Dependency architecture
  passed with zero violations.
- `pnpm dedupe:check` remains non-green: it proposes app `vue-router` 5.3.1 →
  5.4.0 and `magic-string`/Nuxt peer-resolution changes. No dependency or
  lockfile edits are included in these fixes; unrelated app dependency
  upgrades were not applied to force this gate green.

The deferred prerequisites above remain unchanged. Temporary smoke sources,
owned loopback services, and disposable PostgreSQL data are removed after
verification. The review-remediation authorization also covers committing and
pushing fixes, addressing review threads, and merging after final-head gates pass.

## PR review remediation

1. Correct reset catalog identity using SQLite ASCII-only folding; allow triggers
   that cannot fire on deletion without weakening checks on DELETE-trigger effects.
   Serialize and atomically commit canonical metadata migration.
2. Isolate permission-change observers individually and contain startup error
   callback failures so successful permission changes and terminal initialization
   settlement remain observable.
3. Gate PostgreSQL database-dependent regressions consistently. Adapt every reset
   caller to the schema-inspection row contract, including Hephaestus's query/exec
   bridge, and correct the disposal documentation.
4. Exercise regressions and actual API/SQLite/browser paths, build current package
   declarations, run affected package/app/Rust gates, and publish additive commits.
5. Address valid final-head review findings, verify CI and repository merge
   requirements, merge using the exact verified head, and confirm GitHub state.

The request does not require splitting previously authorized work into new PRs,
changing incidental error wording, or adding unrelated dependency upgrades.

### Review-remediation verification

- Corrected SQLite ASCII identifier ownership and trigger-event parsing. Core
  regressions cover distinct Unicode table names, safe INSERT/UPDATE triggers,
  rollback on failed metadata migration, reopen, and mutations queued behind it.
  Core suite: 456 passed.
- Permission observer exceptions no longer prevent later observers or convert
  granted/denied permissions into channel failures. Notification core: 88 passed.
  Startup reporters may throw without leaving initialization unsettled: Nuxt
  covers worker initialization errors, lock conflicts, crashes, timeouts, native
  failures, and late READY with both normal and throwing reporters; 14 passed.
- Built public-API smoke used real timers and exercised all five terminal startup
  paths with a throwing reporter. Queued/future RPCs retained the terminal error,
  late READY could not revive them, later permission observers ran, and a granted
  send delivered exactly once.
- File-backed SQLite public-API smoke proved migration rollback, canonical reopen,
  stale-write rejection, preserved unowned Unicode child rows, and reset with a
  harmless INSERT trigger.
- Hephaestus reset now supplies schema rows through its query/exec bridge. Its
  eight database-boundary regressions passed; full app verification passed
  typechecks and 519 unit tests. In the production PWA, a UI-authored sentinel
  disappeared after reset, preferences remained intact, and a new post-reset
  exercise persisted across reload; fresh accessibility and screenshot evidence
  confirmed the rendered result.
- Core/notification/Nuxt builds and typechecks passed. PostgreSQL without default
  features passed two unit tests and its doctest; Rust formatting and workspace
  all-feature/all-target Clippy with warnings denied passed. Dependency-boundary
  verification reported no violations. Informational app component-name and
  existing package complexity warnings remain; no suppressions were added.
- Final maintained-package run passed 853 tests, plus the separately exercised
  14 Nuxt tests: 867 total. All maintained package builds, typechecks, and lint
  completed without errors. The rebuilt production PWA data-portability E2E
  passed. Final Rust workspace run passed 217 tests, including all five live
  PostgreSQL regressions and the Docker-backed OIDC fixture.

### Subsequent LWW review verification

The next review identified two data-integrity defects, both reproduced before
editing: a DDL regex omitted columns after `DECIMAL(10,2)` (also failing for
quoted/migrated declarations), and legacy pending patches retained column aliases
that bypassed newer registers. All five new regression cases failed with stale
values replacing newer ones.

The engine now caches column spellings from SQLite's applied schema and routes
legacy buffered patches through canonicalization and normal remote validation
before replay. All 20 LWW tests pass. A compiled-public-API smoke against temporary
file-backed SQLite also passed: reopen preserved the newer local value and replay
retained the newer insert under the declared `Title` register.

The runbook below adds exact targeted checks and debugging locations for every
remediated issue. All 22 documented targeted TypeScript commands passed when
introduced; the real client/server E2E suite and its typecheck also passed
(50 tests). Runtime/device limits and unrelated non-green baselines remain
explicit rather than being hidden by fixture success.

After those fixes, all maintained builds/typechecks/lint passed again: 858 package
tests plus 14 Nuxt tests (872 total), all 50 client/server E2E tests, the eight
Hephaestus database-boundary tests, dependency boundaries, and scoped Semgrep.
The rebuilt production PWA passed portability E2E; a fresh Chromium origin also
created a real worker-backed exercise and retained it after reload, with
accessibility/screenshot evidence. The runbook's disposable PostgreSQL recipe,
readiness check, integration suite, and full Rust/OIDC command were executed:
217 workspace tests passed. PostgreSQL's seven library tests comprise five live
database regressions and two identifier unit tests; its doc test also passed.

## Verification and debugging runbook

### Prerequisites and safe execution

Run commands from the repository root in the PR worktree. Use the repository's
Node/pnpm/Rust toolchain and already-provisioned dependencies. Docker is required
only for the PostgreSQL/OIDC integration checks below; Chromium is required for
browser checks. Provision missing tools separately rather than changing manifests
or installing software as part of diagnosis.

Use disposable databases and a fresh browser profile/origin. Reset, replacement,
and tombstone probes intentionally remove fixture data. Never run them against an
existing personal database, shared origin, production server, or production
`DATABASE_URL`. Capture the revision, command, failing test name, fixture/seed,
and sanitized error before changing anything. Do not clear storage, edit sync
metadata, discard quarantine, or replay an unknown-outcome mutation to make a
failure disappear.

Build first: package consumers import generated `dist` exports, so stale builds
can hide a fix or mimic a regression.

```sh
just build-palladium-ts lint-palladium-ts typecheck-palladium-ts test-ts
# The maintained-package recipe excludes Nuxt; exercise its suite explicitly.
pnpm --filter @palladium/nuxt test
pnpm --filter hephaestus verify
pnpm lint:deps
cargo test --locked -p palladium-postgres --no-default-features
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-features --all-targets -- -D warnings
```

Success requires completed suites, not a zero-test filter or merely a successful
build. Current evidence is 858 maintained-package tests plus 14 Nuxt tests (872
combined), 519 Hephaestus tests, and the integration counts above; future
intentional additions may change counts.
Package lint has documented non-fatal warnings. `pnpm dedupe:check` is a separate
known non-green baseline: record its proposed changes, do not silently upgrade
unrelated dependencies or bypass it.

### Targeted TypeScript checks and failure localization

Each command below selects the relevant behavioral suite. Add
`--reporter=verbose` to an `exec vitest run` command for individual test names.
Run the smallest failing suite before the full gate; retain its behavioral
assertions rather than changing expected strings or internal call counts.

| Issues / approach | Exact targeted command | Expected result and first debugging location |
| --- | --- | --- |
| #86: committed writes versus observer delivery | `pnpm --filter @palladium/core exec vitest run src/__tests__/engine.test.ts src/__tests__/event-emitter.test.ts` | A committed mutation resolves despite a throwing observer; subsequent observers/live queries run. Inspect commit, event dispatch, and notification ordering in `core/src/engine.ts` and `event-emitter.ts`; distinguish observer failure from transaction failure. |
| #87: clock ownership | `pnpm --filter @palladium/core exec vitest run src/__tests__/hlc-immutable.test.ts` | Mutating returned/event HLC objects cannot alter the durable clock. Compare the emitted snapshot, next generated clock, and reopened engine; inspect `engine.ts` and `hlc.ts` without rewriting persisted clocks. |
| #88: schema identity versus transport override | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync.test.ts src/__tests__/sync-durable.test.ts` | Transport fingerprint overrides leave local schema identity unchanged and same-schema reopen succeeds. Inspect `_sync_state` identity/checkpoint metadata and the configured schema versus transport option in `sync.ts`; a real schema mismatch must still fail. |
| #89: SQL dependency parsing | `pnpm --filter @palladium/core exec vitest run src/__tests__/sql.test.ts src/__tests__/live-query.test.ts` | Quoted/schema-qualified tables invalidate their live queries without spurious matches from comments or string literals. Compare parsed dependencies and changed tables in `sql.ts`, `live-query.ts`, and `engine.ts`. |
| #77 and review migration: canonical LWW metadata | `pnpm --filter @palladium/core exec vitest run src/__tests__/lww.test.ts src/__tests__/engine.test.ts` | Case aliases share registers; Unicode-distinct tables do not. Columns after parameterized types, quoted declarations, and ALTER TABLE additions retain their declared spelling. Legacy pending patches cannot bypass newer registers. Injected migration failure rolls back, reopen is canonical, and queued writes wait for migration. Inspect `pragma_table_xinfo`, shadow/pending metadata, and the serialized initialization boundary in `engine.ts`; do not repair aliases manually. |
| #70/#71 and review reset: ownership, cascades, triggers | `pnpm --filter @palladium/core exec vitest run src/__tests__/storage-reset.test.ts` | Owned rows delete atomically; preserved/unowned rows and metadata survive. Dangerous cascades/DELETE triggers reject, while harmless INSERT/UPDATE triggers do not block reset. Inspect `main` and `temp` catalogs, `foreign_key_list`, trigger event headers, and ASCII-only identity folding in `storage-reset.ts`. |
| #69/#72: IndexedDB blocked deletion and disposal | `pnpm --filter @palladium/core exec vitest run src/__tests__/idb-blob-adapter.test.ts` | Blocked deletion remains pending until actual completion; disposed opens/writes cannot revive handles or corrupt a replacement. Inspect `blocked`/`versionchange` events, deletion generation, active transactions, and late success handlers in `idb-blob-adapter.ts`. |
| #73: localStorage namespace isolation | `pnpm --filter @palladium/core exec vitest run src/__tests__/localstorage-blob-adapter.test.ts` | Empty prefixes reject; clearing one blob namespace preserves unrelated origin keys. Inspect the configured prefix and key ownership in `localstorage-blob-adapter.ts`; never call `localStorage.clear()` as a workaround. |
| #74: SQLite blob readiness after replacement | `pnpm --filter @palladium/core exec vitest run src/__tests__/sqlite-blob-adapter.test.ts src/__tests__/media-lifecycle.test.ts` | The same adapter can write/read after database replacement. Inspect the new database's blob table and readiness detection in `sqlite-blob-adapter.ts`, not just a cached ready flag. |
| #90: binary ownership | `pnpm --filter @palladium/core exec vitest run src/__tests__/memory-blob-adapter.test.ts` | Mutating either input bytes or returned bytes cannot change stored bytes. Compare independent byte snapshots around `put`/`get` in `memory-blob-adapter.ts`. |
| #75/#91: native open lifecycle and SQL result routing | `pnpm --filter @palladium/sqlite-capacitor exec vitest run src/__tests__/adapter.test.ts` | Concurrent opens share one published connection; failure can retry; close waits for opening. Comments, CTEs, and DML `RETURNING` preserve rows. Inspect `sqlite-capacitor/src/adapter.ts` open promises and query/execute routing. These fixtures are SQLite-backed compatibility evidence, not device proof. |
| #92: unknown-outcome worker mutation | `pnpm --filter @palladium/worker exec vitest run src/db-owner.test.ts` | One timed-out mutation produces at most one service-side execution, not an automatic replay. Inspect the owner, request ID, response timing, and retry boundary in `worker/src/db-owner.ts`; a caller timeout does not establish rollback. |
| #82 and review callback containment: startup terminal state | `pnpm --filter @palladium/nuxt exec vitest run src/__tests__/create-database-plugin.test.ts` | INIT_ERROR, lock conflict, crash, timeout, and native failure settle initialization and reject queued/future RPCs even with a throwing reporter. Late READY must not revive startup. Inspect `markUnavailable`, pending RPC draining, reporter containment, and lifecycle listener removal in `nuxt/src/create-database-plugin.ts`. |
| #79: React blob lifecycle | `pnpm --filter @palladium/react exec vitest run src/__tests__/use-blob-hooks.test.tsx` | Engine/ID changes and failed reads clear old data; stale completions cannot win; URL cleanup belongs to the committed effect. Inspect `react/src/use-blob.ts` and `use-blob-url.ts` request identity/effect cleanup and revoked URLs, including concurrent-render paths. |
| #80: Svelte reactivation | `pnpm --filter @palladium/svelte exec vitest run src/__tests__/stores.test.ts` | First subscription after inactivity samples current sync status, then receives updates. Inspect subscribe/unsubscribe transitions in `svelte/src/live-query-store.ts`, not only continuously active subscribers. |
| #81 and review permission observers: shared permission event | `pnpm --filter @palladium/notifications-core exec vitest run src/__tests__/instance.test.ts src/__tests__/events.test.ts` | Direct and automatic granted/denied requests notify later observers despite a throwing first observer; delivery/skip results remain correct. Inspect `notifications-core/src/instance.ts` and `events.ts`; raw channel calls do not emit instance-level events. |
| #81: React permission consumers | `pnpm --filter @palladium/notifications-react exec vitest run src/__tests__/use-permission.test.tsx` | Active consumers update on the instance permission event; unmounted consumers unsubscribe. Inspect the hook's subscription lifetime. |
| #81: Vue permission consumers | `pnpm --filter @palladium/notifications-vue exec vitest run src/__tests__/permission-event.test.ts` | Shared instance events refresh active Vue permission consumers without requiring delivery. Inspect composable scope disposal. |
| #81: Svelte permission consumers | `pnpm --filter @palladium/notifications-svelte exec vitest run src/__tests__/permission-event.test.ts` | Stores/state update after permission transitions and detach on disposal. Inspect subscription ownership and `NotificationsState.destroy()`. |
| #78: native notification identifiers | `pnpm --filter @palladium/notifications-capacitor exec vitest run src/__tests__/channel.test.ts` | String/generated IDs remain deterministic positive signed-32-bit values and wrap safely. Inspect the scheduled numeric payload and cancellation mapping; fixture checks do not establish physical Android/iOS delivery or collision freedom. |
| #83/#84: Web Push registration and unsubscribe | `pnpm --filter @palladium/notifications-web-push exec vitest run src/__tests__/channel.test.ts` | Backend HTTP rejection fails registration; a fresh channel discovers and unsubscribes a persisted subscription. Inspect Service Worker registration, `pushManager.getSubscription()`, HTTP status, and cleanup ordering in `notifications-web-push/src/channel.ts`; redact endpoint keys/tokens. |
| #85: foreground delivery policy | `pnpm --filter @palladium/notifications-toast exec vitest run src/__tests__/headless.test.ts` | Configured foreground drop/delivery policy changes actual dispatch rather than only stored configuration. Inspect the policy decision in notification core and final toast dispatch; other notification event semantics remain unchanged. |

### Rust, HTTP, and concurrent PostgreSQL checks

```sh
# In-process real router/database boundary checks; no remote service required.
cargo test --locked -p atrium --lib
cargo test --locked -p palladium-core
cargo test --locked -p palladium-blobs
# Independent feature-gating check: must not require DATABASE_URL.
cargo test --locked -p palladium-postgres --no-default-features
```

- **#65—clock recovery:** inspect the structured status/body from
  `atrium/src/routes/changes.rs` and `atrium/src/error.rs`, then the client's
  `core/src/sync.ts` classification. Clock skew is HTTP 400, remains quarantined
  until explicit `recoverClock()` authorization, and can subsequently upload
  successfully. Do not infer recovery from an empty queue alone.
- **#66—malformed insert admission:** `atrium/src/http_tests.rs` rejects malformed
  insert data without advancing history and downloads a later valid change.
  Inspect shared validation in `palladium-core/src/lib.rs` and the SQLite,
  Atrium, and PostgreSQL admission paths. Invalid payloads must not acquire a
  receipt/cursor or poison a later page; update valid fixtures consistently.
- **#68—blob body limits:** the Atrium library suite includes
  `a7_blob_router_enforces_max_body_limit`. Expect 16 MiB accepted, 16 MiB + 1
  rejected with 413 without replacing existing bytes, and the ordinary JSON
  route limit retained. Inspect the method-specific `DefaultBodyLimit` in
  `atrium/src/routes/mod.rs` before blaming blob persistence or changing every
  route's limit.
- **#94—filesystem tombstones:** `palladium-blobs` includes
  `put_after_delete_rejects_replacement_until_purge`. The replacement must return
  NotFound while preserving the tombstone and original bytes. Inspect
  `palladium-blobs/src/filesystem.rs`; purge only owned disposable fixtures,
  never production tombstones to bypass this contract.

For **#67**, an in-memory database or successful compilation is not evidence of
publication ordering. Provision an isolated PostgreSQL instance, then exercise
the feature-enabled concurrency suite. The following uses an already available
image, a loopback-only port, no persistent volume, and fixture-only credentials:

```sh
# Terminal A: keep this disposable server running until verification finishes.
docker run --rm --pull=never --name palladium-verify-postgres \
  -p 127.0.0.1:55596:5432 \
  -e POSTGRES_USER=palladium -e POSTGRES_PASSWORD=palladium-local-only \
  -e POSTGRES_DB=palladium_test postgres:16.8-alpine

# Terminal B: readiness must succeed before running the tests.
docker exec palladium-verify-postgres pg_isready -U palladium -d palladium_test
export DATABASE_URL=postgres://palladium:palladium-local-only@127.0.0.1:55596/palladium_test
cargo test --locked -p palladium-postgres --features integration-tests
cargo test --locked --workspace \
  --features palladium-postgres/integration-tests,atrium/oidc-testcontainers

# Stop only the server created by this recipe; --rm removes its fixture state.
docker stop palladium-verify-postgres
unset DATABASE_URL
```

SQLx tests create disposable databases and require database-creation privileges.
A missing `DATABASE_URL` with `integration-tests` enabled must fail, not skip.
Keep the same `CARGO_TARGET_DIR` for builds and live-server launchers if local
artifacts are redirected.

Expected PostgreSQL behavior: a same-scope reader must not checkpoint past an
uncommitted lower append; an independent scope can progress; rollback releases
the scope lock; concurrent identical changes yield inserted/duplicate outcomes;
invalid inserts leave history unchanged. Inspect lock acquisition **before**
sequence allocation in `palladium-postgres/src/store.rs`. For a blocked fixture,
inspect PostgreSQL `pg_stat_activity` wait-event metadata and `pg_locks` rather
than logging application payloads. Rerun the specific reported Rust test with
`RUST_BACKTRACE=1` and `-- --nocapture`; a timeout alone does not prove ordering.

### Live client/server and production-browser checks

```sh
# Actual TypeScript transport against isolated Rust processes and SQLite files.
pnpm --filter @palladium/e2e typecheck
pnpm --filter @palladium/e2e test

# Build once, then run the existing production portability flow.
pnpm --filter hephaestus build:pwa
pnpm --filter hephaestus exec playwright test tests/e2e/data-portability.spec.ts

# Manual inspection server, in a separate terminal.
pnpm --filter hephaestus exec node scripts/preview-pwa.mjs
```

The preview URL is `http://127.0.0.1:3212`; use an otherwise-unused disposable
browser profile/origin. The preview script supplies COOP/COEP headers required by
SQLite WASM; a generic static server can otherwise cause a blocked worker that
looks like a database defect.

1. In Profile choose a non-default unit; create an exercise with a unique
   sentinel name through Exercises → New, and confirm it is visible.
2. In Profile leave “Also reset … app preferences” unchecked, select Reset
   Hephaestus database, and confirm Reset database. This is destructive only to
   the disposable fixture.
3. Search for the sentinel: it must be absent; the selected preference must
   remain. Create a different exercise, reload, and confirm the new row persists.
   Capture fresh accessibility state or a screenshot, not just a request log.
4. If reset fails, inspect the first worker error and
   `apps/hephaestus/app/lib/database-reset.ts`: reset's `exec` bridge must return
   schema-query rows via `queryAll`, not the void-returning `exec` helper. Rerun
   `pnpm --filter hephaestus exec vitest run tests/unit/lib/database-boundary.test.ts`.
5. If a browser flow fails, retain Playwright's `test-results`/report artifacts
   and the first console/network error. Inspect worker startup, OPFS ownership,
   COOP/COEP, and package build freshness before resetting the origin.

For real IndexedDB blocked-deletion diagnosis, use two connections in the same
disposable origin: hold one connection open, request deletion, and verify the
request stays pending. Close the blocking connection, then confirm deletion,
reopen, and replacement data integrity. For a worker timeout, record one caller
request and count actual service-side commits after the delayed response; one
call must not become two writes. Node/native-compatible fixtures do not replace
browser-worker evidence.

For notification/reactive UI diagnosis, inspect one instance with two permission
observers, the first throwing, and verify the second updates after granted and
denied decisions. Re-subscribe Svelte stores after inactivity; change React blob
IDs while an old read is pending and verify no old bytes/URL flash. Real Web Push
requires a disposable backend and Service Worker; physical native delivery
requires an actual device. Obtain approval before granting permissions or sending
real notifications. Do not treat mocked permission/service APIs as device proof.

### Diagnostic logging and evidence limits

The exported `enableDebug()` / `disableDebug()` helpers from `@palladium/core`
enable scoped diagnostic logging. Prefer a custom handler that records only
scope/message and sanitized identifiers; omit row bodies, blob bytes, credentials,
Push keys, and authorization headers. Enable logging in the realm that owns the
engine: enabling it in the page does not enable a separate worker's module.
Setting `localStorage['palladium:debug']` alone is not a universal switch—the
caller must actually read it and call `enableDebug()`. Disable logging afterward.

For sync failures, inspect receipts, quarantine reasons using
`transport.inspectQuarantine()`, and durable identity/cursor metadata before
retrying. Never manually advance a cursor or invoke `retryQuarantined()` to
bypass clock/schema/permission failures. Preserve replay seeds and crash
boundaries; [the sync validation matrix](../../libs/palladium/docs/TESTING-SYNC.md)
documents deterministic simulation, browser OPFS, crash E2E, and optional model/
fuzz campaigns. Those optional campaigns were not newly executed for this
remediation and are not implied by the passing unit suites.

Deferred #52/#53 tooling experiments, #55 backup design, #76 nested-value
encoding, #93 deleted-note blob retention/ACL policy, and #95 MIME retrieval
remain outside the fixes. Existing behavior can be inspected, but these checks
do not settle their missing product/environment decisions or claim remediation.
