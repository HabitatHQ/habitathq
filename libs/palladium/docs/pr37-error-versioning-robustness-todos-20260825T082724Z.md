# PR #37 error, versioning, usability, and robustness TODOs

- **Recorded at:** 2026-08-25T08:27:24Z
- **PR:** #37 — `feat(palladium): adopt sync protocol v1`
- **Scope:** `@palladium/core`, generic Rust stores and Axum server, Atrium, protocol fixtures, examples, and end-to-end consumers
- **Release posture:** These are release blockers or supportability requirements for claiming Sync Protocol v1 conformance. The repository remains pre-release, so fixes should be clean cutovers without compatibility shims.

> **Ledger status:** Historical review findings, not an active readiness checklist. The implemented v1 behavior is defined by [`SYNC-PROTOCOL-v1.md`](./SYNC-PROTOCOL-v1.md). Items below remain useful as evidence of the original findings; their unchecked “Done when” boxes MUST NOT be read as claims that the current source still has every listed defect.

Current source-backed residuals are intentionally limited to Atrium's decimal-specific cursor representation and longer sanitizer/differential campaigns requiring external toolchains. The transport recovery API exposes typed inspect, export, retry, and durable explicit discard; generic transport handling remains opaque. The targeted commands for the implemented behavior are maintained in [`TESTING-SYNC.md`](./TESTING-SYNC.md).


## P0 — Correctness and liveness

### TODO 1 — Validate typed uplink receipts before draining the outbox

**Problem:** `SyncTransport` treats any successful HTTP status as acknowledgement and deletes the durable outbox row without decoding `{ version, outcome, cursor }`. The generic Axum server omits the cursor and serializes a debug outcome; Atrium always reports `inserted`, including duplicates.

**Evidence:**

- `libs/palladium/core/src/sync.ts:517-523,654-670`
- `libs/palladium/core/src/__tests__/sync.test.ts:603-621`
- `libs/palladium/crates/palladium-axum/src/routes/changes.rs:28-36`
- `libs/palladium/crates/atrium/src/routes/changes.rs:108-134`

**Done when:**

- [ ] Decode the complete v1 receipt before acknowledging the single in-flight change.
- [ ] Accept only `version: 1`, `outcome: "inserted" | "duplicate"`, and a valid cursor.
- [ ] Retain the outbox row and emit a structured terminal protocol error for a malformed, missing, unknown-version, or mismatched receipt.
- [ ] Make generic Axum and Atrium return the same conforming receipt shape and distinguish inserted from duplicate.
- [ ] Add regression coverage proving that `201 {}`, HTML, a wrong version, an unknown outcome, or a missing cursor cannot drain the outbox.
- [ ] Add lost-response replay coverage proving that a valid duplicate receipt drains exactly the original row.

### TODO 2 — Unregister the local-change checkpoint on transport disposal

**Problem:** construction registers a durable local-change checkpoint but discards its unregister function. A replacement transport registers a second checkpoint; the next local mutation attempts to insert the same change twice and fails the transaction with a duplicate `_sync_outbox.change_id` constraint.

**Evidence:**

- `libs/palladium/core/src/engine.ts:413-417`
- `libs/palladium/core/src/sync.ts:405-439,620-625`

**Done when:**

- [ ] Retain the unregister function returned by `registerLocalChangeCheckpoint()`.
- [ ] Invoke it exactly once during idempotent disposal, including partially started transports.
- [ ] Ensure a stopped but not disposed transport retains the checkpoint required for durable local writes.
- [ ] Add a regression test that disposes one transport, attaches a replacement, commits a local transaction, and observes exactly one outbox row.
- [ ] Verify that a failed constructor or initialization path cannot leak ownership or a checkpoint registration.

### TODO 3 — Make transport lifecycle operations race-safe and cancellable

**Problem:** `stop()` can return during the initial poll, after which `start()` installs a new interval. Timer and event callbacks also discard `#tick()` rejections, and disposal can release ownership while old work is still in flight.

**Evidence:**

- `libs/palladium/core/src/sync.ts:475-495,602-625,678-686,748-782`

**Done when:**

- [ ] Serialize `start`, timer work, `poll`, `syncOnce`, `stop`, and `dispose` through one explicit lifecycle state machine.
- [ ] Make overlapping callers await the same in-flight operation rather than silently returning.
- [ ] Cancel fetches with `AbortController` or await active work for a documented bound.
- [ ] Prevent timer installation or further engine mutation after stop/disposal begins.
- [ ] Catch and classify every background rejection.
- [ ] Add deterministic race tests for stop-during-start, dispose-during-fetch, concurrent `poll`/`syncOnce`, repeated start/stop, and replacement attachment.

### TODO 4 — Return the actual scoped append position from stores

**Problem:** SQLite and PostgreSQL calculate a page cursor as `requested position + returned row count`. Append positions are global while page queries are scope-filtered, so interleaved scopes create gaps and cause repeated delivery and delayed catch-up.

**Evidence:**

- `libs/palladium/crates/palladium-sqlite/src/store.rs:220-268`
- `libs/palladium/crates/palladium-postgres/src/store.rs:211-262`
- Reproduction: scope A rows at append positions 1 and 7 returned cursor `2`, not `7`.

**Done when:**

- [ ] Select the append position with every page row.
- [ ] Return the last scanned row's actual append position as the cursor.
- [ ] Calculate `caughtUp` against the captured upper bound without assuming contiguous per-scope positions.
- [ ] Preserve bounded work for empty and filtered pages.
- [ ] Add shared SQLite/PostgreSQL conformance cases with heavily interleaved scopes, sparse positions, empty pages, and exact-limit pages.

### TODO 5 — Process and acknowledge events durably

**Problem:** the TypeScript client validates `events` but drops them from the decoded page and advances the checkpoint without durable processing or acknowledgement. Atrium keeps returning pending grant/revoke events and performs grant backfill work while they remain unacknowledged.

**Evidence:**

- `libs/palladium/core/src/sync.ts:689-779`
- `libs/palladium/crates/atrium/src/routes/changes.rs:177-235`

**Done when:**

- [ ] Include typed events in the public v1 page model.
- [ ] Persist deduplicated event state atomically with changes, purges, and the page checkpoint.
- [ ] Expose or perform the typed idempotent event acknowledgement request only after durable event processing.
- [ ] Leave events pending when acknowledgement fails without repeating their local effect.
- [ ] Bound Atrium grant backfill work and remove repeated full-history scans from steady-state polling.
- [ ] Add replay tests for response loss, acknowledgement loss, duplicate events, grant backfill, revoke purge, and restart between processing and acknowledgement.

## P1 — Errors, recovery, and version evolution

### TODO 6 — Implement structured sync errors end to end

**Problem:** downlink failures collapse to `null`; uplink failures collapse to `ok`, `rejected`, or `offline`; HTTP status, stable code, body, `Retry-After`, phase, change ID, attempt, and retry schedule are lost. Server error bodies and classifications are inconsistent.

**Evidence:**

- `libs/palladium/core/src/sync.ts:654-670,689-745`
- `libs/palladium/crates/palladium-axum/src/error.rs:10-62`
- `libs/palladium/crates/palladium-axum/src/routes/changes.rs:28-32`
- `libs/palladium/crates/atrium/src/error.rs:49-66`

**Done when:**

- [ ] Define and export one `SyncError` containing phase, stable code, retryability, status, response body, change ID, attempt, and next retry time where applicable.
- [ ] Return `{ "code": "stable_code", "message": "human explanation" }` consistently from generic Axum and Atrium.
- [ ] Map validation, authorization, unsupported version, idempotency conflict, clock skew, expired checkpoint, rate limiting, and internal failure to distinct stable codes.
- [ ] Preserve and honor `Retry-After`.
- [ ] Use timeout, cancellation, exponential backoff with jitter, and bounded authentication refresh.
- [ ] Drive `offline`, `blocked_auth`, and `degraded` from classified failures rather than coarse HTTP success.
- [ ] Add tests for terminal 4xx, retryable 5xx/429, repeated 401, malformed error bodies, unknown codes, timeouts, cancellation, and adapter failures.

### TODO 7 — Parse Atrium cursors without panicking

**Problem:** Atrium indexes `value.as_bytes()[0]`; `GET /v1/changes?cursor=` panics with an out-of-bounds access instead of returning a typed client error.

**Evidence:**

- `libs/palladium/crates/atrium/src/routes/changes.rs:147-159`
- Reproduction: empty cursor panicked at `changes.rs:151:21`.

**Done when:**

- [ ] Replace direct indexing with a shared total cursor parser.
- [ ] Return `invalid_cursor` for empty, noncanonical, negative, overflowing, Unicode, or otherwise unsupported tokens.
- [ ] Ensure cursor parsing has no panic, allocation blow-up, or database work before validation.
- [ ] Add permanent HTTP regression tests for empty and boundary cursor values.

### TODO 8 — Keep generic cursors opaque across protocol versions

**Problem:** `@palladium/core` describes cursors as opaque but validates decimal strings and compares them with `BigInt`, coupling the generic client to Atrium's current representation.

**Evidence:**

- `libs/palladium/core/src/sync.ts:119-131,698-741,767-772`
- `libs/palladium/docs/SYNC-PROTOCOL-v1.md:88`

**Done when:**

- [ ] Generic client code treats the cursor as an opaque versioned token.
- [ ] Any representation-specific validation lives in a named v1 server/client codec rather than the generic transport core.
- [ ] Cursor regression and checkpoint expiry are signalled through typed protocol behavior, not client-side numeric inference.
- [ ] Add fixtures covering non-decimal opaque tokens, wrong-version tokens, replay, regression, and expiry.

### TODO 9 — Require an enforceable schema identity

**Problem:** `schemaFingerprint` defaults to `"unversioned"`, and primary examples omit it. Incompatible app versions therefore compare equal and bypass outbox compatibility inspection.

**Evidence:**

- `libs/palladium/core/src/sync.ts:405-413,497-575`
- `libs/palladium/example-burrow/src/atrium.ts:224-231`

**Done when:**

- [ ] Derive a stable schema identity from initialized schema configuration or require it explicitly before sync attachment.
- [ ] Persist the identity with every outbox row and negotiated client view.
- [ ] Classify incompatible queued work before POST without mutating or dropping it.
- [ ] Define server behavior for unsupported schema identities with a stable terminal code.
- [ ] Update all examples and end-to-end clients to supply or derive real schema identity.
- [ ] Add upgrade tests covering compatible additive changes, removed tables/columns, renamed fields, and queued work created by an older app version.

### TODO 10 — Make quarantine recovery actually recover work

**Problem:** outbox quarantine has no public management surface. Remote `degraded_skip` advances the cursor, while `retryQuarantined()` only resets a marker and cannot retrieve the skipped change. Under blocking policy, deleting the marker causes the same uncheckpointed page to recreate it.

**Evidence:**

- `libs/palladium/core/src/sync.ts:170-199,577-599,627-651,788-862`

**Done when:**

- [ ] Expose typed inspect, export, retry, and explicit discard for both uplink and downlink quarantine.
- [ ] Persist code, phase, attempts, complete payload, schema identity, history position, and timestamps.
- [ ] Make retry replay the stored payload or safely restore the required checkpoint epoch.
- [ ] Make discard an explicit durable skip that permits forward progress without silently deleting evidence.
- [ ] Keep block and degraded-skip behavior visible through status and structured errors.
- [ ] Add restart-safe tests for inspect/export, successful remediation and retry, explicit discard, failed retry, and cursor advancement.

## P1 — Fuzz and adversarial verification

### TODO 11 — Add general protocol fuzz testing

**Goal:** exercise the versioned protocol beyond hand-written examples and keep every discovered input as a deterministic regression seed.

**Done when:**

- [ ] Fuzz TypeScript and Rust decoders for changes, operations, HLCs, UUIDs, receipts, pages, errors, events, purges, and cursors.
- [ ] Generate valid and invalid nested JSON with bounded depth, collection sizes, string lengths, and numeric ranges.
- [ ] Add stateful sequences for POST retry, duplicate delivery, cursor paging, schema upgrade, quarantine recovery, stop/start/dispose, and acknowledgement loss.
- [ ] Differentially check shared fixtures against TypeScript core, generic Rust, and Atrium so the same wire input receives the same classification.
- [ ] Assert invariants: no partial apply, no checkpoint past rejected content, no outbox drain without a valid receipt, idempotent replay, and scope isolation.
- [ ] Persist minimized failures in `protocol-fixtures` or the package-native regression corpus.
- [ ] Run a bounded deterministic fuzz corpus in CI and document the command for longer local or scheduled campaigns.

### TODO 12 — Add explicit “must not panic” fuzz testing

**Goal:** prove that every untrusted protocol and HTTP boundary rejects hostile inputs without panics, process aborts, unhandled promise rejections, runaway allocation, or stuck lifecycle work.

**Done when:**

- [ ] Fuzz every public Axum and Atrium route with arbitrary query strings, headers, paths, content types, truncated bodies, and JSON bodies.
- [ ] Include empty strings, invalid UTF-8 at byte-oriented boundaries, deeply nested JSON, huge numeric strings, integer boundaries, duplicate keys, unknown fields/tags, and oversized collections.
- [ ] Fuzz TypeScript response decoding and lifecycle callbacks while fetches resolve, reject, time out, or return malformed streaming bodies.
- [ ] Wrap Rust targets with a hard invariant that no input may panic or abort; treat every panic as a release-blocking minimized regression.
- [ ] Capture browser/Node unhandled rejections and timer leaks as test failures.
- [ ] Apply explicit input-size and time bounds so “does not panic” cannot degrade into memory exhaustion or hangs.
- [ ] Seed the corpus with the empty Atrium cursor reproduction and every future production or fuzz-discovered failure.
- [ ] Run a bounded must-not-panic corpus in normal CI and longer sanitizer-backed campaigns on a scheduled job.

## Release gate

- Functional v1 receipt, page, structured-error, schema-identity, event, lifecycle, cursor, and quarantine behavior is covered by the current source and targeted checks listed in `TESTING-SYNC.md`.
- The bounded hostile corpus and generated deterministic sequences are retained and run by their language-native commands; they are not a substitute for longer external fuzz campaigns.
- Do not claim production readiness from this historical ledger alone. A release still requires the external prerequisites and any deployment-specific database/authentication validation listed in `TESTING-SYNC.md`.
