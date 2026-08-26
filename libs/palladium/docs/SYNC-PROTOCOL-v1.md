# Palladium Sync Protocol v1

**Status:** Implemented wire and transport contract for the current v1 release.
**Authority:** This document defines the currently implemented v1 HTTP envelope and `@palladium/core` transport behavior. It supersedes conflicting sync guidance in `DRAFT-ARCH.md`, `answers.md`, historical plans, and the prior PR37 TODO wording. The implementation-closure evidence is maintained in [`pr37-error-versioning-robustness-todos-20260825T082724Z.md`](./pr37-error-versioning-robustness-todos-20260825T082724Z.md); targeted commands are in [`TESTING-SYNC.md`](./TESTING-SYNC.md).

V1 has no bare change-array response, no HLC history cursor, no legacy pending-operations queue, and no transport response-shape fallback. The local durable queue is `_sync_outbox`. A client treats a server-issued cursor as an opaque non-empty token even though the current generic and Atrium servers encode decimal append positions.

## 1. Identity, changes, and local schema identity

- A `Change` has a UUIDv4 `id`, one HLC, and an ordered canonical operation list. Replicated row IDs are canonical lowercase UUIDv7 strings. `NodeId` is UUIDv4 replica identity; it is not an authorization credential.
- A syncable operation is `insert`, `update`, or `delete`. The engine validates a remote HLC and rejects a remote change whose operations are not canonical before its page transaction begins. Schema/table validation is performed while applying operations.
- The server derives scope from authentication. Atrium additionally requires the `x-workspace` header and verifies workspace membership; callers do not submit a generic store scope in the change payload.
- `PalladiumEngine.init({ version, schema })` derives and persists a local `schema_identity_v1` value. `SyncTransport` requires either an explicit `schemaFingerprint` or an initialized engine identity, and records that identity with durable outbox rows. Before posting an outbox row from a different identity, the transport moves it to `_sync_outbox_quarantine` rather than sending it. This implementation has no schema-identity field or negotiation in the v1 HTTP payload; server-side schema compatibility is therefore outside this wire contract.

## 2. HTTP wire contract

### 2.1 Upload

`POST /v1/changes` accepts one JSON `Change` and returns `201 Created` with the typed receipt:

```json
{ "version": 1, "outcome": "inserted", "cursor": "opaque-position" }
```

`outcome` is exactly `inserted` or `duplicate`; `cursor` is a non-empty string. A `duplicate` receipt identifies a previously accepted identical scoped change. The client removes an `_sync_outbox` row only after it decodes this complete receipt. A malformed JSON body, another receipt version, an unknown outcome, or a missing/empty cursor leaves the row durable and records `lastError` as `invalid_receipt`.

Generic Palladium Axum and Atrium both emit this receipt shape. They return the cursor associated with the append outcome, including a duplicate. A successful receipt is the acknowledgement for only the posted change; a response lost after the server commits is retried with the same durable change ID.

### 2.2 Download

`GET /v1/changes?cursor=<token>&limit=<n>` returns the complete versioned envelope:

```json
{
  "version": 1,
  "changes": ["Change", "..."],
  "purges": [{ "table": "notes", "row_id": "uuidv7" }],
  "events": [{ "id": 1, "kind": "grant", "root_id": "uuidv7" }],
  "cursor": "opaque-position or null",
  "upperBound": "opaque-position",
  "caughtUp": true,
  "control": { "mustRefetch": false }
}
```

The TypeScript transport requires every displayed member, validates the envelope before applying anything, and rejects malformed pages as `invalid_envelope` or malformed changes as `invalid_operation`. It requests `limit=100`. Atrium accepts only limits from 1 through 100 and returns `invalid_request` otherwise. Atrium currently accepts its decimal cursor representation only; empty, non-canonical, non-numeric, overflowing, and Unicode cursor values return a typed `400 invalid_cursor` response without a route panic. Generic clients must not parse, compare, or construct cursor contents.

A page cursor is the server append position after the last scanned history entry. It can advance when ACL filtering hides all changes in the scanned window. `caughtUp` says that the page had fewer raw history entries than the requested limit; it is not a promise that later entries cannot be appended. Atrium currently emits `mustRefetch: false`; transports treat a true value as `degraded` and do not continue that page.

### 2.3 Errors and event acknowledgement

Non-success HTTP responses use JSON `{ "code": "stable_code", "message": "human explanation" }`. `SyncTransport.lastError` is a typed `SyncError` with phase, stable code, retryability, and—when available—HTTP status, response body, change ID, attempt, and retry time. It preserves `Retry-After` as `nextRetryAt` for a rate-limited upload. Known HTTP code handling includes authorization, request/cursor validation, conflict, clock, checkpoint, rate-limit, schema, and internal classifications; an unrecognized or malformed error body remains a terminal transport classification rather than a success.

Atrium event acknowledgements use `POST /v1/changes/events/ack` with:

```json
{ "event_ids": [1, 2] }
```

The endpoint is caller- and workspace-scoped and returns `204 No Content` only for pending events owned by that caller. The client first persists deduplicated `grant`/`revoke` event records in `_sync_events`, then sends the acknowledgement. If acknowledgement fails, the local event remains unacknowledged and a later poll can retry it without duplicating its persisted event record.

## 3. Transactional downlink and recovery

`PalladiumEngine.applyRemotePage` is the transport coordination primitive. It validates the page's remote changes first, then runs remote application in one storage transaction. When every remote change succeeds, the transaction applies ACL purges and runs the transport callback that persists events and the append checkpoint; only after that transaction commits does the transport acknowledge page events.

A rejected remote change is handled inside that transaction through the quarantine callback. Other valid changes in the page may remain durable, but the page's purges, events, and checkpoint callback are withheld and the prior checkpoint remains current. The result is `false`, the transport enters `degraded`, and replay of the page is safe. Under `terminalPolicy: "degraded_skip"`, the rejected change is durably marked permanent; under the default `"block"` policy it remains a visible blocking quarantine. This is intentionally more precise than claiming that a mixed-validity page advances its cursor atomically.

`SyncTransport` exposes restart-safe quarantine operations:

- `inspectQuarantine()` reads durable uplink and downlink entries.
- `exportQuarantine()` serializes those entries for operator inspection.
- `retryQuarantined(changeId)` restores an uplink entry to `_sync_outbox`, or validates and reapplies the persisted downlink payload.

The public recovery API exposes `inspectQuarantine()`, `exportQuarantine()`, `retryQuarantined(changeId)`, and `discardQuarantined(changeId)`. Discard persists a permanent forward skip; it does not delete the evidence. Quarantine entries contain the serialized payload, phase, attempts/permanent state, timestamps, and available schema/error identity. Downlink entries additionally retain their HLC metadata.

## 4. Lifecycle and status

One live `SyncTransport` owns an engine lease. A second attachment fails until the first is disposed. `start`, `syncOnce`, timer work, `stop`, and `dispose` serialize lifecycle work. `stop()` aborts an active request, clears the interval, and unsubscribes local-change handling. `dispose()` is idempotent, stops the transport, unregisters the local outbox checkpoint, and releases the engine lease so a replacement transport can attach.

The engine status vocabulary is exactly `uninitialized`, `hydrating`, `syncing`, `caught_up`, `offline`, `blocked_auth`, and `degraded`. Status changes are emitted through `sync:status`; the latest structured transport failure is exposed through `lastError`. `caught_up` records the result of the most recent completed page, not permanent convergence.

## 5. Executable fixtures

- [`protocol-fixtures/changes-envelope.valid.json`](../protocol-fixtures/changes-envelope.valid.json) is the shared valid page envelope with the required v1 page members. The fixture intentionally uses empty purge/event arrays; typed purge and event wire shapes are exercised by transport and Atrium tests.
- [`protocol-fixtures/receipt.valid.json`](../protocol-fixtures/receipt.valid.json) is the success-receipt fixture used by the fixture contract test.
- [`protocol-fixtures/wire-invalid.json`](../protocol-fixtures/wire-invalid.json) supplies language-neutral invalid HLC, operation, and cursor cases.
- [`protocol-fixtures/hostile-inputs.bounded.json`](../protocol-fixtures/hostile-inputs.bounded.json) is the deterministic hostile corpus. It limits materialized bodies to 8 KiB, nesting to 32 levels, and cases per decoder to eight. It is not an unbounded fuzzing campaign.
- Seed corpus commands:
  ```sh
  pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-corpus.test.ts
  cargo test -p atrium bounded_hostile_route_corpus -- --nocapture
  ```
- Deterministic generated-sequence commands:
  ```sh
  pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-generated.test.ts
  cargo test -p atrium generated_hostile_route_sequences -- --nocapture
  ```

- Sanitizer-backed bounded decoder campaign:
  ```sh
  cd libs/palladium/crates/atrium/fuzz
  cargo +nightly fuzz run change_decoder -- -runs=1000 -max_len=8192
  ```

See [`TESTING-SYNC.md`](./TESTING-SYNC.md) for the final targeted validation matrix and external prerequisites.
