# ERD — Habitat ↔ Palladium Sync Integration

**Status:** Phase 0 complete (PR #33 comments addressed, commit `24811e7`) · Phase 1 pending PR #33 merge
**Owner:** Jeel Bhavsar
**Created:** 2026-07-25 · **Revised:** 2026-07-25
**PR:** [#33 — habitat on the @palladium/worker bus](https://github.com/HabitatHQ/habitathq/pull/33) (prerequisite)
**Harness:** `libs/palladium/e2e/src/__tests__/two-client-sync.test.ts`

---

## 1. Summary

Habitat persists data with **raw SQL through a bespoke worker** (`shared.dispatch`), bypassing Palladium's engine entirely. Palladium ships a real client↔server sync engine (`@palladium/core`'s `SyncTransport` + a Rust `palladium-axum` server), but **no app consumes it yet**, and its conflict layer is **unimplemented** — concurrent edits diverge permanently (finding **F1**).

Per the project's **convergence principle** (*apps adopt Palladium capabilities instead of maintaining bespoke equivalents — Palladium is the single source of truth*), Habitat converges its data layer onto the engine + `SyncTransport`, behind **Clerk**-backed profiles with a **local-first** UX, after first closing the correctness gaps that make sync unsafe.

The five moves:

1. **Route writes through the Palladium engine** (in the leader worker) → HLC stamping + change emission come free.
2. **Adopt `SyncTransport`** for uplink/downlink — no custom sync mechanism.
3. Depend on a **new column-level LWW conflict layer** built into the engine (the documented model, currently missing).
4. Use **deterministic IDs** for natural-key tables so concurrent creates converge.
5. **Gate sync behind a Clerk profile**, local-first: no auth upfront; a sign-up/sign-in prompt appears **only on sync opt-in**; all sync traffic scoped to the Clerk user.

This work sits **on top of PR #33** (the `@palladium/worker` bus migration), which rewrites the exact files involved and must land first.

### Goals

1. Correct, convergent multi-device / multi-tab sync for Habitat on the **web** (v1).
2. Zero bespoke sync/conflict code — everything reusable lands in `@palladium/core`, benefiting every suite app.
3. Local-first preserved: the app is fully usable with **no account**; sync is the only account-gated feature.
4. A cross-session design record: findings, gaps, decisions, and phase gates all traceable by ID.

### Non-goals (v1)

- **Server multi-tenancy / auth enforcement** — v1 validates the client stack against an unscoped dev server; the `ChangeStore`/auth redesign (**G5**) gates *rollout*, not the first demo.
- **Native (Capacitor) sync + native Clerk auth** — web-first; native is a follow-up.
- **CRDT / Yjs**, bootstrap snapshots, tombstones/TTL, blob sync — documented future work, not v1.

> Open items tracked in **§9**. Findings = **F#** (§3.2); gaps = **G#** (§4); decisions = **D#** (§2).

---

## 2. Key decisions (ADR-style)

> **Locked (2026-07-25):**
> **(L1)** Core-engine hardening (Phase 1) is **in scope** here — sync is unsafe without it.
> **(L2)** Tenancy **deferred** — build & validate single-user/dev sync first; the `ChangeStore`/auth redesign precedes real multi-user rollout, not the first demo.
> **(L3)** Completion state stays **row-existence + deterministic IDs + idempotent apply** for v1 — no LWW-state-column remodel.
> **(L4)** **Web-first** — Capacitor sync + native Clerk auth are a follow-up.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Write-capture = route through the engine**, not bespoke CDC triggers. | Convergence principle; engine gives HLC + `changes:local` free; `SyncTransport` works natively. |
| D2 | **Client-side LWW** — each client resolves on `applyRemote`; server stays a dumb append store for v1. | HLC is a total order → deterministic convergence with no Rust changes. Server-side resolution is a later optimization. |
| D2a | **Remote-apply must be non-poisoning** — per-op isolation (or idempotent `INSERT OR IGNORE`/upsert) + `PRAGMA defer_foreign_keys` inside the apply tx. | **G2/G3/G4**: one constraint violation must not roll back the batch or silently drop a change. Required for *any* safe sync, independent of LWW. |
| D2b | **Durable sync state** — persist `nodeId` (stable per device), poll cursor, HLC alongside the outbox. | **G6**: survive leader failover without full re-hydration or identity churn. |
| D3 | **Column-level LWW** via a `_sync_row_meta` (per-column) shadow table. | The documented model; concurrent edits to *different* columns of a row both survive. |
| D4 | **Deletes LWW'd by HLC in v1** — not escalated. | Simpler; `onRejected` + `__conflict` UI is documented future work. *(O3)* |
| D5 | **Deterministic IDs** (`uuidv5(namespace, naturalKey)`) for natural-key tables, applied **before** those tables sync. | **G3**: converts semantic duplicates into normal same-row LWW; without it natural-key tables poison the downlink. |
| D6 | **UUID PKs** (Habitat conforms); **UUIDv7** for new IDs. | Valid UUID (satisfies the server), sortable (the ULID benefit), matches `_sync_deltas.sync_id`. Avoids **F2**. |
| D7 | **Exclude `LiveQuery`**; reactivity via bus `onInvalidate`. | `LiveQuery` is `@deprecated` + same-thread + worker-incompatible. |
| D8 | **Engine runs in the leader worker**; native runs in-process. | Single-writer invariant from PR #33. |
| D9 | **No CRDT / Yjs in v1.** | Habitat data is plain structured rows; no rich-text collaboration need yet. |
| D10 | **Auth via Clerk (free tier)**, not bespoke. | Use a managed identity provider; Palladium ships no auth. |
| D11 | **Local-first: auth shown only on sync opt-in.** | Product requirement — discovery/use must not require an account. |
| D12 | **Server verifies Clerk JWT and scopes changes per user.** | Sync must not leak across accounts; needs new `palladium-axum` middleware + `user_id`/`workspace_id` scope. |

---

## 3. Current state

### 3.1 Palladium's sync engine — built vs. not

Source: `libs/palladium/STATUS.md` + direct code reading.

| Layer | Built | Detail |
|---|---|---|
| Engine (`@palladium/core`) | ✅ | `createEngine`/`PalladiumEngine` write-router over a `StorageAdapter`; `tx/insert/update/delete`, `exec(sql\`\`)`, HLC stamping (`nextSendHlc`/`receiveHlc`), emits `changes:local`, suppresses re-emit during `applyRemote`. `Hlc`, `generateUlid`, blob adapters, versioned migrations. |
| Transport (`core/src/sync.ts`) | ✅ | `SyncTransport<S>` — POSTs local changes to `/v1/changes` via a durable `_sync_pending_changes` outbox; polls `GET /v1/changes?after=<hlc-cursor>`; applies via `engine.applyRemote()`; skips its own `nodeId` after hydration. |
| Rust backend | ✅ | `palladium-axum` (generic over `ChangeStore`), SQLite/Postgres stores, blob storage, `palladium dev` CLI. Endpoints `POST/GET /v1/changes`, `/v1/health`, blobs, OpenAPI. **No auth.** |
| **Conflict resolution** | ❌ | Server stores every valid change; `applyRemote` applies unconditionally — **no per-row/column HLC guard, no LWW, no CRDT, no `onRejected`/`onStaleDelta`.** |
| **Auth / tenancy** | ❌ | No user identity; no per-user/workspace scoping. |
| **Bootstrap snapshot** | ❌ | Cold clients replay full change history. |
| **Tombstones / TTL, deterministic-ID strategy** | ❌ | — |
| **App adoption** | ❌ | No app consumes the engine/transport; every app ships its own data layer. |

### 3.2 Findings from live testing (2026-07-25)

A headless two-client harness exercises the real engine against a real `palladium dev` server (two `PalladiumEngine`+`SyncTransport` pairs, distinct `nodeId`). **insert / update / delete / bidirectional propagation all pass** with UUID PKs. Two defects:

| # | Finding | Root cause | Status |
|---|---|---|---|
| **F1** | **No LWW → permanent divergence.** Two clients editing the same row concurrently end in different states and never reconcile. | `SyncTransport.#poll` → `applyRemote()` applies remote ops with **no HLC comparison**, so a client can overwrite a causally-newer local value with an older remote one. | **Blocking correctness bug.** Held by an `it.fails` guard that flips green when fixed. Buglog `sync-no-lww`. |
| **F2** | **Server rejects non-UUID `row_id`.** A ULID (core's own `generateUlid()`, used by `example-vue`) → HTTP 422, stuck in the outbox forever. | Rust wire type is `Uuid`. | **Habitat unaffected** (uses `crypto.randomUUID()`), but a latent trap for any ULID-keyed app. Buglog `sync-uuid-rowid`. |

Two pre-existing harness bugs were fixed in passing (`test-e2e` was unrunnable against the current monorepo layout): `e2e/src/setup/server.ts` binary path (`e2e-binary-path`) and `e2e/tsconfig.json` extends path (`e2e-tsconfig-extends`).

### 3.3 Palladium's *intended* conflict model (design docs)

Source: `docs/DRAFT-ARCH.md` §"Conflict Resolution" + `answers.md` Batches 2/9/19. **None of this is implemented** — it is the design target that Phase 1 realizes (LWW only; CRDT deferred).

| Field type | Intended strategy |
|---|---|
| Plain columns (default) | **Last-Write-Wins by HLC timestamp** |
| Columns annotated `{"sync":{"crdt":"yjs"}}` | **Yjs CRDT merge** (rich text) |
| Delete vs. concurrent update | **Not** LWW'd — escalated via client `onRejected` |
| Complex / unresolvable | Row flagged `__conflict`; app resolves in UI |

- **Column-granular.** Mutations decompose into per-column deltas (`_sync_deltas(col_name, old_value, new_value, client_id, hlc_timestamp)`); LWW resolves **per column** by HLC → concurrent edits to different columns of a row both survive.
- Opt-in CRDT via SQL `COMMENT` annotations, parsed at startup.
- Hard deletes → tombstones with TTL; a client offline past TTL is force-re-bootstrapped.
- **PK gap:** docs state ULID, but `_sync_deltas.sync_id` is **UUIDv7** and the wire `row_id` is UUID. Docs handle only *accidental* ULID collision (409+retry), **not** *semantic* natural-key duplicates → drives **D5**.

### 3.4 Habitat's data architecture

| Aspect | State |
|---|---|
| Write path | **Bypasses the engine** — raw SQL (`db.exec('INSERT/UPDATE/DELETE …')`) in `db-shared.ts` (~1300 lines, 100+ typed ops), via a `DbAdapter` (`toDbAdapter` web / `toCapacitorDbAdapter` native). Uses `@palladium/core` only for `toDbAdapter`/`applySchema`/`dbg`/`IDBBlobAdapter`. **No `changes:local` emission.** |
| Schema | `db-schema.ts` — 25 tables, all `TEXT PRIMARY KEY` via `crypto.randomUUID()`. Dual source of truth: `SCHEMA_DDL` (fresh) + `migrations` map (existing), parity-guarded by `tests/unit/db-schema.test.ts`. |
| Natural-key `UNIQUE` (conflict hotspots) | `completions UNIQUE(habit_id, date)` · `checkin_entries.entry_date UNIQUE` · `checkin_completions UNIQUE(template_id, date)` · `checkin_responses UNIQUE(question_id, logged_date)`. Two devices creating the same logical row get **different UUIDs** → clash on merge. |
| Row versioning | Most tables have `created_at`; only ~4 have `updated_at`. No uniform row-version. |
| Runtime | SQLite in a Web Worker (`app/workers/database.worker.ts`) + Capacitor native (`app/lib/db-native.ts`). Reactivity = bespoke per-action refetch (no `LiveQuery`). |
| Auth | **None.** No accounts today; data is purely local. |

### 3.5 PR #33 — the prerequisite

[PR #33](https://github.com/HabitatHQ/habitathq/pull/33) *"run the database on the @palladium/worker bus"* (author: Nikhil Reddy / npalladium; branch `feat/habitat-worker-bus`) migrates Habitat's DB worker to the `@palladium/worker` ownership bus.

- **After #33:** one **leader** tab owns the OPFS DB; followers proxy; seamless failover. Worker: `startDbOwner<HabitatService>({ dbName:'habitat', methods:['ping','dispatch'], create() → { open, ping, dispatch } })`; `dispatch` still delegates to `shared.dispatch(adapter, req)`. Client: `connect<HabitatService>(worker)` → `{ service, onError, onInvalidate }`. Adds `@palladium/worker` + `comlink`; drops `@palladium/nuxt`.
- **Critical seam for sync:** the bus exposes `OwnerContext.invalidate(tables)` → fans out to **every tab's `onInvalidate`**. PR #33 defers wiring it ("Phase 2 — cross-tab live invalidation"). **Sync's downlink is a producer of exactly those invalidations** — one shared mechanism.
- **Why it lands first:** #33 rewrites `database.worker.ts` + `database.client.ts` — the exact files sync touches. Building on today's `main` targets an architecture about to disappear.

| Review comment | Resolution (commit `24811e7`) |
|---|---|
| **Major** — `NUKE_OPFS` wiped the whole origin root | **Fixed** — scoped to `/habitat` (via an `OPFS_DIR` constant). |
| Adapter close/reopen half | **Skipped with reason** — this flow never closes the adapter → turned into a `wipeFiles` follow-up. |
| **Trivial** — `as Promise<T>` casts | **Documented** as a deliberate untyped-RPC-boundary assertion. |

**Status:** comments resolved; awaiting merge by the author/user.

---

## 4. Gap analysis (robustness review, 2026-07-25)

A code-level review of the plan's load-bearing assumptions. **These gaps are why the plan changed shape from its first draft** — they move deterministic IDs earlier, split apply-hardening out, and fork tenancy into its own phase.

| # | Gap | Mechanism | Plan impact |
|---|---|---|---|
| **G1** | **Engine op model is PK-only.** | `TxBuilder`/`Op` (`core/src/tx.ts`) supports exactly `insert(full row)`, `update(id, patch)`, `delete(id)` — no upserts, no `WHERE` other than `id = ?`, no multi-row. | **~6 Habitat writes** don't fit (see below) → rewrite as **read-affected-ids-then-emit-per-id** in **Phase 2**. Changes atomicity boundaries. |
| **G2** | **`applyRemote` all-or-nothing → poison pill.** | Wraps *every* op of a poll batch in one `tx()`. One local-constraint violation throws the whole tx; the cursor is advanced **before** apply and the rejection is unhandled (`void this.#tick()`) → change **skipped forever** = silent data loss. | **Highest-severity risk.** **Phase 1a** non-poisoning apply is mandatory before any real sync. |
| **G3** | **Natural-key `UNIQUE` + toggle-by-existence makes G2 fire immediately.** | Completion toggle = SELECT → DELETE-or-INSERT with a fresh `randomUUID` (no `ON CONFLICT` anywhere). Two devices toggling the same `(habit, date)` insert **different UUIDs** → `UNIQUE` violation on merge → G2 poison. | **Deterministic IDs become a prerequisite, not final polish** → moved into **Phase 2** (`D5`). Deeper remodel (state-as-LWW-column) considered and **deferred** (`L3`/`O9`). |
| **G4** | **FK cascades + enforcement is ON.** | Browser adapter runs `PRAGMA foreign_keys = ON`; 11 `ON DELETE CASCADE`s. A cross-device **out-of-order** child insert arriving after the parent was independently deleted → FK violation → G2 poison. | **Phase 1a** needs `PRAGMA defer_foreign_keys` (or per-op isolation) in the apply tx. |
| **G5** | **Server tenancy is a redesign, not middleware.** | `ChangeStore` (`crates/palladium-core/src/store.rs`) is **globally scoped** — `insert(change)`/`list_after(after, limit)` take no user/workspace; `palladium_changes` has no tenancy column; `AppState<S>` wraps one store. | **Deferred phase** with a fork: **(a)** redesign `ChangeStore` + schema + Axum handlers + contract tests for `user_id`/`workspace_id`, or **(b)** per-user store instances + routing. Significant Rust work either way (`O1`). |
| **G6** | **Sync state non-durable across leader failover.** | `SyncTransport.#cursor` and engine `currentHlc` are in-memory. On failover a fresh engine re-hydrates from **full history** (O(history)); unless `nodeId` is persisted, own-write suppression + HLC identity churn. | **Phase 1c** persists **nodeId** (stable per device), poll cursor, HLC alongside the outbox (`D2b`). |
| **G7** | **Invalidation is table-granular.** | `ctx.invalidate(tables)` refetches whole tables in every tab on every remote change. | Acceptable for v1; a chatty multi-device session refetches broadly. |
| **G8** | **`_sync_*` internal tables land in Habitat's OPFS DB.** | Outbox, `_sync_row_meta`, etc. | Exclude from `db-schema.test.ts` parity guard; handle in EXPORT/NUKE. |

**G1 — the ~6 non-conforming writes:** `DELETE FROM completions WHERE habit_id=? AND date=?` (toggle-off) · `DELETE FROM checkin_completions WHERE template_id=? AND date=?` · `UPDATE habits SET paused_until=? WHERE archived_at IS NULL` (multi-row "pause all") · `UPDATE todos … WHERE bored_category_id IN (SELECT …)` · `DELETE FROM bored_categories WHERE is_system=0`.

> **Net effect:** Phase 1 grows from "add LWW" to "add LWW **and** make remote-apply **non-poisoning** (D2a) **and** **durable** (D2b)". Deterministic IDs move into Phase 2 (gate for natural-key tables). Server tenancy (G5) becomes its own deferred phase with an architectural fork.

---

## 5. Identity, accounts & local-first gating (Clerk)

**Sync is meaningless without a stable per-user identity** — it scopes changes and links a user's devices. Habitat has no auth today. Accounts come from **Clerk** (https://clerk.com), free tier. Clerk is an **external** dependency, not a Palladium capability — genuinely new, not a convergence target.

### 5.1 Requirements

| # | Requirement |
|---|---|
| R-A1 | **Local-first, auth-optional by default.** Fully usable offline with zero account. **No sign-up/sign-in on first launch or in the default flow.** Existing local-only users are never forced to authenticate. |
| R-A2 | **Auth gated on sync intent.** A prompt appears **only on sync opt-in** (a "Sync across devices" toggle / CTA). Discovering the app must not require an account. |
| R-A3 | **Clerk provides identity** — sign-up, sign-in, session, profile via Clerk's hosted components/SDK. |
| R-A4 | **Sync scopes to the Clerk user.** Every change is associated with the authenticated user; the server returns only that user's changes. `nodeId` = *device*; Clerk user id = *account*. |
| R-A5 | **Claim existing local data on first sign-in** — associate local rows with the new account and push them (first-sync upload), then normal bidirectional sync. |
| R-A6 | **Graceful sign-out** — stop the transport, return to local-only; local data stays. |

### 5.2 Approach

- **Client SDK:** `@clerk/vue` (or `@clerk/nuxt`) mounted **lazily** — provider/components load only when the sync flow is entered, keeping the default path free of auth UI + bundle weight.
- **Session token:** Clerk issues a short-lived JWT. `SyncTransport` attaches it as `Authorization: Bearer <jwt>` (it already supports a `fetch` override; extend to inject + refresh on 401).
- **Server verification (new `palladium-axum` work):** verify the Clerk JWT (JWKS/issuer), derive the user id, scope reads/writes to a `user_id`/`workspace_id` column. **Largest new backend requirement**; does not exist today (`D12`, `G5`).
- **Offline auth:** a cached valid session keeps the transport working offline; expired tokens pause uplink (outbox retains) until re-auth.

### 5.3 UX flow

```
Launch ─► app works fully, local-only, NO auth UI
                    │
   user opens "Sync across devices" (settings / CTA)
                    ▼
        Clerk sign-up / sign-in prompt (first time here)
                    ▼
   authenticated ─► claim local data ─► first-sync upload ─► live sync on
                    ▼
        sign out ─► transport stops ─► back to local-only (data stays)
```

---

## 6. Convergence inventory

**Principle (user directive):** when Palladium provides a capability Habitat reimplements or skips, Habitat migrates onto it. **Exception:** never migrate onto a *deprecated* Palladium API.

| Palladium capability | Habitat status | Action |
|---|---|---|
| Storage adapters, `applySchema`, `IDBBlobAdapter`, `dbg` | ✅ Used | — |
| `@palladium/worker` bus | ⏳ Arrives with PR #33 | Land #33 |
| `createEngine` / `PalladiumEngine` write-router | ❌ Bypassed (raw SQL) | **Migrate (Phase 2)** |
| `SyncTransport` + `Hlc` | ❌ Not used | **Migrate (Phase 3)** |
| `@palladium/notifications-vue` | ❌ Bespoke `useNotifications` | Follow-up PR (orthogonal) |
| `LiveQuery` / `useLiveQuery` | ❌ Bespoke refetch | **Excluded** — `@deprecated`, same-thread, can't cross the worker; forward path is bus `onInvalidate` (`D7`) |

---

## 7. Target architecture

```
        ┌──────────── Leader tab's worker (single writer) ────────────┐
 UI ─►  │  connect<HabitatService>().service.dispatch(req)            │
 (any   │        │                                                    │
 tab)   │        ▼                                                    │
        │  shared.dispatch  ──►  PalladiumEngine (engine.insert/…)    │
        │        │                    │  emits changes:local          │
        │        │                    ▼                               │
        │        │              SyncTransport ──► outbox ──► POST /v1/changes ─┐
        │        │                    ▲                               │       │
        │        │     poll GET /v1/changes?after= ◄──────────────────┼───┐   │  (Bearer: Clerk JWT)
        │        │                    │ applyRemote (+ LWW guard)      │   │   ▼
        │        ▼                    ▼                               │   └─ palladium-axum
        │   ctx.invalidate(tables) ──► every tab's onInvalidate ──► refetch  (verify JWT,
        └─────────────────────────────────────────────────────────────┘    scope by user)

 Main thread (any tab): Clerk session ──► provides JWT to the transport;
 sync UI/opt-in gated behind Clerk auth (shown only on sync intent).
```

- **Engine + `SyncTransport` live in the leader worker only** (single writer ⇔ single OPFS connection). Followers keep proxying via the bus.
- Local write → engine → `changes:local` → outbox → POST (with Clerk bearer token).
- Downlink poll → `applyRemote` (with the new LWW guard) → `ctx.invalidate(affectedTables)` → all tabs refetch. Also delivers PR #33's deferred cross-tab-live reactivity.
- **Native (Capacitor):** same engine + transport over the capacitor adapter, no leader election. *(Deferred, `L4`.)*
- **Token plumbing:** Clerk session on the main thread; transport in the worker → JWT must be passed in (and refreshed) via a small main→worker channel / token-provider callback (`O6`).

---

## 8. Implementation plan

Each phase is independently verifiable. Phase 1 lands in `@palladium/core` and benefits every future app.

| Phase | Goal | Layer | Status |
|---|---|---|---|
| **0** | Unblock PR #33 (scope NUKE_OPFS; document casts) | Habitat worker | ✅ **Done** (`24811e7`) |
| **1** | Harden the engine's sync core | `@palladium/core` | Pending #33 merge |
| **2** | Route Habitat writes through the engine | Habitat `db-shared` | — |
| **3** | Wire `SyncTransport` vs. single-user dev server | Habitat worker | ⭐ first working demo |
| **4** | Clerk accounts + local-first gating | Habitat client | — |
| **5** | Verification (web, single-user) | — | — |
| **Deferred** | Server tenancy + auth, native, bootstrap | `palladium-axum` | gates multi-user rollout |

### Phase 0 — Unblock PR #33 ✅ done (`24811e7`)

- **NUKE_OPFS scoped** to `/habitat` (via `OPFS_DIR`); stops origin-root iteration that would wipe sibling apps.
- **RPC `as Promise<T>` casts documented** in `database.client.ts`.
- **Adapter close/reopen: intentionally skipped** — this flow never closes the adapter, so `dispatch` never runs on a closed one. A true in-place wipe (reclaiming open SAH-pool handles) needs adapter-level `wipeFiles`; naive close→delete→reopen against the SAH pool is unsafe → **follow-up.**
- **Verified:** habitat `tsgo --noEmit` ✓, `biome check` ✓, lefthook pre-commit ✓, commit-msg ✓, pre-push `lint:deps` ✓. *(Real-browser two-tab smoke not run headlessly — recommend a manual pass.)*
- **Pushed** to `feat/habitat-worker-bus`; **merge is the author's/user's** to do. Phase 1 branches from post-merge `main`.

### Phase 1 — Harden the engine's sync core (`@palladium/core`)

Three coupled, engine-level pieces:

- **1a — Non-poisoning remote apply (G2/G4, `D2a`).** Rework `applyRemote` + `SyncTransport.#poll`: per-op isolation (or idempotent `INSERT OR IGNORE`/upsert) + `PRAGMA defer_foreign_keys` in the apply tx; advance the cursor **only** for changes that applied; surface failures.
- **1b — Column-level LWW by HLC (F1, `D3`).** `_sync_row_meta` shadow table; drop remote ops whose HLC ≤ stored; per-column granularity.
- **1c — Durable sync state (G6, `D2b`).** Persist `nodeId`, poll cursor, HLC.
- **Verify:** the `it.fails` guard in `two-client-sync.test.ts` flips to a passing `it`; add convergence + constraint-violation-does-not-poison + failover-resumes-from-cursor tests. **No Rust changes.**

### Phase 2 — Route Habitat writes through the engine

- In the leader worker's `create()`, build `createEngine(storage, { nodeId })` + `engine.init(SCHEMA_CONFIG)`.
- Migrate `db-shared.ts` **writes** from raw `db.exec` to `engine.insert/update/delete/tx`. Reads may stay on `engine.exec(sql\`\`)`.
- **Rewrite the ~6 non-id-keyed writes (G1)** as read-affected-ids-then-emit; wrap multi-exec operations (e.g. `createHabit` = habit + schedule) in one `engine.tx()` → one atomic, one-Change unit.
- **Apply deterministic IDs to natural-key tables here (G3, `D5`)** — `completions`, `checkin_entries`, `checkin_completions`, `checkin_responses` — *before* they're sync-eligible. Includes a data migration for existing rows (`O4`).
- Keep the `HabitatService.dispatch` surface unchanged. Land incrementally by table group.
- **Verify:** `apps/habitat/tests/unit/*` (incl. `db-schema.test.ts` parity, updated to ignore `_sync_*` — G8) green after each group; app smoke.

### Phase 3 — Wire `SyncTransport` vs. a single-user dev server ⭐ first working demo

- Instantiate `SyncTransport(engine, { serverUrl, pollIntervalMs })` in the leader worker; start after `open()`. On downlink apply → `ctx.invalidate(affectedTables)` → all tabs refetch (delivers PR #33's deferred cross-tab reactivity).
- Run against an **unscoped `palladium dev` server** — no auth, one logical user. Validates the whole client stack (engine → outbox → POST → poll → apply → invalidate → refetch) before any auth/tenancy work.
- **Verify:** extend the harness to Habitat's schema; two-tab + two-device (same user) browser check; constraint-violation / failover scenarios pass without poisoning.

### Phase 4 — Clerk accounts + local-first gating (client)

- Integrate `@clerk/vue`/`@clerk/nuxt`, lazily mounted. Add the "Sync across devices" opt-in; **no auth UI in the default flow.**
- Sign-in/up only on sync intent; persist a stable `nodeId` + the Clerk user association; attach the JWT to transport requests (main→worker token channel, `O6`). The dev server may ignore the token here — enforcement lands with tenancy (deferred).
- **Claim local data on first sign-in** (R-A5): first-sync upload.
- **Verify:** default flow shows no auth; opt-in shows Clerk; sign-out → local-only (data stays). Bundle check that Clerk isn't on the default path.

### Phase 5 — Verification (web, single-user)

- Full harness pass; two-tab / two-device (same user) browser matrix on web. Feature-flag sync; internal dogfood.

### Deferred (gates real multi-user rollout — out of v1 scope)

- **Server tenancy + auth (G5, O1):** fork **(a)** `user_id`/`workspace_id` in `ChangeStore` + schema + Axum + contract tests, or **(b)** per-user store instances + routing; add **Clerk JWT verification** in `palladium-axum`; two-user isolation test. **No real multi-user rollout until this lands.**
- **Native (Capacitor)** sync + native Clerk auth.
- Bootstrap snapshot endpoint; tombstones/TTL; `onRejected`/`onStaleDelta`.

### Follow-ups (separate PRs, orthogonal)

- **Add `wipeFiles()` to `@palladium/sqlite-browser`** + use it for a real in-place OPFS wipe — completes the NUKE_OPFS behaviour Phase 0 deferred.
- **Fix the repo-wide NUKE_OPFS bug** in `hearth`/`halcyon`/`hephaestus` (same unscoped origin-root deletion habitat had).
- Migrate `useNotifications` → `@palladium/notifications-vue`.
- Optional annotation-driven CRDT (Yjs) for future rich-text fields.
- Roll engine+transport+auth convergence to hearth / halcyon / hephaestus (Clerk identity likely shared suite-wide — `O7`).

---

## 9. Risks & open questions

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `db-shared.ts` refactor scope (100+ ops, ~6 non-id writes needing read-then-emit, G1). | Land per table group behind the unchanged `dispatch` surface; unit tests green each step. |
| R2 | Engine-in-a-worker is unproven in this repo. | Phase 1 hardens the engine first; native path is a simpler fallback. |
| R3 | Cold-start replays full history (no bootstrap) — large for a multi-year tracker. | Acceptable early; follow-up bootstrap endpoint. |
| R4 | **Remote-apply poison pill (G2/G3/G4)** — highest-severity; a single constraint violation silently drops changes. | Phase 1a mandatory before enabling any real sync. |
| R5 | Merge conflicts with PR #33. | Land #33 first; branch later phases from post-#33 `main`. |
| R6 | Server tenancy is a trait/schema redesign (G5), not middleware. | Single-user/dev sync validates the client stack first; no rollout without it. |
| R7 | Clerk free-tier limits (MAU cap ~10k — verify) + native auth differs from web. | Verify both fit before native. |
| R8 | Effort/altitude — a multi-PR, cross-stack (TS engine + Vue app + Rust server + external auth) programme. | Scope and sequencing explicitly agreed; phase gates. |

### Open questions

| # | Question | State |
|---|---|---|
| O1 | Tenancy model & deployment (G5): multi-tenant single store vs. per-user instances + routing? Where does `palladium-axum` run in prod? Scope per-user or per-household? | **v1 deferred** (dev/single-user first); open for rollout. |
| O2 | `nodeId` lifecycle — how assigned/persisted per device; reset on reinstall? (Also required for failover durability, G6.) | Open. |
| O3 | Delete semantics — LWW deletes (D4) vs. escalation for v1? | Open. |
| O4 | Existing-data migration for deterministic IDs (Phase 2): backfill + FK cascade; reconcile rows already divergent across devices. | Open. |
| O5 | Clerk ↔ Rust verification — JWKS/issuer/audience; Clerk user id → change-store scope. | Open. |
| O6 | Token plumbing to the worker — main-thread Clerk session → leader worker transport; refresh + 401 + leadership handoff. | Open. |
| O7 | Account scope across the suite — one Clerk identity across habitat/hearth/halcyon/hephaestus, or per-app? | Open. |
| O8 | Blob sync — `IDBBlobAdapter` binary (jots voice/image) via `/v1/blobs`, or out of scope for v1? | Open. |
| ~~O9~~ | ~~Completion/checkin data model.~~ | **Resolved** — keep state-as-row-existence + deterministic IDs + idempotent apply for v1 (`L3`). |
| ~~O10~~ | ~~Core-engine hardening ownership.~~ | **Resolved** — in scope here as Phase 1 (`L1`). |

---

## 10. References

- **Findings & harness:** `libs/palladium/e2e/src/__tests__/two-client-sync.test.ts`; buglog ids `sync-no-lww`, `sync-uuid-rowid`, `e2e-binary-path`, `e2e-tsconfig-extends` in `.wolf/buglog.json`.
- **Palladium status:** `libs/palladium/STATUS.md`.
- **Intended design:** `libs/palladium/docs/DRAFT-ARCH.md`, `libs/palladium/docs/answers.md`.
- **Worker bus:** `libs/palladium/docs/plans/worker-bus-spike.md`; `libs/palladium/worker/src/{db-owner,client}.ts`.
- **Sync engine:** `libs/palladium/core/src/{sync,engine,hlc,tx}.ts`.
- **Habitat data layer:** `apps/habitat/app/lib/{db-shared,db-schema}.ts`, `apps/habitat/app/workers/database.worker.ts`, `apps/habitat/app/plugins/database.client.ts`, `apps/habitat/app/lib/db-native.ts`.
- **Clerk:** https://clerk.com · `@clerk/vue` / `@clerk/nuxt`.
- **PR #33:** https://github.com/HabitatHQ/habitathq/pull/33
