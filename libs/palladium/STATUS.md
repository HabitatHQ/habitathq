# Palladium — Implementation Status

What is actually built, versus what `docs/DRAFT-ARCH.md` describes.

`DRAFT-ARCH.md` is a design document, not a spec of shipped behaviour. This
file is the authoritative inventory. If something is in DRAFT-ARCH and not
listed under "Implemented" below, it does not exist yet.

Last reviewed: 2026-05-26.

---

## TL;DR

Today Palladium is a **local-first SQLite write-router with table-invalidation
reactive queries** plus three storage adapters and four framework bindings.

It is **not yet a sync engine.** There is no network transport, no offline
queue, no HLC stamping on writes, no CRDT, no server, no bootstrap. The Rust
backend crates do not exist in this repo.

No app in this monorepo (`habitat`, `hearth`, `halcyon`, `hephaestus`) uses
`@palladium/core` for its data layer. They each ship their own `db-shared.ts` /
`db-native.ts`. The only Palladium package currently consumed in production is
`@palladium/nuxt`, which is a Web Worker UUID-RPC bus and lifecycle bouncer
(it does not depend on `@palladium/core`).

---

## Implemented

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

### Tests

- Vitest suites for `core`, `sqlite-node`, `kysely`, `react`, `vue`, `svelte`,
  `vite-plugin`. Playwright e2e in `example-vue`, `example-react`,
  `example-capacitor`.
- Stryker mutation-testing config at `stryker.config.mjs`.

---

## Not implemented

### Sync (none of this exists)

- Network transport (SSE / WebSocket / HTTP polling).
- Uplink: `POST /sync/push`, batching modes, `_sync_pending_ops` durable
  queue, retry/backoff, `onStaleDelta` handler.
- Downlink: subscribe stream, applying incoming `Change` rows.
- HLC stamping on local mutations (`Hlc` is exported but never read by the
  engine).
- `Change` and `Op` wire format. The `Op` exported from `core/src/tx.ts` is
  the local builder shape, not the wire `Op` from DRAFT-ARCH.
- Bootstrap (`GET /sync/bootstrap`, snapshot + delta catch-up).
- Conflict-rejection callbacks (`onRejected`, `onStaleDelta`).
- `getSyncStatus()` returns `pendingCount`, `isOnline`, `lastSyncId`. *(Only
  `status` string exists.)*

### CRDT

- Yjs integration, `Y.Doc` registry, `_sync_crdt_updates`, `_sync_crdt_snapshots`,
  background compaction. None of this exists.
- SQL `COMMENT`-based per-column CRDT/LWW annotations are not parsed.

### Storage

- VFS waterfall (OPFS → SAHPool → kvvfs) and `db.vfsInfo()` / `db.migrateVfs()`.
  Only OPFS and `:memory:` are exposed by `sqlite-browser`.
- Worker model is **app-owned**: `@palladium/nuxt` handles the worker
  lifecycle in user-space. `@palladium/core` itself is not worker-aware.
- No Comlink / MessagePort observable layer in `@palladium/core`.

### Schema & types

- No SQL-`COMMENT`-driven schema metadata parser.
- No codegen from schema to client types — users write the `SchemaMap` by
  hand.

### Backend

- Rust crates `palladium-core`, `palladium-axum`, `palladium-postgres`,
  `palladium-sqlite`, `palladium-cli` do not exist in this repo.
- `palladium` (npm CLI shim) does not exist.
- Delta log table, dual-head API, broadcaster trait, auth providers,
  workspace isolation — none implemented.

### Presence

- `PresenceServer` does not exist.

### Cross-cutting gaps

- Engine has no `close()` method despite `BlobRegistry.revokeAll()` being
  documented as called on close.
- `init()` is not idempotent.
- `liveQuery` is `@deprecated` with no replacement.
- Adapter behaviour diverges across platforms (`NodeSqliteAdapter` coerces
  booleans to `0/1`; the browser and Capacitor adapters do not).
- `assertIdentifier` and value-coercion logic are duplicated across all
  three SQLite adapters.

---

## Reality vs. doc snippets

When the DRAFT-ARCH says…                               …today the code does…
- "Mutations queued in `_sync_pending_ops`"            no queue, writes go straight to SQLite.
- "HLC-stamped Change objects"                         no `Change` type; no HLC stamping.
- "VFS waterfall selected automatically at `db.init()`" only `memory` or OPFS, chosen by config.
- "Worker model: Comlink + MessagePort observables"    app owns the worker; core is single-thread.
- "`POST /sync/push`"                                  no server, no transport.
- "Per-column CRDT via SQL `COMMENT`"                  comments are ignored.
- "`palladium migrate up`"                             no CLI binary.
- "`engine.on('sync:status', ...)`"                    works, but no sync subsystem ever fires it.

---

## Suggested next steps

1. Adopt `@palladium/core` inside one app (probably `hearth` — smallest schema,
   best test coverage) so the engine has a real first user.
2. Fix the migration bugs (fresh-install skips callbacks, multi-step is
   non-atomic, downgrade silently no-ops).
3. Add `engine.close()` and idempotent `engine.init()`.
4. Decide the fate of `liveQuery` (un-deprecate or ship the successor).
5. Wire `Hlc` into mutation paths *or* drop it from the public surface.
6. Move the Rust backend from the `sync-engine` repo into this monorepo so
   wire-protocol changes can move atomically.
