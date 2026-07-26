# ERD — Habitat ↔ Palladium Sync Integration

**Status:** Phase 0 complete; PR #33 **merged** (`74e11bf`) · Phase 1 next · multi-tenancy (family workspaces) baked in · **all open questions resolved** (O12 family-merge designed in §5.5) — 2026-07-26
**Owner:** Jeel Bhavsar
**Created:** 2026-07-25 · **Revised:** 2026-07-26
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
5. **Scope all sync to a workspace — multi-tenant from day one.** A workspace is a **family/household of one or more members**. The server (`ChangeStore` + `palladium_changes`) carries `workspace_id`; `palladium-axum` verifies a **Clerk** JWT, resolves the caller's workspace membership, and scopes every change to it. No unscoped single-user dev-server stage. **Within a workspace, each table is `shared` (all members) or `personal` (owning member only)** via a declarative registry — habits/journal stay private, chores/grocery are shared (`D15`/`D16`).
6. **Gate behind Clerk, local-first:** no auth upfront; the sign-up/sign-in (and create-or-join-family) prompt appears **only on sync opt-in**. The app is fully usable with no account.

This work sits **on top of PR #33** (the `@palladium/worker` bus migration, now merged as `74e11bf`), which rewrote the exact files involved.

### Goals

1. Correct, convergent multi-device / multi-tab sync for Habitat on the **web** (v1).
2. **Multi-tenant family sharing from day one** — multiple members of a household sync a shared workspace, with membership + roles, isolated from every other workspace; **per-table shared/personal classification** so habits/journal stay private while chores/grocery are shared.
3. Zero bespoke sync/conflict code — everything reusable lands in `@palladium/core` / `palladium-axum`, benefiting every suite app.
4. Local-first preserved: the app is fully usable with **no account**; sync is the only account-gated feature.
5. A cross-session design record: findings, gaps, decisions, and phase gates all traceable by ID.

### Non-goals (v1)

- **Per-row / ad-hoc sharing + rich permissions** — sharing is **per-table** (feature-level: whole-table `shared`/`personal`, `D15`/`D16`), not per-row (you can't share one specific habit with one member), and roles are coarse (owner / member). Per-row visibility and role-based permissions are future work. *(O11 resolved at table granularity.)*
- **Native (Capacitor) sync + native Clerk auth** — web-first; native is a follow-up.
- **CRDT / Yjs**, bootstrap snapshots, tombstones/TTL — documented future work, not v1. *(Blob sync **is** in v1 — `D18`.)*

> Open items tracked in **§9**. Findings = **F#** (§3.2); gaps = **G#** (§4); decisions = **D#** (§2).

---

## 2. Key decisions (ADR-style)

> **Locked (2026-07-25):**
> **(L1)** Core-engine hardening (Phase 1) is **in scope** here — sync is unsafe without it.
> **(L2)** **Multi-tenancy is foundational** *(amended 2026-07-25)* — the server is **workspace-scoped** (family/household, multi-member) with **Clerk-backed auth** from day one. No unscoped single-user dev-server stage; tenancy is on the v1 critical path (Phase 3).
> **(L3)** Completion state stays **row-existence + deterministic IDs + idempotent apply** for v1 — no LWW-state-column remodel.
> **(L4)** **Web-first** — Capacitor sync + native Clerk auth are a follow-up.
> **(L5)** *(amended 2026-07-25)* **Workspace = tenant**, family sharing is real from v1: memberships + coarse roles (owner/member); a user may belong to several workspaces. Membership is **bespoke in the Palladium server** — Clerk = identity only, *not* Clerk Organizations (D13, O13). Tenancy dimension lives in the `ChangeStore` trait + `palladium_changes` schema (D14).

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Write-capture = route through the engine**, not bespoke CDC triggers. | Convergence principle; engine gives HLC + `changes:local` free; `SyncTransport` works natively. |
| D2 | **Client-side LWW** — each client resolves on `applyRemote`. | HLC is a total order → deterministic convergence. The server does **no** conflict resolution; its only server-side logic is Clerk-auth + workspace scoping (D12–D14). Server-side resolution is a later optimization. |
| D2a | **Remote-apply must be non-poisoning** — **per-op isolation** + `PRAGMA defer_foreign_keys`; **duplicate-specific** resolution (LWW/upsert on the unique key), **not** a blanket `INSERT OR IGNORE` that also swallows FK/other constraint failures; the poll **cursor advances only past the contiguous successfully-applied prefix**, and a failed op is **dead-lettered** for bounded retry + surfaced. | **G2/G3/G4**: one constraint violation must not roll back the batch, silently drop a change, or hide a *non-duplicate* failure. Required for *any* safe sync, independent of LWW. |
| D2b | **Durable sync state** — persist `nodeId` (stable per device), poll cursor, HLC alongside the outbox. | **G6**: survive leader failover without full re-hydration or identity churn. |
| D3 | **Column-level LWW** via a `_sync_row_meta` (per-column) shadow table. | The documented model; concurrent edits to *different* columns of a row both survive. |
| D4 | **Deletes LWW'd by HLC in v1** — not escalated (single authoritative policy). | Simpler; the §2.3 escalation model (`onRejected` + `__conflict`) is **documented future work**, explicitly out of v1. Resolves the D4↔§2.3 tension → O3 closed. |
| D5 | **Deterministic IDs** (`uuidv5(namespace, naturalKey)`) for natural-key tables, applied **before** those tables sync. Namespace = `workspace_id` for **shared** tables, **`owner_user_id` (workspace-independent)** for **personal** tables (`D15`). | **G3**: converts semantic duplicates into same-row LWW. Personal namespace omits `workspace_id` so a member's rows keep **stable IDs when re-homed** on family formation — the merge is a pure relabel (`§5.5`). Two members toggling the same *shared* row converge; personal rows never collide across members (owner-disjoint). |
| D6 | **UUID PKs** (Habitat conforms); **UUIDv7** for new IDs. | Valid UUID (satisfies the server), sortable (the ULID benefit), matches `_sync_deltas.sync_id`. Avoids **F2**. |
| D7 | **Exclude `LiveQuery`**; reactivity via bus `onInvalidate`. | `LiveQuery` is `@deprecated` + same-thread + worker-incompatible. |
| D8 | **Engine runs in the leader worker**; native runs in-process. | Single-writer invariant from PR #33. |
| D9 | **No CRDT / Yjs in v1.** | Habitat data is plain structured rows; no rich-text collaboration need yet. |
| D10 | **Auth via Clerk (free tier)**, not bespoke. | Use a managed identity provider; Palladium ships no auth. |
| D11 | **Local-first: auth shown only on sync opt-in.** | Product requirement — discovery/use must not require an account. |
| D12 | **Server verifies the Clerk JWT and scopes every change to a workspace** — and, for personal-class data, to the owning member (`D15`). Foundational, not deferred (`L2`). | Sync must not leak across families/accounts, nor a member's personal data to other members; needs new `palladium-axum` auth middleware + workspace/member scoping. On the v1 critical path (Phase 3). |
| D13 | **Workspace = tenant; family sharing via memberships + coarse roles**, from v1. Membership / invites / roles are **bespoke in the Palladium server** (`workspaces` / `memberships` / `invites` tables); **Clerk provides identity only** — *not* Clerk Organizations. | O13: Clerk's free-tier Org cap (**100 families × 5 members**) is too tight for a consumer family app and beyond it needs a paid B2B add-on; bespoke has no cap and no per-family cost. A user may belong to several workspaces. |
| D14 | **Tenancy lives in the `ChangeStore` trait + `palladium_changes` schema** (single multi-tenant store): `workspace_id` always, plus `visibility` (`shared`\|`personal`) + `owner_user_id` for personal rows. Server filter: `workspace_id = ? AND (visibility = 'shared' OR owner_user_id = :caller)`. | Chosen fork for **G5**: one logical store, two scope keys — single source of truth, matches the design docs' `_sync_deltas.workspace_id`. Not per-tenant store instances. Implements `D15`. |
| D15 | **Two-axis scoping: workspace (tenant) × sharing-class (`shared` \| `personal`).** Within a workspace, `shared` rows replicate to **all** members; `personal` rows carry `owner_user_id` and replicate **only** to that member — one workspace, no data duplication. | O11/O12: a family shares chores/grocery while habits/journal stay private to each member. |
| D16 | **Declarative sharing-policy registry** — every synced table declares `shared`/`personal` in **one place** (co-located with `SCHEMA_CONFIG`), enforced by a parity test; adding a synced table **forces** a class. **Declaring a *new* table is one line; *reclassifying* a table that already has data is a versioned migration** (§5.4). | Maintainability (user directive): "which parts are shared vs private" is one editable source of truth, not logic scattered across the write path. A missing class **fails CI**, so personal data can't leak by an unclassified default. |
| D17 | **Shared Clerk identity across the suite; workspaces scoped per app** (O7). One login spans habitat/hearth/halcyon/hephaestus; a workspace (family) belongs to a **single app**. | One identity (convergence), but each app owns its store + sharing surface — a habitat family ≠ a hearth family; `workspace_id` is per-app. |
| D18 | **Blob sync in v1** (O8) — `IDBBlobAdapter` binaries (jots voice/image) replicate via the server's `/v1/blobs` routes. | Full-fidelity personal jots across a member's devices. Blobs are `personal`-class → member-scoped. Adds upload/download + storage handling (Phase 5). |
| D19 | **Family formation = claim-into-existing-workspace (promote-host), data-preservation union** (O12, §5.5). Joining re-homes local rows into the inviter's workspace; **no server-side merge endpoint**. | The existing claim path + owner-scoped personal data + column-LWW give a convergent, lossless merge; re-home is a pure `workspace_id` relabel (`D5`). |
| D20 | **Server-authoritative scoping (anti-forgery).** On every write the server derives/validates `workspace_id` (vs `memberships`) and `visibility` + `owner_user_id` (vs its own **sharing-policy manifest** + the authenticated `sub`), rejecting/overwriting client-supplied scope metadata; reads are filtered from `(sub, membership, policy)`, not client claims; `/v1/blobs` keys are workspace/owner-scoped + authz-checked. | CodeRabbit: client-stamped scope is forgeable — a malicious client must not write as another member, reclassify a row to leak it, or read another workspace/member. **The server, not the registry stamp, is the security boundary.** |

---

## 3. Current state

### 3.1 Palladium's sync engine — built vs. not

Source: `libs/palladium/STATUS.md` + direct code reading.

| Layer | Built | Detail |
|---|---|---|
| Engine (`@palladium/core`) | ✅ | `createEngine`/`PalladiumEngine` write-router over a `StorageAdapter`; `tx/insert/update/delete`, ``exec(sql`…`)``, HLC stamping (`nextSendHlc`/`receiveHlc`), emits `changes:local`, suppresses re-emit during `applyRemote`. `Hlc`, `generateUlid`, blob adapters, versioned migrations. |
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

**Status:** **Merged** as `74e11bf` — all review comments resolved.

---

## 4. Gap analysis (robustness review, 2026-07-25)

A code-level review of the plan's load-bearing assumptions. **These gaps are why the plan changed shape from its first draft** — they move deterministic IDs earlier, split apply-hardening out, and (post-amendment) make tenancy a foundational v1 phase.

| # | Gap | Mechanism | Plan impact |
|---|---|---|---|
| **G1** | **Engine op model is PK-only.** | `TxBuilder`/`Op` (`core/src/tx.ts`) supports exactly `insert(full row)`, `update(id, patch)`, `delete(id)` — no upserts, no `WHERE` other than `id = ?`, no multi-row. | **~6 Habitat writes** don't fit (see below) → rewrite as **read-affected-ids-then-emit-per-id** in **Phase 2**. Changes atomicity boundaries. |
| **G2** | **`applyRemote` all-or-nothing → poison pill.** | Wraps *every* op of a poll batch in one `tx()`. One local-constraint violation throws the whole tx; the cursor is advanced **before** apply and the rejection is unhandled (`void this.#tick()`) → change **skipped forever** = silent data loss. | **Highest-severity risk.** **Phase 1a** non-poisoning apply is mandatory before any real sync. |
| **G3** | **Natural-key `UNIQUE` + toggle-by-existence makes G2 fire immediately.** | Completion toggle = SELECT → DELETE-or-INSERT with a fresh `randomUUID` (no `ON CONFLICT` anywhere). Two devices toggling the same `(habit, date)` insert **different UUIDs** → `UNIQUE` violation on merge → G2 poison. | **Deterministic IDs become a prerequisite, not final polish** → moved into **Phase 2** (`D5`). Deeper remodel (state-as-LWW-column) considered and **deferred** (`L3`/`O9`). |
| **G4** | **FK cascades + enforcement is ON.** | Browser adapter runs `PRAGMA foreign_keys = ON`; 11 `ON DELETE CASCADE`s. A cross-device **out-of-order** child insert arriving after the parent was independently deleted → FK violation → G2 poison. | **Phase 1a** needs `PRAGMA defer_foreign_keys` (or per-op isolation) in the apply tx. |
| **G5** | **Server tenancy is a redesign, not middleware.** | `ChangeStore` (`crates/palladium-core/src/store.rs`) is **globally scoped** — `insert(change)`/`list_after(after, limit)` take no user/workspace; `palladium_changes` has no tenancy column; `AppState<S>` wraps one store. | **Foundational (Phase 3), not deferred** (`L2` amended). Fork **resolved → (a)**: add `workspace_id` **+ `visibility`/`owner_user_id`** (`D15`) to the `ChangeStore` trait + `palladium_changes` schema + Axum handlers + contract tests (`D14`). Significant Rust work, now on the v1 critical path. |
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
| R-A5 | **Claim existing local data on first sync** — associate local rows with the **workspace the user creates or joins** and push them (first-sync upload), **preserving each table's sharing class** (personal rows stay owner-scoped to the caller; only shared rows reach other members), then normal bidirectional sync. |
| R-A6 | **Graceful sign-out** — stop the transport, return to local-only; local data stays on the device. |
| R-A7 | **Create or join a family.** On first sync a user either **creates** a new workspace (becomes owner) or **joins** an existing one via invite. |
| R-A8 | **Invite members.** An owner can invite others to the workspace (email/link); an invitee joins and their devices sync the shared data. |
| R-A9 | **Coarse roles (v1): owner / member.** Owner manages membership + invites; both roles read+write all **shared** data and their **own personal** data (per `D15` — a member never sees another member's personal rows). Fine-grained per-record permissions are out of scope (`O11`). |
| R-A10 | **Multi-workspace + switch.** A user may belong to several workspaces (e.g. personal + family) and switch the active one; the transport re-scopes to the active `workspace_id`. *(Lifecycle — O12.)* |
| R-A11 | **Account-switch isolation.** Local data is **bound to the signed-in Clerk account** via a **per-account OPFS store keyed by the Clerk user id** (`O14`); a different sign-in opens a different DB, so it cannot see or claim the previous user's rows. The pre-auth anonymous store is claimed into the account store on first sign-in. |

### 5.2 Approach

- **Client SDK:** `@clerk/vue` (or `@clerk/nuxt`) mounted **lazily** — provider/components load only when the sync flow is entered, keeping the default path free of auth UI + bundle weight.
- **Membership is bespoke in the Palladium server (`D13`, O13):** `workspaces` / `memberships` (`workspace_id`, `user_id`, `role`) / `invites` (`token`, `email`) tables in `palladium-axum`. **Clerk provides identity only** (users, sessions, JWT) — *not* Clerk Organizations, whose free-tier cap (100 families × 5 members) is too tight. We build the invite/role flows.
- **Session token:** Clerk issues a short-lived JWT identifying the user (`sub`). The **active workspace is selected client-side** and sent alongside (header/param); the server verifies it against the user's `memberships`. `SyncTransport` attaches `Authorization: Bearer <jwt>` (it already supports a `fetch` override; extend to inject + refresh on 401).
- **Server verification (new `palladium-axum` work, largest backend requirement):** verify the Clerk JWT (JWKS / issuer / audience), derive the user (`sub`), **confirm the requested `workspace_id` against the `memberships` table**, then scope every read/write to that workspace (+ `owner_user_id` for personal rows, `D15`) in the `ChangeStore` (`D12`/`D14`, `G5`). Does not exist today.
- **Offline auth:** a cached valid session keeps the transport working offline; expired tokens pause uplink (outbox retains) until re-auth.

### 5.3 UX flow

```text
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

### 5.4 Sharing model — workspace × sharing-class (O11, O12)

Two **orthogonal** axes. **Workspace** = the tenant (everyone auto-gets one, `R-A7`; a family is a workspace with several members). **Sharing class** = a per-table policy: `shared` (every member of the workspace sees it) or `personal` (only the authoring member). This is what lets a family share chores/grocery while each member's habits and journal stay private — **in one workspace, with no data duplication**.

**Mechanism (maintainable, single source of truth — `D16`).** Every synced table declares its class **once**, co-located with `SCHEMA_CONFIG`, and a parity test **fails CI if any synced table is unclassified** — so adding a table forces a shared/personal decision and personal data can never leak through an unclassified default.

**Declaring a *new* table's class is one line; *reclassifying* a table that already holds data is a versioned migration**, not a config flip, because the stored scope changes:
- **personal → shared:** rows lose `owner_user_id` and become visible to **all** members (an authorization change — must be intended), and their deterministic-ID namespace changes `owner+key → workspace+key` (ID rewrite + FK fixup, like `O4`).
- **shared → personal:** every existing shared row must be **assigned an `owner_user_id`** (whose? — a product decision), and the namespace changes the other way.
Both run as a one-time transactional migration (backfill/revoke `owner_user_id`, rewrite deterministic IDs, re-emit) and must be reviewed as a privacy change.

**How it scopes (`D15`/`D14`).** The client engine reads the registry and stamps each emitted change (below) for its *local* LWW/scoping — but these stamps are **advisory**: the server re-derives and enforces scope authoritatively (`D20`), never trusting client-supplied `owner_user_id`/`visibility`/`workspace_id`.

| Class | Stamped on the change | Server returns to a member |
|---|---|---|
| `shared` | `workspace_id`, `visibility='shared'` | all `shared` rows of the workspace |
| `personal` | `workspace_id`, `visibility='personal'`, `owner_user_id` | only rows where `owner_user_id = caller` |

**Server-authoritative (`D20`):** on ingest the server sets `owner_user_id = sub` for personal-class rows (and `NULL`/`shared` for shared-class) **from its own copy of the policy manifest**, validates `workspace_id` against `memberships`, and rejects mismatched/forged metadata — so a client cannot write as another member or reclassify a personal row to leak it. Read filter (derived from `sub`+membership, not client claims): `WHERE workspace_id = ? AND (visibility = 'shared' OR owner_user_id = :caller)`. Deterministic-ID namespace (`D5`) is `owner_user_id`-based (workspace-independent) for personal tables — two members never collide on a personal natural key, and IDs stay stable across a family re-home (`§5.5`).

**Initial Habitat classification** (illustrative — the registry is the source of truth, trivially reconfigurable):

| Class | Habitat tables |
|---|---|
| **personal** | `habits`, `habit_schedules`, `habit_logs`, `completions`, `reminders`, `checkin_templates/questions/reminders/entries/completions/responses`, `voice_notes`, `image_notes`, `scribbles`, `bored_categories` |
| **shared** (candidates) | `todos` (family grocery / chore list), `bored_activities` (shared activity ideas) |
| **local-only** (never synced) | `applied_defaults`, `_palladium_seeds` |

> **Everyone gets a workspace (`O12`).** On first sync a user's own workspace is auto-provisioned; personal tables are member-scoped within it (trivially — they're the sole member), shared tables hold their shared lists. Joining a family adds membership to another workspace, where their personal data stays theirs. Solo→family **formation/merge** is designed in **§5.5**.

### 5.5 Family formation & merge (O12)

**Principle — data-preservation via merge.** Forming or joining a family never deletes or recreates data; every local row is preserved and re-homed into the family workspace.

**Key insight — the merge *is* the claim path, not a new subsystem.** Joining a family = the `R-A5` "claim local data into a workspace" operation aimed at an **existing** workspace instead of a fresh one. Because personal data is `owner_user_id`-scoped and shared data unions, the existing column-LWW + deterministic-ID machinery already produces a convergent, lossless merge. **No server-side merge endpoint** — it reuses `POST /v1/changes`.

**Model — promote-host** (recommended). The **inviter's** workspace becomes the family workspace (inviter = owner); invitees join and re-home their data into it; their old solo workspaces are retired (dormant, optional server GC). *(Alternative: a fresh empty family workspace both migrate into — symmetric but moves more data. Promote-host chosen for least movement; flag if you'd rather the symmetric model.)*

**Formation flow** (Alice invites Bob):

1. Alice's solo workspace `W_A` is designated the family; membership `(W_A, Alice, owner)`.
2. Alice creates an invite `(W_A, bob@…, token)`; Bob accepts as himself → membership `(W_A, Bob, member)`.
3. Bob's client runs **claim-into-`W_A`** (once, transactionally): re-stamp each local synced row with `workspace_id = W_A` and emit it as a change to `W_A`'s outbox — personal rows keep `owner_user_id = Bob`; shared rows join the shared set.
4. Bob's active workspace switches to `W_A`; the transport re-scopes (`O6`). `W_B` is retired.
5. Alice polls → receives Bob's **shared** rows (union) but **not** his personal rows (owner filter). Symmetric for Bob.

**Why it converges cleanly:**

| Data | On merge | Collision handling |
|---|---|---|
| **Personal** (habits, check-ins, jots) | re-homed, `owner_user_id` preserved | none — members are owner-disjoint; personal deterministic IDs are `owner + naturalKey` (**workspace-independent**, `D5`), so re-home is a pure `workspace_id` relabel: stable IDs, no FK fixup, idempotent |
| **Shared, natural-keyed** | union into shared set | same logical item → same `uuidv5(workspace_id, key)` → dedupe via column-LWW-by-HLC |
| **Shared, random-PK** (v1 Habitat `todos`, `bored_activities`) | union | distinct UUIDs coexist — **duplicates preserved** (data-preservation); user dedupes manually |

**Idempotency.** Deterministic-ID rows converge on any re-run. Random-PK shared rows are guarded by a one-time **workspace-migration marker** so a re-run can't re-duplicate them. The claim runs in one transaction; a partial failure re-runs safely.

**Data-loss guarantee.** Every local row is uploaded, never deleted; the only intentional collapse is shared *natural-key* LWW dedupe (bounded, documented).

**Deferred (v-next) — *leaving* a family.** The departing member's personal rows (owner = them) re-home to a fresh solo workspace (relabel back); shared rows they contributed **stay** with the family (can't cleanly withdraw). Membership removed; the server stops returning family changes to them.

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

```text
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

 Main thread (any tab): Clerk session (user) + active workspace ──► provides JWT to the transport;
 sync UI/opt-in + create-or-join-family gated behind Clerk auth (shown only on sync intent).
```

- **Engine + `SyncTransport` live in the leader worker only** (single writer ⇔ single OPFS connection). Followers keep proxying via the bus.
- Local write → engine → `changes:local` → outbox → POST (Clerk bearer JWT carrying the active workspace).
- Downlink poll → `applyRemote` (with the new LWW guard) → `ctx.invalidate(affectedTables)` → all tabs refetch. Also delivers PR #33's deferred cross-tab-live reactivity.
- **Server** verifies the JWT (user `sub`), confirms the requested workspace against the bespoke **`memberships` table**, and scopes every read/write to `workspace_id` **and, for personal-class rows, `owner_user_id`** (`D15`) — a member sees all the workspace's `shared` rows but only their own `personal` rows.
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

- **1a — Non-poisoning remote apply (G2/G4, `D2a`).** Rework `applyRemote` + `SyncTransport.#poll`: **per-op isolation** + `PRAGMA defer_foreign_keys`; **duplicate-specific** resolution (LWW/upsert on the unique key) — *not* a blanket `INSERT OR IGNORE`, which would also swallow FK/other constraint failures; **advance the poll cursor only past the contiguous successfully-applied prefix**; **dead-letter** failed ops for bounded retry and surface them (never skip silently).
- **1b — Column-level LWW by HLC (F1, `D3`).** `_sync_row_meta` shadow table; drop remote ops whose HLC ≤ stored; per-column granularity.
- **1c — Durable sync state (G6, `D2b`).** Persist `nodeId`, poll cursor, HLC.
- **Verify:** the `it.fails` guard in `two-client-sync.test.ts` flips to a passing `it`; add convergence + constraint-violation-does-not-poison + failover-resumes-from-cursor tests. **No Rust changes.**

### Phase 2 — Route Habitat writes through the engine + deterministic IDs

- In the leader worker's `create()`, build `createEngine(storage, { nodeId })` + `engine.init(SCHEMA_CONFIG)`.
- Migrate `db-shared.ts` **writes** from raw `db.exec` to `engine.insert/update/delete/tx`. Reads may stay on ``engine.exec(sql`…`)``.
- **Rewrite the ~6 non-id-keyed writes (G1)** as read-affected-ids-then-emit; wrap multi-exec operations (e.g. `createHabit` = habit + schedule) in one `engine.tx()` → one atomic, one-Change unit.
- **Apply deterministic IDs to natural-key tables here (G3, `D5`)** — `completions`, `checkin_entries`, `checkin_completions`, `checkin_responses` — *before* they're sync-eligible. Namespace = `owner_user_id` (workspace-independent) for personal tables, `workspace_id` for shared — keeps personal IDs stable across a family re-home (`§5.5`). Includes a data migration for existing rows (`O4`).
- **Define the sharing-policy registry (`D16`) and stamp `visibility`/`owner_user_id` per class (`D15`)** on emitted changes; add the CI parity test that **every synced table is classified** (`shared`/`personal`/`local-only`).
- Keep the `HabitatService.dispatch` surface unchanged. Land incrementally by table group.
- **Verify:** `apps/habitat/tests/unit/*` (incl. `db-schema.test.ts` parity, updated to ignore `_sync_*` — G8) green after each group; app smoke. *(Client-only; parallelizable with Phase 3.)*

### Phase 3 — Server tenancy + Clerk auth (workspace-scoped) — foundational

The multi-tenant backend, built **from the start** (`L2` amended, `G5`, `D12`/`D14`). Rust work on `palladium-axum` + `palladium-core` crates; parallelizable with Phases 1–2.

- **Tenancy in the store (`D14`/`D15`):** widen the `ChangeStore` scope to `insert(scope, change)` / `list_after(scope, after, limit)` + `workspace_id`, `visibility`, `owner_user_id` columns on `palladium_changes` (indexed) + updated Axum handlers + contract tests. Filter: `WHERE workspace_id = ? AND (visibility = 'shared' OR owner_user_id = :caller)`.
- **Clerk JWT verification + server-authoritative scope (`D12`/`D20`, `O5`):** verify the token (signature / JWKS / issuer / audience), take the user `sub` and the **`workspace_id` request parameter** (bespoke membership — *no* Clerk org / active-org claim), check it against `memberships`; reject unauthorized as 401/403.
- **Server holds the sharing-policy manifest (`D16`/`D20`):** configured per app/deployment (same source as the client registry) so the server **sets** `owner_user_id`/`visibility` on writes from `sub` + policy and **rejects forged client metadata** — the client stamps are advisory only.
- **Membership (`D13`, O13):** build `workspaces` / `memberships` (workspace_id, user_id, role) / `invites` (token, email) tables in `palladium-axum` + invite/accept + coarse owner/member role checks. Clerk = identity only (no Clerk Organizations).
- **Verify:** **two-workspace isolation** (member of A never receives B's changes; non-member rejected) **and two-member personal isolation** (member B in workspace A never receives member C's `personal` rows). Contract tests for the scoped store.

### Phase 4 — Clerk accounts + family/workspace model + local-first gating (client)

- Integrate `@clerk/vue`/`@clerk/nuxt`, lazily mounted. Add the "Sync across devices" opt-in; **no auth UI in the default flow** (`R-A1`/`R-A2`).
- Sign-in/up only on sync intent; then **create a family (become owner) or join via invite** (`R-A7`); **invite members** (`R-A8`); coarse **owner/member** roles (`R-A9`); **workspace switcher** for multi-workspace users (`R-A10`).
- Persist a stable `nodeId` per device; attach the JWT **+ active `workspace_id`** to transport requests (main→worker token channel, `O6`); a switch re-scopes the transport.
- **Claim local data into the chosen workspace on first sync** (`R-A5`): first-sync upload, `personal` tables stamped with the caller as `owner_user_id`. **Joining an existing family = the same claim path pointed at the inviter's workspace** — the data-preservation merge (`D19`, §5.5): re-home local rows (once, transactionally, migration-marker-guarded), personal IDs stay stable, shared rows union.
- **Account-switch isolation (`R-A11`, `O14`):** bind the local store to the Clerk account; on sign-out + a *different* sign-in on the same profile, the new user must see none of the previous user's rows.
- **Verify:** default flow shows no auth; opt-in shows Clerk + create/join family; invite→join works; sign-out → local-only (data stays); **A signs out → B signs in on the same profile → B sees none of A's data**. Bundle check that Clerk isn't on the default path.

### Phase 5 — Wire `SyncTransport` vs. the multi-tenant server ⭐ first working demo

- Instantiate `SyncTransport(engine, { serverUrl, pollIntervalMs })` in the leader worker; start after `open()` once authenticated + a workspace is active. On downlink apply → `ctx.invalidate(affectedTables)` → all tabs refetch (delivers PR #33's deferred cross-tab reactivity).
- Runs against the **workspace-scoped, authenticated** server from Phase 3 (no unscoped single-user stage). A local `palladium dev` may still be used for developer smoke-testing, but the demo is multi-tenant.
- **Blob sync (`D18`, O8):** replicate `IDBBlobAdapter` binaries (jots voice/image) via the server's `/v1/blobs` routes — upload on local write, fetch on downlink; blobs are `personal`-class → member-scoped. **`/v1/blobs` keys are namespaced by workspace (+ owner for personal) and every read/write is authorized against membership/ownership (`D20`)** — no unauthorized cross-workspace/cross-member fetch. Handle retry + a storage cap.
- **Verify:** extend the harness to Habitat's schema; **two members × two devices in one workspace** converge (incl. a voice/image jot round-tripping via `/v1/blobs`); a second workspace stays isolated; **cross-workspace + cross-member authorization tests** (a member cannot read another workspace's changes or another member's personal rows/blobs); constraint-violation / failover scenarios pass without poisoning.

### Phase 6 — Verification (web, multi-user, multi-workspace)

- Full harness pass; **multi-member family** + multi-device browser matrix on web; cross-workspace isolation. Feature-flag sync; internal dogfood.

### Deferred (out of v1 scope)

- **Native (Capacitor)** sync + native Clerk auth flow.
- Bootstrap snapshot endpoint; tombstones/TTL; `onRejected`/`onStaleDelta`.
- Fine-grained per-record sharing / rich role permissions within a workspace (`O11`).
- **Leaving a family** (`O12` v-next, §5.5) — re-home a departing member's personal data to a fresh solo workspace; contributed shared rows stay with the family.

### Follow-ups (separate PRs, orthogonal)

- **Add `wipeFiles()` to `@palladium/sqlite-browser`** + use it for a real in-place OPFS wipe — completes the NUKE_OPFS behaviour Phase 0 deferred.
- **Fix the repo-wide NUKE_OPFS bug** in `hearth`/`halcyon`/`hephaestus` (same unscoped origin-root deletion habitat had).
- Migrate `useNotifications` → `@palladium/notifications-vue`.
- Optional annotation-driven CRDT (Yjs) for future rich-text fields.
- Roll engine+transport+auth convergence to hearth / halcyon / hephaestus — **shared Clerk identity across the suite, per-app workspaces** (`D17`, O7 resolved).

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
| R7 | Clerk free-tier **user** cap (up to ~50k users — fine early; verify) + native auth differs from web. The Org-cap risk is **retired** by choosing bespoke membership (`D13`, O13). | Verify the user cap suffices; verify native auth before that phase. Building bespoke invites/roles is now scope (Phase 3), not a hard limit. |
| R8 | Effort/altitude — a multi-PR, cross-stack (TS engine + Vue app + Rust server + external auth + membership UI) programme, now **larger** with tenancy in v1. | Scope and sequencing explicitly agreed; phase gates; parallelize client vs server tracks. |
| R9 | **Shared-workspace concurrent edits by different members** make cross-*user* LWW a real v1 case (not just multi-device single-user) — two family members editing the same row concurrently. | Phase 1 column-LWW-by-HLC + **workspace-scoped deterministic IDs** (D5) handle it; add a concurrent-two-member convergence test. |
| R10 | **Account-switch data leak (CodeRabbit)** — on a shared device, a new sign-in could see/claim the previous user's local rows; worse now that personal data is member-private. | `R-A11`/`O14`: bind the local store to the account (per-account store or purge-on-switch); test A-out→B-in isolation (Phase 4). |

### Open questions

| # | Question | State |
|---|---|---|
| ~~O1~~ | ~~Tenancy model & deployment (G5): single store vs. per-user instances; scope per-user or per-household?~~ | **Resolved (amended 2026-07-25)** — tenant = **workspace** (family, multi-member); `workspace_id` in the `ChangeStore` trait (`D14`); foundational Phase 3 (`L2`). Deployment of `palladium-axum` in prod still TBD. |
| ~~O2~~ | ~~`nodeId` lifecycle — how assigned/persisted per device.~~ | **Resolved** — a **UUIDv7 minted on first launch**, persisted with the durable sync state (`D2b`) so it survives leader failover/reload; a reinstall/OPFS-wipe mints a new device identity (acceptable). Not user-facing. |
| ~~O3~~ | ~~Delete semantics — LWW deletes vs. escalation for v1.~~ | **Resolved** — v1 uses HLC LWW deletes (`D4`); escalation (`onRejected`/`__conflict`, §2.3) is deferred future work. |
| ~~O4~~ | ~~Existing-data migration for deterministic IDs.~~ | **Resolved** — a one-time **transactional PK rewrite** to `uuidv5` ids with FK fixups under `PRAGMA defer_foreign_keys` (Phase 2); rows already divergent across devices collapse to the same id and merge under column-LWW-by-HLC on first upload. |
| ~~O5~~ | ~~Clerk ↔ Rust verification.~~ | **Resolved** — `palladium-axum` validates the Clerk JWT via **JWKS** (cache by `kid`), checks issuer/audience/expiry, takes the user `sub`, and confirms the requested `workspace_id` against the bespoke **`memberships`** table (`D13`). |
| ~~O6~~ | ~~Token plumbing to the worker.~~ | **Resolved** — the main thread exposes a **`getToken()` provider** to the leader worker over the bus; the transport calls it (refresh on 401); on leadership handoff the new leader re-establishes it; a **workspace switch** pushes the new active `workspace_id` → transport re-scopes (per-workspace cursor). |
| ~~O7~~ | ~~Account scope across the suite.~~ | **Resolved** — **shared Clerk identity** across habitat/hearth/halcyon/hephaestus, **workspaces per app** (`D17`). |
| ~~O8~~ | ~~Blob sync in v1?~~ | **Resolved — yes, in v1** (`D18`): jots voice/image via `/v1/blobs`, member-scoped (Phase 5). |
| ~~O11~~ | ~~Sharing granularity — share all tables, or some personal within a family?~~ | **Resolved (2026-07-25)** — **per-table** `shared`/`personal` via a declarative registry (`D15`/`D16`); habits/journal personal, chores/grocery shared. Per-**row** sharing is out of scope (non-goal). |
| ~~O12~~ | ~~Workspace lifecycle / solo→family merge.~~ | **Resolved (2026-07-26)** — everyone auto-gets a workspace; personal data member-scoped (`D15`); **family formation = claim-into-inviter's-workspace, data-preservation union** (`D19`, §5.5): personal rows re-home with stable IDs, shared rows union. *Leaving* a family is v-next. |
| ~~O13~~ | ~~Membership mechanism — Clerk Organizations vs. bespoke tables.~~ | **Resolved — bespoke** `workspaces`/`memberships`/`invites` in the Palladium server; Clerk = identity only (`D13`). Clerk Orgs rejected (free-tier 100 families × 5 members cap). |
| ~~O14~~ | ~~Account-switch isolation mechanism (`R-A11`).~~ | **Resolved** — **per-account local store**: the OPFS DB is keyed by the Clerk user id (e.g. `/habitat/<userHash>/…`), so a different sign-in opens a different DB; the pre-auth anonymous store is claimed into the account store on first sign-in; sign-out returns to anonymous. |
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
