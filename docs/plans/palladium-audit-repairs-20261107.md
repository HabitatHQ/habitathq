# Palladium audit repairs — 2026-11-07

## Baseline and scope

Repair every finding in `palladium-bug-hunt-20261107.md`, including the additional lifecycle, PostgreSQL, and HLC findings. Baseline: origin/main `69f2e11648942478195959eba55a3ac4603be650`. Implementation is isolated in `.worktrees/palladium-audit-20261107`, preserving the dirty primary checkout. After verification, the user authorized committing, publishing a PR, merging, and removing this repair worktree with its installed dependencies and Cargo artifacts.

## Contracts and ownership

- Server infrastructure: scope is part of blob identity throughout storage and HTTP access; reject cursors outside signed storage range; listing never provisions or migrates databases; PostgreSQL schema identity is length-bounded and included in instance identity.
- Atrium: blob identity is workspace-qualified and uploads atomically idempotent; downloads are attachments with nosniff; revoke events reflect recipient-specific prior visibility; child parentage is immutable; heterogeneous JWKS stays fail-closed with bounded/coalesced refresh.
- Engine/sync: invalid preparation uses the same quarantine policy as failed application; only durable completed pages checkpoint; successful replay reconciles quarantine; successful phase recovery clears only resolved error state; SQL identifiers are canonical before normalization on every initialization path. HLC strings preserve numeric order across supported timestamps.
- Adapters/startup: direct Node operations cannot join another asynchronous transaction; callback-scoped transaction handles avoid deadlock; SQL punctuation is syntax only for punctuation tokens; native startup queues settle; browser opening/closing is ordered and single-flight.
- Notifications/React: asynchronous subscription operations cannot clear a later generation; enrollment waits for its own registration; public interaction events reflect deliberate click/dismiss semantics; query identity preserves all supported parameter types including bigint.

## Verification approach

Add consumer-visible regression cases using existing suites. Implement independent slices without running checks mid-flight; run affected package suites and Rust workspace checks once integrated, followed by real local HTTP, SQLite, browser, and CLI scenarios where available. Distinguish fake/native-plugin coverage from real browser or physical-device coverage. Update this document with exercised evidence and any limitations after verification.

## Completed repairs

All 18 numbered groups and all additional findings are implemented.

| Findings | Repair and retained coverage |
|---|---|
| 1 | Scope is required by every `BlobStore`/`DynBlobStore` operation. Filesystem directories are keyed by the scope hash. Router and filesystem regressions cover cross-scope read/delete denial and independent same-ID storage. |
| 2 | Atrium downloads use attachment disposition and nosniff; HTTP regression preserves original HTML bytes without serving them as inline content. |
| 3–4 | Visibility transitions govern revoke events; redundant private unshares reveal no identifiers. Child parentage cannot be changed by replicated writes. HTTP ACL regressions retained. |
| 5, 15 | Heterogeneous JWKS selects eligible RSA/RS256 signing keys. Unknown-kid refresh is serialized and has a 30-second cooldown, including failed refresh attempts. |
| 6 | Engine preparation failures enter per-change rejection/quarantine handling; the Rust validator rejects case-insensitive immutable-ID updates. Valid work still commits, but incomplete pages do not checkpoint. |
| 7 | Successful replay clears quarantine, including successful changes in partially rejected pages. Clock, upload, and invalid-receipt errors reconcile independently. Real HTTP partial-page recovery failed before the final repair and passed afterward; regression retained. |
| 8–9 | Schema-less initialization reads actual SQLite columns and migrates legacy shadow aliases. Identifiers are canonical before operation normalization. LWW and mixed-table delete/reinsert regressions retained. |
| 10 | Node operations are FIFO-exclusive with transactions. Callbacks receive an expiring scoped adapter; outer calls cannot silently join or roll back with that transaction. |
| 11–12 | Capacitor classification checks token kinds for punctuation and keywords. Successful native startup dispatches queued requests and preserves independent failure outcomes. |
| 13–14 | Atrium blobs use a workspace-qualified primary key, with a transactional legacy migration. Atomic insert/conflict handling makes concurrent identical uploads idempotent. HTTP and migration regressions retained; GET callers now send `X-Workspace`. |
| 16a–b | HTTP rejects cursors above `i64::MAX`. CLI status inspection selects the configured backend and does not create or migrate databases. |
| 17 | Concurrent enrollment is coalesced; service-worker activation has a 30-second deadline and cancellation. Subscription generations prevent a delayed backend unsubscribe from clearing a replacement. |
| 18a | Browser, Toast, Capacitor local, and Expo response channels forward supported interactions. Shared instance ownership is reference-counted; Toast eviction/removal releases interaction metadata. Click-triggered close is not a dismissal. |
| 18b | React parameter identities preserve bigint, undefined/null, numeric/string identity, and binary content without JSON serialization or intermediate byte-array copies. Mounted hook regressions use real SQLite results. |
| Additional browser lifecycle | Browser opens/closes are ordered across WASM initialization; an actual Chromium regression covers pending-open close, concurrent opens, retained data, and fresh reopen. |
| Additional PostgreSQL findings | Identifiers reject more than 63 bytes. Registry identity includes the URL and schema without exposing the URL in registry errors. A live PostgreSQL regression opens independent schemas on one URL. |
| Additional HLC finding | New strings use 16 timestamp digits over the supported safe-integer range; readers retain support for prior 15-digit encodings. |

The Vue example still imported the removed `generateUlid` export, which prevented the real-browser verification app from starting. Its caller now uses the existing `generateUuidV7` API, with no alias. `just test-ts` now includes the existing Nuxt suite rather than excluding it under a stale comment.

## Compatibility and data preservation

- Axum filesystem blobs are now scope-qualified. Legacy unscoped files are preserved but never used as a fallback. Assigning their ownership requires an administrator-directed relocation; the server cannot safely infer a tenant from an unscoped UUID.
- Atrium migrates existing blob rows and bytes transactionally. Downloads now require `X-Workspace`; repository callers have been migrated.
- Node transaction callbacks must use their supplied adapter, including `SqliteBlobAdapter` transaction options. Scoped lifecycle calls reject deterministically instead of closing the shared connection. Obsolete implicit-transaction coverage was removed; rollback coverage now passes the explicit scoped handle.
- Local operations emit canonical identifiers. Received remote payloads retain their replay/idempotency identity. Existing casing-only payload assertions were removed while retaining actual LWW and alias-conflict assertions.
- HLC readers accept old strings, but consumers must parse or rewrite mixed old/new strings before lexical comparison. Current core consumers use parsed values or equality identities, not mixed-format lexical sorting.
- The unused SQL `BlobMetadata` helper was not changed into a tenant store: it has no active storage/router callers. The repaired Axum filesystem path does not use it.
- No dependency versions were upgraded. Scoped blob hashing uses the already-locked workspace `sha2` dependency; an unused CLI dependency introduced during implementation was removed through Cargo.

## Verification results

| Check | Observed result |
|---|---|
| Maintained Palladium TypeScript suites, including Nuxt | 965 tests passed across 19 packages. |
| Maintained package builds and `just typecheck-palladium-ts` | Passed. Final React/core-notifications edits also passed their builds, 108 tests, and typechecks. |
| `cargo test --workspace --features palladium-postgres/integration-tests` with a disposable PostgreSQL 18 server | 234 tests passed, including same-URL/different-schema isolation. |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | Passed. |
| `cargo fmt --all -- --check` | Passed. |
| Live E2E suite | Final full run: 50 tests passed, zero failures/skips. |
| Vue example Playwright suite, retries disabled | 9 tests passed, including the new real-browser SQLite lifecycle case. |
| Root `pnpm test:unit` | Habitat 720, Hearth 351, Halcyon 232, Hephaestus 519 passed: 1,822 passing tests and one existing skip. |
| Vue/Burrow production builds | Passed. |
| Changed TypeScript Biome checks | Passed with warnings; no warning suppressions added. |
| Changed TypeScript severity-ERROR Semgrep | Passed. |
| Dependency-cruiser | Passed: 812 modules, 615 dependencies, no violations. |
| `pnpm dedupe:check` | Non-green on the unchanged baseline lockfile; it proposes unrelated Nuxt/router/transitive upgrades. No dedupe rewrite was applied. |

The pnpm lockfile matches `origin/main` byte-for-byte: SHA-256 `6acff7bdcbd7868b88db4bec7151105cfeee09a1784bb81692d2bab3cf9642f5`.

### Exercised runtime boundaries

- Real loopback Atrium HTTP: private redundant revocation returned no private IDs; child reparenting returned 400; all 16 simultaneous identical uploads returned 201; same blob UUID in separate workspaces retained independent bytes; unauthorized read returned 403; HTML download had attachment and nosniff headers.
- Real loopback OIDC discovery/JWKS: mixed RSA+EC startup was healthy; valid RSA tokens authenticated; eight forged kids returned 401 without increasing the startup JWKS count of one; after the cooldown, eight concurrent misses caused only one additional refresh; a legitimately rotated RSA key then authenticated.
- Real Node SQLite/native bridge: requests admitted during deferred native initialization settled against SQLite; an outside write survived another transaction's rollback; overlapping transactions serialized and retained the final committed values.
- Real loopback page recovery: a corrected change applied while another change failed, its own quarantine row cleared, and the other failure remained quarantined without advancing the page cursor.
- Real CLI: missing SQLite remained absent after listing, initialized SQLite reported `ok`, and a PostgreSQL schema initialized with the store schema reported `ok` with its URL redacted. A live CLI HTTP server returned 200 for `i64::MAX` and 400 for the next cursor.
- Real Chromium: the Vue app created a SQLite-backed task; browser WASM lifecycle smoke retained data correctly. Toast activation/dismissal and shared-owner disposal behaved correctly. Enrollment waited for a real service worker's `activated` state; the push subscription/provider was synthetic and no browser permission was granted.

### Evidence limits and non-green observations

- No physical Capacitor/Expo device or production push delivery was qualified. Plugin/notification-provider fakes are not device evidence.
- No browser script-execution attack was performed. Active-content protection was qualified through actual HTTP response headers and bytes.
- Two earlier full E2E attempts failed nine family visibility waits while broader verification was running. The isolated family suite subsequently passed all 13 cases, and the final full suite passed all 50 without configured retries. The earlier failure's cause was not isolated; no production repair is attributed to those transient waits. Failure diagnostics now report HTTP and client/outbox state.
- React's test environment emits existing `act(...)` warnings; Biome reports complexity/static-class warnings. Neither was suppressed or represented as zero-warning verification.
- The baseline dedupe failure remains outside these audit repairs.

All temporary probe fixtures, reports, services, and the disposable PostgreSQL container were removed/stopped after implementation verification. No commits or pushes were made during that verification phase. Publication and cleanup are separately authorized: preserve this source and evidence on the remote default branch before removing the repair worktree, its duplicated dependencies, and its Cargo artifacts. Preserve the primary checkout and unrelated worktrees.
