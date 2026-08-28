# Palladium sync engine production-readiness TODOs

- **Reviewed at:** 2026-08-24T16:42:25Z
- **Decision update:** 2026-08-24T16:57:46Z
- **Repository revision reviewed:** `614c3d47949858c0530faceb3634fde574a6dce2`
- **Scope:** `@palladium/core`, the Rust wire/store/Axum crates, Atrium, protocol fixtures, and coupled documentation
- **Release status:** Not production-ready
- **Cutover constraint:** There are no current users or production data.
- **Compatibility policy:** Breaking changes are explicitly allowed. Make clean cutovers; do not add compatibility aliases, dual-write paths, deprecated APIs, or legacy migrations.
> **Normative authority:** [`SYNC-PROTOCOL-v1.md`](./SYNC-PROTOCOL-v1.md) is the sole protocol specification. This review is an evidence ledger and release checklist, not a second wire-contract authority.

## How to use this document

- Check a remediation item only after implementation, permanent regression coverage, and focused verification are complete.
- Check a contract only after it is normative in protocol documentation and enforced by tests.
- Parent tasks remain unchecked until every nested acceptance criterion is satisfied.
- P0 items block production use. P1 items block a supportable release. P2 items block scale or maintainability.
- Existing behavior cited below is evidence, not a guarantee. Some code already partially satisfies an unchecked contract.

## Release gate

- [x] Review current client, server, storage, and Atrium sync paths.
- [x] Reproduce the six highest-risk contract failures.
- [x] Resolve the six open architecture decisions.
- [ ] Complete every P0 remediation item.
- [ ] Complete every P1 remediation item.
- [ ] Complete P2 paging and cursor safety before production scale.
- [ ] Make all 28 release contracts normative and verifiably enforced.
- [ ] Convert T01–T22 into permanent passing regression or conformance tests.
- [ ] Remove every superseded name, protocol, API, fixture, and caller in the same cutover.
- [ ] Run the final TypeScript, Rust, integration, and end-to-end verification matrix.
- [ ] Reassess production readiness against completed evidence.

## Breaking-change register

- [ ] **B01—Rename the internal outbox table.**
  - `_sync_pending_changes` becomes `_sync_outbox`.
  - Remove the old constant, DDL, queries, fixtures, comments, and documentation.
  - Do not add a migration, alias, compatibility view, or dual-write path.

- [ ] **B02—Require UUIDv7 for replicated row IDs.**
  - Reject ULIDs, UUIDv4, and arbitrary strings as row IDs.
  - Change TypeScript row types/generation and Rust validation together.
  - Keep `NodeId` and `Change.id` as UUIDv4 unless a separate decision changes them.

- [ ] **B03—Canonicalize transactions before commit.**
  - Collapse repeated writes into one canonical final operation set.
  - Execute and replicate the exact same normalized `Change`.
  - Reject non-canonical inbound changes.

- [ ] **B04—Replace the HLC cursor protocol.**
  - Replace `ChangeStore::list_after(Hlc)` with server-issued append positions.
  - Remove bare-array responses and response-shape protocol detection.
  - Require one versioned page envelope with cursor and control fields.

- [ ] **B05—Change change-ID persistence and duplicate behavior.**
  - Use `(scope, change_id)` rather than globally unique `change_id`.
  - Treat identical canonical bytes as a no-op.
  - Return a terminal conflict for the same ID with different canonical bytes.

- [ ] **B06—Replace permissive wire types with strict public types.**
  - Add `SyncRow` and `JsonValue`.
  - Reject primary-key mutation and values that cannot round-trip through JSON.
  - Replace shallow/cast-based decoding with one exhaustive runtime decoder.

- [ ] **B07—Replace transport lifecycle semantics.**
  - Permit only one `SyncTransport` attachment per engine.
  - Add deterministic `dispose()`.
  - Make lifecycle operations single-flight and reject a second live transport.

- [ ] **B08—Replace page hooks and status/error APIs.**
  - Replace opaque `decodeChanges`/`acknowledgeChanges` side-effect hooks with a typed page-application contract.
  - Expand statuses to `uninitialized`, `hydrating`, `syncing`, `caught_up`, `offline`, `blocked_auth`, and `degraded`.
  - Replace coarse POST outcomes with stable structured errors and retryability.

- [ ] **B09—Expose quarantine as a managed public state.**
  - Add inspect, export, retry, and discard operations.
  - Apply configured block or degraded-skip policy to terminal failures instead of relying only on `maxApplyAttempts`.

## Completed decision log

### D1—Use `_sync_outbox` for the durable outbox

- [x] Select `_sync_outbox` as the final internal table name.
  - **Contract:** one row is one atomic `Change` containing an ordered `Op[]`; it is not one row per `Op`.
  - **Flow:**

    ```text
    PalladiumEngine.tx()
      -> normalize one Change { changeId, HLC, Op[] }
      -> commit app rows + LWW metadata + engine HLC + _sync_outbox row
      -> SyncTransport drains the row
      -> POST one Change
      -> delete the row only after 2xx
    ```

  - **Rationale:** `_sync_outbox` accurately names the durable delivery role. `_sync_pending_ops` is misleading because the retry and atomicity unit is a `Change` batch.
  - **User story:** Alice changes a title and due date in one transaction. Both operations retry, deduplicate, and commit remotely as one unit.

- [x] Establish naming and authorship history.
  - `_sync_pending_ops` exists only in `DRAFT-ARCH.md:277-294`; it was never implemented under `libs/palladium/core`.
  - Its proposed row also contains an `ops` array under one ID and HLC. Its memory fallback and `onStaleDelta` policy were never implemented.
  - `_sync_pending_changes` is the current implementation in `core/src/sync.ts:169-201`.
  - Nikhil Pallamreddy introduced `_sync_pending_ops` in `a8cd508a97ff45565c06ed70ed71a806833535be` on 2026-03-07.
  - Nikhil introduced `_sync_pending_changes` in `64c17ee5f2553692e1ffe110d6ccf03a4fe62a6e` on 2026-05-27.
  - Nikhil temporarily removed it for the engine `_changes` journal in `a5902691b70528026d4f645ae632e6c79f0642ad` on 2026-06-15.
  - Nikhil restored the current atomic outbox in `c8c0ad9cd946b5938cfc225f1894883bfd883903` on 2026-08-24.
  - Nikhil subsequently added `schema_fingerprint` and `_sync_outbox_quarantine` in `bba9ec20`.

### D2—Use UUIDv7 for replicated row IDs

- [x] Select canonical UUIDv7 strings for row identity.
  - This decision applies to row IDs. `NodeId` and `Change.id` remain UUIDv4.
  - Reject all non-v7 row IDs and update seeds, fixtures, examples, and schemas before release.
  - Flow: `UUIDv7 generator -> TypeScript SyncRow.id -> WireOp.row_id -> Rust Uuid -> storage key`.
  - Rust currently enables only `uuid` features `v4` and `serde` (`Cargo.toml:67`).

### D3—Normalize each `Change` before local commit

- [x] Select pre-commit canonicalization instead of adding an operation index to conflict versions.

  ```text
  TxBuilder ordered Op[]
    -> canonicalize by (table, row)
         repeated updates: last value per column
         insert + updates: fold into final insert
         writes + terminal delete: final delete
         delete + later insert: final resurrection insert
    -> validate one final write per (table, row, column)
    -> local apply + metadata + _sync_outbox
  ```

- [x] Define that updates after a terminal delete do not resurrect a row; resurrection requires a later insert.

### D4—Use versioned append history

- [x] Select a clean sequenced-history replacement for generic `ChangeStore`/Axum.
  - Replace the HLC protocol in one coordinated change.
  - Do not retain bare-array/HLC-cursor compatibility.
  - Flow: `append -> assign position atomically -> fetch bounded page -> apply -> checkpoint`.

### D5—Classify failures before applying policy

- [x] Select stable error codes plus configurable per-code policy.

  ```text
  failure
    -> classify { phase, code, retryable, status, changeId }
         transient -> retain position -> backoff/retry
         terminal  -> quarantine -> configured block | degraded-skip
    -> public inspect/retry/export/discard recovery
  ```

### D6—One transport owns one engine

- [x] Select exclusive transport ownership with deterministic disposal.
  - Flow: `attach -> exclusive lease -> single-flight lifecycle -> stop -> dispose and release`.
  - Multiple destinations require a deliberate future multiplexer.

## Current-state evidence

- [x] Map local write and uplink.

  ```text
  tx -> ordered Op[] -> serialized write -> one HLC/changeId
     -> transaction(data + LWW + HLC + _sync_pending_changes)
     -> changes:local -> drain by HLC -> POST -> delete after 2xx
  ```

  Evidence: `libs/palladium/core/src/engine.ts:365-421`; `libs/palladium/core/src/sync.ts:425-450,505-536`.

- [x] Map downlink and materialization.

  ```text
  poll -> restore cursor -> GET -> decode shallowly -> convert Op
       -> applyRemote transaction -> LWW/tombstone/pending update
       -> retry/quarantine/dead-letter -> acknowledge -> persist cursor
  ```

  Evidence: `libs/palladium/core/src/sync.ts:646-769`; `libs/palladium/core/src/engine.ts:424-474`.

- [x] Identify incompatible server-history dialects.
  - Generic `palladium-axum` uses HLC as `after` and orders by HLC (`palladium-axum/src/routes/changes.rs:63-101`; `palladium-core/src/store.rs:34-46`).
  - Atrium assigns `append_seq`, lists in append order, advances across ACL-filtered history, and returns `{ changes, cursor, purges, events }` (`atrium/src/routes/changes.rs:98-163`; `atrium/src/db.rs:1010-1045`).
  - The client detects the dialect from response shape rather than protocol version.

## Protocol specification TODOs

### Vocabulary

- [ ] Publish one normative glossary defining ownership, persistence, ordering, retry behavior, and security meaning for:
  - [ ] Replica
  - [ ] Actor / principal
  - [ ] Scope
  - [ ] Client view
  - [ ] Operation (`Op`)
  - [ ] Canonical change
  - [ ] Conflict version
  - [ ] History position
  - [ ] Checkpoint
  - [ ] Uplink / downlink
  - [ ] At-least-once delivery
  - [ ] Idempotency
  - [ ] Hydrated
  - [ ] Caught up
  - [ ] Resnapshot / must-refetch
  - [ ] Transient failure
  - [ ] Terminal rejection
  - [ ] Quarantine
  - [ ] Dead letter
  - [ ] Tombstone versus ACL purge
  - [ ] Schema identity
  - [ ] Syncable value

### Release contract checklist

Unchecked means “not yet normative and proven,” even when code partially conforms.

#### Data and identity

- [ ] C01. Every syncable table has one immutable primary key named `id`.
- [ ] C02. Every row ID is canonical UUIDv7 and validated before mutation and at every wire boundary.
- [ ] C03. Table and column names are safe identifiers present in the negotiated schema.
- [ ] C04. Values are losslessly JSON-serializable under one cross-language model.
- [ ] C05. `NodeId` is stable for a replica, is not authentication, and is bound to an authorized principal by production hosts.

#### Change semantics

- [ ] C06. A `Change` is immutable and atomic, and its ID is unique within its scope.
- [x] C07. Reusing `(scope, change_id)` with identical canonical bytes is a no-op; different bytes produce a side-effect-free conflict.
- [ ] C08. Local transactions normalize before local apply, LWW stamping, and outbox checkpointing; receivers reject non-canonical changes.
- [ ] C09. Local data, LWW metadata, durable HLC, and outbox row commit atomically before `changes:local`.
- [ ] C10. Remote data, LWW metadata, pending updates, and applied marker/checkpoint commit atomically.

#### Merge and convergence

- [ ] C11. Replicas given the same valid change set, schema, tombstones, and node IDs converge regardless of arrival order.
- [ ] C12. A column write wins only when its complete conflict version is greater; the rule covers intra-change sequences.
- [ ] C13. Deletes leave tombstones; stale writes cannot resurrect them; reclamation requires safe-history proof or resnapshot.
- [ ] C14. Primary-key updates are rejected; resurrection is a later insert with the same ID and greater version.
- [ ] C15. Remote clocks pass structural, bounds, future-skew, and per-node monotonicity checks before affecting state.

#### Delivery and checkpoints

- [x] C18. History position is server-issued append order, independent of HLC, opaque, view-scoped, and monotonic.
- [ ] C19. A checkpoint never advances past malformed or transiently failed content; terminal skip requires policy and visible degraded state.
- [x] C20. ACL-filtered or empty windows advance over scanned history without exposing unauthorized changes.
- [ ] C21. Response acknowledgement is idempotent and has an explicit checkpoint recovery protocol.

#### Lifecycle, errors, and operability

- [ ] C22. Exactly one `SyncTransport` owns one engine; disposal releases checkpoint registration and ownership.
- [ ] C23. `start`, `poll`, `syncOnce`, and `stop` are race-safe; stop cancels work or has a bounded wait.
- [ ] C24. Every failure reports phase, code, retryability, HTTP status, change ID, attempt count, and next retry when applicable.
- [ ] C25. Retryable failures use timeout, cancellation, exponential backoff, and jitter; auth refresh is bounded.
- [ ] C26. Quarantined outbox rows and remote dead letters support inspect, export, retry, and explicit discard.
- [ ] C27. Status distinguishes `uninitialized`, `hydrating`, `syncing`, `caught_up`, `offline`, `blocked_auth`, and `degraded`.
- [ ] C28. Initial and steady-state pages are bounded; expired history can require resnapshot.

## Remediation backlog

### P0—Release blockers

- [ ] **P0.1 Reject unknown wire operations without destructive fallback.**
  - Current failure: `isWireChange` accepts any string tag; `wireOpToEngine` treats every tag other than `insert` or `update` as `delete` (`sync.ts:63-94,312-336`).
  - Observed: `op: "merge"` deleted a row and advanced the cursor.
  - [ ] Replace the guard and casts with one exhaustive runtime decoder.
  - [ ] Return a stable terminal protocol code for unknown tags.
  - [ ] Ensure no decoder default can invoke a destructive operation.
  - [ ] Add permanent T01 coverage.

- [ ] **P0.2 Reject malformed envelopes before extracting a checkpoint.**
  - Current failure: missing/non-array `changes` decodes to `[]`, while cursor extraction accepts the cursor (`sync.ts:415-424,682-698,725-732`).
  - Observed: `{ "chnages": [...], "cursor": "42" }` persisted `42`.
  - [ ] Define required fields for each versioned envelope.
  - [ ] Decode and validate the whole envelope atomically.
  - [ ] Prevent malformed bodies from returning or persisting a checkpoint.
  - [ ] Add permanent T02 coverage.

- [ ] **P0.3 Canonicalize operations before commit and replication.**
  - Current failure: all local operations share one HLC; the first remote same-column write stamps metadata and a later equal-HLC write loses (`engine.ts:365-410,724-740`).
  - [ ] Implement the D3 state machine.
  - [ ] Execute only normalized operations locally.
  - [ ] Persist exactly those operations in `_sync_outbox`.
  - [ ] Reject non-canonical remote changes.
  - [ ] Cover insert/update/delete permutations and foreign-key ordering.
  - [ ] Add permanent T03 and T22 coverage.

- [ ] **P0.4 Replace HLC history ordering with append positions.**
  - Current failure: `ChangeStore::list_after` orders by HLC, so a late append with an older HLC is never delivered (`palladium-core/src/store.rs:34-46`; `palladium-axum/src/routes/changes.rs:63-101`).
  - [ ] Define the versioned request and envelope.
  - [ ] Assign append position atomically with durable append.
  - [ ] Replace SQLite and PostgreSQL schemas and indexes directly.
  - [ ] Update Axum, Atrium, clients, fixtures, and examples together.
  - [ ] Delete bare-array/HLC-cursor compatibility.
  - [ ] Add permanent T07 coverage.

- [ ] **P0.5 Implement scoped, content-checked idempotency.**
  - Current failure: `applyRemote` ignores `RemoteChange.id`; stores use global IDs while reads are scoped; Atrium checks duplicates after metadata work (`engine.ts:77-86,428-474`; `palladium-sqlite/src/store.rs:10-19`; `palladium-postgres/src/store.rs:56-72`; `atrium/src/db.rs:860-1018`).
  - [ ] Key server identity by `(scope, change_id)`.
  - [ ] Compare canonical payload hashes before accepting duplicates.
  - [ ] Return no-op for identical bytes and conflict for different bytes.
  - [ ] Deduplicate before node, ACL, event, or other metadata effects.
  - [ ] Add a bounded client applied-change ledger or checkpoint-epoch equivalent.
  - [ ] Add permanent T04, T17, and T18 coverage.

### P1—Supportability blockers

- [ ] **P1.1 Align TypeScript and Rust identity/value contracts.**
  - Current failure: TypeScript accepts arbitrary IDs and `unknown` values, exports ULID, and permits primary-key patches; Rust requires UUID row IDs (`tx.ts:16-50`; `core/src/index.ts:68`; `palladium-core/src/op.rs:14-43`).
  - [ ] Add `SyncRow` and `JsonValue`.
  - [ ] Add shared UUIDv7 generation and validation.
  - [ ] Enable required Rust `uuid` features through the package workflow.
  - [ ] Reject ULID, UUIDv4, malformed IDs, primary-key updates, and lossy JSON values.
  - [ ] Update all seeds, fixtures, examples, schemas, OpenAPI, glossary, and architecture guidance together.
  - [ ] Add permanent T09 and T10 coverage.

- [ ] **P1.2 Bound untrusted HLCs before conflict state changes.**
  - Current failure: TypeScript accepts invalid numbers; Rust has no future-skew policy; Atrium has no per-node monotonicity check (`sync.ts:73-94`; `hlc.ts:52-75`; `palladium-core/src/hlc.rs:16-38`; `atrium/src/db.rs:860-882,1004-1045`).
  - [ ] Validate finite safe-integer wall time, counter bounds, and UUID node identity.
  - [ ] Enforce configurable maximum future offset and per-node monotonicity.
  - [ ] Return terminal `clock_skew` with server time.
  - [ ] Add permanent T11 and T21 coverage.

- [ ] **P1.3 Preserve structured failures and prevent rejection leaks.**
  - Current failure: `error` is never emitted; downlink failures collapse to `null`; validation can bypass quarantine; POST handling loses actionable details (`engine.ts:88-98,536-539`; `sync.ts:255-261,490-502,622-701,745-762`).
  - [ ] Define one `SyncError` and stable client/server error catalog.
  - [ ] Preserve HTTP status, response code/body, `Retry-After`, phase, and change ID.
  - [ ] Move validation inside quarantine and catch every background rejection.
  - [ ] Add timeout, cancellation, exponential backoff, jitter, and bounded auth refresh.
  - [ ] Add permanent T05, T06, T12, and T13 coverage.

- [ ] **P1.4 Enforce one transport owner and single-flight lifecycle.**
  - Current failure: construction permanently registers a checkpoint; `stop()` does not unregister it; concurrent starts can duplicate work (`sync.ts:405-450,486-536,610-620,705-735`).
  - [ ] Add exclusive attachment, unregister handling, and idempotent `dispose()`.
  - [ ] Serialize start, full sync, syncOnce, timer tick, and stop transitions.
  - [ ] Cancel or await bounded in-flight work.
  - [ ] Remove superseded lifecycle APIs instead of retaining wrappers.
  - [ ] Add permanent T14 and T15 coverage.

- [ ] **P1.5 Replace opaque page hooks with a typed replay-safe contract.**
  - Current failure: decode and acknowledgement hooks may perform side effects outside the transaction; retry can repeat partial work (`sync.ts:152-166,486-497,725-732`).
  - [ ] Replace hooks with a typed page model for changes, purges, events, cursor, and caught-up state.
  - [ ] Specify transaction and replay boundaries.
  - [ ] Require idempotent purge and acknowledgement behavior.
  - [ ] Clean up after failed initialization.
  - [ ] Add permanent T16 coverage.

- [ ] **P1.6 Add operator-visible quarantine recovery.**
  - Current failure: permanent remote failures may advance the cursor, and schema-incompatible rows leave the active outbox, without public management (`sync.ts:585-608,738-769`).
  - [ ] Store code, phase, attempts, payload, position, and timestamps.
  - [ ] Expose inspect, export, retry, and discard.
  - [ ] Classify transient retry versus terminal quarantine without fixed-attempt guessing.
  - [ ] Apply configured block or degraded-skip policy and expose recovery through status.
  - [ ] Add permanent T20 coverage.

### P2—Scale and maintainability

- [ ] **P2.1 Bound bootstrap and steady-state history.**
  - Current failure: the client sends no page size; first sync may process all retained history; no caught-up bound or resnapshot exists (`sync.ts:669-680`).
  - [ ] Add page-size and response limits.
  - [ ] Return a server upper bound and caught-up marker.
  - [ ] Continue bounded pages without monopolizing the UI worker.
  - [ ] Add checkpoint-expired and `must-refetch`/resnapshot responses.
  - [ ] Add permanent T19 coverage.

- [ ] **P2.2 Enforce append-cursor validity and monotonicity.**
  - Current failure: decimal strings are accepted loosely and persisted even when they regress (`sync.ts:98-105,725-732`).
  - [ ] Keep generic client tokens opaque and put comparison in the versioned protocol.
  - [ ] For Atrium cursors, parse `bigint`, reject non-canonical encoding, and reject regression.
  - [ ] Add permanent T08 coverage.

- [ ] **P2.3 Replace contradictory architecture documents.**
  - Current failure: `DRAFT-ARCH.md` presents unimplemented features and old names; `answers.md` claims error emission that does not exist; core docs claim adapter neutrality despite SQLite PRAGMAs (`DRAFT-ARCH.md:277-375,426-593`; `answers.md:261-264`; `sync.ts:376-390,425-435,558-582`; `storage.ts:62-87`).
  - [ ] Publish a versioned normative specification.
  - [ ] Document `_sync_outbox` and remove old outbox names from final guidance.
  - [ ] Move proposals to a non-normative roadmap.
  - [ ] Decide whether `StorageAdapter` means SQLite-family SQL or portable SQL.
  - [ ] Update `GLOSSARY.md`, examples, fixtures, and protocol docs together.

## Permanent verification TODOs

T01–T06 were reproduced with disposable Vitest cases and then removed. They need permanent tests that pass after remediation.

- [ ] **T01—Unknown operation never deletes.**
  - [x] Reproduce deletion with `op: "merge"`.
  - [ ] Assert row/cursor unchanged and stable error emitted.
- [ ] **T02—Missing `changes` cannot checkpoint.**
  - [x] Reproduce persistence of `42` from `{ chnages: [], cursor: "42" }`.
  - [ ] Assert protocol failure and no checkpoint.
- [ ] **T03—Later same-column operation wins identically.**
  - [x] Reproduce remote retention of the first insert→update value.
  - [ ] Assert normalized final value and metadata.
- [ ] **T04—Same change ID with different bytes is rejected.**
  - [x] Reproduce application of the second payload.
  - [ ] Assert conflict/no-op and unchanged state.
- [ ] **T05—Unknown table follows quarantine policy.**
  - [x] Reproduce rejection before quarantine.
  - [ ] Assert structured failure, quarantine, and block/degraded state.
- [ ] **T06—Downlink failure emits structured offline error.**
  - [x] Reproduce `idle` with no event after thrown GET.
  - [ ] Assert offline state and structured error.
- [ ] **T07—Late old-HLC append is delivered after the prior append cursor.**
- [ ] **T08—Append cursor cannot regress.**
- [ ] **T09—UUIDv7 row ID round-trips TypeScript to Rust; ULID, v4, and malformed IDs fail.**
- [ ] **T10—Primary-key update fails before mutation with unchanged row/meta.**
- [ ] **T11—Future HLC beyond maximum offset returns `clock_skew` with no effects.**
- [ ] **T12—Terminal 4xx follows configured outbox block/degraded policy.**
- [ ] **T13—Periodic adapter failure creates no unhandled rejection.**
- [ ] **T14—Concurrent start is single-flight and stop removes all work.**
- [ ] **T15—Second transport is rejected and disposal permits replacement.**
- [ ] **T16—Acknowledgement failure replays without duplicate effects.**
- [ ] **T17—Same change UUID is independent across scopes in SQLite and PostgreSQL.**
- [ ] **T18—Duplicate ID cannot mutate Atrium ACL metadata.**
- [ ] **T19—Initial history is consumed in bounded pages and reports caught-up.**
- [ ] **T20—Dead letter can be inspected, remediated, and retried.**
- [ ] **T21—Invalid HLC fields fail before clock/apply.**
- [ ] **T22—Canonicalization covers delete→insert and insert→delete.**

## Implementation order

- [ ] **Phase 1—Freeze wire language and rename the outbox.** Apply B01, B02, and B06; complete P0.1, P0.2, P1.1, T01, T02, T09, T10, and T21.
- [ ] **Phase 2—Canonicalize and deduplicate.** Apply B03 and B05; complete P0.3, P0.5, T03, T04, T17, T18, and T22.
- [ ] **Phase 3—Replace history protocol.** Apply B04 in one breaking cutover; complete P0.4, P2.2, T07, and T08.
- [ ] **Phase 4—Build classified failure recovery.** Apply B09; complete P1.2, P1.3, P1.6, T05, T06, T11, T12, T13, and T20.
- [ ] **Phase 5—Replace lifecycle and page APIs.** Apply B07 and B08; complete P1.4, P1.5, T14, T15, and T16.
- [ ] **Phase 6—Bound history and replace stale authority.** Complete P2.1, P2.3, and T19.

## External-pattern adoption checklist

- [ ] Adopt applicable Replicache patterns: explicit identity, atomic deduplication, version negotiation, and terminal handling.
  - Sources: [push](https://doc.replicache.dev/reference/server-push) and [pull](https://doc.replicache.dev/reference/server-pull).
- [ ] Adopt applicable CouchDB patterns: normative glossary, opaque positions, checkpoints, recovery, and filtered views.
  - Source: [CouchDB replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html).
- [ ] Adopt applicable Electric patterns: named views, bounded initial pages, caught-up control, and must-refetch.
  - Source: [Electric HTTP Shape API](https://electric-sql.com/docs/sync/api/http).
- [ ] Adopt applicable PowerSync patterns: ordered at-least-once upload, deduplication keys, and explicit conflict-policy ownership.
  - Source: [PowerSync handling update conflicts](https://docs.powersync.com/handling-writes/handling-update-conflicts).
- [ ] Pair HLC with maximum clock offset and operational clock requirements, following CockroachDB practice.
  - Source: [CockroachDB clock synchronization](https://www.cockroachlabs.com/docs/stable/deploy-cockroachdb-on-premises#step-1-synchronize-clocks).
- [ ] Adopt applicable Syncular patterns: `commitSeq`, serialized push, locked duplicate recheck, schema-aware outbox encoding, conformance tests, virtual clocks, and fault injection.
  - Evidence: `libs/palladium/docs/plans/syncular-comparison-20260824.md:41-53,57-62`.

## Final verification checklist

### Existing review evidence

- [x] Start from a repository current with `origin/main` at review time.
- [x] Inspect TypeScript core, Rust core/store/Axum, Atrium, protocol fixtures, architecture docs, and Syncular comparison.
- [x] Run six isolated Vitest reproductions and observe T01–T06 failures.
- [x] Remove disposable reproduction tests.
- [x] Run baseline `pnpm --filter @palladium/core test`: 265 tests passed in 21 files.
- [x] Run baseline `cargo test -p palladium-core -p palladium-sqlite -p palladium-axum`: 160 tests passed in 9 suites.
- [x] Attribute `_sync_pending_ops` and `_sync_pending_changes` history.

### Post-cutover evidence recorded 2026-08-24

- [x] Core static verification: `pnpm --filter @palladium/core lint` — **passed** (Biome checked 42 files, no warnings); `pnpm --filter @palladium/core typecheck` — **passed**.
- [x] Core behavioral verification: `pnpm --filter @palladium/core test` — **passed** (21 files, 261 tests).
- [x] Protocol consumer/e2e verification: `pnpm --filter @palladium/core build && pnpm --filter @palladium/e2e typecheck && pnpm --filter @palladium/e2e test` — **all passed** (e2e: 7 files, 39 tests).
- [x] Rust/Atrium/CLI verification: `cargo test -p palladium-core -p palladium-sqlite -p palladium-postgres -p palladium-axum -p palladium-cli -p atrium` — **passed** (164 tests across 16 suites).
- [x] Focused Rust/Axum/Atrium verification: `cargo test -p palladium-core -p palladium-axum -p atrium` — **passed** (142 tests across 10 suites).
- [x] Earlier focused generic-store check: `cargo test -p palladium-core -p palladium-sqlite -p palladium-postgres -p palladium-axum` — **122 tests passed, 0 failures**. This supports the checked C07 and C18 items; it does not close the release gate.
- [x] Earlier focused Atrium check: `cargo test -p atrium --lib` — **28 passed**; `cargo check -p atrium` — **passed**. Source evidence confirms versioned `{changes,cursor,purges,events,control,caughtUp}` pages, ACL-hidden scan advancement, and explicit event acknowledgement.

### Required after remediation

- [x] Run changed `@palladium/core` focused and full unit suites.
- [x] Run changed Rust crate focused and full suites.
- [ ] Run SQLite and live PostgreSQL store conformance tests.
- [x] Run TypeScript/Rust protocol fixture compatibility tests.
- [x] Run Atrium authorization, append, duplicate, and clock-skew tests.
- [x] Run two-client and Atrium family-sync end-to-end suites.
- [ ] Exercise bootstrap, caught-up, offline retry, blocked-auth, quarantine recovery, resnapshot, stop, and disposal through public APIs.
- [ ] Run repository-native formatting, linting, and type checking for affected packages.
- [ ] Confirm no compatibility shims, deprecated paths, old names, temporary tests, or generated state remain.
- [x] Record exact commands and outcomes here.
- [ ] Change **Release status** to production-ready only when every release gate is satisfied.
