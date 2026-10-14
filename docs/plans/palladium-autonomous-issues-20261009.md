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
  passed. Final Rust workspace run passed 217 tests, including all seven live
  PostgreSQL regressions and the Docker-backed OIDC fixture.
