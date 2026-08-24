# Syncular comparison and Palladium adoption report

Date: 2026-08-24

## Executive verdict

Syncular is materially ahead of Palladium PR #36 in protocol robustness and testing discipline. Palladium has stronger local merge semantics and richer Habitat-specific ACL and sharing behavior, but its history pagination is not production-safe while the downlink cursor is derived from client HLC values.

The highest-priority change is a server-assigned append sequence independent of HLC. HLC should remain the conflict-resolution clock; it must not also represent server insertion order.

This comparison adopted two practices immediately:

1. PalladiumEngine now fails closed when an adapter cannot provide transaction support, instead of applying a batch sequentially and risking a partial commit.
2. Palladium core now has deterministic response-loss and truncated-response sync scenarios using the existing injected fetch seam.

The append-sequence change was not partially implemented. It requires a coordinated protocol and migration cutover across Atrium persistence, response envelopes, SyncTransport decoding, client cursor persistence, and e2e coverage. Implementing only the server field or only the Atrium decoder would leave mixed HLC and append-order cursor semantics.

## Compared revisions and workspace layout

- Syncular repository: <https://github.com/syncular/syncular>
- Syncular shallow-clone revision: [`197755fd07cbf6440ac7aaebd920b1d9cb7700b9`](https://github.com/syncular/syncular/tree/197755fd07cbf6440ac7aaebd920b1d9cb7700b9)
- Syncular clone depth: 1
- Syncular scratch clone: `/var/folders/ym/vy7fg2dj5vj2gh7f3by_lv_m0000gn/T/syncular-compare.UgZvgu9wIM/syncular`
- Palladium PR: HabitatHQ/habitathq PR #36
- Palladium PR revision used for the comparison: `b948342`
- Palladium implementation worktree: `.worktrees/syncular-adoption`
- Palladium implementation branch: `fix/pr36-syncular-adoption`

The main checkout and the existing `.worktrees/fix-pr36-review` worktree were preserved. No commit or push was performed.

## Comparison method

The comparison covered three independent dimensions:

- Robustness: ordering and cursors, idempotency, transactions, retry behavior, partial failure, poison changes, schema evolution, authorization, validation, and recovery.
- Features: directionality, offline writes, scoping, conflict behavior, subscriptions, batching, tombstones, sharing, blobs, migrations, realtime behavior, and supported runtimes.
- Testing methodology: real versus mocked components, deterministic clocks and identifiers, transport fault injection, conformance vectors, concurrency, replay behavior, load testing, and CI isolation.

Three read-only scout agents independently examined robustness, feature coverage, and testing methodology. Their findings were treated as evidence inputs. The final prioritization and adoption decisions were checked against the cloned sources and Palladium PR code.

## Summary comparison

| Area | Syncular | Palladium PR #36 | Judgement |
|---|---|---|---|
| History cursor | Server-assigned `commitSeq`; bootstrap pins a sequence; filtered and empty windows still advance through scanned history | Cursor is derived from client HLC; Atrium queries `hlc_key > after` | Syncular is decisively stronger. Palladium can permanently skip a late-arriving older-HLC offline write. |
| Atomicity | Push requires serialized transactional storage and fails closed when capabilities are absent | Engine previously fell back to sequential writes on non-transactional adapters | Syncular was stronger. Palladium's fallback was removed in this work. |
| Idempotency | Partition lock, duplicate recheck after locking, and result caching in the same transaction | Stable change IDs, durable client outbox, and `INSERT OR IGNORE` server storage | Syncular handles concurrent duplicate delivery more rigorously. |
| Conflict handling | Server-authoritative `baseVersion` conflicts and application policy | Per-column HLC LWW, buffered missing-row updates, and durable delete tombstones | Palladium is stronger for offline peer convergence. Syncular's model should not replace it. |
| Poison changes | Retry behavior and protocol errors | Bounded durable quarantine, dead-letter state, and cursor recovery | Palladium is explicit and operationally useful, though permanent dead-lettering is a deliberate data-loss tradeoff. |
| Schema evolution | Schema-aware outbox encoding; incompatible queued operations get a terminal error | Versioned client SQL migrations, but queued wire operations lack a schema compatibility marker | Palladium migrations are stronger; Syncular's outbox compatibility tactic is worth adopting. |
| Authorization | Generic scope resolution, validators, and whole-commit validation | Domain-specific workspace membership, root and child ACL, sharing grants, purges, and blob ACL inheritance | Palladium's Habitat model is stronger and more specific. |
| Feature breadth | Scoped and windowed subscriptions, realtime socket rounds, multiple runtimes, and content-addressed network blobs | Polling, full workspace history, Atrium sharing and purges, Atrium blobs, TS client, and Rust server | Syncular is significantly broader; several features require protocol redesign rather than direct copying. |
| Test methodology | Real client/server loopback testkit, virtual clock, seeded transport faults, TS/Rust conformance catalog, golden wire vectors, and load budgets | Good core tests, Rust HTTP tests, real-process TS-to-Rust e2e, and poison tests; frequent timers and ad hoc fetch mocks | Syncular is substantially stronger and more systematic. |

## Robustness findings

### P0: HLC is not a safe server history cursor

Syncular assigns a server commit sequence independent of client clocks:

- [`packages/server/src/pull.ts:466-575`](https://github.com/syncular/syncular/blob/197755fd07cbf6440ac7aaebd920b1d9cb7700b9/packages/server/src/pull.ts#L466-L575) handles cursor expiry, pins bootstrap to `asOfCommitSeq`, reads by `afterSeq`, and advances through filtered history.
- [`packages/server/src/push.ts:904-1060`](https://github.com/syncular/syncular/blob/197755fd07cbf6440ac7aaebd920b1d9cb7700b9/packages/server/src/push.ts#L904-L1060) serializes partition writes, rechecks duplicate commits after locking, and persists the append sequence and idempotency result atomically.

Palladium currently encodes the downlink cursor from HLC in `libs/palladium/core/src/sync.ts:95-106`. Atrium filters and orders history by `hlc_key` in `libs/palladium/crates/atrium/src/db.rs:861-878`.

A valid data-loss sequence is:

1. A consumer advances past client HLC `100`.
2. An offline client later uploads a valid change with HLC `50`.
3. Atrium appends that change after the consumer's previous request.
4. The consumer requests `after=100`.
5. Atrium excludes the newly appended change forever because its HLC is less than the cursor.

The monotonic-max cursor behavior already added to PR #36 prevents cursor regression, but it cannot retrieve a change inserted later with an older HLC.

#### Required clean cutover

- Add a server-assigned `append_seq` or equivalent commit sequence to Atrium history.
- Query with `append_seq > after`.
- Return a response-level high-water cursor even when ACL filtering produces no visible changes.
- When a page is limited, return the sequence of the last completely scanned history position rather than the global maximum.
- Persist the sequence cursor on the client.
- Keep HLC exclusively for LWW conflict resolution.
- Migrate or explicitly invalidate existing persisted HLC cursors.
- Add an e2e regression: consume HLC 100, append HLC 50 afterward, and verify the next sync delivers HLC 50 exactly once.

This is a production correctness requirement, not an optional optimization.

### P0: atomic and serialized commit finalization

Syncular's push path:

- Performs an optimistic idempotency lookup.
- Begins a storage transaction and requires partition serialization support.
- Fails closed if the backend lacks the capabilities required for serialized apply and atomic rejection finalization.
- Rechecks idempotency after acquiring the partition lock.
- Applies every operation within one transaction.
- Rolls back all writes on commit rejection.
- Appends the commit and stores the canonical idempotency result before commit.

Relevant source: [`packages/server/src/push.ts:862-1060`](https://github.com/syncular/syncular/blob/197755fd07cbf6440ac7aaebd920b1d9cb7700b9/packages/server/src/push.ts#L862-L1060).

PalladiumEngine previously treated transaction support as optional. Both local `tx()` and `applyRemote()` fell back to applying operations sequentially on a plain `StorageAdapter`. A failure during operation two could therefore leave operation one durable without the corresponding complete sync change or cursor checkpoint.

This report implemented a fail-closed policy for the engine. Existing Node, browser, and Capacitor SQLite adapters already implement transactions.

Atrium already authorizes and appends a change within one SQLite transaction. Its endpoint is simpler than Syncular's authoritative operation application, but concurrent duplicate POST behavior should still receive explicit coverage when append sequencing is added.

### P1: poison-change isolation

Palladium already has a useful bounded quarantine mechanism:

- Failed changes are stored durably with retry count and error information.
- A transient failure prevents cursor advancement.
- After the configured attempt limit, the change becomes permanent and the cursor may advance.
- A successful retry clears quarantine state.

This is comparable to or more explicit than Syncular's retry behavior. The caveat is that permanent dead-lettering converts a correctness failure into continued availability. Production operations must surface permanent entries prominently because the local replica has intentionally omitted data.

Recommended additional scenario: a batch containing good, malformed, and good changes must eventually apply both valid changes while retaining a durable permanent record for the malformed one.

### P1: schema-aware outbox replay

Syncular stores a schema-agnostic outbox and encodes queued operations against the current schema at send time. Removed tables or columns produce a stable terminal incompatibility error rather than an endless retry:

- `packages/web-client/src/outbox.ts:1-8`
- `packages/web-client/src/outbox.ts:121-185`

Palladium's outbox stores serialized wire operations and HLC data. After a migration removes or renames a table or column, an old operation can remain retryable without a durable terminal classification.

Recommended adaptation:

- Persist a schema fingerprint or schema version with each queued change.
- Validate every queued operation against the active schema before POST.
- Move incompatible operations to a terminal outbox state with a stable error identity.
- Preserve compatible queued changes and their original change IDs and HLCs.
- Test reopening after a migration with both compatible and incompatible queued writes.

Do not copy Syncular's full wipe-and-rebootstrap schema model. Palladium's versioned SQL migrations are an intentional stronger capability.

### P1: authorization and validation

Syncular authorizes using stored authoritative rows, strips scope columns from untrusted payloads, validates post-merge rows, and supports whole-commit validators.

Palladium Atrium has stronger domain-specific behavior:

- Workspace membership enforcement.
- Root ownership and sharing-class checks.
- Root-to-child authorization inheritance.
- Per-member grants and revokes.
- Durable grant and purge events with acknowledgement.
- Blob access inherited from the parent note.

The primary follow-up is adversarial coverage rather than copying Syncular's generic scope system. Tests should cover scope-field manipulation, first-insert races, cross-workspace identifiers, concurrent invite acceptance, and rejected changes leaving no stale record metadata.

## Feature comparison

### Capabilities where Syncular is broader

#### Scoped and windowed partial replicas

Syncular has named subscriptions, requested and effective scopes, windowed bootstrap, incremental windows, cursor horizons, and reset behavior. Palladium currently polls a full workspace history and filters it through Atrium ACL logic.

This is adaptable, but it requires a protocol design. Subscription identity, scope changes, pagination completeness, grant backfill, revoke purge, and cursor advancement must share one model.

#### Realtime transport

Syncular supports websocket deltas, wakeups, reconnect catch-up, presence, and full sync rounds over the realtime connection. Palladium currently uses periodic HTTP polling.

A safe Palladium first step would use realtime as a wakeup signal while retaining HTTP history as the source of truth. Direct websocket delivery without an append-sequence catch-up protocol would introduce another data-loss path.

#### Network blob lifecycle

Syncular uses content-addressed blob references, upload-before-reference validation, download handling, and orphan cleanup. Atrium already exposes ACL-gated blob PUT and GET routes, while Palladium core's `BlobHandle` and adapters are local-only.

Palladium can adapt the lifecycle without copying Syncular's schema wholesale:

- Add a network blob transport abstraction.
- Integrate Atrium upload and download routes with `BlobHandle`.
- Preserve parent-record ACL checks.
- Validate referenced blobs before accepting a synchronized record.
- Define orphan cleanup and retry behavior.

#### Runtime and implementation breadth

Syncular has one TypeScript core and one Rust core that implement the same protocol, plus browser, native, Bun, Node, Worker, and binding surfaces. Palladium currently has a TypeScript client engine and Rust server stores and routes rather than two interchangeable client cores.

### Capabilities where Palladium is stronger

#### Offline merge semantics

Palladium applies per-column HLC LWW. Concurrent changes to different columns survive, missing-row updates are buffered, and delete tombstones prevent stale resurrection. Syncular's server-authoritative `baseVersion` conflict model should not replace this behavior.

#### Client migrations

Palladium has versioned SQL migrations and seeds. Syncular intentionally uses schema-floor reset and rebootstrap rather than general client migrations. Palladium should preserve migrations and adopt only explicit outbox compatibility handling.

#### Habitat-specific sharing

Atrium's household sharing classes, per-member grants, root and child inheritance, purge behavior, and note-blob ACL are more directly aligned with Habitat's product semantics than Syncular's generic scope model.

## Testing methodology findings

### Deterministic transport fault vocabulary

Syncular centralizes transport faults in [`packages/testing/src/faults.ts`](https://github.com/syncular/syncular/blob/197755fd07cbf6440ac7aaebd920b1d9cb7700b9/packages/testing/src/faults.ts):

- Drop a request before server processing.
- Drop a response after server processing.
- Duplicate a request.
- Truncate a response.
- Drop or truncate a segment download.
- Drop or corrupt a signed-URL fetch.
- Use a seeded PRNG so truncation and corruption locations reproduce exactly.

Palladium previously used separate ad hoc mocked fetch responders. This report added deterministic response-loss and truncated-response scenarios through the existing fetch seam. A reusable controller is justified once more scenarios need to arm the same faults; until then, the existing local helper is the smaller design.

### Real shipped components through an in-process seam

Syncular's [`createTestSync`](https://github.com/syncular/syncular/blob/197755fd07cbf6440ac7aaebd920b1d9cb7700b9/packages/testing/src/create-test-sync.ts) wires the real shipped client and server through an in-process loopback. It is wiring rather than a mocked protocol implementation.

Palladium has two useful but separated layers:

- Core tests with injected fetch responses.
- Real-process e2e tests against the Rust servers.

Recommended middle tier: invoke the Atrium Axum router in-process for deterministic protocol tests, while retaining a smaller real-process e2e lane for packaging and lifecycle coverage.

### Virtual domain clock

Syncular's virtual clock is an explicit `now()` seam shared by every test client and the server. Tests advance domain time without intercepting `setTimeout`.

Palladium should introduce explicit clock seams for:

- HLC wall time.
- Outbox and quarantine timestamps.
- Token and lease expiry where applicable.

This would eliminate many sleeps and make same-millisecond counter and expiry cases deterministic.

### Cross-implementation conformance

Syncular has a scenario catalog executed against TypeScript and Rust implementations. Golden SSP2 vectors validate:

- Valid decode.
- Expected decoded structure.
- Byte-identical re-encoding.
- Invalid vectors and exact stable error codes.

Palladium has no shared TS/Rust wire-vector gate. TypeScript `WireChange`, Rust `Change`, Atrium response envelopes, HLC serialization, malformed changes, and purge/event envelopes should have committed language-neutral vectors consumed by both test suites.

### No timers in tests

Syncular treats wall-clock sleeps in tests as defects. Palladium core tests and e2e tests still use poll intervals and sleeps.

Recommended replacement APIs:

- `syncOnce()` for one deterministic uplink/downlink round.
- `syncUntilIdle()` with an explicit bounded progress condition.
- Readiness barriers based on observable state rather than elapsed time.
- Deterministic hooks for response acknowledgement and reconnect.

### Load and performance methodology

Syncular has a load harness with ramped virtual users, wall-time caps, abort and drain behavior, latency percentiles, conflict and retry counts, and CI benchmark budgets.

Palladium has no equivalent sync load lane. An initial informational harness should measure:

- Concurrent client count.
- Push and pull throughput.
- p50, p95, and p99 request latency.
- Retry, conflict, quarantine, and duplicate-delivery rates.
- SQLite and Postgres behavior separately.

Make budgets blocking only after the environment and baseline are stable.

## Completed implementation

### Fail closed without transaction support

Changed files:

- `libs/palladium/core/src/engine.ts`
- `libs/palladium/core/src/storage.ts`
- `libs/palladium/core/src/__tests__/engine.test.ts`
- `libs/palladium/STATUS.md`

Behavior:

- `PalladiumEngine.tx()` checks transaction capability before advancing HLC or applying a write.
- `PalladiumEngine.applyRemote()` performs the same check before receiving the remote HLC or modifying local state.
- Both paths use the adapter transaction directly once capability is established.
- The previous sequential fallback was removed.
- The storage capability documentation now states that PalladiumEngine writes require transactions, while lower-level storage and migration APIs may still use plain adapters.
- Status documentation records the fail-closed engine contract.

Regression test:

- A deliberately non-transactional adapter is initialized successfully for lower-level access.
- A two-table local transaction is rejected.
- A two-table remote change is rejected.
- Both tables remain empty after each rejection.

The SQL-injection guard test was also rewritten to mutate an otherwise well-typed remote change at runtime. This preserves the untrusted-input scenario without leaving an intentional TypeScript diagnostic.

### Deterministic sync fault scenarios

Changed file:

- `libs/palladium/core/src/__tests__/sync.test.ts`

Added scenarios:

#### Response lost after server processing

- The fake server observes and records the change ID.
- The first response is lost after simulated processing.
- The durable outbox retains the change.
- A new transport instance drains the outbox.
- Two POST attempts reuse one logical change ID.
- The outbox is empty after the successful acknowledgement.

This proves stable client replay identity and durable retry. It does not by itself prove concurrent server-side idempotency; that requires a real Atrium regression when append sequencing is implemented.

#### Truncated downlink response

- The first response contains truncated JSON.
- The poll returns without applying the change.
- The cursor does not advance.
- The second poll requests the same URL without an `after` cursor.
- A valid replay applies exactly one row.

### Type-level test cleanup

The modified core test schemas were converted from interfaces to type aliases so they satisfy Palladium's `SchemaMap` constraint under LSP diagnostics as well as the package compiler.

## Verification completed

### Core

Command:

```sh
pnpm --filter @palladium/core test
```

Result:

- 21 test files passed.
- 258 tests passed.

Typecheck:

```sh
pnpm --filter @palladium/core typecheck
```

Result: passed.

Formatting and linting:

```sh
pnpm exec biome check \
  libs/palladium/core/src/engine.ts \
  libs/palladium/core/src/storage.ts \
  libs/palladium/core/src/__tests__/engine.test.ts \
  libs/palladium/core/src/__tests__/sync.test.ts
```

Result: passed with no fixes required in the final run.

LSP diagnostics:

- `engine.ts`: no errors.
- `storage.ts`: no errors.
- `sync.test.ts`: no errors.
- `engine.test.ts`: no errors; existing deprecated `LiveQuery` hints remain.

### Atrium Rust

Command:

```sh
cargo test -p atrium
```

Result:

- 21 tests passed across 3 suites.

### Real TypeScript-to-Rust sync

Final command:

```sh
env -u CARGO_TARGET_DIR pnpm exec vitest run \
  src/__tests__/two-client-sync.test.ts \
  src/__tests__/atrium-family-sync.test.ts
```

Run from `libs/palladium/e2e`.

Result:

- `atrium-family-sync.test.ts`: 7 tests passed.
- `two-client-sync.test.ts`: 6 tests passed.
- 13 real client/server tests passed in total.

The final e2e run covered multi-device convergence, household sharing, sharing downgrade behavior, per-member backfill, revoke purge, rejected offline writes after revoke, insert/update/delete propagation, bidirectional convergence, same-column LWW, and different-column merge survival.

### E2e harness path issue observed

The clean PR version of `libs/palladium/e2e/src/setup/server.ts` hardcodes `<worktree>/target/debug/palladium`, while this development environment configures `CARGO_TARGET_DIR` to the primary checkout's `target` directory. Cargo therefore built the binary in one location while global setup attempted to spawn another.

Unsetting `CARGO_TARGET_DIR` made Cargo and the existing hardcoded path agree for this isolated worktree and allowed the final tests to pass. The existing `.worktrees/fix-pr36-review` worktree already contains an uncommitted change to resolve the binary through `process.env.CARGO_TARGET_DIR ?? join(ROOT, "target")`; this comparison worktree did not duplicate or overwrite that user work.

## Recommended follow-up order

### P0 before production use

1. Replace the HLC history cursor with a server append sequence.
2. Add the late-arriving older-HLC regression at Atrium database, HTTP, and TS-to-Rust e2e levels.
3. Verify ACL-filtered empty pages still advance the response high-water cursor safely.
4. Define migration behavior for persisted HLC cursors.

### P1 correctness and compatibility

1. Add a shared deterministic transport fault controller used by core and integration tests.
2. Add TS/Rust wire conformance vectors and malformed-envelope cases.
3. Add schema-aware outbox incompatibility handling.
4. Add concurrent duplicate POST coverage with one persisted append sequence and one canonical response.
5. Add adversarial authorization tests for scope manipulation and cross-workspace identifiers.

### P2 operability and breadth

1. Add explicit clock seams and remove timer-driven unit tests.
2. Add an in-process Atrium router test tier.
3. Add realtime wakeups only after append-sequence catch-up is established.
4. Integrate Atrium network blobs with the client blob abstraction.
5. Add informational sync load and latency reporting before setting blocking budgets.

## Final judgement

Palladium PR #36 already demonstrates good local-first foundations: durable outbox behavior, column-level HLC merge, tombstones, poison quarantine, Habitat-specific ACL, and real TS-to-Rust acceptance coverage. Syncular demonstrates the higher standard for history ordering, atomic server commit finalization, cross-language conformance, deterministic fault injection, and timer-free testing.

The transaction fallback was safe to remove immediately and is completed here. The deterministic response-loss and truncation cases were also safe to adopt immediately and are completed here. The append-sequence cursor is the most important remaining robustness change and should be treated as a coordinated protocol migration rather than an incremental optional enhancement.
