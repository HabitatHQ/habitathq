# ERD — Habitat ↔ Palladium Sync Integration

**Status:** Phase 0 complete; PR #33 **merged** (`74e11bf`) · Phase 1 next · **multi-tenancy (family workspaces) now baked in from the start** (amendment 2026-07-25)
**Owner:** Jeel Bhavsar
**Created:** 2026-07-25 · **Revised:** 2026-07-25
**PR:** [#33 — habitat on the @palladium/worker bus](https://github.com/HabitatHQ/habitathq/pull/33) (prerequisite, merged) · [#35 — this ERD](https://github.com/HabitatHQ/habitathq/pull/35)
**Harness:** `libs/palladium/e2e/src/__tests__/two-client-sync.test.ts`

---

## 1. Summary

Habitat persists data with **raw SQL through a bespoke worker** (`shared.dispatch`), bypassing Palladium's engine entirely. Palladium ships a real client↔server sync engine (`@palladium/core`'s `SyncTransport` + a Rust `palladium-axum` server), but **no app consumes it yet**, and its conflict layer is **unimplemented** — concurrent edits diverge permanently (finding **F1**).

Per the project's **convergence principle** (*apps adopt Palladium capabilities instead of maintaining bespoke equivalents — Palladium is the single source of truth*), Habitat converges its data layer onto the engine + `SyncTransport`, behind **Clerk**-backed, **workspace-scoped** profiles (multi-member **family sharing**) with a **local-first** UX, after first closing the correctness gaps that make sync unsafe.

The six moves:

1. **Route writes through the Palladium engine** (in the leader worker) → HLC stamping + change emission come free.
2. **Adopt `SyncTransport`** for uplink/downlink — no custom sync mechanism.
3. Depend on a **new column-level LWW conflict layer** built into the engine (the documented model, currently missing).
4. Use **deterministic IDs** for natural-key tables (unique **per workspace**) so concurrent creates converge.
5. **Scope all sync to a workspace — multi-tenant from day one.** A workspace is a **family/household of one or more members**. The server (`ChangeStore` + `palladium_changes`) carries `workspace_id`; `palladium-axum` verifies a **Clerk** JWT, resolves the caller's workspace membership, and scopes every change to it. No unscoped single-user dev-server stage.
6. **Gate behind Clerk, local-first:** no auth upfront; the sign-up/sign-in (and create-or-join-family) prompt appears **only on sync opt-in**. The app is fully usable with no account.

This work sits **on top of PR #33** (the `@palladium/worker` bus migration, now merged as `74e11bf`), which rewrote the exact files involved.

### Goals

1. Correct, convergent multi-device / multi-tab sync for Habitat on the **web** (v1).
2. **Multi-tenant family sharing from day one** — multiple members of a household sync a shared workspace, with membership + roles, isolated from every other workspace.
3. Zero bespoke sync/conflict code — everything reusable lands in `@palladium/core` / `palladium-axum`, benefiting every suite app.
4. Local-first preserved: the app is fully usable with **no account**; sync is the only account-gated feature.
5. A cross-session design record: findings, gaps, decisions, and phase gates all traceable by ID.

### Non-goals (v1)

- **Fine-grained per-record sharing / permissions** — a workspace shares its **full** dataset among members; "this habit is private within the family" and rich role permissions are future work. v1 roles are coarse (owner / member). *(O11.)*
- **Native (Capacitor) sync + native Clerk auth** — web-first; native is a follow-up.
- **CRDT / Yjs**, bootstrap snapshots, tombstones/TTL, blob sync — documented future work, not v1.

> Open items tracked in **§9**. Findings = **F#** (§3.2); gaps = **G#** (§4); decisions = **D#** (§2).

---

## 2. Key decisions (ADR-style)

> **Locked (2026-07-25):**
> **(L1)** Core-engine hardening (Phase 1) is **in scope** here — sync is unsafe without it.
> **(L2)** **Multi-tenancy is foundational** *(amended 2026-07-25)* — the server is **workspace-scoped** (family/household, multi-member) with **Clerk-backed auth** from day one. No unscoped single-user dev-server stage; tenancy is on the v1 critical path (Phase 3).
> **(L3)** Completion state stays **row-existence + deterministic IDs + idempotent apply** for v1 — no LWW-state-column remodel.
> **(L4)** **Web-first** — Capacitor sync + native Clerk auth are a follow-up.
> **(L5)** *(amended 2026-07-25)* **Workspace = tenant**, family sharing is real from v1: memberships + coarse roles (owner/member); a user may belong to several workspaces. Prefer **workspace ↔ Clerk Organization** (D13). Tenancy dimension lives in the `ChangeStore` trait + `palladium_changes` schema (D14).

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Write-capture = route through the engine**, not bespoke CDC triggers. | Convergence principle; engine gives HLC + `changes:local` free; `SyncTransport` works natively. |
| D2 | **Client-side LWW** — each client resolves on `applyRemote`. | HLC is a total order → deterministic convergence. The server does **no** conflict resolution; its only server-side logic is Clerk-auth + workspace scoping (D12–D14). Server-side resolution is a later optimization. |
| D2a | **Remote-apply must be non-poisoning** — per-op isolation (or idempotent `INSERT OR IGNORE`/upsert) + `PRAGMA defer_foreign_keys` inside the apply tx. | **G2/G3/G4**: one constraint violation must not roll back the batch or silently drop a change. Required for *any* safe sync, independent of LWW. |
| D2b | **Durable sync state** — persist `nodeId` (stable per device), poll cursor, HLC alongside the outbox. | **G6**: survive leader failover without full re-hydration or identity churn. |
| D3 | **Column-level LWW** via a `_sync_row_meta` (per-column) shadow table. | The documented model; concurrent edits to *different* columns of a row both survive. |
| D4 | **Deletes LWW'd by HLC in v1** — not escalated. | Simpler; `onRejected` + `__conflict` UI is documented future work. *(O3)* |
| D5 | **Deterministic IDs** (`uuidv5(namespace, naturalKey)`) for natural-key tables, applied **before** those tables sync; the namespace is **workspace-scoped**. | **G3**: converts semantic duplicates into normal same-row LWW; without it natural-key tables poison the downlink. Two family members toggling the same `(habit, date)` now converge to one row. |
| D6 | **UUID PKs** (Habitat conforms); **UUIDv7** for new IDs. | Valid UUID (satisfies the server), sortable (the ULID benefit), matches `_sync_deltas.sync_id`. Avoids **F2**. |
| D7 | **Exclude `LiveQuery`**; reactivity via bus `onInvalidate`. | `LiveQuery` is `@deprecated` + same-thread + worker-incompatible. |
| D8 | **Engine runs in the leader worker**; native runs in-process. | Single-writer invariant from PR #33. |
| D9 | **No CRDT / Yjs in v1.** | Habitat data is plain structured rows; no rich-text collaboration need yet. |
| D10 | **Auth via Clerk (free tier)**, not bespoke. | Use a managed identity provider; Palladium ships no auth. |
| D11 | **Local-first: auth shown only on sync opt-in.** | Product requirement — discovery/use must not require an account. |
| D12 | **Server verifies the Clerk JWT and scopes every change to a workspace** — foundational, not deferred (`L2`). | Sync must not leak across families/accounts; needs new `palladium-axum` auth middleware + workspace scoping. On the v1 critical path (Phase 3). |
| D13 | **Workspace = tenant; family sharing via memberships + coarse roles**, from v1. Prefer **workspace ↔ Clerk Organization** so membership / invites / roles come from Clerk. | User directive: families share data. Managed membership (Clerk Orgs) over bespoke, extending D10; a user may belong to several workspaces. *(Free-tier org limits — R7; O13.)* |
| D14 | **Tenancy dimension lives in the `ChangeStore` trait + `palladium_changes` schema** (single multi-tenant store), scoped by `workspace_id`. | Chosen fork for **G5**: one logical store, `WHERE workspace_id = ?` — single source of truth, matches the design docs' `_sync_deltas.workspace_id`. Not per-tenant store instances. |

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

A code-level review of the plan's load-bearing assumptions. **These gaps are why the plan changed shape from its first draft** — they move deterministic IDs earlier, split apply-hardening out, and (post-amendment) make tenancy a foundational v1 phase.

| # | Gap | Mechanism | Plan impact |
|---|---|---|---|
| **G1** | **Engine op model is PK-only.** | `TxBuilder`/`Op` (`core/src/tx.ts`) supports exactly `insert(full row)`, `update(id, patch)`, `delete(id)` — no upserts, no `WHERE` other than `id = ?`, no multi-row. | **~6 Habitat writes** don't fit (see below) → rewrite as **read-affected-ids-then-emit-per-id** in **Phase 2**. Changes atomicity boundaries. |
| **G2** | **`applyRemote` all-or-nothing → poison pill.** | Wraps *every* op of a poll batch in one `tx()`. One local-constraint violation throws the whole tx; the cursor is advanced **before** apply and the rejection is unhandled (`void this.#tick()`) → change **skipped forever** = silent data loss. | **Highest-severity risk.** **Phase 1a** non-poisoning apply is mandatory before any real sync. |
| **G3** | **Natural-key `UNIQUE` + toggle-by-existence makes G2 fire immediately.** | Completion toggle = SELECT → DELETE-or-INSERT with a fresh `randomUUID` (no `ON CONFLICT` anywhere). Two devices toggling the same `(habit, date)` insert **different UUIDs** → `UNIQUE` violation on merge → G2 poison. | **Deterministic IDs become a prerequisite, not final polish** → moved into **Phase 2** (`D5`). Deeper remodel (state-as-LWW-column) considered and **deferred** (`L3`/`O9`). |
| **G4** | **FK cascades + enforcement is ON.** | Browser adapter runs `PRAGMA foreign_keys = ON`; 11 `ON DELETE CASCADE`s. A cross-device **out-of-order** child insert arriving after the parent was independently deleted → FK violation → G2 poison. | **Phase 1a** needs `PRAGMA defer_foreign_keys` (or per-op isolation) in the apply tx. |
| **G5** | **Server tenancy is a redesign, not middleware.** | `ChangeStore` (`crates/palladium-core/src/store.rs`) is **globally scoped** — `insert(change)`/`list_after(after, limit)` take no user/workspace; `palladium_changes` has no tenancy column; `AppState<S>` wraps one store. | **Foundational (Phase 3), not deferred** (`L2` amended). Fork **resolved → (a)**: add `workspace_id` to the `ChangeStore` trait + `palladium_changes` schema + Axum handlers + contract tests (`D14`). Significant Rust work, now on the v1 critical path. |
| **G6** | **Sync state non-durable across leader failover.** | `SyncTransport.#cursor` and engine `currentHlc` are in-memory. On failover a fresh engine re-hydrates from **full history** (O(history)); unless `nodeId` is persisted, own-write suppression + HLC identity churn. | **Phase 1c** persists **nodeId** (stable per device), poll cursor, HLC alongside the outbox (`D2b`). |
| **G7** | **Invalidation is table-granular.** | `ctx.invalidate(tables)` refetches whole tables in every tab on every remote change. | Acceptable for v1; a chatty multi-device session refetches broadly. |
| **G8** | **`_sync_*` internal tables land in Habitat's OPFS DB.** | Outbox, `_sync_row_meta`, etc. | Exclude from `db-schema.test.ts` parity guard; handle in EXPORT/NUKE. |

**G1 — the ~6 non-conforming writes:** `DELETE FROM completions WHERE habit_id=? AND date=?` (toggle-off) · `DELETE FROM checkin_completions WHERE template_id=? AND date=?` · `UPDATE habits SET paused_until=? WHERE archived_at IS NULL` (multi-row "pause all") · `UPDATE todos … WHERE bored_category_id IN (SELECT …)` · `DELETE FROM bored_categories WHERE is_system=0`.

> **Net effect:** Phase 1 grows from "add LWW" to "add LWW **and** make remote-apply **non-poisoning** (D2a) **and** **durable** (D2b)". Deterministic IDs move into Phase 2 (gate for natural-key tables). **Server tenancy (G5) is now a foundational v1 phase (Phase 3)** — `workspace_id` in the `ChangeStore` trait + Clerk auth — not a deferred one.

---

## 5. Identity, workspaces & local-first gating (Clerk)

**Sync is meaningless without a stable identity, and family sharing is meaningless without a shared tenant.** Habitat has no auth today. Identity comes from **Clerk** (https://clerk.com, free tier); the **tenant is a workspace** — a family/household of one or more members. Clerk is an **external** dependency, not a Palladium capability — genuinely new, not a convergence target.

**Model:** `Clerk user` = a person (may own several devices, may belong to several workspaces) · `workspace` = the sync tenant (all `palladium_changes` carry its `workspace_id`) · `membership` = (workspace, user, role) · `nodeId` = a device. Every change is scoped to **one workspace**; the server returns only that workspace's changes to a member.

### 5.1 Requirements

| # | Requirement |
|---|---|
| R-A1 | **Local-first, auth-optional by default.** Fully usable offline with zero account. **No sign-up/sign-in on first launch or in the default flow.** Existing local-only users are never forced to authenticate. |
| R-A2 | **Auth gated on sync intent.** A prompt appears **only on sync opt-in** (a "Sync across devices" toggle / CTA). Discovering the app must not require an account. |
| R-A3 | **Clerk provides identity** — sign-up, sign-in, session, profile via Clerk's hosted components/SDK. |
| R-A4 | **Sync scopes to a workspace.** Every change carries `workspace_id`; the server returns only the caller's workspace's changes, and only to verified members. `nodeId` = *device*; Clerk user = *person*; workspace = *tenant*. |
| R-A5 | **Claim existing local data on first sync** — associate local rows with the **workspace the user creates or joins** and push them (first-sync upload), then normal bidirectional sync. |
| R-A6 | **Graceful sign-out** — stop the transport, return to local-only; local data stays on the device. |
| R-A7 | **Create or join a family.** On first sync a user either **creates** a new workspace (becomes owner) or **joins** an existing one via invite. |
| R-A8 | **Invite members.** An owner can invite others to the workspace (email/link); an invitee joins and their devices sync the shared data. |
| R-A9 | **Coarse roles (v1): owner / member.** Owner manages membership + invites; both roles read+write all workspace data. Fine-grained per-record permissions are out of scope (`O11`). |
| R-A10 | **Multi-workspace + switch.** A user may belong to several workspaces (e.g. personal + family) and switch the active one; the transport re-scopes to the active `workspace_id`. *(Lifecycle — O12.)* |

### 5.2 Approach

- **Client SDK:** `@clerk/vue` (or `@clerk/nuxt`) mounted **lazily** — provider/components load only when the sync flow is entered, keeping the default path free of auth UI + bundle weight.
- **Membership via Clerk Organizations (preferred, D13):** map **workspace ↔ Clerk Organization** so memberships, invites, and roles come from Clerk's managed org features rather than a bespoke table. The Clerk **org id becomes the `workspace_id`**. *(Verify free-tier org / seat limits — R7, O13; fallback is bespoke `workspaces`/`memberships` tables if limits bite.)*
- **Session token:** Clerk issues a short-lived JWT carrying the **active org (workspace) claim**. `SyncTransport` attaches it as `Authorization: Bearer <jwt>` (it already supports a `fetch` override; extend to inject + refresh on 401).
- **Server verification (new `palladium-axum` work, largest backend requirement):** verify the Clerk JWT (JWKS/issuer/audience), derive the user **and the active workspace (org) claim**, confirm membership, then scope every read/write to that `workspace_id` in the `ChangeStore` (`D12`/`D14`, `G5`). Does not exist today.
- **Offline auth:** a cached valid session keeps the transport working offline; expired tokens pause uplink (outbox retains) until re-auth.

### 5.3 UX flow

```
Launch ─► app works fully, local-only, NO auth UI
                    │
   user opens "Sync across devices" (settings / CTA)
                    ▼
        Clerk sign-up / sign-in prompt (first time here)
                    ▼
     ┌── create a family (become owner) ──┐   or   ┌── join via invite ──┐
     ▼                                    ▼        ▼                     ▼
   new workspace_id                    accept invite → existing workspace_id
                    ▼
   claim local data into workspace ─► first-sync upload ─► live sync on
   (shared with every member of the workspace)
                    ▼
        sign out ─► transport stops ─► back to local-only (data stays)
```

> The workspace is chosen **after** sign-in and **before** the first upload — it decides which family the local data is claimed into (`R-A5`/`O12`). An owner can later invite members (`R-A8`); a user in several workspaces switches the active one (`R-A10`).

---

## 6. Convergence inventory

**Principle (user directive):** when Palladium provides a capability Habitat reimplements or skips, Habitat migrates onto it. **Exception:** never migrate onto a *deprecated* Palladium API.

| Palladium capability | Habitat status | Action |
|---|---|---|
| Storage adapters, `applySchema`, `IDBBlobAdapter`, `dbg` | ✅ Used | — |
| `@palladium/worker` bus | ✅ Landed (PR #33, `74e11bf`) | — |
| `createEngine` / `PalladiumEngine` write-router | ❌ Bypassed (raw SQL) | **Migrate (Phase 2)** |
| `SyncTransport` + `Hlc` | ❌ Not used | **Migrate (Phase 5)** |
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
        └─────────────────────────────────────────────────────────────┘    resolve workspace,
                                                                            scope by workspace_id)

 Main thread (any tab): Clerk session (active org = workspace) ──► provides JWT to the transport;
 sync UI/opt-in + create-or-join-family gated behind Clerk auth (shown only on sync intent).
```

- **Engine + `SyncTransport` live in the leader worker only** (single writer ⇔ single OPFS connection). Followers keep proxying via the bus.
- Local write → engine → `changes:local` → outbox → POST (Clerk bearer JWT carrying the active workspace).
- Downlink poll → `applyRemote` (with the new LWW guard) → `ctx.invalidate(affectedTables)` → all tabs refetch. Also delivers PR #33's deferred cross-tab-live reactivity.
- **Server** verifies the JWT, resolves the caller's **workspace (org) membership**, and scopes every read/write to that `workspace_id` — a member sees only their workspace's changes.
- **Native (Capacitor):** same engine + transport over the capacitor adapter, no leader election. *(Deferred, `L4`.)*
- **Token plumbing:** Clerk session on the main thread; transport in the worker → JWT (+ active `workspace_id`) must be passed in and refreshed via a small main→worker channel / token-provider callback; a workspace switch re-scopes the transport (`O6`).

---

## 8. Implementation plan

Each phase is independently verifiable. Phase 1 lands in `@palladium/core` and benefits every future app. **Multi-tenancy (Phase 3) is now foundational, not deferred** (`L2` amended) — so the "first working demo" (Phase 5) is workspace-scoped and authenticated, not a single-user dev server. Phases 1–2 (client engine) and Phase 3 (Rust server) are largely **parallelizable**; Phase 5 depends on both.

| Phase | Goal | Layer | Status |
|---|---|---|---|
| **0** | Unblock PR #33 (scope NUKE_OPFS; document casts) | Habitat worker | ✅ **Done** (`24811e7`; PR #33 merged `74e11bf`) |
| **1** | Harden the engine's sync core | `@palladium/core` | Next |
| **2** | Route Habitat writes through the engine + deterministic IDs | Habitat `db-shared` | — |
| **3** | **Server tenancy + Clerk auth** (workspace-scoped) | `palladium-axum` + crates | — (v1 critical path) |
| **4** | Clerk accounts + **family/workspace model** + local-first gating | Habitat client | — |
| **5** | Wire `SyncTransport` vs. the **multi-tenant** server | Habitat worker | ⭐ first working demo |
| **6** | Verification (web, multi-user, multi-workspace) | — | — |
| **Deferred** | Native (Capacitor), bootstrap snapshot, tombstones/TTL | — | post-v1 |

### Phase 0 — Unblock PR #33 ✅ done (`24811e7`)

- **NUKE_OPFS scoped** to `/habitat` (via `OPFS_DIR`); stops origin-root iteration that would wipe sibling apps.
- **RPC `as Promise<T>` casts documented** in `database.client.ts`.
- **Adapter close/reopen: intentionally skipped** — this flow never closes the adapter, so `dispatch` never runs on a closed one. A true in-place wipe (reclaiming open SAH-pool handles) needs adapter-level `wipeFiles`; naive close→delete→reopen against the SAH pool is unsafe → **follow-up.**
- **Verified:** habitat `tsgo --noEmit` ✓, `biome check` ✓, lefthook pre-commit ✓, commit-msg ✓, pre-push `lint:deps` ✓. *(Real-browser two-tab smoke not run headlessly — recommend a manual pass.)*
- **Merged** into `main` as `74e11bf` (PR #33). Phase 1 branches from current `main`.

### Phase 1 — Harden the engine's sync core (`@palladium/core`)

Three coupled, engine-level pieces:

- **1a — Non-poisoning remote apply (G2/G4, `D2a`).** Rework `applyRemote` + `SyncTransport.#poll`: per-op isolation (or idempotent `INSERT OR IGNORE`/upsert) + `PRAGMA defer_foreign_keys` in the apply tx; advance the cursor **only** for changes that applied; surface failures.
- **1b — Column-level LWW by HLC (F1, `D3`).** `_sync_row_meta` shadow table; drop remote ops whose HLC ≤ stored; per-column granularity.
- **1c — Durable sync state (G6, `D2b`).** Persist `nodeId`, poll cursor, HLC.
- **Verify:** the `it.fails` guard in `two-client-sync.test.ts` flips to a passing `it`; add convergence + constraint-violation-does-not-poison + failover-resumes-from-cursor tests. **No Rust changes.**

### Phase 2 — Route Habitat writes through the engine + deterministic IDs

- In the leader worker's `create()`, build `createEngine(storage, { nodeId })` + `engine.init(SCHEMA_CONFIG)`.
- Migrate `db-shared.ts` **writes** from raw `db.exec` to `engine.insert/update/delete/tx`. Reads may stay on `engine.exec(sql\`\`)`.
- **Rewrite the ~6 non-id-keyed writes (G1)** as read-affected-ids-then-emit; wrap multi-exec operations (e.g. `createHabit` = habit + schedule) in one `engine.tx()` → one atomic, one-Change unit.
- **Apply deterministic IDs to natural-key tables here (G3, `D5`)** — `completions`, `checkin_entries`, `checkin_completions`, `checkin_responses` — *before* they're sync-eligible. Namespace is **workspace-scoped** so two family members converge to one row. Includes a data migration for existing rows (`O4`).
- Keep the `HabitatService.dispatch` surface unchanged. Land incrementally by table group.
- **Verify:** `apps/habitat/tests/unit/*` (incl. `db-schema.test.ts` parity, updated to ignore `_sync_*` — G8) green after each group; app smoke. *(Client-only; parallelizable with Phase 3.)*

### Phase 3 — Server tenancy + Clerk auth (workspace-scoped) — foundational

The multi-tenant backend, built **from the start** (`L2` amended, `G5`, `D12`/`D14`). Rust work on `palladium-axum` + `palladium-core` crates; parallelizable with Phases 1–2.

- **Tenancy in the store (`D14`):** add a workspace scope to the `ChangeStore` trait (`insert(scope, change)` / `list_after(scope, after, limit)`) + a `workspace_id` column on `palladium_changes` (indexed) + updated Axum handlers + contract tests. One logical multi-tenant store, `WHERE workspace_id = ?`.
- **Clerk JWT verification (`D12`, `O5`):** verify the token (JWKS/issuer/audience), derive the user + **active workspace (org) claim**, confirm membership, reject otherwise (401/403).
- **Membership (`D13`, `O13`):** map **workspace ↔ Clerk Organization** (memberships/invites/roles from Clerk). Fallback: bespoke `workspaces`/`memberships` tables if free-tier org limits bite (`R7`).
- **Verify:** **two-workspace isolation test** — member of A never receives B's changes; a non-member is rejected. Contract tests for the scoped store.

### Phase 4 — Clerk accounts + family/workspace model + local-first gating (client)

- Integrate `@clerk/vue`/`@clerk/nuxt`, lazily mounted. Add the "Sync across devices" opt-in; **no auth UI in the default flow** (`R-A1`/`R-A2`).
- Sign-in/up only on sync intent; then **create a family (become owner) or join via invite** (`R-A7`); **invite members** (`R-A8`); coarse **owner/member** roles (`R-A9`); **workspace switcher** for multi-workspace users (`R-A10`).
- Persist a stable `nodeId` per device; attach the JWT **+ active `workspace_id`** to transport requests (main→worker token channel, `O6`); a switch re-scopes the transport.
- **Claim local data into the chosen workspace on first sync** (`R-A5`): first-sync upload.
- **Verify:** default flow shows no auth; opt-in shows Clerk + create/join family; invite→join works; sign-out → local-only (data stays). Bundle check that Clerk isn't on the default path.

### Phase 5 — Wire `SyncTransport` vs. the multi-tenant server ⭐ first working demo

- Instantiate `SyncTransport(engine, { serverUrl, pollIntervalMs })` in the leader worker; start after `open()` once authenticated + a workspace is active. On downlink apply → `ctx.invalidate(affectedTables)` → all tabs refetch (delivers PR #33's deferred cross-tab reactivity).
- Runs against the **workspace-scoped, authenticated** server from Phase 3 (no unscoped single-user stage). A local `palladium dev` may still be used for developer smoke-testing, but the demo is multi-tenant.
- **Verify:** extend the harness to Habitat's schema; **two members × two devices in one workspace** converge; a second workspace stays isolated; constraint-violation / failover scenarios pass without poisoning.

### Phase 6 — Verification (web, multi-user, multi-workspace)

- Full harness pass; **multi-member family** + multi-device browser matrix on web; cross-workspace isolation. Feature-flag sync; internal dogfood.

### Deferred (out of v1 scope)

- **Native (Capacitor)** sync + native Clerk auth flow.
- Bootstrap snapshot endpoint; tombstones/TTL; `onRejected`/`onStaleDelta`.
- Fine-grained per-record sharing / rich role permissions within a workspace (`O11`).

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
| R5 | ~~Merge conflicts with PR #33.~~ **Resolved** — #33 merged (`74e11bf`); all phases branch from current `main`. | — |
| R6 | **Tenancy + auth is now on the v1 critical path** (`L2` amended) — a Rust trait/schema redesign **plus** the family/membership model + invite UI. Biggest single scope increase. | Own phase (3), parallelizable with client Phases 1–2; contract + **two-workspace isolation** tests gate it. |
| R7 | Clerk free-tier limits — **MAU cap ~10k AND Organizations/seat limits** (workspaces = orgs, `D13`) — plus native auth differs from web. | Verify org limits early (Phase 3); bespoke `workspaces`/`memberships` fallback if they bite. Verify native before that phase. |
| R8 | Effort/altitude — a multi-PR, cross-stack (TS engine + Vue app + Rust server + external auth + membership UI) programme, now **larger** with tenancy in v1. | Scope and sequencing explicitly agreed; phase gates; parallelize client vs server tracks. |
| R9 | **Shared-workspace concurrent edits by different members** make cross-*user* LWW a real v1 case (not just multi-device single-user) — two family members editing the same row concurrently. | Phase 1 column-LWW-by-HLC + **workspace-scoped deterministic IDs** (D5) handle it; add a concurrent-two-member convergence test. |

### Open questions

| # | Question | State |
|---|---|---|
| ~~O1~~ | ~~Tenancy model & deployment (G5): single store vs. per-user instances; scope per-user or per-household?~~ | **Resolved (amended 2026-07-25)** — tenant = **workspace** (family, multi-member); `workspace_id` in the `ChangeStore` trait (`D14`); foundational Phase 3 (`L2`). Deployment of `palladium-axum` in prod still TBD. |
| O2 | `nodeId` lifecycle — how assigned/persisted per device; reset on reinstall? (Also required for failover durability, G6.) | Open. |
| O3 | Delete semantics — LWW deletes (D4) vs. escalation for v1? | Open. |
| O4 | Existing-data migration for deterministic IDs (Phase 2): backfill + FK cascade; reconcile rows already divergent across devices. | Open. |
| O5 | Clerk ↔ Rust verification — JWKS/issuer/audience; **active-org (workspace) claim** → change-store scope; membership check. | Open. |
| O6 | Token plumbing to the worker — main-thread Clerk session → leader worker transport; refresh + 401 + leadership handoff; **re-scope on workspace switch**. | Open. |
| O7 | Account scope across the suite — one Clerk identity **and shared workspaces** across habitat/hearth/halcyon/hephaestus, or per-app? | Open. |
| O8 | Blob sync — `IDBBlobAdapter` binary (jots voice/image) via `/v1/blobs`, or out of scope for v1? | Open. |
| O11 | **Sharing granularity** — does a family workspace share **all** Habitat tables, or are some personal within a family (my habits vs shared chores/grocery)? v1 assumes whole-workspace share (coarse). | Open — product call. |
| O12 | **Workspace lifecycle** — does every user get a personal workspace by default + optional family workspaces? Which workspace does first-sync claim local data into? Can data move between workspaces? | Open. |
| O13 | **Membership mechanism** — workspace ↔ Clerk Organization (invites/roles, free-tier limits) vs. bespoke `workspaces`/`memberships` tables? | Open — verify Clerk Org free-tier limits (R7). |
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
