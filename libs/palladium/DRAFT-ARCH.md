> **Disclaimer:** This document is a non-authoritative design draft. It reflects current thinking and intent but is subject to change at any time without notice. Implementation details, API shapes, and architectural decisions may diverge from what is described here as the project evolves.

---

# Palladium — Architecture Draft

A local-first sync engine. Rust backend, TypeScript frontend.

---

## Table of Contents

1. [Overview](#overview)
2. [Repository Layout](#repository-layout)
3. [Core Primitives (palladium-core)](#core-primitives-palladium-core)
4. [Frontend Architecture (@palladium/core)](#frontend-architecture-palladiumcore)
   - [Storage: VFS Waterfall](#storage-vfs-waterfall)
   - [Worker Model](#worker-model)
   - [Mutation API](#mutation-api)
   - [Reactivity: LiveQuery](#reactivity-livequery)
   - [Offline Queue](#offline-queue)
   - [Sync Loop & Transport](#sync-loop--transport)
   - [Bootstrap](#bootstrap)
   - [CRDT Fields (Yjs)](#crdt-fields-yjs)
   - [Schema & Migrations](#schema--migrations-frontend)
   - [Type Safety](#type-safety)
5. [Backend Architecture (Rust crates)](#backend-architecture-rust-crates)
   - [Delta Log: The Unified Action Log](#delta-log-the-unified-action-log)
   - [Dual-Head Entry Points](#dual-head-entry-points)
   - [Broadcaster (Pub/Sub)](#broadcaster-pubsub)
   - [Downlink Adapters](#downlink-adapters)
   - [Auth & Access Control](#auth--access-control)
   - [Conflict Resolution (Server-Side)](#conflict-resolution-server-side)
   - [Schema & Migrations (Backend)](#schema--migrations-backend)
   - [Deployment](#deployment)
6. [Background: CRDTs for Beginners](#background-crdts-for-beginners)
7. [Wire Protocol](#wire-protocol)
8. [Conflict Resolution Model](#conflict-resolution-model)
9. [Presence & Awareness](#presence--awareness)
10. [Framework Adapters](#framework-adapters)
11. [Key Architectural Decisions](#key-architectural-decisions)

---

## Overview

Palladium is an open-source local-first sync engine for building collaborative, offline-capable applications. It provides:

- A **TypeScript client** (`@palladium/core`) that runs SQLite in the browser via WASM, maintains a durable offline queue, and synchronises deltas with a server.
- A **Rust backend library** (`palladium-axum`, `palladium-postgres`, `palladium-sqlite`) that acts as a central sequencer: it persists canonical application data, records every change as a structured delta, and fans those deltas out to connected clients.

The two sides share a common delta model defined in `palladium-core`.

---

## Repository Layout

```
crates/
  palladium-core/       # Shared primitives: NodeId, Hlc, Op, Change
  palladium-axum/       # Axum extractors, routers, middleware
  palladium-postgres/   # PostgreSQL backend + LISTEN/NOTIFY broadcaster
  palladium-sqlite/     # SQLite server-side backend
  palladium-cli/        # CLI binary (migrations, codegen, inspection)

packages/
  core/                 # @palladium/core — TS client (framework-agnostic)
  react/                # @palladium/react — React hooks
  vue/                  # @palladium/vue — Vue composables
  svelte/               # @palladium/svelte — Svelte bindings
  kysely/               # @palladium/kysely — Kysely query builder adapter
  vite-plugin/          # @palladium/vite-plugin — COOP/COEP + WASM helpers
  cli-wrapper/          # palladium (npm) — thin npm shim for the Rust CLI binary
```

---

## Core Primitives (`palladium-core`)

This crate defines the canonical types shared between all Rust crates and serialised on the wire. It has no runtime dependencies beyond `serde`, `uuid`, and `chrono`.

### `NodeId`

A `Uuid` v4 wrapper that uniquely identifies a sync participant (a client device or a server node).

```rust
pub struct NodeId(Uuid);
```

### `Hlc` — Hybrid Logical Clock

Provides causal ordering across distributed nodes without relying on wall-clock synchronisation alone. Based on Kulkarni et al. (ICDCS 2014).

```rust
pub struct Hlc {
    pub millis: u64,    // wall-clock milliseconds
    pub counter: u32,   // logical counter (tiebreak within the same millisecond)
    pub node_id: NodeId,
}
```

Key operations:
- `Hlc::send(&mut self)` — advance clock for a local event.
- `Hlc::recv(&mut self, remote: &Hlc)` — merge with an incoming remote clock.

Ordering is lexicographic `(millis, counter, node_id)`, guaranteeing that causally later events sort higher.

### `Op` — Row-Level Operation

The atomic unit of change. One `Op` describes a single row-level action:

```rust
pub enum Op {
    Insert { table: String, row_id: String, data: serde_json::Value },
    Update { table: String, row_id: String, col: String, value: serde_json::Value },
    Delete { table: String, row_id: String },
}
```

Serialised with a `"op"` discriminant tag: `"insert"`, `"update"`, `"delete"`.

### `Change` — Atomic Delta Batch

A causally-stamped, atomic batch of `Op`s. This is the unit of replication — what flows over the network and what gets stored in the delta log.

```rust
pub struct Change {
    pub id: Uuid,
    pub hlc: Hlc,
    pub ops: Vec<Op>,
}
```

All ops in a `Change` are applied atomically (single SQLite `BEGIN/COMMIT` locally; single delta row on the server).

---

## Frontend Architecture (`@palladium/core`)

### Storage: VFS Waterfall

The client stores application data in an in-process SQLite database running via the official `sqlite.org` WASM build. Storage is backed by one of three VFS tiers, selected automatically at `db.init()` time:

| Tier | VFS | Requirement | Performance |
|------|-----|-------------|-------------|
| 1 | OPFS (Origin Private File System) | `COOP`/`COEP` headers | Highest |
| 2 | SAHPool (pre-allocated file handles) | None | Near-native |
| 3 | kvvfs (wa-sqlite, IndexedDB-backed) | None | Universal |

**VFS migration** is app-controlled. The library surfaces which tier is active via `db.vfsInfo()` and fires an event when a better tier becomes available (e.g., headers added). The app calls `db.migrateVfs()` to serialise the current database to a `Uint8Array` and hydrate the new VFS in place.

`@palladium/vite-plugin` automatically injects `COOP`/`COEP` headers during development and configures WASM module loading.

### Worker Model

SQLite runs inside a **dedicated Web Worker** (one per browser tab). The main thread never touches SQLite directly.

```
Main thread
  │  Comlink RPC + MessagePort Observable
  ▼
SQLite Worker
  ├── SQLite WASM (VFS tier)
  ├── Sync loop (SSE / WS / polling)
  └── Offline queue (_sync_pending_ops)
```

- **RPC** (via [Comlink](https://github.com/GoogleChromeLabs/comlink)): `db.insert()`, `db.update()`, `db.delete()`, `db.exec()` — proxied calls to the Worker.
- **Push streams** (via `MessagePort` Observables): change events emitted by the Worker to drive reactive UI updates on the main thread.

The Worker owns the network connection. It opens and manages the SSE/WS stream, writes incoming deltas to SQLite, and posts invalidation events to the main thread. No cross-tab coordination is performed.

### Mutation API

Mutations use a transaction-style synchronous builder, flushed asynchronously:

```ts
// Transaction (grouped, atomic)
await db.tx(t => {
  t.insert('tasks', { id: ulid(), title: 'Buy milk', done: false });
  t.update('tasks', taskId, { done: true });
  t.delete('tasks', oldId);
});

// Convenience shorthands (sugar over tx())
await db.insert('tasks', { id: ulid(), title: 'Buy milk' });
await db.update('tasks', taskId, { done: true });
await db.delete('tasks', taskId);
```

The `tx()` callback is **synchronous** (builders only). `tx()` itself is `async` — it flushes all queued operations as a single SQLite `BEGIN/COMMIT`. `db.tx()` returns `Promise<void>`; to read the result, run a query after.

Per-mutation mode:

```ts
await db.insert('tasks', data, { mode: 'immediate' });   // flush now
await db.insert('tasks', data, { mode: 'batched' });     // coalesce, flush on debounce
await db.insert('tasks', data, { mode: 'optimistic' });  // apply locally, sync async
```

Every mutation is schema-validated client-side before hitting SQLite. Invalid commands are rejected with a `TypeError`.

### Reactivity: LiveQuery

Reactive reads use a `LiveQuery` object:

```ts
const query = db.liveQuery(sql`SELECT * FROM tasks WHERE done = false ORDER BY created_at`);

// Initial load
const initial = await query.exec();

// Subscribe to changes
query.on('change', (rows) => { /* re-render */ });

// Cleanup
query.cancel();
```

**Invalidation model**: The library tracks which tables each query touches. Any write to a tracked table triggers a re-run of the query and emits a `change` event with the new result set.

Supported subscription granularities:

| Tier | Description |
|------|-------------|
| Table-level | Re-run when any row in a table changes |
| Query-level | Re-run when the result set of this specific SQL query changes |
| Row-level | Re-run when a specific `row_id` changes |
| Count-based | Re-emit only when the row count changes |
| Pull-based | No subscription; manual `query.exec()` only |

### Offline Queue

All mutations are durably queued in a `_sync_pending_ops` SQLite table before being sent to the server. If SQLite is not yet initialised (very early boot), a memory fallback queue is used and drained once the DB is ready.

```sql
CREATE TABLE _sync_pending_ops (
  id       TEXT PRIMARY KEY,  -- ULID
  hlc      TEXT NOT NULL,
  ops      TEXT NOT NULL,     -- JSON: Op[]
  queued_at INTEGER NOT NULL
);
```

On reconnect, the pending queue is flushed in HLC order. Unsynced deltas whose age exceeds a configurable threshold trigger an app-defined staleness handler:

```ts
onStaleDelta: (delta) => 'keep' | 'drop' | 'alert'
```

### Sync Loop & Transport

The sync transport is configurable at init time:

```ts
const db = new Palladium({
  serverUrl: 'https://api.example.com',
  transport: 'sse',   // 'sse' | 'ws' | 'polling'
  auth: () => getToken(),
});
```

**Downlink** (server → client): The Worker connects to the server using the chosen transport and streams incoming `Change` objects, writing them directly to SQLite and firing table invalidations.

**Uplink** (client → server): Pending ops are sent over the same channel:
- `sse` transport: HTTP `POST /sync/push`
- `ws` transport: the open WebSocket channel

Delta batching is configurable:

```ts
batchMode: 'immediate' | { debounce: 50 } | 'manual'
```

Sync status is observable:

```ts
engine.on('sync:status', (status) => { /* 'connected' | 'connecting' | 'offline' */ });
engine.on('error', (err) => { /* network/sync errors */ });
const { pendingCount, isOnline, lastSyncId } = engine.getSyncStatus();
```

### Bootstrap

When a client connects for the first time (or after a re-bootstrap), it uses a **snapshot + delta catch-up** strategy:

1. Client sends its current `last_sync_id` (or `null` for first boot).
2. Server returns a **snapshot** of all current data at a known `sync_id`.
3. Client hydrates its local SQLite from the snapshot.
4. Client streams all deltas with `sync_id > snapshot_sync_id` to catch up.

If a client has been offline longer than the server's tombstone TTL (configurable per workspace), the server forces a full re-bootstrap.

### CRDT Fields (Yjs)

Rich text and other complex structured data use [Yjs](https://yjs.dev/) as a CRDT layer. Yjs is opt-in per column, declared via SQL `COMMENT` annotations (see [Schema & Migrations](#schema--migrations-frontend)).

Internals:

- The library maintains a `Y.Doc` instance per CRDT-annotated row.
- Incremental Yjs update buffers are stored in `_sync_crdt_updates (row_id, doc_id, update BLOB)`.
- Background compaction merges update buffers into `_sync_crdt_snapshots` (configurable threshold, e.g., every 100 updates, or 5 minutes of inactivity).
- On bootstrap, the client loads the snapshot + applies any subsequent incremental updates to reconstruct the live `Y.Doc`.

CRDT updates are included in the `crdt_update` column of the delta row sent to and stored on the server as raw `bytea`.

### Schema & Migrations (Frontend)

Schema is defined as numbered SQL migration files bundled with the app. On `db.init()`, the library runs any pending migrations in order:

```ts
await db.init({
  migrations: [migration_001, migration_002],
});
```

Or via the builder API:

```ts
db.runMigrations([sql1, sql2]);
```

CRDT and sync behaviour per column is declared via inline JSON in SQL `COMMENT`s, parsed by the library at migration time:

```sql
CREATE TABLE tasks (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  status TEXT NOT NULL
);

COMMENT ON COLUMN tasks.title  IS '{"sync":{"crdt":"yjs"}}';
COMMENT ON COLUMN tasks.status IS '{"sync":{"lww":true}}';
```

Primary keys use **ULIDs** (client-generated, sortable, URL-safe).

### Type Safety

The client is fully generic over a user-defined schema:

```ts
import { createPalladium } from '@palladium/core';

interface Schema {
  tasks: { id: string; title: string; done: boolean };
}

const db = createPalladium<Schema>(config);
// db.insert('tasks', ...) now knows the shape of tasks
// db.liveQuery(...) returns typed rows
```

---

## Backend Architecture (Rust crates)

### Delta Log: The Unified Action Log

Every mutation — regardless of whether it arrives via the sync endpoint or a regular REST endpoint — creates a row in the `_sync_deltas` table. This table is the authoritative record of all changes in the system and the source for fan-out to connected clients.

```sql
CREATE TABLE _sync_deltas (
  sync_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(), -- UUID v7
  workspace_id  TEXT        NOT NULL,
  table_name    TEXT        NOT NULL,
  row_id        TEXT        NOT NULL,
  operation     CHAR(1)     NOT NULL CHECK (operation IN ('I','U','D')),
  col_name      TEXT,                   -- NULL for Insert/Delete
  old_value     JSONB,
  new_value     JSONB,
  client_id     TEXT        NOT NULL,   -- NodeId of originating client
  hlc_timestamp TEXT        NOT NULL,   -- serialised Hlc
  crdt_update   BYTEA,                  -- Yjs binary update, nullable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON _sync_deltas (workspace_id, sync_id);
```

`sync_id` is a **UUID v7** (time-ordered). This gives monotonic ordering across deltas without a serial sequence, enabling future multi-master use.

The backend also maintains full canonical application tables alongside the delta log — it is a full mirror, not just an event log.

### Dual-Head Entry Points

The backend exposes two entry points, both of which write to the delta log:

```
┌─────────────────────────────────────────────┐
│             Palladium Axum Router            │
│                                              │
│  POST /sync/push  ──► DeltaIngester          │
│  (sync engine batches from clients)          │
│                                              │
│  POST/PUT/PATCH/DELETE /api/v1/*             │
│  (standard REST for 3rd-party integrations)  │
│           │                                  │
│           └──► Axum middleware               │
│                (auto-generates deltas from   │
│                 DB changes via RETURNING)     │
│                                              │
│           Both paths ──► _sync_deltas        │
└─────────────────────────────────────────────┘
```

**Sync head** (`POST /sync/push`): Accepts a batch of `Change` objects from a client. The server rebases each `Change` against current state, validates, persists, and broadcasts the resulting delta.

**REST head** (`/api/v1/...`): Standard REST handlers. An Axum middleware wraps each handler, detects DB mutations (via `RETURNING` clauses or trigger-based capture), and automatically generates delta rows. Third-party integrations get sync for free.

The builder API for integrating into an existing Axum app:

```rust
let engine = PalladiumEngine::builder()
    .db(pg_pool)
    .auth(JwtAuth::new(secret))
    .broadcaster(PgNotifyBroadcaster::new(pg_pool.clone()))
    .build()
    .await?;

// Merge the Palladium router into your app
let app = Router::new()
    .merge(your_routes)
    .merge(engine.router());

// Or standalone
palladium::serve(config).await?;
```

### Broadcaster (Pub/Sub)

The broadcaster is a pluggable trait:

```rust
pub trait Broadcaster: Send + Sync + 'static {
    async fn publish(&self, workspace_id: &str, delta: &Change) -> Result<()>;
    async fn subscribe(&self, workspace_id: &str) -> impl Stream<Item = Change>;
}
```

Built-in implementations:

| Broadcaster | Use case |
|-------------|----------|
| `InProcessBroadcaster` | Single-process deployments; uses Tokio broadcast channels |
| `PgNotifyBroadcaster` | Multi-process; uses Postgres `LISTEN`/`NOTIFY` |
| `RedisBroadcaster` *(optional)* | High-throughput; Redis pub/sub |

Custom broadcasters (NATS, Kafka, etc.) can be plugged in by implementing the trait.

### Downlink Adapters

Deltas flow from the broadcaster to connected clients over a persistent pipe. The downlink protocol is configurable per deployment:

| Protocol | Best for |
|----------|----------|
| **SSE** (recommended) | PWAs, mobile, firewalls — HTTP/1.1 compatible |
| **WebSocket** | Ultra-low latency text collaboration |
| **HTTP Polling** (fallback) | Strict firewalls, proxy environments |

Each delta emitted on the pipe is filtered by `workspace_id` before delivery — a client only receives deltas for its own workspace.

### Auth & Access Control

Authentication is pluggable:

```rust
pub trait AuthProvider: Send + Sync + 'static {
    async fn verify(&self, token: &str) -> Result<AuthClaims>;
}
```

Built-in providers:
- `JwtAuth` — validates a Bearer JWT and extracts `workspace_id`, `client_id`.
- `OpaqueSessionAuth` — calls an app-supplied `verify_session` async hook.
- `ApiKeyAuth` — for server-to-server sync.

Access control:
- **Workspace isolation**: every delta query is scoped by `workspace_id` extracted from the auth token.
- **Row-level security**: Postgres RLS policies are supported and encouraged.
- **App-defined filter**: an optional per-table async hook `filter_delta(delta, claims) -> bool` for custom ABAC logic.
- **Server-side validation**: a hook `validate_delta(delta, conn) -> Result<()>` allows server-computed/read-only columns to reject unauthorised mutations.

### Conflict Resolution (Server-Side)

| Field type | Strategy |
|------------|----------|
| Plain columns | Last-Write-Wins by `hlc_timestamp` |
| CRDT columns (Yjs) | Yjs operational merge |
| Deletes vs. updates | Surfaces as conflict; `onRejected` hook on client |

Tombstones are kept in `_sync_deltas` with `operation = 'D'` and a configurable TTL. Garbage collection runs after TTL expiry. Clients that miss the TTL window are forced to re-bootstrap.

**ULID collision** (two clients insert the same ULID): server detects a duplicate primary key and returns a `409 Conflict`. Client retries with a new ULID.

Client tracking uses a hybrid model:
- **Stateless** (default): client sends its `last_sync_id` on every request.
- **Stateful** (optional): server records client cursor in `_sync_clients (client_id, workspace_id, last_sync_id, last_seen_at)`.

### Schema & Migrations (Backend)

Plain SQL migration files, numbered sequentially. The Palladium CLI runs migrations:

```
palladium migrate up
palladium migrate status
```

Column-level sync behaviour is declared via SQL `COMMENT` annotations:

```sql
COMMENT ON COLUMN tasks.title  IS '{"sync":{"crdt":"yjs"}}';
COMMENT ON COLUMN tasks.status IS '{"sync":{"lww":true}}';
```

These are stored in `pg_catalog.pg_description` and queried at engine startup. They do not affect vanilla SQL tooling.

Backend and frontend schemas are **independent but validated at sync time**: the server validates incoming delta column names against its current schema and rejects unknown columns.

### Deployment

**As a library** (embedded in an existing Axum service):

```rust
app.merge(engine.router())
```

**As a standalone binary** (`palladium-cli` crate):

```
palladium serve --config palladium.toml
```

The engine uses an app-owned connection pool — `PgPool` is created and configured by the host application and passed into the builder. Palladium does not manage connection pool lifecycle.

Horizontal scaling (multiple server instances) is a v2 concern. v1 targets single-server deployments. The broadcaster trait is designed to allow Redis/NATS-backed fan-out for horizontal scale without API changes.

---

## Background: CRDTs for Beginners

If you are new to distributed systems, this section explains what CRDTs are, why they matter for a sync engine, and how Palladium uses them. Feel free to skip it if you are already familiar with the topic.

### The Problem: Two People Editing at the Same Time

Imagine two users — Alice and Bob — both editing a shared to-do list while offline. Alice renames a task; Bob deletes it. When they both come back online, what should happen?

This is the **conflict problem**. Any sync engine must answer it. There are three broad strategies:

1. **Lock-based** (prevent conflicts): only one user can edit at a time. Simple but kills collaboration.
2. **Last-Write-Wins (LWW)**: whoever wrote last wins. Fast and simple, but can silently discard changes.
3. **CRDT-based** (merge conflicts automatically): both changes are preserved and merged deterministically. More complex, but the only strategy that feels natural for real-time collaboration.

Palladium uses **LWW for plain structured fields** (fast, good enough for most app data) and **CRDTs for rich content** like text documents (where LWW would be disastrous — overwriting someone's entire paragraph because you changed a single word).

### What is a CRDT?

**CRDT** stands for **Conflict-free Replicated Data Type**. A CRDT is a data structure with a special property: any two replicas can be merged in any order and you always end up with the same result. Formally, this is called **strong eventual consistency**.

The key insight is that instead of sending "set the value to X", you send operations that can be merged without coordination:

```
// Problematic (requires coordination):
"Set counter to 5"   ← depends on what the current value is

// CRDT-safe (merge freely):
"Increment counter by 1"   ← can be applied in any order
```

There are two main families:

| Family | How it works | Examples |
|--------|--------------|---------|
| **State-based (CvRDT)** | Replicas exchange their full state; merge via a join operation | G-Counter, G-Set, LWW-Register |
| **Operation-based (CmRDT)** | Replicas exchange the operations themselves; operations commute | Text editing algorithms |

In practice, most production systems use a hybrid called **delta-state CRDTs** — they exchange only the _changed portion_ of state (a "delta"), not the full thing. This is much more efficient.

### Why is Text Hard?

Plain fields (a boolean, a number, a short string) are easy: the last writer wins. But **collaborative text editing** is famously difficult.

Consider two users editing `"Hello"` concurrently:

```
Alice inserts " World" after position 5  →  "Hello World"
Bob  inserts "!"      after position 5  →  "Hello!"
```

A naive merge might produce `"Hello World!"` or `"Hello! World"` depending on order — but different clients could disagree on which one. Worse, index-based positions shift as text changes, so naive approaches corrupt documents.

CRDTs for text solve this by assigning a **stable, globally unique identity** to every character or block. Instead of "insert at index 5", the operation is "insert after character with ID `abc123`". This identity does not shift when other text is inserted nearby, so merges are always unambiguous and deterministic.

Two dominant algorithms:

| Algorithm | Description |
|-----------|-------------|
| **WOOT / RGA** | Each character has a unique ID and a predecessor reference. Insertions are resolved by comparing IDs when characters are inserted at the same position. |
| **LSEQ / Logoot** | Each character has a fractional position in a dense ordered space. No predecessor pointer needed. |

Modern libraries (including Yjs) build on variants of these ideas with significant optimisations.

### Yjs

[Yjs](https://yjs.dev/) is the CRDT library Palladium uses. It is the most widely adopted CRDT library in the JavaScript ecosystem.

**What Yjs provides:**

- `Y.Text` — collaborative rich text (used with ProseMirror, TipTap, CodeMirror, Quill).
- `Y.Map` — a key-value map where concurrent writes to different keys do not conflict.
- `Y.Array` — an ordered list where concurrent insertions are merged deterministically.
- `Y.XmlFragment` — for structured XML/HTML content.

All types live inside a `Y.Doc` (a document). A document is a container — it holds your shared data and tracks the full history needed for merging.

**How Yjs represents changes:**

Yjs uses a variant of the **YATA** algorithm (Yet Another Transformation Approach). Every inserted item has a unique `(clientID, clock)` identifier. When two clients insert at the same position, Yjs uses a deterministic tie-breaking rule based on client IDs to decide final order. Every client always reaches the same result, regardless of the order it receives the updates.

**Update format:**

Yjs encodes changes as compact binary **update blobs**. An update blob is the delta between two states of a document. Updates are:

- **Associative**: `merge(merge(A, B), C) = merge(A, merge(B, C))`
- **Commutative**: `merge(A, B) = merge(B, A)`
- **Idempotent**: applying the same update twice has no effect

This means you can apply Yjs updates in any order, any number of times, and always converge to the same document. This is exactly the CRDT property.

**How Palladium stores Yjs state:**

```
_sync_crdt_updates    ← incremental update blobs (one row per Yjs update)
_sync_crdt_snapshots  ← periodic compacted snapshots (merge of all updates so far)
```

On read, the library loads the latest snapshot and applies any subsequent incremental updates on top. Background compaction periodically merges updates into a new snapshot to keep read performance stable over time.

### Other CRDT Libraries (Ecosystem Overview)

Palladium commits to Yjs, but here is a map of the broader ecosystem for context:

| Library | Language | Algorithm | Best for |
|---------|----------|-----------|----------|
| **[Yjs](https://yjs.dev/)** | JS/TS | YATA | Rich text, collaborative editors |
| **[Automerge](https://automerge.org/)** | JS/TS + Rust | JSON CRDT | Arbitrary JSON documents |
| **[Diamond Types](https://github.com/josephg/diamond-types)** | Rust (+ WASM) | Positional CRDT | Ultra-fast text, Rust-first |
| **[loro](https://loro.dev/)** | Rust (+ WASM) | Fugue + Fractional Index | Rich text + tree structures |
| **[electric-sql / cr-sqlite](https://electric-sql.com/)** | SQLite extension | LWW + causal ordering | Whole-database sync |

Yjs was chosen for Palladium because it has the deepest editor integration (ProseMirror, TipTap, CodeMirror), the largest community, and a mature update/snapshot storage model that maps cleanly onto a SQL backend.

### CRDTs vs. Operational Transformation (OT)

You may have heard of **Operational Transformation (OT)**, the algorithm behind Google Docs. OT and CRDTs both solve collaborative editing but take different approaches:

| | OT | CRDT |
|--|----|----|
| **Core idea** | Transform operations against each other before applying | Assign stable IDs; merge without transformation |
| **Server required** | Yes — a central server serialises all operations | No — peers can sync directly (P2P) |
| **Complexity** | High — transformation functions are notoriously tricky to get right | Moderate — complexity is in the data structure, not the algorithm |
| **Adoption** | Google Docs, Etherpad | Yjs, Automerge, Figma, Linear |

Modern systems have largely moved to CRDTs because they do not require a central server to mediate all operations, making them a natural fit for local-first architectures like Palladium.

---

`Change` objects are serialised as JSON on the wire (optional `zstd`/`gzip` compression):

```json
{
  "id": "018e4c7d-5a12-7000-8a1b-3f2d1e9c0ab4",
  "hlc": {
    "millis": 1712345678901,
    "counter": 3,
    "node_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "ops": [
    {
      "op": "update",
      "table": "tasks",
      "row_id": "01HXXXXXXXXXXXXXXXXXXXXX",
      "col": "done",
      "value": true
    }
  ]
}
```

**Push** (client → server): `POST /sync/push` with `Content-Type: application/json`, body `{ changes: Change[] }`.

**Pull** (server → client, SSE): Each SSE event is a single JSON-serialised `Change`.

**Bootstrap**: `GET /sync/bootstrap?since=<last_sync_id>` returns `{ snapshot: <full dump at sync_id>, sync_id: <uuid> }` followed by an SSE stream of deltas.

---

## Conflict Resolution Model

```
Client A writes task.done = true   at HLC (T=100, C=1, node=A)
Client B writes task.done = false  at HLC (T=99,  C=5, node=B)

Server receives both.
HLC(T=100, C=1, A) > HLC(T=99, C=5, B)
→ Client A wins. task.done = true.
```

For CRDT fields (Yjs):

```
Client A inserts "Hello" at position 0
Client B inserts "World" at position 0  (concurrent)

Both Yjs update blobs arrive at server.
Server merges: Y.applyUpdate(doc, updateA); Y.applyUpdate(doc, updateB)
Result is deterministic: both clients converge to the same document.
```

For **delete vs. update** conflicts, the server surfaces the conflict to the originating client via the `onRejected` hook:

```ts
onRejected: (delta, error) => 'rollback' | 'keep' | 'retry'
```

---

## Presence & Awareness

Presence (cursor positions, user awareness) is an **optional add-on** (`PresenceServer`). It is independent of the main sync engine and always uses WebSocket regardless of the main transport, as presence requires bidirectional low-latency messaging.

Apps opt in explicitly:

```ts
const presence = new PresenceServer({ db, channel: 'tasks-room' });
presence.setLocalState({ cursor: { x: 10, y: 20 }, userId: 'alice' });
presence.on('change', (states) => { /* render cursors */ });
```

---

## Framework Adapters

`@palladium/core` is framework-agnostic. Framework packages wrap it in idiomatic primitives:

### `@palladium/react`

```ts
const { data, status } = useLiveQuery(db, sql`SELECT * FROM tasks`);
const { insert, update, delete: remove } = useMutations(db);
const { isOnline, pendingCount } = useSyncStatus(db);
```

### `@palladium/vue`

```ts
const { data, status } = useLiveQuery(db, sql`SELECT * FROM tasks`);
const { insert, update } = useMutations(db);
```

### `@palladium/svelte`

```ts
const tasks = liveQuery(db, sql`SELECT * FROM tasks`);
// $tasks is a Svelte store
```

### `@palladium/kysely`

Type-safe query builder as an alternative to raw SQL:

```ts
const tasks = await db.kysely
  .selectFrom('tasks')
  .where('done', '=', false)
  .selectAll()
  .execute();
```

### React Native / Expo

`@palladium/core` supports an abstract `StorageAdapter` interface. On web, the adapter uses SQLite WASM; on React Native, it uses `expo-sqlite`. The sync core is identical on both platforms.

---

## Key Architectural Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Clock | HLC (Hybrid Logical Clock) | Causal ordering without wall-clock sync |
| Plain field conflicts | Last-Write-Wins by HLC | Simple, deterministic, no coordination needed |
| CRDT | Yjs | Mature ecosystem; ProseMirror/TipTap/CodeMirror compatible |
| CRDT opt-in | Per-column, via SQL `COMMENT` annotations | SQL stays source of truth; no separate schema language |
| Primary keys | Client-generated ULIDs | Decentralised, sortable, URL-safe |
| sync_id | UUID v7 | Time-ordered globally unique; multi-master friendly |
| Frontend storage | OPFS → SAHPool → IndexedDB waterfall | Graceful degradation across browser environments |
| Worker model | Dedicated Worker per tab | Isolates DB I/O and network from main thread |
| Worker comms | Comlink + MessagePort Observables | Ergonomic RPC + push-based reactivity |
| Transport | SSE / WS / polling (configurable) | SSE works everywhere; WS for low-latency collab |
| Broadcaster | Pluggable trait | Ships with in-process + PG NOTIFY; Redis drop-in |
| Backend data model | Canonical tables + `_sync_deltas` log | Full mirror enables arbitrary queries; log enables sync |
| Dual-head API | Sync endpoint + REST via middleware | Third-party REST integrations get sync automatically |
| Auth | Pluggable provider trait | JWT / opaque session / API key — app chooses |
| Tenant isolation | `workspace_id` row-level filtering | Simpler ops than per-tenant DBs |
| Tombstones | TTL-based with app-defined GC | Balances storage cost and client catch-up window |
| Bootstrap | Snapshot + delta catch-up | Efficient for large datasets; avoids full replay |
| Deployment (v1) | Single-server | Horizontal scale deferred to v2 |
| Local-only mode | First-class support | Single-user apps; add sync later |
| Testing | `createMockEngine()` | Fast in-memory CI tests without a real server |
| Module format | ESM primary | Tree-shaking; modern bundlers and native ES modules |
| Browser target | Chrome 100+, Firefox 100+, Safari 16+ | Enables OPFS, SharedArrayBuffer, top-tier WASM |
