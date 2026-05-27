# Palladium — Implementation Status

What is actually built, versus what `docs/DRAFT-ARCH.md` describes.

`DRAFT-ARCH.md` is a design document, not a spec of shipped behaviour. This
file is the authoritative inventory. If something is in DRAFT-ARCH and not
listed under "Implemented" below, it does not exist yet.

Last reviewed: 2026-05-27 (post sync-engine import + sync-transport lift — Rust
crates and notifications stack at `1483e4a`; wire-format alignment, HLC
advancement, `SyncTransport` lifted into `@palladium/core`, and durable
`_sync_pending_changes` outbox shipped through `64c17ee`).

---

## TL;DR

Palladium today is **a real client-side sync engine talking to a real
server**, missing only bootstrap and conflict semantics:

- **Frontend (TS)** — local-first SQLite write-router with table-invalidation
  reactive queries, three storage adapters, four framework bindings, blob
  handling, versioned migrations, and `@palladium/core`'s new `SyncTransport`
  class. HLC stamping is wired into the engine; writes are HLC-stamped with
  real counter advancement; failed POSTs land in a durable
  `_sync_pending_changes` outbox and retry on the next tick or next reload.
- **Backend (Rust)** — Axum router, two `ChangeStore` impls (SQLite for
  clients, Postgres for servers), blob storage, and a CLI binary. The router
  is generic over any `ChangeStore` and explicitly designed to be mounted
  under an existing app's base path — matches the "easily mountable" vision.
- **The middle** — `@palladium/core`'s `SyncTransport<S>` POSTs `{id, hlc,
  ops}` to `/v1/changes`, polls `GET /v1/changes?after=<cursor>` for
  downlink, and applies remote ops via `engine.applyRemote()` without
  re-emit. Wire-format mismatch on `Hlc` is gone — Rust now serialises
  `{wallMs, counter, nodeId}` via `#[serde(rename)]` and the bridge function
  was deleted. `example-react/src/db.ts` shrunk from 245 → 56 lines (down to
  a `createNotesSession()` factory) by leaning on the lifted transport.

What is still missing for the full vision: cold-start **bootstrap** (today
the first poll walks the entire change history from the server), **conflict
handlers** (`onRejected` / `onStaleDelta` — needs server-side rejection
semantics first), in-app **adoption** (no app in this monorepo consumes
`@palladium/core` for its data layer yet), and the **derive-macro / codegen**
that lets backend types declare themselves sync-able.

No app in this monorepo (`habitat`, `hearth`, `halcyon`, `hephaestus`)
consumes `@palladium/core` for its data layer yet. They each ship their own
`db-shared.ts` / `db-native.ts`. The only Palladium package consumed in
production is `@palladium/nuxt` (a Web Worker UUID-RPC bus, independent of
`@palladium/core`).

---

## Implemented — TypeScript frontend

### `@palladium/core`

- `PalladiumEngine` / `createEngine` — high-level API over a `StorageAdapter`.
- `tx()` / `insert` / `update` / `delete` — synchronous transaction builder,
  flushed atomically when the adapter is `TransactableStorageAdapter`.
- `exec(sql)` — raw SQL via `sql\`...\`` tagged template with `?` placeholders.
- `LiveQuery` — reactive queries via best-effort regex extraction of
  `FROM` / `JOIN` table names. Re-runs on any touched-table overlap.
  *(Marked `@deprecated`; no successor exists yet.)*
- `applySchema` / `applySeeds` — versioned migrations tracked via
  `PRAGMA user_version`; named seeds tracked in `_palladium_seeds`.
- `DbAdapter` + `toDbAdapter()` / `toCapacitorDbAdapter()` — app-facing bridges
  used by `habitat` and `hearth` for migrations even though they don't consume
  the engine itself.
- `BlobHandle` + adapters (`Memory`, `IDB`, `LocalStorage`), `BlobRegistry`,
  `BlobRef` JSON column helper.
- `Hlc` primitives (`createHlc`, `sendHlc`, `recvHlc`, `compareHlc`,
  `hlcToString`, `hlcFromString`). *Not consumed by the engine — writes are
  not HLC-stamped.*
- `generateUlid` — 26-char Crockford base-32 ULIDs with same-millisecond
  monotonicity.
- `EventEmitter` — typed pub/sub. Engine emits `sync:status` and `error`.
- `getSyncStatus()` / `setStatus()` — manual status surface; nothing inside
  Palladium ever moves it off `"idle"`.
- `dbg()` — gated debug logging, zero-cost when disabled, worker-safe.

### Storage adapters

- `@palladium/sqlite-node` — `node:sqlite`, file or `:memory:`. Transactable.
- `@palladium/sqlite-browser` — `@sqlite.org/sqlite-wasm`, `:memory:` or OPFS.
  Transactable. (No SAHPool, no kvvfs, no automatic VFS waterfall.)
- `@palladium/sqlite-capacitor` — `@capacitor-community/sqlite`. Transactable.

### Framework bindings

- `@palladium/react` — `useLiveQuery`, `useSyncStatus`, `useBlob`, `useBlobUrl`,
  `<PalladiumProvider>`.
- `@palladium/vue` — `useLiveQuery`, `useSyncStatus`.
- `@palladium/svelte` — `liveQueryStore` (Svelte store wrapper).
- `@palladium/kysely` — Kysely dialect over `StorageAdapter`.
- `@palladium/nuxt` — Web Worker UUID-RPC bus, lifecycle messages (`READY` /
  `LOCK_UNAVAILABLE` / `INIT_ERROR`), optional Capacitor-native fallback.
  **Independent of `@palladium/core`.**

### Tooling

- `@palladium/vite-plugin` — sets `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Embedder-Policy` headers in dev. No WASM helpers, no asset
  copying.

### Examples

- `example-vue`, `example-react`, `example-capacitor` — local-only todo apps
  exercising the in-memory or OPFS adapter.

---

## Implemented — Rust backend

> Landed in `main` via the sync-engine subtree import on 2026-05-26.
> Crates compile and have tests; **not yet validated against any consuming app
> in this monorepo** (no TS client wires up to the HTTP endpoints).

### `palladium-core`

Wire types and the `ChangeStore` trait.

- `NodeId` — identifies a sync participant (device / client / server).
- `Hlc` — Hybrid Logical Clock for causal ordering.
- `Op` — single row-level change (`Insert` / `Update` / `Delete`). *This is the
  **wire** `Op`, distinct from the TS `Op` in `core/src/tx.ts` which is the
  local builder shape.*
- `Change` — atomic, HLC-stamped batch of `Op`s.
- `ChangeStore` — trait for persisting / retrieving / streaming changes.
  Duplicate inserts (same `id`) are silently ignored.
- `ServerConfig` / `InstanceConfig` / `InstanceRegistry` / `OpenGuard` —
  per-instance limits + RAII guard against double-open.

### `palladium-axum`

HTTP router, generic over any `ChangeStore`. **Designed to be mounted under
any base path** (`Mount this router under your chosen base path, or serve it
directly.` per its docstring).

- `create_router<S>(state: AppState<S>, cors: CorsLayer) -> Router`
- `AppState::new(store)` (optionally `.with_blob_store(...)`).

Endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/changes` | Uplink — accept a single change from a client |
| `GET` | `/v1/changes` | Downlink — list/stream changes (server → client) |
| `GET` | `/v1/health` | Global health |
| `GET` | `/v1/instances/:name/health` | Per-instance health |
| `POST` | `/v1/blobs` | Upload a blob |
| `GET` | `/v1/blobs/:id` | Download a blob |
| `DELETE` | `/v1/blobs/:id` | Delete a blob |
| `GET` | `/v1/blobs/:id/presigned` | Get a presigned URL |

OpenAPI doc generation via `utoipa` + Swagger UI is wired up.

### `palladium-sqlite`

`SqliteStore` — `ChangeStore` impl backed by SQLite. Intended as the
local embedded store on client devices, or as a single-node server backend.
Includes criterion benchmarks.

### `palladium-postgres`

`PostgresStore` — `ChangeStore` impl backed by Postgres. Intended as the
server-side authoritative store. Schema-isolation and per-instance registry
guard. Testcontainers-based integration + load/stress tests.

### `palladium-blobs`

`BlobRef`, `BlobStore` trait, `BlobError`, `BlobMetadata` table + store,
`FilesystemBlobStore` (with soft-delete + purge), `BlobColumnMeta` /
`BlobSchemaRegistry` for runtime schema declaration of which columns
contain blob refs.

### `palladium-cli`

`palladium` binary (subcommands):

- `palladium migrate` — run database schema migrations.
- `palladium inspect` — list changes stored in the database.
- `palladium dev` — start a local development sync server.
- `palladium instances list` — list configured instances and their status.

Wraps `palladium-axum` + `palladium-sqlite` to provide a turnkey local dev
server. Distributed as `palladium-cli` npm shim via `libs/palladium/cli-wrapper`.

### `palladium-axum` contract tests

CATS-based contract + fuzz tests against the OpenAPI spec, runnable via
`just cats` (requires Docker).

---

## Implemented — Notifications stack

Cross-app local + push notification framework, separate from the sync core.
**Landed via the sync-engine import; not yet consumed by any app in this monorepo.**

| Package | Purpose |
|---|---|
| `@palladium/notifications-core` | Core types: channel adapter trait, scheduling, dedup, permissions |
| `@palladium/notifications-browser` | Browser `Notification` API channel |
| `@palladium/notifications-capacitor` | `@capacitor/local-notifications` channel |
| `@palladium/notifications-expo` | Expo notifications channel |
| `@palladium/notifications-web-push` | Web Push (VAPID) channel |
| `@palladium/notifications-toast` | In-app toast channel |
| `@palladium/notifications-react` | React hooks + `<NotificationProvider>` |
| `@palladium/notifications-vue` | Vue composables + plugin |
| `@palladium/notifications-svelte` | Svelte stores |

All packages ship Vitest suites; cross-package E2E not yet wired up.

---

## Implemented — Tests

- Vitest suites for `core`, `sqlite-node`, `kysely`, `react`, `vue`, `svelte`,
  `vite-plugin`, all 9 `notifications-*` packages.
- Playwright e2e in `example-vue`, `example-react`, `example-capacitor`.
- Stryker mutation-testing config at `stryker.config.mjs`.
- `libs/palladium/e2e` — TS-client ↔ Rust-server contract tests
  (`changes.test.ts`, `frontend-compat.test.ts`, `openapi.test.ts`).
  Run via `just test-e2e` (builds the Rust binary, then runs Vitest).
- Rust: workspace-level `cargo test`, criterion benchmarks (`palladium-sqlite`,
  `palladium-core/hlc`), testcontainers integration (`palladium-postgres`),
  CATS contract tests (`palladium-axum --features cats-tests`).

---

## Not implemented

### Sync glue (remaining gaps after the SyncTransport lift)

`@palladium/core` now exposes a real `SyncTransport<S>` and a durable
outbox; the items below are what's still missing:

- **Downlink reconciliation is shallow** — `SyncTransport` applies remote ops
  via `engine.applyRemote()` with no conflict detection, no `onRejected` /
  `onStaleDelta` handlers, no LWW or CRDT merging. Needs server-side
  rejection semantics first (today the server stores every valid change).
- **Bootstrap** — no `GET /sync/bootstrap` snapshot endpoint on the server,
  no client logic. Cold clients still pull the full change history through
  the regular `GET /v1/changes` poll, which is O(history) per cold-start.
- **`getSyncStatus()`** returns only `status: string`. The outbox now has
  enough data to answer `pendingCount` (`SELECT COUNT(*) FROM
  _sync_pending_changes`) and `isOnline` (last outcome ≠ "offline"); not
  yet exposed. `lastSyncId` is also missing.
- **HLC durability** — `currentHlc` is in-memory only. After a reload, the
  next HLC is `createHlc(nodeId)` (uses `Date.now()`); a backwards-clock
  could yield an HLC that's not strictly greater than ones we issued
  pre-reload. Should be persisted alongside the outbox.

### CRDT

- Yjs integration, `Y.Doc` registry, `_sync_crdt_updates`,
  `_sync_crdt_snapshots`, background compaction. None of this exists.
- SQL `COMMENT`-based per-column CRDT/LWW annotations are not parsed.

### Codegen / sync-able-type scaffolding

The vision item *"take backend data types and create scaffolding to make them
sync-able"* is **not implemented**. There is no derive macro, no build-script
codegen, no `palladium generate` subcommand. Users write `SchemaMap` by hand
on the TS side; on the Rust side, `Op` payloads are opaque JSON. This is the
largest backend-side vision gap.

### Storage

- VFS waterfall (OPFS → SAHPool → kvvfs) and `db.vfsInfo()` / `db.migrateVfs()`.
  Only OPFS and `:memory:` are exposed by `sqlite-browser`.
- Worker model is **app-owned**: `@palladium/nuxt` handles the worker
  lifecycle in user-space. `@palladium/core` itself is not worker-aware.
- No Comlink / MessagePort observable layer in `@palladium/core`.

### Schema metadata

- No SQL-`COMMENT`-driven schema metadata parser on the TS side.
- No codegen from schema to client types — users write the `SchemaMap` by
  hand.

### Presence

- `PresenceServer` does not exist on either side.

### Cross-cutting gaps

- Engine has no `close()` method despite `BlobRegistry.revokeAll()` being
  documented as called on close.
- `init()` is not idempotent.
- `liveQuery` is `@deprecated` with no replacement.
- Migration callbacks: fresh-install path skips them, multi-step is
  non-atomic, downgrade silently no-ops. Untested in any production schema
  because no app consumes the engine yet.
- Adapter behaviour diverges across platforms (`NodeSqliteAdapter` coerces
  booleans to `0/1`; the browser and Capacitor adapters do not).
- `assertIdentifier` and value-coercion logic are duplicated across all
  three SQLite adapters.

---

## Reality vs. doc snippets

When the DRAFT-ARCH says…                                …today the code does…
- "Mutations queued in `_sync_pending_ops`"             queued in `_sync_pending_changes` (same idea, renamed).
- "HLC-stamped Change objects"                          stamped by `engine.nextSendHlc()` on every local tx.
- "VFS waterfall selected automatically at `db.init()`" only `memory` or OPFS, chosen by config.
- "Worker model: Comlink + MessagePort observables"     app owns the worker; core is single-thread.
- "`POST /sync/push`"                                   `SyncTransport` POSTs to `/v1/changes` automatically.
- "Per-column CRDT via SQL `COMMENT`"                   comments are ignored.
- "`palladium migrate up`"                              `palladium migrate` exists (no `up`/`down` split).
- "`engine.on('sync:status', ...)`"                     `SyncTransport` drives this between idle / syncing / error / offline.

---

## Vision alignment (2026-05-27)

| Vision bullet | Status |
|---|---|
| Local-only, browser | ✅ via `sqlite-browser` (OPFS / `:memory:`) |
| Local-only, native | ✅ via `sqlite-capacitor` |
| Local-first, multi-device | ✅ first-class `SyncTransport<S>` in `@palladium/core`; HLC stamping + durable outbox |
| FE: CRUD | ✅ `tx() / insert / update / delete / exec` |
| FE: DDL | ✅ via `exec(sql)` |
| FE: Schema migrations | ⚠️ `applySchema` works in common path; bugs in fresh-install, multi-step, downgrade |
| FE: Data migrations | ⚠️ shares callback path with schema — same bugs |
| FE: Data seeding | ✅ `applySeeds` + `_palladium_seeds` |
| FE: Sync with backend + multi-device | ✅ `SyncTransport` POSTs `/v1/changes`, polls downlink, retries from outbox |
| BE: Easily mountable | ✅ `create_router<S>` is generic + mountable under any base path |
| BE: Sync-able type scaffolding | ❌ no derive / codegen / `palladium generate` |

---

## Suggested next steps

1. **Server-side bootstrap.** `GET /v1/sync/bootstrap` returning a per-table
   snapshot + the cursor representing "everything up to here is included."
   Then a `SyncTransport` cold-start path that applies the snapshot before
   the first poll. Closes the O(history) cold-start cost.
2. **Conflict semantics.** Add server-side rejection (probably `409` with a
   reason payload), then expose `onRejected` / `onStaleDelta` callbacks on
   `SyncTransport`. Currently the server accepts every valid change
   LWW-style, so the TS handlers would have nothing to fire on.
3. **Persist `currentHlc`.** Today it's in-memory. A row in
   `_sync_pending_changes` or a sibling `_sync_hlc` table would let
   `SyncTransport.start()` rehydrate the HLC across reloads and avoid the
   backwards-clock corner case.
4. **Adopt `@palladium/core` inside one app** (probably `hearth` — smallest
   schema, best test coverage) so the engine has a real first user and the
   migration bugs surface against a real schema.
5. **Fix the migration bugs** (fresh-install skips callbacks, multi-step is
   non-atomic, downgrade silently no-ops).
6. **Decide the codegen story.** A `palladium generate --from <schema>`
   subcommand or a Rust derive macro for sync-able types is the second
   biggest gap.
7. Add `engine.close()` and idempotent `engine.init()`.
8. Decide the fate of `liveQuery` (un-deprecate or ship the successor).
9. Expose richer `getSyncStatus()` — `pendingCount` (count rows in
   `_sync_pending_changes`), `isOnline`, `lastSyncId`.
