# Palladium bug hunt — 2026-11-07

## Scope and status

Read-only audit of the Palladium TypeScript packages and Rust crates, including Atrium. No fixes, commits, or pushes were made as part of the audit.

- Audited checkout: `.worktrees/palladium-bughunt-20261106`.
- Audited commit: `25639eb` (`fix/palladium-node-idempotent-open`).
- Its tree, `a04ba8880bec80e93f16664c03b3f1d8c6b29ab0`, was verified identical to `origin/main` at `69f2e11648942478195959eba55a3ac4603be650`.
- The audit checkout was clean at completion. Existing changes in the primary checkout were preserved.
- Temporary probe directories were removed; the inline probes were not retained as regression tests.

This document preserves the findings and evidence from the audit. Findings are grouped under the same 18 identifiers as the audit summary; several identifiers contain more than one related defect. Severity is provisional and depends on the deployment and consumer contract.

**Evidence terminology:** “reproduced” means observed in a local runtime probe, not necessarily a real browser or native device. HTTP probes used local servers and synthetic records. Browser/notification API behavior exercised through fakes is identified separately. Source-only findings are not presented as runtime-qualified failures.

## Priority 1 — server security and access-control integrity

### 1. Axum blob endpoints discard the authorized scope

**Location:** `libs/palladium/crates/palladium-axum/src/routes/blobs.rs`, especially `authorize()` and the upload/read/delete/presign handlers; `libs/palladium/crates/palladium-blobs/src/lib.rs`.

The blob authorization helper converts the returned `Grant` to `()`, discarding `Grant.scope()`. All requests use one `AppState.blob_store`, whose storage interface accepts a blob ID but no scope. Change-stream handlers, in contrast, use the authorized scope.

**Reproduction:** A real router with `BearerAuthenticator`, `BearerScopeAuthorizer`, and `FilesystemBlobStore` accepted Alice's upload. Bob, mapped to a different scope, read the bytes with HTTP 200 and deleted them with HTTP 204. Alice's next read returned 404.

**Impact and qualification:** The returned scope alone does not isolate blob data. This is a cross-scope isolation defect for hosts relying on the scope contract. The bundled authorizer is explicitly for development; a custom authorizer can deny individual blob resources, so this is not proof that every custom authorization implementation is bypassed. The bundled CLI dev server does not configure blob storage. Atrium implements separate blob handlers.

**Fix direction:** Carry the authorized scope through blob creation, storage, lookup, deletion, and presigning, with ownership established on upload. Prove cross-scope denial as well as same-scope access.

### 2. Atrium serves uploader-selected active content inline

**Location:** `libs/palladium/crates/atrium/src/routes/blobs.rs`, `put_blob()` and `get_blob()`.

The upload content type is persisted and reflected into the download response without an attachment disposition or `X-Content-Type-Options: nosniff`.

**Reproduction:** Uploading `<script>alert(1)</script>` as `text/html` returned 201. Download returned 200 with `Content-Type: text/html`, the original bytes, and neither protective header.

**Impact and qualification:** An active-content serving hazard and potential stored-XSS vector if the content is rendered in a security-sensitive origin/context. Script execution was not demonstrated in a real browser. Blob access requires authorization, which affects exploit delivery; authenticated fetch followed by an application-created object URL is not equivalent to unauthenticated top-level navigation.

**Fix direction:** Define the intended blob-rendering contract and prevent untrusted active content from executing in the application/API security context.

### 3. Redundant revocations disclose private record identifiers

**Location:** `libs/palladium/crates/atrium/src/db.rs`, `revoke_share()`, `set_sharing_and_enqueue()`, and `records_for_root()`; `src/routes/changes.rs`, revoke-event purge generation.

Revocation events are generated without requiring that the recipient previously had visibility. Purge generation then includes private root and child identifiers.

**Reproduction:** Bob joined Alice's workspace but was never granted access to a private note. His initial changes response was HTTP 200 with no changes, purges, or events. Alice redundantly unshared the note from Bob. His next successful changes response contained a revoke event and both the private note ID and its `note_images` child ID in `purges`. Setting an already-private note to `private` reproduced the same disclosure. A separate share control returned a grant event and the shared note's change.

**Impact:** Disclosure of private table names and record identifiers to a workspace member, not disclosure of the note's contents.

**Probe correction:** Earlier negative results used `x-node`, not the required `x-palladium-node` header, and mistakenly interpreted error responses as empty envelopes. The corrected probes checked HTTP status and reproduced the disclosure.

**Fix direction:** Generate purge events from actual visibility transitions and recipient-specific prior access, while preserving valid revocation delivery.

### 4. Child `root_id` updates diverge from ACL metadata

**Location:** `libs/palladium/crates/atrium/src/db.rs`, change authorization/application and ACL record handling.

An ordinary replicated update can change a child's `root_id`, while the server's ACL record continues to identify its original root. Client-visible parentage and server-side authorization then disagree.

**Reproduction:** Inserted a note and a `note_images` child, then submitted an update setting the child's `root_id` to a different UUID. The update returned HTTP 201. Two consequences were then observed:

- A member with read access to the original note received the update change, including the value, so the identifier of Alice's unrelated private note was disclosed to him.
- After Alice revoked that member's access to the original note, the server's purge for the original note also listed the child, even though the replicated row now claimed the unrelated note as its parent. The server's ACL metadata continued to treat the child as belonging to the original note.

**Impact and qualification:** Access-control/data-integrity divergence between replicated parentage and server-side authorization metadata, with an observable private-identifier disclosure and a purge that does not match the client's view of the row. A write-based takeover of another member's data was not exercised end to end.

**Fix direction:** Either enforce immutable parentage or implement an atomic reparenting contract that validates both roots and updates ACL metadata consistently.

### 5. Mixed RSA/EC JWKS prevents Atrium startup

**Location:** `libs/palladium/crates/atrium/src/identity.rs`, `JwkSet`, `Jwk`, and key fetching.

Every JWK requires RSA-specific `n` and `e` fields before the key type is inspected. A valid EC entry therefore causes deserialization of the entire set to fail, even when a usable RSA key is also present.

**Reproduction:** A local OIDC provider published RSA and EC keys. Atrium exited during startup with `identity provider unavailable: OIDC provider unavailable: error decoding response body`. With the same setup publishing only the RSA key, Atrium stayed running and health returned 200.

**Impact:** An unrelated unsupported key in the provider's key set can prevent startup. This finding does not require adding support for EC-signed tokens; ignoring unsupported key types safely is a distinct concern.

**Fix direction:** Parse heterogeneous JWKS safely, select supported signing keys, and retain fail-closed algorithm validation.

## Priority 1–2 — sync and data integrity

### 6. Pre-apply validation bypasses quarantine and blocks sync progress

**Location:** `libs/palladium/core/src/engine.ts`, `canonicalOp()` and `applyRemotePage()` (preparation at lines 1305–1316 in the audited snapshot); `core/src/sync.ts`, page polling.

Page preparation and canonicalization happen before per-change error handling. An update to the immutable `id` column throws during preparation, so the rejection callback and transport quarantine policy are never reached.

**Reproduction:** A remote `id` update threw `TypeError: Cannot update the immutable primary key`, with zero quarantine entries, even under `terminalPolicy: "degraded_skip"`. Three consecutive polls against a server that keeps returning the same change each threw the same error, the persisted append cursor stayed `null`, and the quarantine table stayed empty.

**Impact:** The failed page does not checkpoint its cursor, so repeated delivery can permanently block progress. Source inspection found the Rust structural validator does not reject this particular update column.

**Fix direction:** Handle preparation failures through the deliberate invalid-change/quarantine policy without advancing past unapplied valid work accidentally. Align server and client immutable-key validation.

### 7. Recovery leaves quarantine and sync error status stale

**Location:** `libs/palladium/core/src/sync.ts`, page application, quarantine cleanup, `#hasUnresolvedFailure()`, and `#lastError` handling.

Two related recovery defects were reproduced:

- A change failed to apply and was quarantined (`attempts: 1`, `permanent: 0`). When the server later redelivered the same change with a higher HLC and a complete payload, it applied successfully and the row was present, but the quarantine row remained unchanged and `inspectQuarantine()` still listed the change as a non-permanent blocking entry. Status stayed `degraded` across polls.
- A single failing `/v1/clock` request at startup left status `offline` for every subsequent poll even though the clock endpoint and the changes endpoint both answered normally afterwards. `#lastError` keeps its `uplink` phase, and `#hasUnresolvedFailure()` treats any uplink-phase error as unresolved, so the success branch that clears `#lastError` is never reached. With a pending outbox row the same failing clock is retried and the status recovers, so the defect is specific to the error state, not to clock access.

**Impact:** Persistent incorrect failure state after recovery, including stale quarantine records. The second case is not evidence that data stops syncing; downlink polling continued successfully.

**Fix direction:** Reconcile quarantine and phase-specific error state on actual recovery, preserving genuinely unresolved failures.

### 8. Schema-less initialization permits a case-alias LWW bypass

**Location:** `libs/palladium/core/src/engine.ts`, initialization, `readSchemaColumns()`, `canonicalColumn()`, and column-version metadata.

`init()` without a `SchemaConfig` is supported, but column canonicalization metadata is not populated on that path. SQLite treats differently cased column names as the same column while conflict metadata can treat them as separate registers.

**Reproduction:** With schema-less initialization, an older remote update using a column-case alias (`Title` against a `title` column) overwrote a newer local value: the row ended up holding the older remote text. The same scenario with schema initialization kept the newer local value, which isolates the schema-less path as the cause.

**Impact:** Stale values can win conflict resolution for that supported initialization path. This is not a claim that all LWW behavior is disabled whenever a schema argument is absent.

**Fix direction:** Establish authoritative SQL column identity on every supported initialization path and keep metadata current for supported schema changes.

### 9. Mixed-case table names defeat operation normalization

**Location:** `libs/palladium/core/src/engine.ts`, `normalizeOps()` and later table canonicalization.

Normalization keys operations by the original table spelling, but application canonicalizes the table name. A delete and an insert for one SQL row can survive normalization as distinct operations and then conflict during application.

**Reproduction:** One remote change deleted the row for table `notes` and inserted the same row ID for table `NOTES`. The page reported success, but the row was absent afterwards: the insert was dropped and the final row count was zero.

**Fix direction:** Use one table-identity convention consistently before operation normalization, validation, and application.

### 10. Node adapter transactions are not isolated from concurrent direct calls

**Location:** `libs/palladium/sqlite-node/src/adapter.ts`, `transaction()` and direct adapter operations.

`transaction()` starts a transaction on the shared connection and awaits the callback with the same adapter. Other direct operations can run on that connection during the callback's awaits.

**Reproduction:** A write issued outside the callback completed but disappeared when the open transaction rolled back. Overlapping transaction calls produced `cannot start a transaction within a transaction`.

**Impact and qualification:** A data-loss/API-contract hazard for consumers mixing transactions and concurrent direct adapter calls. Engine-mediated operations have their own serialization; this probe does not establish that an existing application flow bypasses it.

**Fix direction:** Define and enforce the adapter's concurrency contract, including callback-scoped access, without introducing nested-call deadlocks.

### 11. Capacitor SQL classifier mistakes quoted punctuation for syntax

**Location:** `libs/palladium/sqlite-capacitor/src/adapter.ts`, `classification()`, `afterParentheses()`, and `hasTopLevelReturning()`.

The tokenizer distinguishes quoted values from punctuation, but statement splitting and parenthesis tracking compare token values without consistently checking token kind.

**Reproduction through an adapter/plugin fake backed by a real SQLite database:**

| Statement | Route chosen | Result |
|---|---|---|
| `SELECT ';' AS sep` | `execute()` | No rows returned; the query never ran as a read |
| `SELECT '(' AS p` | `query()` | Correct row |
| `INSERT INTO items(id, value) VALUES (1, '(') RETURNING id, value` | `execute()` | Row inserted, returned rows lost |
| `INSERT INTO items(id, value) VALUES (2, ';') RETURNING id, value` | `execute()` | Row inserted, returned rows lost |
| `INSERT INTO items(id, value) VALUES (3, 'ok') RETURNING id, value` | `run()` | Row and returned rows correct |

A quoted `;` splits the statement into two, so the classifier treats it as a multi-statement command; a quoted `(` or `)` then defeats the top-level `RETURNING` scan for the remainder of the statement.

**Impact:** Valid SQL silently returns the wrong result shape. This was not tested on a physical Capacitor device.

**Fix direction:** Respect token kinds everywhere syntax is interpreted, including statement boundaries, CTE parsing, and `RETURNING` detection.

### 12. Requests during successful native initialization never settle

**Location:** `libs/palladium/nuxt/src/create-database-plugin.ts`, `sendToWorker()` and the native initialization branch.

Until `nativeReady` becomes true, requests enter the worker pending map. On native there is no worker; successful initialization sets the flag but never dispatches or rejects those existing requests.

**Reproduction:** Issued a request while a deferred native initialization was pending, then resolved initialization successfully. The queued request was still unsettled after the initialization promise resolved and remained unsettled after the observation window; it neither resolved nor rejected.

**Fix direction:** Define startup request behavior explicitly and drain queued native requests, or reject them deterministically under the intended API contract.

## Priority 2 — robustness and public API behavior

### 13. Concurrent identical Atrium blob uploads return 500

**Location:** `libs/palladium/crates/atrium/src/db.rs`, blob insertion/idempotency handling; `src/routes/blobs.rs`.

The existence/idempotency check and insert race with another upload for the same blob ID.

**Reproduction:** Of 16 concurrent identical PUT requests to a new blob ID, 5 returned 201 and 11 returned 500.

**Fix direction:** Make identical upload handling atomic and return the documented idempotent outcome under contention.

### 14. Atrium blob IDs collide across workspaces

**Location:** `libs/palladium/crates/atrium/src/db.rs`, blob primary key and ownership checks.

Blob IDs occupy one global namespace rather than a workspace-qualified namespace.

**Reproduction:** Alice uploaded a blob. Mallory created a separate workspace and note, then used the same blob ID. The upload returned 409, `blob id is already bound to different content`.

**Impact and qualification:** Cross-workspace identifier contention; a tenant knowing or predicting a chosen ID could claim it first. No cross-workspace overwrite or content read was demonstrated. If global blob IDs are intentional, this needs an explicit contract rather than automatically being treated as a security bypass.

**Fix direction:** Decide whether blob identity is workspace-qualified or intentionally global and align collision semantics with that decision.

### 15. Unknown signing-key IDs amplify JWKS requests

**Location:** `libs/palladium/crates/atrium/src/identity.rs`, authentication cache miss and refresh handling.

Unknown key IDs trigger provider refresh without an effective cooldown for repeated misses.

**Reproduction:** Five tokens with forged key IDs each caused a JWKS request, taking the provider hit count from 1 (startup) to 6. All five forged tokens were rejected with 401.

**Impact:** Unauthenticated requests can amplify traffic to the identity provider and consume authentication-path resources. Provider-wide denial of service was not load-tested.

**Fix direction:** Bound refresh frequency and coalesce misses while allowing legitimate key rotation and preserving fail-closed verification.

### 16. Cursor validation and CLI listing have incorrect behavior

#### 16a. Oversized cursor maps to an internal error

**Location:** `libs/palladium/crates/palladium-axum/src/routes/changes.rs` and backend cursor conversion/error mapping.

**Reproduction:** Cursor behavior against the running server:

| Cursor | Status | Response |
|---|---|---|
| `0` | 400 | `append cursor must be positive` |
| `1` | 200 | page |
| `abc`, `-1` | 400 | `invalid append cursor` |
| `9223372036854775807` | 200 | page |
| `9223372036854775808` | 500 | `internal server error` |
| `999999999999999999999999` | 400 | `append cursor out of range` |

The cursor is accepted as an unsigned 64-bit value and then converted to a signed database position, so the value one above `i64::MAX` reaches the store conversion and surfaces as an internal error instead of a client-input rejection.

**Fix direction:** Validate the cursor against the storage-supported range at the HTTP boundary and return the appropriate 4xx error.

#### 16b. `instances list` creates databases and ignores backend selection

**Location:** `libs/palladium/crates/palladium-cli/src/main.rs`, `run_instances_list()`.

The listing path opens every configured instance as a `SqliteStore`, which creates/migrates missing SQLite databases and mishandles Postgres configuration.

**Reproduction:** Listing a configured instance whose database file did not exist created `missing.db` and `missing.db.lock` and reported the instance as `ok`. A separate instance configured with a `postgres://` URL was reported as `error: io error: No such file or directory (os error 2)`, because the path was handed to the SQLite store.

**Fix direction:** Inspect instance status without provisioning/migrating it, and respect each configured backend.

### 17. Web Push subscription lifecycle races

**Location:** `libs/palladium/notifications-web-push/src/channel.ts`, `subscribe()` and `unsubscribe()`.

Two related behaviors were observed with browser/service-worker API fakes:

- With the backend unsubscribe call held open, a second subscription was established (endpoint `push.test/3`) while the first unsubscribe was still in flight. When the first unsubscribe finally completed, the in-memory subscription was cleared even though the newer subscription existed, and a subsequent send returned `skipped: Not subscribed to web push`. The same probe without a configured backend unsubscribe endpoint did not reproduce the clearing, which locates the defect in the backend-unsubscribe step rather than in browser removal.
- Subscription attempted before service-worker activation failed with `InvalidStateError`; the channel returned `null` without waiting for activation, and the push manager was called once.

**Impact and qualification:** Subscription state can diverge from the browser/backend, and first enrollment can fail. These are controlled lifecycle probes, not real push-service/browser delivery qualification.

**Fix direction:** Associate asynchronous operations with the subscription generation they own and wait for the intended registration's active state under the enrollment contract.

### 18. Notification interaction events and React bigint query parameters

#### 18a. Advertised instance interaction events never fire

**Location:** `libs/palladium/notifications-core/src/events.ts`, `instance.ts`, and channel integration.

The event map exposes `clicked` and `dismissed`, but channel interaction callbacks are not forwarded into those instance events.

**Reproduction with a browser Notification fake:** A simulated click invoked the channel callback once, but instance `clicked` and `dismissed` listeners remained at zero. Closing the notification from its click handler also invoked the channel's dismiss callback; whether that should count as dismissal requires a defined interaction contract.

**Fix direction:** Connect the public event contract to channel interactions and distinguish click/close/dismiss semantics deliberately.

#### 18b. React live queries crash on bigint parameters

**Location:** `libs/palladium/react/src/use-live-query.ts`, query identity construction.

Query parameters are passed to `JSON.stringify()` during rendering. The storage value contract supports `bigint`, which JSON serialization rejects.

**Reproduction:** Server-rendering the hook inside its provider with a bigint parameter threw `TypeError: Do not know how to serialize a BigInt` during render, before any query ran.

**Fix direction:** Construct query identity for all supported parameter types without lossy conversion or render-time serialization errors.

## Additional source-only and low-priority findings

These are separate from the 18 grouped findings above.

### Browser SQLite opening/closing is not coordinated

**Location:** `libs/palladium/sqlite-browser/src/adapter.ts`, `open()` and `close()`.

`open()` checks `this.#db !== null` and then awaits `sqlite3InitModule()` before assigning the handle, so two concurrent calls can both pass the guard and the second assignment replaces the first connection. `close()` does not wait for a pending open, so a close that lands during initialization can be undone when the open completes. A Node probe could not initialize the browser WASM bundle, so this remains source-only. The package has no unit-test script in the audited snapshot.

### Postgres schema identifiers are not length-bounded

**Location:** `libs/palladium/crates/palladium-postgres/src/store.rs`, `validate_identifier()` and schema construction.

The validator checks identifier characters but not length. [INFERENCE] On a standard PostgreSQL build with a 63-byte identifier limit, two accepted schema names with the same first 63 bytes resolve to the same truncated schema. No live Postgres reproduction was run.

The same file registers instance ownership using `cfg.path` (the connection string) before selecting its schema, while `InstanceConfig` carries the schema separately under `postgres.schema`. [INFERENCE] Two configured schema-isolated instances sharing one connection URL therefore collide in the in-process instance registry despite selecting different schemas. This was not runtime-qualified against Postgres.

### HLC sortable-string contract fails beyond 15 timestamp digits

**Location:** `libs/palladium/core/src/hlc.ts`, `hlcToString()`.

**Reproduction:** For timestamps `999999999999999` and `1000000000000000`, `compareHlc()` orders the first before the second, but their string forms order the other way round. Padding is only 15 digits.

**Impact:** Low. The threshold is approximately year 33658, and inspected engine consumers use these strings for equality keys rather than ordering. This is not evidence of a current engine conflict-resolution failure or a TypeScript/Rust wire-format mismatch.

## Verification performed

The audit recorded these baseline checks before/alongside the targeted probes:

- `just test-ts` (maintained TypeScript packages, excluding e2e/examples/nuxt): 922 tests across 66 files passed. Per package: core 489, notifications-core 88, notifications-toast 49, sqlite-capacitor 54, notifications-web-push 43, notifications-browser 23, sqlite-node 23, notifications-react 26, worker 21, notifications-svelte 18, notifications-capacitor 17, notifications-expo 13, notifications-vue 13, react 20, svelte 9, kysely 7, vite-plugin 3, vue 6.
- `@palladium/nuxt`: 14 tests passed, run directly. `just test-ts` excludes this package, so its suite is not part of that aggregate and its exclusion comment in the `Justfile` ("Nuxt has no unit suite") no longer matches the package.
- `cargo test --workspace`: 221 tests passed.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: passed.
- Local runtime probes exercised the failures described above. No permanent regression tests were added.

Passing baseline suites do not disprove the findings; the probes exercised gaps in their coverage.

### Evidence limitations

- No physical Capacitor/native device qualification.
- No real-browser XSS execution, browser SQLite lifecycle proof, or production push-delivery proof.
- No live Postgres qualification.
- HTTP/security probes used local synthetic users, workspaces, and payloads; there was no production impact assessment.
- The already-merged Node SQLite repeated-open repair (PR #102) was present in the audited tree and is not an outstanding finding in this document.
- This document records an audit snapshot, not a statement that subsequent revisions still contain every issue. Recheck the exact source before implementation.

## Recommended repair order

1. Define and enforce blob scope/active-content policies and ACL parentage invariants (#1–#4).
2. Repair sync poison handling, recovery state, and SQL identity consistency (#6–#9).
3. Repair OIDC key-set parsing and refresh bounds (#5, #15).
4. Repair adapter SQL routing/startup and concurrent transaction contracts (#10–#12).
5. Address blob contention, CLI/cursor behavior, and public notification/query APIs (#13–#18).

For each repair, add behavior-focused failing-before/passing-after coverage, run the entire affected test module, and exercise the real boundary involved. A native-plugin fake or direct engine probe alone is not proof of device or browser behavior.
