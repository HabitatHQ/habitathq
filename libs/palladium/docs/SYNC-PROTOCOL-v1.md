# Palladium Sync Protocol v1

**Status:** Normative contract for the next breaking protocol release.
**Authority:** This document is the sole normative authority for Palladium sync wire behavior, persisted sync state, and public transport behavior. It supersedes sync guidance in `DRAFT-ARCH.md`, `answers.md`, `TESTING-SYNC.md`, `STATUS.md`, and historical plans where they differ. The production-readiness review remains the implementation and evidence ledger: [`sync-engine-contract-review-20260824T164225Z.md`](./sync-engine-contract-review-20260824T164225Z.md).

A conforming implementation MUST implement every requirement in this document. A document, test, fixture, or public API that contradicts it is obsolete and MUST be removed rather than supported through compatibility behavior. Version 1 does not accept bare arrays, HLC `after` cursors, response-shape dialect detection, `_sync_pending_changes`, `_sync_pending_ops`, ULID row IDs, or opaque `decodeChanges` / `acknowledgeChanges` hooks.

## 1. Terms and authority

- **Replica** is one local materialized database and its stable `NodeId`; it is not a user, session, or authorization credential.
- **Principal** is the authenticated actor selected by the host. The server derives the **scope** from the principal; client payloads MUST NOT select or override it.
- **Client view** is the authorized subset of a scope materialized by a replica. It may change because ACL policy changes.
- **`Op`** is an insert, update, or delete of one row. A **Change** is an immutable, atomic ordered collection of operations with a UUIDv4 change ID and one HLC. A **canonical change** is the sole accepted representation after transaction normalization.
- A **conflict version** is the complete LWW version used for one cell or tombstone. Its comparison is total and deterministic. A version includes the HLC and any explicitly specified intra-change ordering component; v1 canonicalization eliminates repeated targets instead of accepting an implicit equal-HLC sequence.
- A **history position** is a server-issued append position. A **checkpoint** is a durably stored position for one client view after its complete typed page has committed.
- **Uplink** sends durable local changes to the server; **downlink** applies server pages to a replica. Both are **at least once**: a valid item or page can be delivered again and every consumer boundary MUST be replay-safe.
- **Idempotency** means reprocessing the same scoped canonical change has the documented no-op effect. It is not merely an HTTP success code.
- **Hydrated** means the replica has applied its initial page/snapshot state. **Caught up** means it has committed every page through the response `upperBound`; later appends may still exist.
- **Resnapshot** (also **must-refetch**) means a checkpoint can no longer be safely continued and the client MUST replace its view from the server-directed bootstrap.
- A **transient failure** can be retried without changing user input. A **terminal rejection** cannot be retried until an operator or application changes the cause. **Quarantine** is durable, inspectable storage for a terminal item. A **dead letter** is a quarantined downlink item; an outbox quarantine is a quarantined uplink item.
- A **tombstone** is replicated delete-conflict state and prevents stale resurrection. An **ACL purge** removes a formerly authorized row from one client view; it is not a replicated delete and MUST NOT create a tombstone.
- **Schema identity** identifies the negotiated schema and supported tables/columns. A **syncable value** is a JSON value that round-trips losslessly under Section 2.

## 2. Data language and validation

### 2.1 Rows, identifiers, and JSON

Every syncable table MUST have one immutable primary key named `id`. `id` MUST be a canonical lowercase UUIDv7 string. UUIDv4, ULID, arbitrary text, noncanonical spellings, and primary-key patches are invalid at local mutation, persisted outbox decode, and every wire boundary. `NodeId` and `Change.id` are UUIDv4 and have different meanings from row IDs.

`SyncRow` is an object with an `id` and only schema-declared columns. A `JsonValue` is exactly `null`, boolean, finite JSON number, string, array of `JsonValue`, or object with string keys and `JsonValue` values. `undefined`, functions, symbols, bigint, NaN, infinities, cyclic values, dates without an explicit JSON encoding, and values that change meaning on JSON encode/decode are invalid. Implementations MUST reject unknown tables/columns and unsafe identifiers before mutation; they MUST NOT interpolate unvalidated identifiers into SQL.

The host binds each `NodeId` to an authorized principal. A NodeId is stable replica identity only and MUST NOT authenticate or authorize requests.

### 2.2 Canonical change

Before local apply, LWW stamping, and outbox persistence, a transaction MUST normalize to one canonical Change:

1. Group writes by `(table, row id)` while preserving dependencies required by the schema.
2. For repeated updates, retain only the final value of each column.
3. Fold an insert followed by updates into the final insert.
4. Fold writes followed by a terminal delete into that delete.
5. Treat delete followed by a later insert as an explicit resurrection insert.
6. Reject any remaining repeated `(table, row id, column)` target or invalid operation.

The normalized operations are exactly the operations locally applied, persisted, hashed, and transmitted. Receivers MUST validate canonical form before applying it. A Change and all of its operations are immutable and atomic: a receiver applies all effects or none.

For a change identity `(scope, change_id)`, the server MUST calculate the canonical-byte identity before node, ACL, event, or other metadata side effects. The same canonical bytes are a no-op and return the original receipt/position. Different canonical bytes are a side-effect-free terminal `idempotency_conflict`. Change IDs may repeat in different scopes.

### 2.3 Conflict and clocks

A column write wins only when its complete conflict version is greater than the stored version. Deletes leave tombstones; a stale update or insert MUST NOT resurrect a tombstoned row. Reclamation requires proof that every relevant history consumer is safe, or a resnapshot protocol. A later canonical insert with the same row ID and greater version is the only resurrection path.

Before an untrusted HLC changes clock, data, metadata, or append history, the receiver MUST validate structural form, finite safe-integer wall time, counter bounds, UUIDv4 node identity, configured maximum future skew, and per-node monotonicity. Failure returns terminal `clock_skew` with server time where applicable and has no data or checkpoint effect.

## 3. Versioned HTTP page protocol

All v1 sync endpoints are scoped by server authentication. A request MUST use protocol version 1 and a response MUST carry `version: 1`; unknown versions are terminal `unsupported_version`. The protocol has no fallback dialect.

### 3.1 Uplink

`POST /v1/changes` accepts one canonical Change. Its v1 success receipt is a typed object:

```json
{ "version": 1, "outcome": "inserted | duplicate", "cursor": "opaque-position" }
```

The receipt is an acknowledgement of this one change only. A client MUST retain the `_sync_outbox` row until it has decoded a valid matching success receipt and durably recorded the acknowledgement. A lost response after server commit is safe: retrying the identical scoped canonical change receives `duplicate` and drains the same row. The outbox is one row per canonical Change, not one row per operation, and local data, LWW metadata, durable HLC, and that row MUST commit atomically before `changes:local` is observable. Uplink order is the durable outbox order and one transport runs one single-flight drain worker.

### 3.2 Downlink

`GET /v1/changes?cursor=<opaque-position>&limit=<positive bounded integer>` returns one typed v1 page. `cursor` is omitted for the initial page. Servers clamp limits to their documented maximum (v1 maximum: 100), capture an upper bound, and return bounded work only.

```json
{
  "version": 1,
  "changes": ["canonical Change", "..."],
  "cursor": "opaque-position or null",
  "upperBound": "opaque-position",
  "caughtUp": true,
  "purges": ["typed ACL purge", "..."],
  "events": ["typed authorized event", "..."],
  "control": { "mustRefetch": false }
}
```

The generic page may omit `purges`, `events`, and `control` only when its endpoint contract explicitly does not support them; Atrium v1 includes them. Implementations MUST exhaustively validate the complete envelope before extracting any cursor or applying any field. A missing, malformed, unknown-version, or unknown-operation envelope has no application, acknowledgement, or checkpoint effect. A response is never a bare Change array.

A history position is independent of HLC, server-issued, opaque to generic clients, scoped to the client view, and monotonic. Servers assign it atomically at durable append. A page scans only through its captured `upperBound`; `caughtUp: true` means the returned/retained checkpoint has reached that bound. Empty and ACL-filtered windows may advance a checkpoint across scanned unauthorized history without exposing unauthorized changes. A client MUST store the returned position only after the entire typed page has committed. It MUST NOT advance past malformed or transiently failed content.

If `control.mustRefetch` is true, or the server returns terminal `checkpoint_expired`, the client MUST stop ordinary continuation, discard the invalid view checkpoint as directed, and resnapshot. Initial and steady-state sync MUST remain page-bounded and yield between pages so a UI worker is not monopolized.

### 3.3 Typed page application and acknowledgements

A transport applies a page in one replay-safe transaction boundary: validate page; apply canonical changes; apply idempotent ACL purges; persist deduplicated events; persist the page checkpoint; then make local effects observable. A retry of the same page MUST be harmless. Remote data, LWW metadata, pending-update state, applied-change ledger (or equivalent checkpoint epoch), events, purges, and checkpoint MUST be atomic where their storage shares a transaction boundary; no component MAY perform a partial opaque page hook outside this contract.

Event acknowledgement is an explicit typed, idempotent request after durable event processing. An acknowledgement failure leaves the event pending and a later page/retry MUST not duplicate its effect. Purges MUST delete only the local view and associated local derived data, never emit a replicated tombstone, and MUST make a resnapshot possible if later authorization restores visibility.

## 4. Errors, recovery, status, and lifecycle

Every failure is a `SyncError` with `phase`, stable `code`, `retryable`, HTTP `status` when present, `changeId` when applicable, `attempt`, and `nextRetryAt` when scheduled. HTTP error bodies are typed `{ "code": "stable_code", "message": "human explanation" }`; clients preserve status, body, and `Retry-After`. Known terminal examples are `unsupported_version`, `invalid_envelope`, `invalid_operation`, `invalid_row_id`, `invalid_json_value`, `idempotency_conflict`, `clock_skew`, `checkpoint_expired`, and authorization/schema rejection codes. Unknown error codes are terminal protocol errors, not implicit retries.

Retryable failures use timeout and cancellation, exponential backoff with jitter, and bounded authentication refresh. Terminal items are durably quarantined with code, phase, attempts, payload, history position when present, and timestamps. The public recovery surface MUST support inspect, export, retry, and explicit discard. Policy is configured per code: it either blocks the affected sync flow or explicitly skips it into visible `degraded` state. No implementation may use a fixed attempt count as an unclassified terminal decision.

One live `SyncTransport` exclusively owns one engine. Attachment obtains that lease; a second live attachment is rejected. `start`, `poll`, `syncOnce`, timer work, and `stop` are single-flight and race-safe. `stop` cancels in-flight work or awaits it for a documented bound. `dispose()` is idempotent, stops work, unregisters checkpoint/event handling, releases the lease, and permits a replacement transport. There are no compatibility lifecycle wrappers.

The public status is exactly one of `uninitialized`, `hydrating`, `syncing`, `caught_up`, `offline`, `blocked_auth`, or `degraded`. Status transitions and structured errors are observable; `caught_up` is not a promise that the server will never append more history.

## 5. Contract index

| Review clauses | Normative sections |
| --- | --- |
| C01–C05 data and identity | Sections 1, 2.1 |
| C06–C10 canonical Change and atomic persistence | Sections 2.2, 3.1, 3.3 |
| C11–C15 merge, tombstones, and HLC validation | Sections 2.2–2.3 |
| C16–C21 delivery, history, checkpoints, acknowledgements | Sections 3.1–3.3 |
| C22–C28 lifecycle, errors, quarantine, status, bounded history | Section 4 and Section 3.2 |

## 6. Conformance and evidence

Protocol documentation alone does not prove a release. The checklist in the review is authoritative for implementation evidence and remains unchecked until source enforcement and permanent regression/conformance coverage exist. Required verification commands and their latest recorded outcomes are maintained there; do not infer a checked release gate from this specification.
