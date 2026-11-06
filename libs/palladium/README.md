# Palladium

> Local-first sync engine — Rust backend, TypeScript frontend.

## Packages

| Package | Description |
|---|---|
| `@palladium/core` | Framework-agnostic TS client |
| `@palladium/react` | React bindings |
| `@palladium/vue` | Vue bindings |
| `@palladium/svelte` | Svelte bindings |
| `@palladium/kysely` | Kysely integration |
| `@palladium/vite-plugin` | Vite plugin (COOP/COEP + WASM) |
| `palladium-cli` | npm shim for the Rust CLI |

## Prerequisites

- [mise](https://mise.jdx.dev/) or Node 24 + pnpm 9 + Rust stable
- [`just`](https://just.systems/)

```sh
mise install        # installs node, pnpm, rust, just, cargo tools
pnpm install
```

## Development

```sh
just lint           # lint everything
just test           # test everything
just fmt            # format everything
just ci             # full CI check
```

For maintained Palladium TypeScript packages, use `just test-ts` (builds package
dependencies first) and `just lint-palladium-ts` (the root Biome version).
Examples and live-server E2E remain separate from this unit gate.

For issue-specific checks, failure localization, isolated PostgreSQL setup, and
production-browser smoke steps, see the
[remediation verification/debugging runbook](../../docs/plans/palladium-autonomous-issues-20261009.md#verification-and-debugging-runbook).

### Named development instances

`palladium dev` serves a single database at the root API by default. Repeated
`--instance NAME:PATH` arguments instead open independent SQLite stores and mount
each complete API under `/instances/NAME`:

```sh
cargo run -p palladium-cli -- dev \
  --instance alpha:sqlite:alpha.db \
  --instance beta:sqlite:beta.db
```

Set the client's `serverUrl` to `http://127.0.0.1:3000/instances/alpha` or
`http://127.0.0.1:3000/instances/beta`; changes remain isolated in their respective
databases. Explicit instances override `--db` without opening its database.
Names must be unique and contain only ASCII letters, digits, `_` or `-`.
Configuration errors stop startup before serving any instance. The existing
`--auth` setting applies independently to every mounted API; the default bind
address remains loopback.

`palladium instances list` inspects the configured backend without creating
databases or running migrations. `ok` means an existing initialized store was
found. PostgreSQL connection strings are redacted in listing output. PostgreSQL
schema identifiers are limited to 63 bytes; instance ownership includes both
the connection URL and selected schema.

### Storage ownership and Kysely

`PalladiumDialect` transactions use the adapter's real transaction boundary and
hold exclusive engine storage ownership until commit or rollback. Concurrent
Kysely queries, queued engine writes, and engine-created live-query reads wait
for that boundary. Adapter transaction support is required.

`engine.withStorage(callback)` is the low-level coordination primitive. The
callback receives the adapter and owns the storage queue for its full async
lifetime; it is not itself a transaction. Use `adapter.transaction()` inside it
when atomicity is needed. Do not re-enter queued engine methods from that
callback—they would wait on the callback and deadlock.

Raw SQL through Kysely or the adapter does not generate replicated operations,
outbox entries, or live-query write notifications. Use engine mutations for
replicated writes; Kysely transactions are for explicitly low-level SQL work.

The sync transport reads committed outbox snapshots under the same storage
ownership queue, releases ownership for network I/O, and serializes durable
acknowledgements separately. A transaction that rolls back cannot be uploaded.

IndexedDB blob replacement and deletion commit metadata and chunks atomically.
Failed writes preserve the previous blob, and concurrent reads use a consistent
metadata/chunk snapshot.

### Mutation, reset, and adapter lifecycle

Local builders and remote admission capture immutable JSON snapshots before
asynchronous work. SQL application, durable outbox capture, and observers consume
the same submitted values; later caller mutation cannot change them. Local and
remote LWW writes resolve column aliases against the applied SQLite schema.
Local wire operations use canonical identifiers; received remote payloads keep
their wire identity. Conflicting aliases in one operation are rejected.

Post-commit observer failures do not reject an already-committed mutation or
prevent other observers and live queries from receiving it. Synchronous throws
and asynchronous/thenable rejections reach the engine's `error` observers; failures
in that terminal error channel are contained without recursive reporting.
Observers are not awaited while holding storage ownership. Manual live-query
`refresh()` still rejects observer failures.

Standalone `purgeLocal()` requires transaction support: application rows, LWW
metadata, and pending updates are removed atomically, with invalidation only
after commit. A failed purge preserves the prior row and replay state.

Public HLC values are snapshots, not references to the engine's clock. A
transport fingerprint override does not overwrite the local schema identity
used when reopening.

HLC strings now use 16 timestamp digits so lexical order covers the supported
safe-integer domain. Readers also accept previous 15-digit strings. Do not
lexically compare mixed old/new encodings: parse them or rewrite them first.

Quoted and schema-qualified SQL table names participate in live-query
invalidation. LWW metadata and logical-reset table identities use SQLite's
ASCII-only case folding, preserving distinct Unicode identifiers. Legacy metadata
canonicalization is serialized and transactional. Column names come from the
applied SQLite schema, including migrated columns and parameterized types;
legacy buffered patch keys are canonicalized before replay. Logical reset rejects
foreign-key cascades and DELETE-trigger writes into preserved or unowned tables;
INSERT/UPDATE-only triggers do not prevent deletion.

Schema-less initialization also reads authoritative SQLite column names and
migrates legacy alias metadata. Local changes normalize canonical identifiers
before operation normalization; SQL application and conflict metadata use the
same identity.

Remote preparation errors follow the downlink quarantine policy. A rejected
change withholds the page checkpoint without rolling back other committed
changes. Successfully replayed changes clear their quarantine evidence even
when another change still blocks the page. Clock, upload, and receipt errors
clear only when their own operation recovers.

Blocked IndexedDB deletion remains pending until the browser's deletion request
settles. IndexedDB disposal closes its database handle and waits for active
transactions to settle. An empty localStorage blob prefix is invalid; memory blob
reads and writes isolate their bytes from caller mutation. SQLite blob storage
checks table readiness again after database replacement.

Capacitor queries preserve rows from commented SQL, CTEs, and DML `RETURNING`,
including quoted semicolons and parentheses.
Capacitor physical opens are single-flight and publish the connection only
after a successful open. Repeated opens reuse a live handle, failed opens can
be retried, and close waits for an in-flight open before releasing the handle.

Browser SQLite open and close operations are ordered, including while WASM is
initializing. Concurrent opens reuse the active handle; close waits for earlier
opens, and a later open starts a new connection.

Node SQLite serializes direct operations and transactions on its connection.
Use only the callback's `tx` adapter inside a transaction: operations on the outer
adapter wait for its commit or rollback. Transaction handles expire when their
callback settles and cannot open or close the shared connection.

Native verification uses SQLite-backed compatible connections unless physical
device evidence is explicitly stated.

A timed-out worker mutation is not automatically replayed: its commit outcome
is unknown to the caller. Terminal database startup failure rejects both queued
and future RPCs rather than leaving them pending, even if the error-reporting
callback throws.
Successful native startup dispatches requests queued before or during
initialization; an individual request failure does not prevent the remaining
requests from settling.

Worker invalidation, role, error, and diagnostic subscriptions are independent.
Every subscription returns an idempotent unsubscribe function; diagnostics replay
the latest 20 events. `client.live(sql, params, onRows, onError?)` ignores late
or superseded query completions. Active query failures reach the supplied error
handler, or are logged when it is absent.

Atrium blob identity is `(workspace_id, blob_id)`; uploads and downloads require
`X-Workspace`. Existing blob rows migrate transactionally without dropping bytes.
Concurrent identical uploads are idempotent; conflicting content in the same
workspace returns 409. Downloads are attachments with `nosniff`, including
uploader-selected HTML. Uploads accept up to 16 MiB; larger requests return
HTTP 413 without replacing existing bytes. JSON routes retain their 2 MiB limit.

Atrium child parentage is immutable. Revoke events are generated from actual
recipient visibility changes, not redundant requests against private records.

Axum blob storage uses `(authorized scope, UUID)` for every store operation,
including presigning. Filesystem paths are scope-qualified. Existing unscoped
files are preserved but not served: administrators must establish ownership
and relocate them into the intended scope before use; there is no unsafe
unscoped fallback. Retained soft-deleted IDs reject writes with
`BlobError::NotFound` until `purge_deleted()` reclaims their tombstone and bytes.

Rust `AppendCursor` construction requires a `NonZeroU64`. Parsing and
deserialization reject zero, noncanonical decimal strings, and overflow; JSON
serialization remains a decimal string. `position()` returns the validated
numeric value. Start-of-history is represented by an absent cursor.

The Axum HTTP boundary additionally rejects cursors above `i64::MAX`, matching
the database append-position range.

### Reactive binding lifecycle

React blob hooks key their result by engine and blob ID. A newly committed
request renders `null` while loading or after a read failure; late results from
superseded requests cannot replace it. Object URLs are revoked when their
owning effect is cleaned up, not by an abandoned concurrent render.

Svelte `syncStatusStore` samples the engine's current status on every first
subscription after an inactive period, then listens for status changes until
the last subscriber leaves.

Live-query bindings discard initial results and errors after their subscription
or component scope ends. Once a change notification publishes newer rows, a late
initial result or error cannot replace them; that notification also settles loading.

React query identity preserves bigint, undefined/null parameters, and binary
content without render-time JSON serialization.

Notification permissions are instance-level state changes, independent of
delivery. Use `instance.requestPermission(channel)` or
`instance.browser.requestPermission()` so every active React, Vue and Svelte
consumer receives the typed `permissionchange` event, including denials.
Permission observers are isolated individually: a throwing observer cannot reject
the completed permission request, skip later consumers, or prevent delivery.
Automatic send-time permission requests use the same path. Requests through a
raw adapter returned by `getChannel()` are lower-level and do not emit instance
events. Dispose Svelte notification stores and call
`NotificationsState.destroy()` when their owning scope ends; Vue composables
and React hooks unsubscribe with their component scopes.

Instance `clicked` and `dismissed` events forward supported channel interactions.
A close following activation is not a dismissal. Toast renderers should use
`ToastChannel.click()` for activation and `dismiss()` for deliberate user
dismissal; headless eviction/clear only removes display state and interaction
metadata. Shared channels retain their listeners until the last instance calls
`dispose()`. Capacitor and Expo forward their available tap/action events, not
unsupported native dismissal events.

Capacitor local-notification IDs use deterministic positive signed-32-bit
hashes (`1..2147483647`); zero is reserved and generated IDs wrap at the upper
bound. Reusing a logical string ID targets the same numeric ID, but hashing
does not guarantee collision-free IDs. Previously scheduled iOS notifications
whose old numeric IDs exceeded this range require cancellation by their old
platform IDs when upgrading.

Web Push `subscribe()` publishes its cached subscription only after a configured
registration endpoint acknowledges it with HTTP success. Failed registration
returns `null` without replacing an earlier acknowledged subscription.
`unsubscribe()` discovers persisted subscriptions in the exact configured
service-worker scope, including on a fresh channel after reload. Browser or
backend removal failure rejects the promise; backend failure retains the
endpoint and keys for retry without repeating an already-successful browser
unsubscribe. Only successful completion clears the retry payload.

Concurrent enrollment calls share one flight. Enrollment waits for the returned
registration's worker to activate, with a 30-second deadline; unsubscribe cancels
that wait. A delayed backend unsubscribe cannot clear a newer subscription.

Configure `WebPushChannel` with `sendEndpoint` to submit notifications to your
application backend. `send()` POSTs JSON `{ subscription, notification }`, where
`subscription` contains the endpoint and keys returned by `subscribe()` and
`notification` contains the complete notification payload. HTTP success reports
`delivered`, meaning backend acceptance—not device receipt. The backend is
responsible for authorization, VAPID signing and push-provider delivery; never
put the private VAPID key in browser configuration.

Subscription-only configurations remain valid, but `send()` without a
`sendEndpoint` returns `skipped` instead of claiming delivery. HTTP and network
failures return `failed`, allowing configured fallback channels to deliver.
Cached unsubscribe-retry payloads cannot be used to send after browser removal.

While the document is visible, `foregroundBehavior` applies per channel after
middleware selection and also to fallback delivery. `"show"` preserves ordinary
delivery; `"suppress"` skips the channel before requesting permission or sending;
`"toast-only"` redirects to a configured toast channel without sending through
the original channel. Redirects are deduplicated and respect the toast channel's
own policy. A missing toast channel is not created implicitly. Hidden documents
retain normal delivery; server-side rendering still performs no delivery.

## Local Authentik OIDC

The reproducible local identity-provider stack lives in
`crates/atrium/authentik/`. It follows Authentik's PostgreSQL Compose
topology and pins both Authentik services to `2026.8.1`. Published ports are
bound to loopback only; the named volumes are local development state and
must not be copied into source control.

```sh
cd libs/palladium/crates/atrium/authentik
cp .env.example .env
# Replace PG_PASS and AUTHENTIK_SECRET_KEY in .env with local random values.
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://127.0.0.1:9000/if/flow/initial-setup/` (including the trailing
slash) to create the first local administrator. The worker discovers
`blueprints/atrium-oidc.yaml` automatically and creates the public
`atrium-local` OIDC provider plus the `atrium` application. Public browser
clients use authorization code with PKCE and therefore do not have a client
secret.

Use the values in `.env` for Atrium's OIDC configuration. In particular, the
per-provider issuer is
`http://127.0.0.1:9000/application/o/atrium/`, its discovery document is under
that path at `.well-known/openid-configuration`, and its JWKS endpoint is
`jwks/`. The loopback HTTP endpoints are intentionally suitable only for local
development; production requires an HTTPS issuer.

OIDC key sets may mix RSA and unsupported key types. Atrium selects eligible
RS256 signing keys and rejects unsupported token algorithms. Unknown key IDs
share a serialized refresh with a 30-second cooldown, including provider failures;
legitimate newly rotated keys become discoverable after that cooldown.
