# Palladium Sync Engine — Design Q&A

All answers collected across 22 batches of interactive design questions.

---

## Batch 1 — Scope & Target Users

**Q: Who is the primary consumer?**
A: Open source library. Other devs will use this. Public API, docs, and DX are first-class concerns.

**Q: What is your primary target app domain?**
A: All four — Productivity/notes/tasks, Collaborative editing, Structured data/forms, Financial/health tracking.

**Q: How many concurrent users/clients per workspace?**
A: Real-time collaboration (20+). Requires low-latency CRDT merges, presence, awareness.

**Q: Framework-agnostic or specific framework?**
A: Framework-agnostic core. Vanilla JS/TS core, publish separate @palladium/react, @palladium/vue, @palladium/svelte adapters.

---

## Batch 2 — CRDT & Conflict Resolution

**Q: Yjs committed or open to alternatives?**
A: Yjs — committed. Strong ecosystem, mature, works with ProseMirror/TipTap/CodeMirror. Best for rich text.

**Q: Field-level conflict strategy for plain structured rows?**
A: Last-Write-Wins by client HLC timestamp. Uses Hybrid Logical Clocks client-side. Better causal ordering.

**Q: How to handle hard deletes?**
A: Tombstones with TTL. Keep delete markers for N days then GC. Requires clients to sync within TTL window.

**Q: Should the CRDT layer be opt-in per field?**
A: Opt-in per field. Column-level annotations.

---

## Batch 3 — Schema Definition & Migrations

**Q: How should developers define the schema?**
A: Plain SQL migrations + annotations in comments. Keep SQL as source of truth.

**Q: How should schema migrations be handled between app versions?**
A: Migration files (like Flyway/Liquibase). Developer writes numbered migration SQL files. Engine runs them in order.

**Q: Should backend and frontend share the schema definition?**
A: Independent but validated at sync time. Both sides define their own schema. Server validates incoming deltas.

**Q: Primary key strategy?**
A: ULIDs (client-generated). Sortable, URL-safe, good for pagination.

---

## Batch 4 — Frontend Storage & VFS

**Q: Which SQLite WASM build?**
A: sqlite.org official WASM (the canonical build from the SQLite team).

**Q: Should VFS tier detection and migration be automatic?**
A: App-controlled with library recommendations. Library tells app which VFS is available; app decides when to migrate.

**Q: How critical is it to work without COOP/COEP headers?**
A: Detect and degrade gracefully. Use OPFS if headers available, SAHPool otherwise.

**Q: Should SQLite run in a Web Worker or on the main thread?**
A: Dedicated Worker per tab. No cross-tab coordination. Each tab has its own DB connection.

---

## Batch 5 — Mutation API & Reactivity

**Q: Should commands be validated client-side before hitting SQLite?**
A: Yes — strict validation, reject invalid commands. Schema-aware validation layer.

**Q: How should the reactive read layer work?**
A: All tiers supported:
- Table-level invalidation (coarse)
- Query-level subscriptions with result diffing
- Row-level subscriptions
- Pull-based (no subscriptions)
- Count-based

**Q: Should mutations be synchronous or async?**
A: App chooses per-call: `mutate(cmd, { mode: 'immediate' | 'batched' | 'optimistic' })`.

**Q: Should the library bundle Kysely?**
A: Provide both — raw `sql()` tag + async `exec()` in core, plus `@palladium/kysely-adapter` as a separate package.

---

## Batch 6 — Sync Protocol & Transport

**Q: What is the primary downlink protocol?**
A: Configurable at init time: `transport: 'sse' | 'ws' | 'polling'`. App author picks per deployment.

**Q: How should the client's push (uplink) work?**
A: Shared channel (same as downlink). If SSE, use HTTP POST. If WS, use the WS channel.

**Q: What should the sync unit (delta) look like on the wire?**
A: JSON with optional compression (zstd/gzip). Human-readable, easy to debug.

**Q: How should a new device bootstrap?**
A: Snapshot + delta catch-up hybrid. Server provides a snapshot at a known sync_id, then client streams deltas from that point.

---

## Batch 7 — Backend Architecture & Database

**Q: Which databases should the Rust backend support?**
A: PostgreSQL (primary) + SQLite (server-side, for embedded/single-user deployments).

**Q: How should the Pub/Sub broadcast layer work?**
A: Pluggable — trait-based `Broadcaster`. Ships with in-process + Postgres LISTEN/NOTIFY implementations. User can plug in Redis/NATS.

**Q: How should the backend be deployed?**
A: Both: library + optional standalone binary. Core is a library. Also ships a `palladium-server` binary for simple deploys.

**Q: Should the backend maintain a canonical copy of app data?**
A: Full canonical store + delta log. Backend mirrors app data in real tables AND keeps the deltas table.

---

## Batch 8 — Auth & Access Control

**Q: How should the sync engine handle authentication?**
A: Multiple strategies supported:
- JWT Bearer token (app provides, engine validates)
- Opaque session tokens (app provides `verify_session` hook)
- Built-in API key auth (for server-to-server sync)

**Q: What is the primary access control model?**
A: Workspace/tenant isolation (row filtering by workspace_id) + App-defined filter function.

**Q: Should the engine support row-level security?**
A: Yes — Postgres RLS policies + App-defined per-table filter function.

**Q: How should multi-device sync work for a single user?**
A: Devices are just clients in the same workspace. No special device concept.

---

## Batch 9 — Yjs Integration & CRDT Storage

**Q: What triggers CRDT compaction?**
A: Configurable: threshold (e.g., every 100 updates) + idle timeout (e.g., 5 minutes inactivity). Whichever fires first.

**Q: How should Yjs awareness (presence) be handled?**
A: Optional separate presence service. Library ships a PresenceServer. App opts in. Uses WebSocket regardless of main transport.

**Q: How are Yjs CRDT updates stored on the backend?**
A: Store raw Yjs binary updates in Postgres `bytea` column. Faithful to Yjs. Server can replay update log.

**Q: How should HLC be implemented client-side?**
A: Use an existing HLC library (e.g., `hlc-node`, `uhlc`). Battle-tested.

---

## Batch 10 — Offline Queue & Reconnect

**Q: Where is the offline queue stored?**
A: Both: SQLite when available (durable `_sync_pending_ops` table), memory fallback when SQLite not yet initialized.

**Q: How does the server handle conflicting offline deltas on reconnect?**
A: CRDT merge for CRDT (Yjs) fields + LWW by HLC for plain fields.

**Q: Should the engine support transactional multi-row mutations?**
A: No — each mutation is independent. App composes multi-row operations at the application layer.

**Q: How long should unsynced deltas be retained?**
A: App-defined policy: `onStaleDelta(delta) => 'keep' | 'drop' | 'alert'`.

---

## Batch 11 — Rust Library API Design

**Q: What should the primary Rust API look like?**
A: Builder pattern: `PalladiumEngine::builder().db(pool).auth(jwt).build()`. Fluent, ergonomic.

**Q: How should the REST dual-head be implemented?**
A: Library provides an Axum middleware/extractor that wraps handlers. Handler writes to DB normally; middleware detects changes and generates deltas automatically.

**Q: How should `sync_id` be generated?**
A: UUID v7 (time-ordered). Globally unique across DBs. Good for multi-master future use.

**Q: How should the backend handle a stale client (behind by thousands of deltas)?**
A: Configurable per workspace. Some workspaces allow deep catch-up; others force re-bootstrap after N days.

---

## Batch 12 — Package Structure & Naming

**Q: What should the NPM package structure look like?**
A: Core + adapters:
- `@palladium/core` (framework-agnostic)
- `@palladium/react`
- `@palladium/vue`
- `@palladium/kysely`
(Monorepo, tree-shaking friendly)

**Q: What should the Rust crate structure look like?**
A: Workspace with feature flags: `features = ["axum", "postgres", "sqlite", "redis"]`.

**Q: What is the name of this project?**
A: **Palladium**. Strong, unique, named after a rare metal.

**Q: Should there be a CLI tool?**
A: Both: Rust CLI (`cargo install palladium-cli`) + npm script wrapper (`npx palladium`). Rust binary does heavy lifting; npm is a thin wrapper.

---

## Batch 13 — Frontend Worker Architecture

**Q: How should the main thread communicate with the SQLite Worker?**
A: Comlink (proxy-based RPC) + Observable streams (via worker MessagePort). Push-based change events for subscriptions.

**Q: How should the sync loop manage the connection lifecycle?**
A: Worker owns the connection. Worker opens SSE/WS, receives deltas, writes to SQLite, posts change events to main thread.

**Q: How should sync status be exposed?**
A: Dual approach:
- EventEmitter: `engine.on('sync:status', handler)`
- Polling: `engine.getSyncStatus()`

**Q: How should the frontend handle schema migrations?**
A: Numbered SQL migration files bundled in the app + Manual: `db.runMigrations([sql1, sql2, ...])`.

---

## Batch 14 — Delta Table Schema Design

**Q: What columns should the core deltas table include?**
A: All of the following:
- `sync_id` (UUID v7), `workspace_id`, `table_name`, `row_id`, `operation` (I/U/D)
- `col_name`, `old_value`, `new_value` (column-level diff)
- `client_id`, `hlc_timestamp` (causal ordering)
- `crdt_update` (bytes, nullable) for Yjs fields

**Q: Should the deltas table ever be pruned?**
A: App-controlled retention policy. Library provides retention hooks.

**Q: How should the backend track which clients have received which deltas?**
A: Both: client sends its `last_sync_id` on every request (stateless by default), server optionally records cursor in `_sync_clients` table.

**Q: How should Postgres LISTEN/NOTIFY be integrated?**
A: Pluggable: NOTIFY by default, Redis/polling as alternatives. Matches the trait-based broadcaster design.

---

## Batch 15 — Error Handling & Observability

**Q: When the server rejects a delta, what happens on the client?**
A: App-defined rejection handler: `onRejected: (delta, error) => 'rollback' | 'keep' | 'retry'`.

**Q: What observability hooks should the Rust backend expose?**
A: All of:
- Tracing spans (via `tracing` crate) on all sync operations
- Application-level hooks: `on_delta_persisted`, `on_client_connected`, `on_sync_error`
- Structured log events (`tracing::info!` with `delta_id`, `client_id`, `workspace_id` fields)

**Q: How should the frontend library report errors?**
A: Combination:
- `throw` (TypeError) for programming errors (bad API usage)
- Error events for runtime errors (network failures, sync errors): `engine.on('error', handler)`

**Q: Should the library support time-travel / history queries?**
A: Expose the raw delta log. Library provides `getDeltasFor(rowId) -> Delta[]`. App builds its own history/time-travel UI.

---

## Batch 16 — Performance & Bundle Size

**Q: What is the acceptable initial bundle size for @palladium/core?**
A: No hard limit — correctness over size. Modern bundlers tree-shake well.

**Q: How should the SQLite WASM file be loaded?**
A: Lazy-loaded on first `db.init()` call. App bootstrap is fast; DB loads on demand.

**Q: How should the library handle batching deltas before sending to server?**
A: Configurable: `batchMode: 'immediate' | { debounce: 50 } | 'manual'`.

**Q: How should large binary payloads (e.g., Yjs CRDT updates, file attachments) be handled?**
A: Chunked transfer for large payloads. Resumable uploads.

---

## Batch 17 — Testing & Developer Experience

**Q: How should app developers test sync logic without a real server?**
A: In-memory mock engine: `createMockEngine()` with configurable simulated latency. Runs in Node/Bun. Fast CI tests.

**Q: Should the library ship with a dev UI for inspecting sync state?**
A: No — rely on structured logs + browser DevTools. Console logs and SQLite browser extensions are sufficient.

**Q: What module formats should the NPM packages ship?**
A: ESM (primary). Modern bundlers and native ES modules.

**Q: What is the minimum browser support target?**
A: Modern evergreen only: Chrome 100+, Firefox 100+, Safari 16+. Enables top-tier OPFS, SharedArrayBuffer, etc.

---

## Batch 18 — Multi-tenancy & Workspace Model

**Q: Should workspaces be isolated at the database level or via row-level filtering?**
A: Row-level filtering. All workspaces in shared tables with `workspace_id`. Simpler ops, cheaper hosting.

**Q: How should workspace membership work?**
A: Out of scope — app manages users/workspaces. Engine just needs `workspace_id` from the auth token.

**Q: Can a client be a member of multiple workspaces simultaneously?**
A: Yes — one engine instance per workspace. App creates multiple `PalladiumClient` instances.

**Q: Should the engine support local-only mode (no server)?**
A: Yes — first-class local-only mode. No server required. Can add sync later. Great for single-user apps and demos.

---

## Batch 19 — Conflict-Free Guarantees & Edge Cases

**Q: What happens when two clients create a row with the same ULID?**
A: Server detects duplicate and rejects the second insert (409 conflict). Client must retry with a new ULID.

**Q: What happens when a client updates a row that was deleted by another client?**
A: Surface it as a conflict for the user to resolve. UI shows a conflict dialog.

**Q: How should the engine handle network partitions longer than the tombstone TTL?**
A: Force re-bootstrap from a fresh snapshot. Client loses its local changes and gets a clean copy of current state.

**Q: Should the engine support server-side computed columns clients cannot overwrite?**
A: Yes — via server-side validation hooks: `validate_delta(delta: &Delta, conn: &PgPool) -> Result<(), SyncError>`.

---

## Batch 20 — Security & Encryption

**Q: Should the client-side SQLite database support encryption at rest?**
A: Application-layer encryption for sensitive columns only. App encrypts specific column values before writing.

**Q: Should deltas in transit be end-to-end encrypted?**
A: Field-level E2E encryption as an optional feature. Encrypt only sensitive fields. Server can still process unencrypted columns.

**Q: Should the engine prevent malicious delta injection?**
A: No special protection — auth token proves identity, DB constraints prevent bad data.

**Q: Should the CLI support secret management?**
A: Read from environment variables only. Standard 12-factor app approach.

---

## Batch 21 — Deployment & Infra

**Q: Should the backend support horizontal scaling out of the box?**
A: Not initially — single-server first, scale later. Horizontal scale is a v2+ concern.

**Q: What container/deployment targets should the binary support?**
A: Docker (Dockerfile + docker-compose.yml in examples).

**Q: Should the engine support database connection pooling configuration?**
A: Use the pool the app passes in. App creates its own `PgPool` and passes it to Palladium.

**Q: Should the server ship with a built-in HTTP server or integrate into Axum apps?**
A: Both:
- Axum Router: `app.merge(palladium.router())`
- Standalone binary: `palladium::serve(config).await`

---

## Batch 22 — Final Details

**Q: Should the frontend library support React Native / Expo?**
A: Yes — abstract `StorageAdapter` interface. Web uses SQLite WASM, RN uses `expo-sqlite`. Same sync core for both.

**Q: How should the library handle schema annotations in SQL migration files?**
A: Inline JSON in table/column comments:
```sql
COMMENT ON COLUMN tasks.name IS '{"sync":{"crdt":"yjs"}}';
COMMENT ON COLUMN tasks.status IS '{"sync":{"lww":true}}';
```
Queryable via `pg_catalog`. Doesn't break vanilla SQL tools.

**Q: What should the MSRV (Minimum Supported Rust Version) be?**
A: Latest stable (rolling). No MSRV guarantee.

**Q: What is the v1.0 scope?**
A: Full v1.0 scope — everything:
- Frontend: SQLite WASM + VFS waterfall + basic sync (SSE)
- Frontend: Full CRDT (Yjs) + all reactivity tiers
- Backend: Delta log + Postgres + SSE downlink
- Backend: Full auth + RLS + REST dual-head + presence

---

## Key Architecture Decisions Summary

### Frontend (@palladium/core)
| Concern | Decision |
|---|---|
| SQLite WASM | sqlite.org official, lazy-loaded on `db.init()` |
| VFS strategy | OPFS > SAHPool > IndexedDB waterfall, app-controlled |
| Worker model | Dedicated Worker per tab; Worker owns network connection |
| Worker comms | Comlink (RPC) + MessagePort Observable streams |
| Reactivity | Table / Query / Row / Count / Pull — all tiers |
| Mutations | Per-call: `immediate | batched | optimistic` |
| Query layer | Raw `exec()` core + `@palladium/kysely-adapter` |
| CRDT | Yjs, opt-in per field via SQL `COMMENT` annotations |
| HLC | Existing library (uhlc / hlc-node) |
| Conflict (plain) | LWW by HLC timestamp |
| Conflict (CRDT) | Yjs merge |
| Tombstones | TTL-based, app-defined retention policy |
| Offline queue | SQLite `_sync_pending_ops` + memory fallback |
| Transport | Configurable: SSE / WS / polling |
| Delta format | JSON + optional zstd/gzip |
| Bootstrap | Snapshot + delta catch-up hybrid |
| Schema | SQL migrations + `COMMENT ON COLUMN` annotations |
| Module format | ESM primary |
| Browser target | Chrome/Firefox/Safari 100+/100+/16+ |
| Mobile | `StorageAdapter` abstraction (web WASM / expo-sqlite) |
| Auth (client) | Token passed at init, forwarded on every sync request |

### Backend (palladium Rust crate)
| Concern | Decision |
|---|---|
| Databases | Postgres (primary) + SQLite, feature-flagged |
| API style | Builder pattern |
| Crate structure | Workspace with feature flags |
| Deployment | `app.merge(palladium.router())` + standalone binary |
| Connection pool | App-owned `PgPool` passed in |
| sync_id | UUID v7 |
| Broadcaster | Pluggable trait: in-process / PG NOTIFY / Redis |
| REST dual-head | Axum middleware auto-generates deltas on mutations |
| Data model | Full canonical tables + `_sync_deltas` table |
| Auth | JWT + opaque session + API key |
| Access control | Workspace RLS + app-defined filter fn |
| Tenant isolation | Row-level filtering (`workspace_id`) |
| Delta columns | sync_id, workspace_id, table_name, row_id, op, col_name, old/new value, client_id, hlc_timestamp, crdt_update |
| Delta retention | App-controlled policy |
| Client tracking | Hybrid: client sends cursor + optional `_sync_clients` table |
| Error handling | `onRejected` hook; tracing + structured logs |
| MSRV | Latest stable (rolling) |
| Scale (v1) | Single-server; horizontal scale is v2 |
| Deploy example | Docker + docker-compose |

### Project
| Concern | Decision |
|---|---|
| Name | **Palladium** |
| NPM packages | `@palladium/core`, `@palladium/react`, `@palladium/vue`, `@palladium/kysely` |
| Rust crates | `palladium` workspace with feature flags |
| CLI | `palladium-cli` (Rust) + `npx palladium` (npm wrapper) |
| Testing | `createMockEngine()` in-memory mock |
| Local-only mode | First-class support (no server required) |
| Presence | Optional `PresenceServer` add-on |

---

# Round 2 — Deep Design Q&A (Batches 23–43)

## Batch 23 — TypeScript API Ergonomics

**Q: What does the init call look like?**
A: Two-step: `const db = new Palladium(config); await db.init()`. Construct + async init. Allows pre-flight config before connecting.

**Q: What should the mutate() call signature look like?**
A: Transaction-style callback: `db.tx(t => { t.insert('tasks', data); t.update('tasks', id, patch) })`. Future-proof for grouped mutations.

**Q: What should the subscribe call signature look like?**
A: `const query = db.liveQuery(sql`SELECT ...`)` — returns a `LiveQuery` object with `.on('change', cb)`, `.cancel()`, `.refresh()` methods.

**Q: Should the engine expose a TypeScript generic for schema-level type safety?**
A: Yes — `createPalladium<MySchema>(config)` with full type inference. `db.insert('tasks', ...)` knows the shape of tasks. Similar to Drizzle/Prisma.

---

## Batch 24 — Command & Transaction API Details

**Q: Should there be shorthand methods alongside tx()?**
A: Yes — `db.insert()`, `db.update()`, `db.delete()` as sugar over `db.tx()`. Consistent internals, ergonomic API.

**Q: What should db.tx() return?**
A: `Promise<void>` — use a subsequent query to read back results. Consistent with CQRS. Write-only.

**Q: Can app devs await inside the tx() callback?**
A: No — synchronous builder only. `t.insert/update/delete` are synchronous builders. `tx()` itself is async (it flushes). Async work happens before/after `tx()`.

**Q: What is the atomicity guarantee at the local SQLite level?**
A: Full SQLite transaction (BEGIN/COMMIT). All-or-nothing locally. Either all ops succeed or none do.

---

## Batch 25 — LiveQuery & Subscription Internals

**Q: How should LiveQuery handle the first result emission?**
A: Both: explicit pull-then-push. `query.exec()` for initial value, `.on('change', cb)` for subsequent updates.

**Q: How should LiveQuery result diffing work?**
A: Table-level invalidation drives re-run. Library tracks which tables the query touches; any write to those tables triggers a re-run.

**Q: Should LiveQuery support dynamic params without re-subscribing?**
A: No — create a new LiveQuery with new params. App manages subscription lifecycle.

**Q: How should LiveQuery handle errors?**
A: Both: validate SQL eagerly at construction (throw on syntax error); runtime errors go to `.on('error', cb)`.

---

## Batch 26 — Worker Initialization & WASM Loading

**Q: How should the Worker script be made available to the browser?**
A: Bundler-native: `new Worker(new URL('./worker', import.meta.url))`. Works with Vite, Webpack 5, Rollup. Each bundler handles worker bundling natively.

**Q: What is the WASM loading sequence?**
A: Two-phase: `db.preload()` downloads WASM early and caches it. `db.init()` uses the cached WASM instantly. App can call preload on app start for fast DB open.

**Q: How to handle second-tab race condition on OPFS?**
A: Use `navigator.locks.request()` lock during init. Only one tab initializes at a time. Others wait.

**Q: What happens when db.init() fails?**
A: Throw a typed error: `PalladiumInitError { code: 'WASM_LOAD_FAILED' | 'MIGRATION_FAILED' | 'VFS_UNAVAILABLE' | ... }`. App wraps in try/catch.

---

## Batch 27 — Wire Protocol Details

**Q: What does the sync handshake look like?**
A: Client sends: `GET /sync/v1/stream?workspace_id=X&last_sync_id=Y` with `Authorization: Bearer <token>` header.

**Q: What are the message types in the downlink stream?**
A: Five types: `delta`, `snapshot`, `ack`, `ping`, `error`.

**Q: What does a delta message look like on the wire?**
A: Verbose, named fields:
```json
{
  "type": "delta",
  "sync_id": "...",
  "workspace_id": "...",
  "table": "tasks",
  "row_id": "...",
  "op": "U",
  "cols": { "name": { "old": "foo", "new": "bar" } },
  "hlc": "...",
  "client_id": "...",
  "crdt": null
}
```

**Q: How should the client acknowledge received deltas?**
A: Client periodically POSTs its current `last_sync_id` to `POST /sync/v1/ack`. Explicit cursor update. Low traffic.

---

## Batch 28 — Snapshot Format & Bootstrap

**Q: What format is the bootstrap snapshot?**
A: Compressed NDJSON (zstd stream). Streaming, one row per line, with streaming decompression in the worker.

**Q: Where does the server store snapshots?**
A: Pre-generated and cached in Postgres — a `_sync_snapshots` table with a `bytea` or `jsonb` column. Generated periodically.

**Q: How does the client know when it needs to re-bootstrap?**
A: Server decides. If gap > N deltas or client is past tombstone TTL, server sends a `{ type: 'rebootstrap', reason: 'stale' | 'fresh' }` message. Client tears down and re-initializes.

**Q: How should the app's UI behave during a snapshot bootstrap?**
A: UI is blocked until bootstrap completes, then unlocks all at once. Standard loading spinner.

---

## Batch 29 — CRDT Field Bindings & Y.Doc Model

**Q: How is a Y.Doc scoped?**
A: One Y.Doc per row. `doc_id = row's ULID`. Each row with CRDT fields gets its own Y.Doc.

**Q: Which Yjs shared types does the engine natively support?**
A: All four: `Y.Text`, `Y.Map`, `Y.Array`, `Y.XmlFragment`.

**Q: When app code reads a CRDT column, what does it get?**
A: Both: `row.body` for plain string value (for display), `row.body.yDoc` for the live `Y.Doc` (for editor binding like TipTap/ProseMirror).

**Q: How should Y.Doc updates be synced?**
A: Debounced. Configurable window, default 500ms. Reduces traffic; small latency for collaborators.

---

## Batch 30 — React & Framework Adapters

**Q: What hooks does @palladium/react export?**
A: Three hooks:
- `useLiveQuery(sql`...`) → { rows, loading, error }`
- `useMutation() → { tx, insert, update, delete, pending }`
- `useSyncStatus() → { status, pendingCount, isOnline }`

**Q: How should @palladium/react handle Suspense?**
A: Both: `useLiveQuery` for loading-state pattern (`{ rows, loading }`), `useLiveQuerySuspense` for React.Suspense pattern (suspends until resolved).

**Q: How should the React adapter provide the db instance?**
A: Both: `<PalladiumProvider db={db}>` for multi-instance apps, singleton export (`import { db }`) for simple apps.

**Q: What is the @palladium/vue API surface?**
A: Composables with the same names as React: `useLiveQuery()`, `useMutation()`, `useSyncStatus()`. Consistent naming across frameworks.

---

## Batch 31 — CLI Design

**Q: What are the core CLI commands?**
A: Four commands:
- `palladium migrate` — run pending migrations against a DB
- `palladium generate types` — generate TypeScript + Zod schemas from SQL
- `palladium inspect` — show current sync state of a running server
- `palladium snapshot create/list/restore` — manage server snapshots

**Q: What does palladium generate types output?**
A: Both TypeScript interfaces AND Zod schemas alongside them. For apps that need both static types and runtime validation.

**Q: How does palladium migrate discover migration files?**
A: Config-file driven: `palladium.config.ts` in the project root specifies `migrationsDir`, `dbUrl`, etc. No magic defaults.

**Q: Should the CLI have a dev server command?**
A: Yes — `palladium dev` wraps `palladium-server` with sensible dev defaults: verbose logging, no auth required, auto-migration on start.

---

## Batch 32 — SSR, Bundler & Build Edge Cases

**Q: How should @palladium/core behave in SSR contexts?**
A: Throw a clear error if imported server-side: `'Palladium requires a browser environment. Use dynamic imports or client-only guards.'`

**Q: Should the library ship a Vite plugin?**
A: Yes — `@palladium/vite`. One plugin handles: COOP/COEP header injection, worker bundling, and WASM asset copying.

**Q: How should the library handle HMR when migration files change?**
A: HMR is out of scope. Engine is initialized once. Dev uses hard page refresh when changing schema.

**Q: How should the library handle CSP restrictions blocking WASM?**
A: Document required CSP directives (`wasm-unsafe-eval`) and throw a clear, actionable error message pointing to the docs if WASM is blocked.

---

## Batch 33 — Connection Management & Reconnect

**Q: How should the client handle a dropped connection?**
A: Immediate retry once (catches brief blips), then exponential backoff with jitter, capped at 60s.

**Q: When a reconnect happens, what's the first thing the client does?**
A: Flush queued offline deltas first (`POST /sync/v1/push`), then reconnect the SSE/WS stream. Uplink before downlink.

**Q: What happens when a JWT expires mid-session?**
A: App provides a `getToken(): Promise<string>` async function at init time. Engine calls it before each reconnect attempt. Never stores tokens internally.

**Q: Should the engine expose connection health state?**
A: Both: simple `engine.isOnline` boolean for simple UIs, detailed `engine.syncStatus` (`'connected' | 'reconnecting' | 'offline' | 'syncing'`) for advanced UIs.

---

## Batch 34 — Rust Backend: Hooks & Middleware

**Q: How does the Axum middleware auto-detect DB mutations and generate deltas?**
A: Three configurable strategies (app picks one or combines):
1. Postgres triggers on each synced table (decoupled, works for any writes)
2. `palladium::insert!() / update!()` macros wrapping SQLx (engine sees every write)
3. Explicit `engine.record_delta(delta)` call (most explicit)

**Q: What server-side hooks should app developers register?**
A: All four:
- `before_delta_persist` — transform or reject a delta before DB write
- `after_delta_persist` — side effects after delta is committed
- `on_client_connect / on_client_disconnect` — lifecycle events
- `on_snapshot_request` — customize bootstrap snapshot per workspace

**Q: How should the Rust library expose workspace context to Axum handlers?**
A: Axum extractor: `async fn handler(ctx: PalladiumCtx, ...) -> ...`. `PalladiumCtx` has `workspace_id`, `client_id`, `claims`. Idiomatic Axum.

**Q: Should the Rust library provide an engine SQL API?**
A: No — app uses raw `PgPool` for reads. Engine owns only the `_sync_*` tables. Keeps the engine minimal.

---

## Batch 35 — Presence Service Design

**Q: What data does the PresenceServer track?**
A: Two fields:
- User identity: `user_id`, `display_name`, `avatar_url`
- Custom metadata: app-defined JSON payload (e.g., `{ status: 'typing' }`, `{ page: '/dashboard' }`)

**Q: How does the PresenceServer relate to the sync server?**
A: Same process — an additional Axum router mounted alongside the sync routes. Single binary. Easiest to deploy.

**Q: How is presence data delivered to the frontend?**
A: Both: raw Yjs Awareness protocol for editor integrations (TipTap/ProseMirror), plus a higher-level `engine.presence.subscribe(docId, callback)` API for custom UIs.

**Q: How long does presence state persist after disconnect?**
A: Configurable grace period, default 30 seconds. Covers brief network blips. `presenceTTL: 30000`.

---

## Batch 36 — Filtering, Partial Sync & Subscriptions

**Q: Can clients subscribe to only a subset of tables?**
A: Yes — opt-in in init config: `sync: { tables: ['tasks', 'comments'] }`. Server filters the delta stream.

**Q: Can clients sync only a filtered subset of rows?**
A: No — sync all rows in the workspace. Client queries locally for filtered views. Storage is cheap on device.

**Q: Can sync configuration change at runtime?**
A: Via multiple engine instances (one per scope). Create a new `Palladium` instance for each distinct sync scope.

**Q: Should unannotated tables be local-only?**
A: Yes — unannotated tables are local-only. Engine never syncs them. App can have private tables for local state (UI preferences, cache, etc.).

---

## Batch 37 — Schema Annotation Format & SQL Parser

**Q: What's the exact JSON schema for a COMMENT ON COLUMN annotation?**
A: Namespaced under `"palladium"`:
```sql
COMMENT ON COLUMN tasks.name IS '{"palladium": {"crdt": "yjs:text"}}';
COMMENT ON COLUMN tasks.status IS '{"palladium": {"lww": true}}';
COMMENT ON COLUMN tasks.secret IS '{"palladium": {"lww": true, "e2e": true}}';
```

**Q: When does the frontend SQL migration parser run?**
A: Both — build-time for type/annotation extraction (via CLI `generate types`), runtime for migration execution only. Annotations are never re-parsed at runtime.

**Q: How does the CLI parser handle SQL it doesn't understand?**
A: Opaque pass-through. Unrecognized statements are passed through without parsing. Never blocks on exotic SQL.

**Q: Is COMMENT ON TABLE needed for table-level sync config?**
A: No — inferred from columns. If any column in a table has a `{"palladium": ...}` annotation, the table is automatically considered synced.

---

## Batch 38 — API Versioning & Protocol Evolution

**Q: How should the wire protocol be versioned?**
A: Version in the URL: `/sync/v1/stream`, `/sync/v2/stream`. Breaking changes get a new path. Old clients can still connect to `/v1`.

**Q: Should Palladium use semver?**
A: `0.x` throughout alpha/beta (breaking changes allowed freely). Strict semver after `1.0` (public API stability).

**Q: What is the back-compat policy when server is newer than client?**
A: No backward compatibility guarantee during `0.x` phase. Policy defined at `1.0`.

**Q: What should palladium.config.ts look like?**
A: Two separate files:
- `palladium.client.ts` — safe to bundle, contains sync config, table lists, migration paths
- `palladium.server.ts` — server-only, contains DB URLs, secrets (via env vars), auth config

---

## Batch 39 — Rate Limiting, Backpressure & Server Health

**Q: Should the server have built-in rate limiting on delta pushes?**
A: Yes — configurable: `maxDeltasPerSecond` per client. Returns HTTP 429 if exceeded.

**Q: How should the server handle backpressure from slow clients?**
A: Tokio async backpressure — server pauses sending until the client catches up. No data loss. True flow control.

**Q: Should the server expose a health check endpoint?**
A: Yes — two endpoints:
- `GET /health` — simple 200 for uptime monitors / Kubernetes liveness probes
- `GET /metrics` — Prometheus format for Grafana dashboards

**Q: How should delta lag be reported?**
A: Both: Prometheus gauge `palladium_delta_lag_seconds` + structured log warning when oldest undelivered delta exceeds threshold.

---

## Batch 40 — Project & Open Source

**Q: What open-source license?**
A: Dual license: BSL (Business Source License) + AGPL. BSL for commercial protection; AGPL for open-source users.

**Q: What is the JS monorepo toolchain?**
A: pnpm workspaces (JS) + Cargo workspace (Rust) + Justfile for task automation. No extra monorepo tooling.

**Q: What Rust async runtime setup?**
A: Adaptive: multi-threaded tokio by default (for Postgres/high-throughput). `current_thread` tokio when `sqlite` feature is active (SQLite is not `Send`).

**Q: Should the project include a demo app?**
A: No demo app. Focus on the library. Docs with inline code snippets are sufficient.

---

## Batch 41 — Client Identity & Storage Keys

**Q: How is client_id generated and persisted?**
A: Generated once per device (ULID or UUID v4), stored in `localStorage`. Persists across tabs and page refreshes on the same origin.

**Q: How should the SQLite DB file be named in OPFS?**
A: Fixed default `'palladium.db'`, overridable via config: `new Palladium({ dbName: 'myapp-tasks' })`.

**Q: Should the engine track migration version in SQLite?**
A: Both: `PRAGMA user_version = N` for fast boot check + `_sync_migrations` table `(version, name, applied_at)` for full history.

**Q: When the user clears browser storage, how does the engine recover?**
A: Detect empty DB on init, emit a `'storage-cleared'` event. App decides how to respond (e.g., show a notification, trigger re-bootstrap).

---

## Batch 42 — Optimistic Mutations & Rollback

**Q: What does 'rollback' mean when the server rejects an optimistic delta?**
A: Mark the row as `'conflicted'` — adds a `__conflict` metadata field. App shows conflict UI. User manually resolves. Most correct for complex conflicts.

**Q: How does the app know a mutation is still pending?**
A: LiveQuery results include a `__pending` metadata field on each row. Queryable via normal live queries. Easy to show per-row "saving..." indicator.

**Q: Should the engine support undo/redo?**
A: No — out of scope. Undo/redo is application-level logic. App can use `getDeltasFor(rowId)` to build its own undo stack. CRDT fields have native undo via Yjs.

**Q: When a tx() partially fails in optimistic mode, how is it handled?**
A: Configurable per-transaction: `db.tx({ rollbackOnAnyFailure: true })`. Default is all-or-nothing to match local SQLite atomicity semantics.

---

## Batch 43 — Testing Infrastructure & Final Risks

**Q: What does createMockEngine() look like?**
A: Simple config params: `createMockEngine({ latency: 50, failRate: 0.1, initialData: { tasks: [...] } })`. Configurable latency, simulated failure rate, and seed data.

**Q: How should the Rust backend be tested?**
A: Both tiers:
- Unit: `PalladiumEngine::test().sqlite_in_memory().build().await` — fast, no external DB
- Integration: testcontainers-rs (Postgres container per test) — realistic, Docker required

**Q: Is delta application idempotent?**
A: Yes — applying the same delta twice is a no-op. Engine deduplicates by `sync_id` before applying. Safe to retry.

**Q: What is the most likely part of this design to need a major rethink after v1?**
A: The Y.Doc-per-row CRDT model at scale. 1M rows = 1M Y.Docs. Memory and storage implications will likely require lazy loading, eviction, and a Y.Doc lifecycle manager.

---

## Updated Architecture Summary (Round 2 additions)

### TypeScript API Shape
```typescript
// Init
const db = new Palladium<MySchema>(config);
await db.preload();  // Optional: pre-fetch WASM
await db.init();     // Runs migrations, opens SQLite, connects sync

// Mutations
await db.tx(t => {
  t.insert('tasks', { id: ulid(), name: 'Buy milk' });
  t.update('tasks', id, { status: 'done' });
  t.delete('tasks', id);
});
// Shorthand sugar:
await db.insert('tasks', data);
await db.update('tasks', id, patch);
await db.delete('tasks', id);

// Reactive reads
const query = db.liveQuery(sql`SELECT * FROM tasks ORDER BY created_at`);
const rows = await query.exec();        // Initial pull
query.on('change', (rows) => { ... });  // Push updates
query.on('error', (err) => { ... });

// Sync status
engine.isOnline;                        // boolean
engine.syncStatus;                      // 'connected' | 'reconnecting' | 'offline' | 'syncing'
engine.on('sync:status', handler);
engine.getSyncStatus();
```

### Wire Protocol
```
Client → Server: GET /sync/v1/stream?workspace_id=X&last_sync_id=Y
                 Authorization: Bearer <token>

Server → Client (SSE stream):
  { "type": "snapshot", "sync_id": "...", "data": <zstd NDJSON stream> }
  { "type": "delta", "sync_id": "...", "workspace_id": "...", "table": "tasks",
    "row_id": "...", "op": "U", "cols": { "name": { "old": "foo", "new": "bar" } },
    "hlc": "...", "client_id": "...", "crdt": null }
  { "type": "ack", "sync_id": "..." }
  { "type": "ping" }
  { "type": "error", "code": "...", "message": "..." }

Client → Server (push): POST /sync/v1/push  { deltas: [...] }
Client → Server (ack):  POST /sync/v1/ack   { last_sync_id: "..." }
```

### Schema Annotation Format
```sql
-- Table is synced if any column has a palladium annotation (inferred, no table annotation needed)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,  -- ULID, client-generated
  name TEXT NOT NULL,
  body TEXT,
  status TEXT DEFAULT 'todo',
  created_at TEXT NOT NULL
);

COMMENT ON COLUMN tasks.name   IS '{"palladium": {"lww": true}}';
COMMENT ON COLUMN tasks.body   IS '{"palladium": {"crdt": "yjs:text"}}';
COMMENT ON COLUMN tasks.status IS '{"palladium": {"lww": true}}';
-- tasks.id, tasks.created_at — no annotation = LWW by default (primary key never conflicts)
-- tasks table itself is not annotated but is inferred as synced
```

### Palladium CLI Commands
```
palladium migrate          # Apply pending migrations to DB (reads palladium.client.ts)
palladium generate types   # Emit schema.d.ts + schema.zod.ts from SQL annotations
palladium inspect          # Show connected clients, delta backlog, workspace stats
palladium snapshot create  # Manually trigger a server snapshot
palladium snapshot list    # List available snapshots
palladium snapshot restore # Restore a workspace to a snapshot
palladium dev              # Start palladium-server with dev defaults (no auth, verbose)
```

---

# Round 3 — Design Issue Resolution (Issue Batches 1–10)

_86 issues were identified by auditing the previous Q&A rounds. Below are the resolved issues._

---

## Issue Batch 1 — Core Architecture Contradictions

**Q: VFS waterfall — automatic or app-controlled?**
A: Both: auto-migrate on first init (engine picks the best available VFS automatically), app-controlled thereafter (if a better VFS becomes available later, emit a `'vfs-available'` event and let the app decide when to migrate).

**Q: Does the backend maintain canonical app tables or only _sync_* tables?**
A: Engine owns ONLY `_sync_*` tables. App creates and owns its domain tables (`tasks`, `users`, etc.). Engine's job is solely to track and broadcast deltas. The "full canonical store" language in the idea.md was misleading — the backend hosts the app's domain tables, but Palladium doesn't manage them.

**Q: When does db.tx() resolve — after local SQLite commit or after server ACK?**
A: tx() resolves after local SQLite commit (fast, <5ms). App gets a separate `syncPromise` for cases that need to await server confirmation:
```typescript
const { sync } = await db.tx(t => { t.insert(...) });
await sync; // Optional: wait for server ACK
```

**Q: How are multi-op transactions synced to the server?**
A: Each op in a `tx()` becomes a separate delta row, all sharing the same `tx_id` field. `tx_id` is for audit only — no atomicity guarantee across the network. Server applies deltas independently as they arrive.

---

## Issue Batch 2 — Protocol & Network Gaps

**Q: Postgres LISTEN/NOTIFY is not durable — is this a problem?**
A: Accept the loss. NOTIFY is an efficiency signal, not the source of truth. The delta IS durable in `_sync_deltas`. If a NOTIFY is lost due to crash, clients reconnect and catch up from their `last_sync_id`. No delta is actually lost.

**Q: If the offline delta flush POST fails on reconnect, what happens?**
A: Retry flush with exponential backoff. Do NOT open the downlink stream until flush succeeds. Strict uplink-before-downlink ordering prevents seeing server deltas that conflict with un-flushed local work.

**Q: When is the pre-generated snapshot in _sync_snapshots regenerated?**
A: Both triggers: background job on a configurable schedule (e.g., every hour) AND on-demand when a bootstrap request arrives and no snapshot exists or the existing one is stale.

**Q: What is the re-bootstrap threshold (N)?**
A: Time-based, not delta-count: re-bootstrap if `gap > 7 days` (configurable). More intuitive for ops teams. `rebootstrapThreshold: '7d'` in server config, overridable per workspace.

---

## Issue Batch 3 — CRDT & Y.Doc Issues

**Q: If the connection drops during the 500ms Y.Doc debounce window, where do pending updates go?**
A: Debounce buffers Yjs updates in memory. On disconnect, the buffer is immediately flushed to `_sync_pending_ops` in SQLite. No per-keystroke SQLite writes during active editing; durable on disconnect.

**Q: Should presence and sync share a transport connection?**
A: Opt-in behavior: if presence is not used, zero overhead. When opt-in, presence messages are multiplexed over the existing sync connection as a separate message type: `{ type: 'presence', ... }`. No second connection needed.

**Q: What mitigation should be built for the Y.Doc-per-row scalability risk?**
A: No mitigation in v1. Flag as a known limitation in docs. Design the Y.Doc lifecycle API to allow LRU eviction in v2 without breaking changes. API will expose `engine.crdt.evict(rowId)` and `engine.crdt.preload(rowId)` for future use.

**Q: Can a developer accidentally sync a table by annotating one column?**
A: Yes — this is intentional (inferred sync). A dev-mode warning is emitted when a previously-unsynced table becomes synced due to a new annotation: `⚠️ Table 'tasks' is now synced because column 'body' was annotated.`

---

## Issue Batch 4 — Schema & Migration Issues

**Q: What prevents schema type drift between CLI-generated types and deployed migrations?**
A: Defense in depth: docs recommend running `palladium generate types` as part of the build script. Engine also includes a runtime hash check at `db.init()` — if the migration file hash doesn't match what generated the types, warn in console.

**Q: How does the server detect schema divergence (unknown table/column in incoming delta)?**
A: Server rejects deltas with unknown `table_name` or `col_name` with HTTP 400 Bad Request. Client gets a rejected delta event. Client must upgrade to a newer app version.

**Q: Are migrations atomic? What if the process crashes mid-migration?**
A: Migrations are idempotent by design (developer responsibility: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). `_sync_migrations` records only completed migrations. Failed migration is retried on next boot.

**Q: COMMENT ON COLUMN is Postgres-specific. How does the client-side SQLite handle annotations?**
A: Annotations are server-side tooling only. Client-side SQLite uses the `schema.json` generated by `palladium generate types`. `COMMENT ON COLUMN` statements are stripped from the client migration SQL by the CLI pre-processor.

---

## Issue Batch 5 — API Design Tensions

**Q: What if app schema columns collide with __pending or __conflict metadata fields?**
A: Engine validates at `db.init()` time. If the schema contains any column starting with a reserved prefix, throw a clear `PalladiumSchemaError`: `'Column "__pending" in table "tasks" conflicts with a reserved Palladium metadata field.'`

**Q: With three delta detection strategies, which is the default?**
A: `engine.record_delta(delta)` (explicit call) is the default — opt-in, no magic. Postgres triggers and `palladium::insert!()`/`update!()` macros are convenience helpers for developers who want less boilerplate.

**Q: When should developers use sql\`\` vs exec() vs Kysely?**
A: `sql\`...\`` template literal is the ONLY first-party query API. No `exec()` method. Kysely adapter is fully optional for developers who want type-safe complex queries. One way to do it in core.

**Q: How does the app get the inserted row's ID from a tx() that returns void?**
A: App generates the ULID before calling `tx()`. Client-generated ULIDs are known before the insert. No round-trip needed. This is the correct pattern — `id` is not a surprise from the server.

---

## Issue Batch 6 — Auth & Security Gaps

**Q: What happens when a JWT expires during an active long-lived SSE session?**
A: Reactive approach: server closes the SSE stream with a 401 event. Client detects the 401, calls `getToken()` to get a fresh token, and reconnects. Brief interruption on each token expiry.

**Q: Can a malicious client spoof workspace_id in deltas?**
A: No. Server NEVER trusts `workspace_id` from the client request body. `workspace_id` is always extracted server-side from the auth token (JWT claim or session lookup). Client-provided `workspace_id` is either ignored or validated against the token's claims.

**Q: What if Postgres RLS and app-defined filter function contradict each other?**
A: Both must pass (layered security): RLS is the first gate (DB-level tenant isolation). App filter is the second gate (business logic). A delta is broadcast only if both allow it. Neither can override the other.

**Q: E2E-encrypted columns bypass server validate_delta hooks — is this acceptable?**
A: Yes — explicit trade-off. Documented. Developer annotates with `{"palladium": {"lww": true, "e2e": true}}` knowing that `validate_delta` won't run for that column. Privacy wins over server-side validation.

---

## Issue Batch 7 — Offline & Conflict Edge Cases

**Q: If client is offline and builds a chain A→B→C on the same row, and B is rejected on sync, what happens to C?**
A: C is retried regardless. B rejection doesn't cascade. The server sees C's final state with its own HLC timestamp and applies LWW. B is rejected, C competes on its own merits.

**Q: When force re-bootstrapping (TTL exceeded), what happens to pending ops in _sync_pending_ops?**
A: Last-chance flush: engine attempts to flush all pending ops before re-bootstrap. If flush fails (server rejects), emits a `'data-loss-warning'` event with the affected ops (serialized for the app to inspect). Then proceeds with re-bootstrap.

**Q: Two tabs open. Tab A mutates. How does Tab B's LiveQuery update?**
A: Default is single-tab mode (`navigator.locks` primary lock). If a second tab detects the lock is taken, it emits a `'tab-conflict'` event — app can take over (claim the lock) or defer. Multi-tab via BroadcastChannel requires explicit opt-in: `new Palladium({ multiTab: true })`.

**Q: Server receives deltas from the same tx_id out of order. What happens?**
A: Server applies deltas as they arrive. `tx_id` is for audit only. LWW + HLC timestamps settle any ordering ambiguity regardless of arrival order.

---

## Issue Batch 8 — Cross-Tab & Worker Model

**Q: How is single-tab enforcement implemented and what happens to the second tab?**
A: `navigator.locks.request('palladium:primary:{dbName}')`. Second tab detects lock is taken, emits `'tab-conflict'` event. App can call `db.takeover()` to acquire the lock (old tab loses it) or show a message like "Open in another tab."

**Q: Should multi-tab mode be an explicit opt-in?**
A: Yes — `new Palladium({ multiTab: true })`. Default is single-tab. Multi-tab mode uses BroadcastChannel for cross-tab change notifications + separate worker per tab. Explicit opt-in.

**Q: Are the init lock and primary session lock the same?**
A: Two different locks:
- `'palladium:init:{dbName}'` — short-lived, held only during OPFS initialization to prevent race conditions
- `'palladium:primary:{dbName}'` — long-lived, held for the entire session lifetime for single-tab enforcement

**Q: When a primary tab crashes, how long until secondary takes over?**
A: Configurable grace period (default: 5 seconds) before the secondary tab acquires the primary lock. Prevents jitter if the primary tab is temporarily unresponsive rather than crashed.

---

## Issue Batch 9 — REST Dual-Head & Backend API

**Q: REST clients have no client_id or HLC. What do their deltas contain?**
A: Server generates a synthetic `client_id = 'rest:api:{user_id}'` and uses server wall clock as the HLC timestamp. REST mutations always "win" LWW conflicts with client mutations since the server's time is authoritative.

**Q: How does an app REST handler connect its domain table write to delta generation?**
A: Two complementary patterns:
1. Explicit: app handler writes to domain table, then calls `engine.record_delta(delta)` manually (blessed default)
2. Automatic: `PalladiumCtx` extractor can intercept and auto-generate a delta when the handler returns a modified resource (convenience for REST handlers)

**Q: How does the Rust backend know the app schema for delta validation?**
A: Self-discovering: Palladium reads schema from Postgres `pg_catalog` at startup (table names, column names, types, and `COMMENT ON COLUMN` annotations). No manual schema config needed. Schema is refreshed on server restart.

**Q: What indexes should the _sync_deltas table have?**
A: Three indexes:
```sql
CREATE INDEX ON _sync_deltas (workspace_id, sync_id DESC);              -- stream new deltas
CREATE INDEX ON _sync_deltas (workspace_id, table_name, sync_id DESC);  -- catch-up by table
CREATE INDEX ON _sync_deltas (row_id);                                   -- row history queries
```

---

## Issue Batch 10 — Performance & Miscellaneous Gaps

**Q: How does LiveQuery determine which tables a SQL query touches for invalidation?**
A: Configurable — developer can declare tables explicitly (zero overhead, developer responsibility):
```typescript
db.liveQuery(sql`SELECT * FROM tasks JOIN users ON ...`, { tables: ['tasks', 'users'] })
```
Fallback: run `EXPLAIN QUERY PLAN` and extract table names from the output (accurate, cached after first run).

**Q: What exactly does db.preload() do?**
A: Full pre-initialization except opening the DB: downloads and caches WASM binary, instantiates the Worker, initializes SQLite in memory (without running migrations). `db.init()` then only runs migrations, making it near-instant.

**Q: Should _sync_clients tracking be on or off by default?**
A: Off by default. App opts in: `.track_clients(true)` in the engine builder. Tracking adds a write on every ack POST.

**Q: What does the dual BSL + AGPL license mean in practice?**
A: All code is BSL (Business Source License). AGPL applies as the open-source alternative license. In practice:
- Open-source users / self-hosters: AGPL (source-available, can use freely)
- Commercial SaaS builders (hosting Palladium for others): BSL requires a commercial license
- The BSL converts to Apache 2.0 after N years (TBD)

---

## Resolved Architecture Decisions (Round 3 Addendum)

| Issue | Resolution |
|---|---|
| VFS migration model | Auto on first init, app-controlled on subsequent VFS upgrades |
| Backend data model | Engine owns ONLY `_sync_*` tables. App owns domain tables. |
| tx() resolution timing | Resolves after local SQLite commit. Optional `syncPromise` for server confirmation. |
| Multi-op tx on wire | Grouped by `tx_id` (audit only). No server-side atomicity guarantee. |
| NOTIFY durability | Accept loss. Delta log is source of truth. Reconnect catches up. |
| Reconnect ordering | Flush offline deltas first (retry with backoff). Then open downlink. |
| Snapshot regeneration | Background job (scheduled) + on-demand fallback |
| Re-bootstrap threshold | Time-based: `gap > 7 days` (configurable) |
| CRDT debounce + offline | Buffer in memory; flush to SQLite on disconnect |
| Presence transport | Opt-in; multiplexed as `{ type: 'presence' }` on sync connection |
| Y.Doc scale risk | No v1 mitigation; API designed for LRU eviction in v2 |
| Metadata collision guard | Throw `PalladiumSchemaError` at init time |
| Delta detection default | Explicit `engine.record_delta()` is default; triggers/macros are helpers |
| Query API | `sql\`\`` only; no `exec()`; Kysely is optional adapter |
| Insert ID | App generates ULID before `tx()`. Client owns the ID. |
| Token expiry mid-session | Reactive: server sends 401, client reconnects with fresh token |
| workspace_id spoofing | Server extracts from auth token; never trusts client body |
| RLS vs app filter | Both layers required; neither overrides the other |
| E2E + server validation | E2E columns bypass `validate_delta`; documented trade-off |
| Offline chain conflicts | C retried on its own; B rejection doesn't cascade |
| Re-bootstrap + pending ops | Last-chance flush + `'data-loss-warning'` event |
| Cross-tab reactivity | Single-tab by default; `{ multiTab: true }` opt-in |
| Delta ordering on server | tx_id is audit only; LWW + HLC settles order |
| Single-tab enforcement | `navigator.locks 'palladium:primary:{dbName}'` + 5s grace on failover |
| REST delta authorship | Synthetic `'rest:api:{user_id}'` client_id; server wall clock HLC |
| REST + record_delta | Explicit `record_delta()` default; PalladiumCtx auto-detect as convenience |
| Server schema awareness | Self-discovering from `pg_catalog` at startup |
| _sync_deltas indexes | 3 indexes: (workspace_id, sync_id), (workspace_id, table, sync_id), (row_id) |
| LiveQuery table tracking | Explicit `{ tables: [...] }` parameter; EXPLAIN fallback |
| preload() scope | Full pre-init (WASM + Worker + SQLite); `db.init()` runs migrations only |
| _sync_clients default | Off by default; `.track_clients(true)` opt-in |
| License model | BSL + AGPL dual-license; converts to Apache 2.0 after N years |

---

# Round 4 — Continued Issue Resolution (Issue Batches 11–20)

## Issue Batch 11 — CRDT Semantics & HLC Details

**Q: A row has both CRDT and LWW fields. How does merge work across field types?**
A: Each field type merges independently. Yjs merge for CRDT fields, LWW-by-HLC for plain fields. No interaction between them. The "row" is just a grouping — conflicts are per-column.

**Q: How is the HLC timestamp serialized on the wire?**
A: Two explicit fields: `{ "wall_time": 1709812800123, "logical": 42 }`. Explicit structure, easy to parse and compare programmatically.

**Q: A client offline 30 days reconnects with 30-day-old HLC timestamps. Those timestamps will always lose LWW. Is this correct?**
A: App-configurable. Options are: (a) keep original HLC timestamps (old edits lose LWW by design), or (b) bump offline delta HLCs to reconnect time (offline edits compete on equal footing). Configured via `offlineHLCPolicy: 'preserve' | 'bump'`.

**Q: Who GC's expired tombstones from local SQLite?**
A: Piggybacked on CRDT compaction. When the worker runs the compaction job (threshold or idle timeout), it also deletes tombstone rows from local SQLite where `deleted_at < (now - TTL)`.

---

## Issue Batch 12 — Transport & Wire Protocol Gaps

**Q: SSE uplink backpressure — what if client pushes faster than server processes?**
A: Server-driven backpressure. Server returns `Retry-After` header or HTTP 429 if overwhelmed. Client backs off and retries after the indicated delay.

**Q: Polling fallback — what frequency?**
A: Short polling with configurable interval, default 30 seconds. `pollingInterval: 30000` in init config.

**Q: How do client and server negotiate compression?**
A: Standard HTTP content negotiation. Client sends `Accept-Encoding: zstd, gzip`. Server compresses if supported. No custom protocol. Works with CDNs and proxies natively.

**Q: How often does the client POST its cursor to /sync/v1/ack?**
A: Whichever fires first: 30-second timer OR every 50 deltas received. Adaptive and time-bounded. Both thresholds configurable.

---

## Issue Batch 13 — Rust API Surface Gaps

**Q: What is the Broadcaster trait signature?**
```rust
trait Broadcaster: Send + Sync {
    async fn publish(&self, workspace_id: &str, delta: &Delta) -> Result<(), BroadcastError>;
    async fn subscribe(&self, workspace_id: &str) -> impl Stream<Item = Delta>;
}
```
Domain-aware (typed `Delta`, not opaque bytes). Engine handles serialization.

**Q: What do the convenience write helpers look like?**
A: Engine methods, not proc macros:
```rust
engine.insert(&pool, "tasks", json!({ "id": id, "name": name }), &ctx).await?;
engine.update(&pool, "tasks", row_id, json!({ "status": "done" }), &ctx).await?;
engine.delete(&pool, "tasks", row_id, &ctx).await?;
```
These wrap SQLx + call `record_delta()` atomically in one DB transaction.

**Q: What are the required vs optional builder methods?**
A: Only `.db(pool)` is required. All else optional with defaults:
```rust
PalladiumEngine::builder()
    .db(pool)                               // REQUIRED
    .auth(auth_config)                      // optional (default: no auth)
    .broadcaster(impl Broadcaster)          // optional (default: in-process)
    .track_clients(true)                    // optional (default: false)
    .rebootstrap_after(Duration::days(7))  // optional (default: 7 days)
    .rate_limit(RateLimitConfig { ... })   // optional (default: none)
    .build()
    .await?
```

**Q: Is PalladiumCtx available in all Axum handlers or only palladium.router() handlers?**
A: Available in ALL handlers once the engine is added as an Axum layer:
```rust
let app = Router::new()
    .merge(palladium.router())
    .route("/api/tasks", get(my_handler))   // PalladiumCtx available here too
    .layer(Extension(engine));
```

---

## Issue Batch 14 — React Adapter & Framework Gaps

**Q: Is there a useOptimisticMutation for React 18+?**
A: Yes — first-class `useOptimisticMutation()` integrates natively with React 18's `useOptimistic(startTransition)` pattern. Optimistic updates show immediately in the UI, roll back if server rejects.

**Q: What does the @palladium/svelte API look like?**
A: Composables matching the React and Vue API names for consistency:
```typescript
// @palladium/svelte
import { useLiveQuery, useMutation, useSyncStatus } from '@palladium/svelte'

const { rows, loading, error } = useLiveQuery(sql`SELECT * FROM tasks`)
const { insert, update, delete: del } = useMutation()
const { status, isOnline, pendingCount } = useSyncStatus()
```

**Q: Singleton or Provider — which should new projects use?**
A: Clear rule: singleton for single-workspace apps (the majority); Provider for multi-workspace apps or when you need to swap the db instance in tests.

**Q: Does the singleton survive HMR in development?**
A: Yes — engine stores the instance on `globalThis` in dev mode to survive HMR module re-evaluation. Standard pattern used by Prisma, tRPC, etc. Zero re-init cost on hot reload.

---

## Issue Batch 15 — CLI & Tooling Gaps

**Q: Where do generated types go and what are the filenames?**
A: Two files in a configured output directory (set in `palladium.client.ts`):
- `palladium.schema.ts` — TypeScript interfaces
- `palladium.zod.ts` — Zod schemas (same shape, runtime validators)

**Q: How does palladium dev prevent pointing at a production DB?**
A: Hard separation via environment variable. `palladium dev` reads ONLY from `PALLADIUM_DEV_DATABASE_URL` and refuses to start if it's not set. It never reads `DATABASE_URL`. Makes it impossible to accidentally connect to prod.

**Q: How does palladium inspect connect to the server?**
A: Both modes:
- `palladium inspect --db $DATABASE_URL` — queries `_sync_*` tables directly (works offline)
- `palladium inspect --server http://localhost:8080` — hits `GET /_palladium/inspect` REST endpoint (requires API key, shows live runtime state)

**Q: Where does the CLI look for palladium.config.ts?**
A: CWD by default. Override with `--config` flag:
```
palladium migrate
palladium migrate --config ./apps/server/palladium.server.ts
```

---

## Issue Batch 16 — Operational & Deployment Gaps

**Q: Which Prometheus metrics does /metrics expose?**
A: Five metrics:
- `palladium_delta_lag_seconds` (gauge) — age of oldest undelivered delta
- `palladium_connected_clients` (gauge, by `workspace_id`) — active SSE/WS connections
- `palladium_deltas_persisted_total` (counter, by `table`, `operation`) — total delta writes
- `palladium_push_duration_seconds` (histogram) — latency of client push to DB commit
- `palladium_bootstrap_duration_seconds` (histogram) — time to serve a full snapshot

**Q: What happens when a workspace is deleted?**
A: Out of scope — workspace lifecycle is the app's responsibility. App deletes workspace rows and related data. Palladium engine picks up the deletion on its next GC cycle and cleans up orphaned `_sync_*` rows.

**Q: How does a user revoke access for a specific device?**
A: Two paths matching the auth strategies:
- JWT: app revokes the token via its auth system; next `getToken()` call fails; client disconnects
- API key: `engine.revoke_client(client_id)` disconnects if active (SSE close with 401) and rejects future pushes

**Q: What is the transaction scope of the before_delta_persist hook?**
A: Purely synchronous and stateless. Hook receives only the `Delta` struct — no DB handle, no async. Can normalize fields, redact values, or return `None` to reject. No DB access from within the hook.

---

## Issue Batch 17 — Data Portability & Local-Only Upgrade

**Q: How does a local-only database get connected to a server for the first time?**
A: Server treats the first-ever push as a bootstrap upload. Client calls `db.connect(syncConfig)` which serializes the local DB as a compressed NDJSON snapshot and POSTs it to `/sync/v1/bootstrap-upload`. Server stores it, assigns `sync_id`s, and begins normal sync.

**Q: Should the engine provide a data export API?**
A: Both:
- Client: `db.export() → Promise<Blob>` — NDJSON of all local tables. Works in local-only mode.
- Server: `GET /sync/v1/export?workspace_id=X` — authenticated, complete workspace export as zstd NDJSON.

**Q: Should the engine support importing from CSV or external formats?**
A: No — out of scope. App handles its own ETL using `db.insert()`. Engine doesn't need to understand external formats. Palladium's own NDJSON export format is supported for round-trip portability only.

**Q: When a local-only app syncs for the first time, how are conflicts handled?**
A: Server is authoritative for first-sync. If the server has a row with the same ULID (collision from another device that already synced), server version wins regardless of local HLC timestamps. Clean deterministic behavior on first contact.

---

## Issue Batch 18 — Error Handling & Developer Ergonomics

**Q: Should there be a unified error taxonomy across frontend and backend?**
A: No — language-idiomatic. Frontend uses typed JS Error subclasses (`PalladiumInitError`, `PalladiumSyncError`, etc.). Backend uses Rust `thiserror` enums. Different languages, different conventions. Both documented separately.

**Q: What does failRate actually fail in createMockEngine?**
A: Both push failures AND connection establishment failures at the given rate. `failRate: 0.1` means 10% of push requests AND 10% of connection attempts fail. Tests both retry/backoff paths.

**Q: How does the app handle the tab-conflict event UX?**
A: Entirely app-defined. Engine emits the event; app shows whatever makes sense (toast, modal, redirect to a "tab conflict" page). Docs provide example implementations for common patterns.

**Q: Should the engine emit opt-in telemetry?**
A: No telemetry. Privacy-first. No data leaves the user's app. Especially important for local-first apps where privacy is a core value proposition.

---

## Issue Batch 19 — UUID v7, Idempotency & Deduplication

**Q: Is UUID v7 unique globally or just per-database?**
A: Globally unique by construction. UUID v7 is 128-bit random + time-ordered. Collision probability is negligible across multiple servers with no coordination needed. This is the standard UUID guarantee.

**Q: Who deduplicates duplicate delta deliveries — client or server?**
A: Server-side on ingestion. If a client retries a push and the same delta arrives twice, server returns `200 OK` but doesn't write a duplicate row (deduplicated by `sync_id`). Clients can safely retry push requests after network failures.

**Q: What if the client's stored last_sync_id is corrupted or ahead of server state?**
A: Server validates that the claimed `last_sync_id` exists in `_sync_deltas`. If not found, server treats the client as fresh and sends a snapshot (same path as a new device bootstrap).

**Q: How does the before_delta_persist hook transform a delta without DB access?**
A: Hook returns a modified `Delta` struct (or `None` to reject). Transformation is purely in-memory on the delta's existing fields — normalize a string, redact a column value, add a server-assigned computed field. No new columns can be injected that aren't in the delta schema.

---

## Issue Batch 20 — Concurrent Mutations & Final Gaps

**Q: Two users edit the same LWW field simultaneously. What do they each see?**
A: Optimistic + eventual consistency:
1. Each user sees their own value immediately (local optimistic write)
2. When the other's delta arrives, higher HLC timestamp wins
3. The losing client's field value reverts; `__conflict` is set on that row
4. App can react to `'conflict'` events to show resolution UI

**Q: How does @palladium/vite inject COOP/COEP headers?**
A: Two-phase:
- Dev: `configureServer` hook adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to Vite's dev server middleware
- Prod: outputs a `_headers` file in the build output (Netlify/Cloudflare Pages format) + documents manual setup for Nginx, Caddy, Apache

**Q: Should the Rust library provide a test client for server-side integration tests?**
A: No — use standard `axum::test` utilities and `httptest` to make raw HTTP requests to the Axum router. No Palladium-specific test client. Standard patterns keep the test surface minimal.

**Q: Are there any remaining significant implementation challenges or design unknowns?**
A: No — design is considered complete at this point.

---

## Final Consolidated Architecture (Post-Issue-Resolution)

### Corrected / Clarified Decisions

| Topic | Final Decision |
|---|---|
| Mixed-field merge | Independent per column: Yjs for CRDT fields, LWW-by-HLC for plain fields |
| HLC wire format | `{ "wall_time": unix_ms, "logical": N }` |
| Stale HLC on reconnect | App-configurable: `offlineHLCPolicy: 'preserve' \| 'bump'` |
| Tombstone GC client | Piggybacked on CRDT compaction job |
| Uplink backpressure | Server returns 429 + Retry-After; client backs off |
| Polling interval | Short polling, default 30s, configurable |
| Compression negotiation | Standard HTTP Accept-Encoding header |
| Ack frequency | Whichever fires first: 30s timer OR every 50 deltas |
| Broadcaster trait | Domain-typed: `publish(workspace_id, &Delta)`, `subscribe(workspace_id) → Stream<Delta>` |
| Write helper API | Engine methods (`engine.insert/update/delete`), not proc macros |
| PalladiumEngine builder | `.db(pool)` only required; all else optional with defaults |
| PalladiumCtx scope | App-wide via `app.layer(Extension(engine))` |
| React optimistic | `useOptimisticMutation()` integrates with React 18 `useOptimistic` |
| Svelte API | Same composable names as React/Vue: `useLiveQuery`, `useMutation`, `useSyncStatus` |
| Singleton + HMR | Instance stored on `globalThis` to survive HMR module re-evaluation |
| Generated files | `palladium.schema.ts` + `palladium.zod.ts` in configured output dir |
| Dev server DB safety | Reads only `PALLADIUM_DEV_DATABASE_URL`, never `DATABASE_URL` |
| palladium inspect | Both `--db` (offline) and `--server` (live) modes |
| Config discovery | CWD default + `--config` flag override |
| Prometheus metrics | 5 metrics: lag, clients, deltas_total, push_duration, bootstrap_duration |
| Workspace deletion | Out of scope; app manages; engine GCs orphaned rows |
| Session revocation | JWT: app-side; API key: `engine.revoke_client(client_id)` |
| before_delta_persist scope | Sync, stateless, sees only Delta struct, no DB access |
| Local → sync upgrade | First push = bootstrap snapshot upload; server assigns sync_ids |
| Data export | `db.export()` (client) + `GET /sync/v1/export` (server) |
| Data import | Out of scope; app uses `db.insert()` |
| First-sync conflicts | Server is authoritative on first contact |
| Error taxonomy | Language-idiomatic; no shared cross-language error codes |
| Mock failRate | Applies to both push requests AND connection establishment |
| Tab conflict UX | Entirely app-defined; engine emits event only |
| Telemetry | No telemetry; privacy-first |
| UUID v7 uniqueness | Globally unique by UUID spec; no server coordination needed |
| Delta deduplication | Server-side on ingestion; client retries are safe |
| Cursor integrity | Server validates last_sync_id; invalid cursor → fresh bootstrap |
| Delta transformation | In-memory only; returns modified Delta or None to reject |
| LWW concurrent UX | Optimistic local write → delta arrives → higher HLC wins → loser reverts with __conflict |
| COOP/COEP injection | Dev: Vite middleware; Prod: `_headers` file + platform docs |
| Server test client | Use axum::test utilities; no Palladium-specific test client |

