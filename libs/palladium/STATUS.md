# Palladium — Implementation Status

What is actually built, versus what `docs/DRAFT-ARCH.md` describes.

`DRAFT-ARCH.md` is a design document, not a spec of shipped behaviour. This
file is the authoritative inventory. If something is in DRAFT-ARCH and not
listed under "Implemented" below, it does not exist yet.

Last reviewed: 2026-05-26 (post sync-engine import — Rust crates, notifications stack,
LLM guardrails landed on `main` at `1483e4a`).

---

## TL;DR

Palladium today is **two halves connected only by a demo, not by a reusable API**:

- **Frontend (TS)** — a local-first SQLite write-router with table-invalidation
  reactive queries, three storage adapters, four framework bindings, blob handling,
  and a versioned migration framework. `@palladium/core` has **no transport API**;
  HLC primitives are exported but never stamped on writes; the `useSyncStatus`
  surface exists but nothing in core ever moves it off `"idle"`.
- **Backend (Rust)** — an Axum router, two `ChangeStore` impls (SQLite for clients,
  Postgres for servers), blob storage, and a CLI binary. The router is **generic
  over any `ChangeStore` and explicitly designed to be mounted under an existing
  app's base path**, which matches the "easily mountable" vision item.
- **The middle (working demo, hand-rolled)** — `example-react/src/db.ts` subclasses
  a `@palladium/core` write-router to intercept `_insertRow / _patchRow / _removeRow`,
  POSTs `{id, hlc, ops}` to `/v1/changes`, polls `GET /v1/changes?after=<cursor>`
  for downlink, and uses an `#applyingRemote` guard to break re-emit loops.
  A Playwright test (`example-react/e2e/sync.spec.ts`) opens two browser contexts
  (Alice + Bob) and asserts changes propagate within a 5s settle window. **It works.**

What is missing to be a *reusable* sync engine, not a one-off demo: promote that
subclass into `@palladium/core` as a first-class API, fix the deliberately-broken
HLC counter (the demo hardcodes `counter: 0`), add a `_sync_pending_ops` outbox so
failed POSTs aren't lost (today the demo `void`-fires the fetch promise), add
reconciliation handlers (`onRejected` / `onStaleDelta`), and bootstrap.

There is also a wire-format mismatch papered over by a bridge function: the TS
`@palladium/core` uses `{wallMs, counter, nodeId}` for HLCs while the Rust server
uses `{millis, counter, node_id}`. `e2e/client.ts` carries a `coreHlcToServer`
adapter to keep tests green. **One side should be renamed** so the boundary stops
needing translation.

No app in this monorepo (`habitat`, `hearth`, `halcyon`, `hephaestus`) consumes
`@palladium/core` for its data layer yet. They each ship their own `db-shared.ts` /
`db-native.ts`. The only Palladium package consumed in production is `@palladium/nuxt`
(a Web Worker UUID-RPC bus, independent of `@palladium/core`).

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

### Sync glue (mostly demo-grade, not yet a reusable API)

A working TS↔Rust sync path exists in `example-react/src/db.ts` and is
exercised by `example-react/e2e/sync.spec.ts` (two-browser Playwright).
Treat it as a proof-of-concept, not a production primitive. What's missing
to promote it from demo to API:

- **No first-class transport in `@palladium/core`** — the working uplink
  (`POST /v1/changes`) and downlink poll (`GET /v1/changes?after=<cursor>`)
  live in the example app as a hand-rolled subclass. Lift into core.
- **No outbox / offline queue** — `_sync_pending_ops` is in DRAFT-ARCH but
  not in the schema; the demo `void`-fires `fetch()` and silently loses
  changes on failure.
- **HLC counter is hardcoded to `0`** in the demo (`{millis: Date.now(),
  counter: 0, node_id}`) — fine for single-write-per-ms but loses ordering
  guarantees under bursts. The engine still doesn't stamp writes with `Hlc`.
- **Wire-format field mismatch** — TS `@palladium/core` Hlc is
  `{wallMs, counter, nodeId}`; Rust server is `{millis, counter, node_id}`.
  `e2e/client.ts` carries a `coreHlcToServer` bridge to compensate. One
  side should be renamed at the source.
- **Downlink reconciliation is shallow** — the demo applies remote ops via
  an `#applyingRemote` flag; no conflict detection, no `onRejected` /
  `onStaleDelta` handlers, no LWW or CRDT merging.
- **Bootstrap** — no `GET /sync/bootstrap` snapshot endpoint on the server,
  no client logic. Cold clients have to start from empty.
- **`getSyncStatus()`** returns only `status: string`. DRAFT-ARCH calls for
  `pendingCount`, `isOnline`, `lastSyncId` — not implemented.

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

When the DRAFT-ARCH says…                               …today the code does…
- "Mutations queued in `_sync_pending_ops`"            no queue, writes go straight to SQLite.
- "HLC-stamped Change objects"                         server expects them; client never stamps.
- "VFS waterfall selected automatically at `db.init()`" only `memory` or OPFS, chosen by config.
- "Worker model: Comlink + MessagePort observables"    app owns the worker; core is single-thread.
- "`POST /sync/push`"                                  exposed as `POST /v1/changes`; called by `example-react`, not core.
- "Per-column CRDT via SQL `COMMENT`"                  comments are ignored.
- "`palladium migrate up`"                             `palladium migrate` exists (no `up`/`down` split).
- "`engine.on('sync:status', ...)`"                    works, but no sync subsystem ever fires it.

---

## Vision alignment (2026-05-26)

| Vision bullet | Status |
|---|---|
| Local-only, browser | ✅ via `sqlite-browser` (OPFS / `:memory:`) |
| Local-only, native | ✅ via `sqlite-capacitor` |
| Local-first, multi-device | ⚠️ works end-to-end in `example-react` (Playwright two-browser test green); not yet a reusable API in `@palladium/core` |
| FE: CRUD | ✅ `tx() / insert / update / delete / exec` |
| FE: DDL | ✅ via `exec(sql)` |
| FE: Schema migrations | ⚠️ `applySchema` works in common path; bugs in fresh-install, multi-step, downgrade |
| FE: Data migrations | ⚠️ shares callback path with schema — same bugs |
| FE: Data seeding | ✅ `applySeeds` + `_palladium_seeds` |
| FE: Sync with backend + multi-device | ⚠️ proof-of-concept in `example-react/src/db.ts`; needs lifting into `@palladium/core` |
| BE: Easily mountable | ✅ `create_router<S>` is generic + mountable under any base path |
| BE: Sync-able type scaffolding | ❌ no derive / codegen / `palladium generate` |

---

## Suggested next steps

1. **Lift `example-react/src/db.ts` into `@palladium/core`** as a first-class
   transport API. The wire protocol, downlink polling, and re-emit guards
   are already proven; what's left is to expose them as a reusable subclass
   or hook, add real HLC advancement, and persist an outbox so failed POSTs
   survive reloads. Also resolve the `wallMs / millis` field-name mismatch
   at the source (either rename in TS or rename in Rust) so the
   `coreHlcToServer` bridge can be deleted.
2. **Adopt `@palladium/core` inside one app** (probably `hearth` — smallest
   schema, best test coverage) so the engine has a real first user and the
   migration bugs surface against a real schema.
3. **Fix the migration bugs** (fresh-install skips callbacks, multi-step is
   non-atomic, downgrade silently no-ops).
4. **Decide the codegen story.** A `palladium generate --from <schema>`
   subcommand or a Rust derive macro for sync-able types is the second
   biggest gap.
5. Add `engine.close()` and idempotent `engine.init()`.
6. Decide the fate of `liveQuery` (un-deprecate or ship the successor).
