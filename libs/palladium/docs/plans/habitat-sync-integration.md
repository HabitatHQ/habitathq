# ERD — HabitatHQ Sync Architecture (Palladium + Atrium)

**Status:** Reframed to a **three-layer** architecture + **record-level ACL** + **POC-first** delivery — 2026-07-26 · **multi-device identity (`D22`) + timezone-robust UTC-HLC resolution (`D23`) folded in — 2026-08-01** · PR #33 **merged** (`74e11bf`) · prior O1–O14 resolved; the reframe opens O11a / O5a / O12a / O20 (§8)
**Owner:** Jeel Bhavsar
**Created:** 2026-07-25 · **Revised:** 2026-08-01
**PRs:** [#33 — habitat on the @palladium/worker bus](https://github.com/HabitatHQ/habitathq/pull/33) (merged) · [#35 — this ERD](https://github.com/HabitatHQ/habitathq/pull/35)
**Harness:** `libs/palladium/e2e/src/__tests__/two-client-sync.test.ts`

> **Reframe note (2026-07-26, from npalladium's PR #35 review + design calls):** the earlier plan hard-bound Palladium to Clerk, pushed Habitat's domain (workspaces/membership) into the generic server, and used a coarse per-table sharing model. This revision (a) keeps **Palladium generic** behind an **auth seam**, (b) introduces **Atrium** — a dedicated Rust backend for the HabitatHQ ecosystem that owns auth/tenancy/membership/**record-level ACL**, and (c) proves the stack with a **mock-habitat POC example app** instead of migrating the real (mammoth) Habitat first.

---

## 1. Summary

Palladium ships a real client↔server sync engine (`@palladium/core`'s `SyncTransport` + a Rust `palladium-axum` server), but **no app consumes it**, its conflict layer is **unimplemented** (concurrent edits diverge permanently — **F1**), and it has **no auth/tenancy**. HabitatHQ apps (Habitat is the most developed) persist data with **raw SQL through a bespoke worker**, bypassing the engine entirely.

We will stand up sync as **three layers**, each with one job, and prove it end-to-end with a small POC before touching the real apps:

```text
┌─ apps (Vue) ─────────────  mock-habitat POC first; real Habitat/hearth/… later
│     local-first + @palladium/core engine + SyncTransport (in the leader worker)
├─ Atrium (Rust) ─────────  HabitatHQ ecosystem backend  ← NEW
│     Clerk verify · workspaces / memberships / invites / roles · record-level ACL
│     · server-authoritative scoping · gateway in front of Palladium's store
└─ Palladium (generic) ───  @palladium/core + palladium-axum
      hardened sync engine (LWW, non-poisoning apply, durable state)
      + generic scoped change store + an AUTH SEAM (no vendor, no domain)
```

The moves:

1. **Harden Palladium's generic sync core** — column-level LWW (fixes **F1**), non-poisoning remote apply, durable sync state (Phase 1). Benefits every future consumer.
2. **Give Palladium an auth seam** — a generic scoped change store keyed by an opaque tenant scope + an authenticated-scope-provider / request-decoration hook. **No auth vendor or app domain enters Palladium** (Phase 2).
3. **Build Atrium** — the Rust backend owning the HabitatHQ ecosystem's identity (Clerk), tenancy (workspaces = families), membership/invites/roles, and **record-level ACL authorization**, plugged into Palladium's seam (Phase 3).
4. **Prove it with a mock-habitat POC example app** — a minimal Habitat slice (a few tables), local-first, syncing through Atrium, with Clerk opt-in gating and record-level sharing (Phase 4–5). **The real Habitat migration is deferred** until the POC validates the stack.
5. **Sharing is record-level (ACL).** Every record has an owner; default private; the owner grants access **household-wide** (all workspace members) or to **specific members** — "share this note with Bob." Atrium is the security boundary.
6. **Local-first.** No auth upfront; the sign-up/sign-in (and create-or-join-family) prompt appears **only on sync opt-in**.

### Goals

1. A **hardened, generic Palladium** sync core (correct convergence) reusable by every suite app.
2. **Atrium** — one Rust backend for the whole HabitatHQ ecosystem: identity, tenancy, membership, **record-level ACL sharing**.
3. **Prove the full stack with a POC example app** (mock-habitat, web) — local-first + multi-member family sharing at record granularity — *before* the costly real-app migration.
4. Clean layering: **no auth vendor or app domain in Palladium**; no bespoke sync/conflict code in the apps.
5. A cross-session design record: findings, gaps, decisions, and phase gates traceable by ID.

### Non-goals (v1 / POC)

- **Migrating the real Habitat app** — deferred until the POC validates the architecture (the ~1300-line `db-shared.ts` refactor, deterministic-ID data migration, and schema-parity work are real but come *after* the POC).
- **Native (Capacitor)** sync + native Clerk auth — web-first.
- **CRDT / Yjs**, bootstrap snapshots, tombstone **TTL/compaction** (durable delete tombstones themselves are **in v1** — `D4`; only their garbage collection defers), *leaving* a family — documented future work. *(Blob sync **is** in the POC — `D18`.)*

> Open items tracked in **§8**. Findings = **F#** (§3.2); gaps = **G#** (§4); decisions = **D#** (§2).

---

## 2. Key decisions (ADR-style)

> **Locked (2026-07-26):**
> **(L1)** Palladium engine hardening is **in scope** — sync is unsafe without it (Phase 1).
> **(L2)** **Three layers.** Palladium stays **generic** (engine + scoped store + auth seam); **Atrium** owns all HabitatHQ domain/auth/tenancy/ACL; apps are clients. Domain never leaks into Palladium (npalladium #1/#3).
> **(L3)** **Record-level ACL sharing** — per-record owner + grants, *reversing* the earlier per-table model (npalladium #2).
> **(L4)** **POC-first.** Prove the stack with a **mock-habitat example app**; defer the real Habitat migration.
> **(L5)** **Web-first**; native is a follow-up.
> **(L6)** Completion/check-in state = row-existence + deterministic IDs + idempotent apply (no LWW-state-column remodel).

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Write-capture = route through the engine**, not bespoke CDC triggers. | Convergence principle; engine gives HLC + `changes:local` free; `SyncTransport` works natively. |
| D2 | **Client-side LWW** — each client resolves on `applyRemote`. | HLC is a total order → deterministic convergence. The store does **no** conflict resolution. |
| D2a | **Remote-apply must be non-poisoning** — **per-change isolation** (each `Change` is one HLC-stamped unit, applied atomically in its own savepoint) + **adapter-neutral constraint deferral** (a `StorageAdapter` capability, *not* a SQLite `PRAGMA` in core — `D2c`); **duplicate-specific** resolution (column-LWW on the deterministic PK, `D3`/`D5`), **not** a blanket `INSERT OR IGNORE`; the poll **cursor advances only past the contiguous applied prefix**; a failed change is **dead-lettered** for bounded retry + surfaced. **Terminal state:** once a change exhausts bounded retries it is marked **permanently-failed and durably skipped** — the contiguous cursor **advances past its HLC** (recorded in a persisted quarantine set so the skip survives recovery and the change is never replayed), and the failure is surfaced for operator action. The cursor is thus *contiguous over {applied ∪ permanently-failed}*, never stuck behind one poison change. | **G2/G3/G4**: one violation must not roll back other changes, silently drop a change, hide a non-duplicate failure, or wedge the cursor forever; a change must not apply partially. |
| D2b | **Durable sync state** — persist `nodeId` (stable per device), poll cursor, HLC alongside the outbox, as **one atomic checkpoint** advanced in the same transaction as the apply/append it records (recovery replays/retries the incomplete op; a persisted HLC is never reused). | **G6**: survive leader failover without full re-hydration, identity churn, lost/duplicated changes, or HLC reuse. |
| D2c | **`@palladium/core` stays storage-agnostic** — no SQLite-specific statements (`PRAGMA`, OPFS paths) in core. Constraint deferral and `_sync_state`/`_sync_row_meta` persistence go through **adapter capability hooks** on `StorageAdapter`; `@palladium/sqlite-browser` implements them (`PRAGMA defer_foreign_keys`, OPFS). | Core is publishable, adapter-neutral infra (convergence principle); a wrong layer leaks SQLite into every consumer. Enforced by an adapter-contract test. |
| D3 | **Column-level LWW** via a `_sync_row_meta` (per-column) shadow table, keyed **table-qualified** (`(table, row_id, column)`) since PKs are table-scoped. | The documented model; concurrent edits to *different* columns of a row both survive. Fixes **F1**. |
| D4 | **Deletes LWW'd by HLC in v1** — not escalated. **A delete leaves a durable row-tombstone (its HLC in `_sync_row_meta`), never a hard row removal** — required for LWW correctness (a stale/offline update must not resurrect a deleted row) and for §5.4a **backfill replay** (a late/offline client must still receive the delete). Tombstones are **retained indefinitely in v1**; **TTL/compaction is the deferred part** — a tombstone may only be discarded once every reachable client is provably past its HLC. | Simpler; the §2.3 escalation model is documented future work. LWW deletes are impossible without a durable tombstone, so the tombstone itself is **in v1** — only its garbage-collection policy defers. |
| D5 | **Deterministic IDs** (`uuidv5(owner_user_id, naturalKey)`) for natural-key tables, applied before they sync. **Owner-scoped, workspace-independent.** Under record-level ACL **every record has exactly one owner**, so IDs are *always* owner-scoped — there is **no cross-owner shared ID**. Two members creating the "same" logical item in a shared list are **two distinct owned records** (union, no auto-dedupe in v1); cross-member dedupe would need a cross-owner natural key (future). | **G3**: converts a *single owner's* semantic duplicates (their two devices) into same-row LWW, and keeps IDs stable on re-home (§5.6). Convergence is **within one owner's devices** — not across members. |
| D6 | **UUID PKs**; **UUIDv7** for new IDs. | Valid UUID (satisfies the store), sortable. Avoids **F2**. |
| D7 | **Exclude `LiveQuery`**; reactivity via the worker bus `onInvalidate`. | `LiveQuery` is `@deprecated` + same-thread + worker-incompatible. |
| D8 | **Engine runs in the leader worker**; native runs in-process. | Single-writer invariant from PR #33. |
| D9 | **No CRDT / Yjs in v1.** | Plain structured rows; no rich-text collaboration need yet. |
| **D10** | **Three-layer architecture** — Palladium (generic) → **Atrium** (ecosystem backend) → apps (clients). | Separation of concerns (npalladium): a generic reusable engine, a domain/auth gateway, thin apps. |
| **D11** | **Palladium stays generic** — a **scoped change store** (keyed by an *opaque* tenant scope) + an **auth-seam** trait. **Network-private, Atrium-only:** clients never reach Palladium directly nor supply the scope — Atrium derives + authorizes it. **No auth vendor, no app domain** enters Palladium. | npalladium #1/#3 + the convergence principle: Palladium is publishable infra; the scope is a server-derived secret, not a client input. |
| **D12** | **Atrium** = the Rust HabitatHQ ecosystem backend: Clerk verification, `workspaces`/`memberships`/`invites`/roles, **record-level ACL authorization**, server-authoritative scoping. It is the **gateway** in front of Palladium's store. | These are *application* concepts, not generic sync — they belong in a dedicated suite backend, not in `palladium-axum`. |
| **D13** | **Clerk = identity only** (free tier), behind Atrium's implementation of Palladium's auth seam. **Not** Clerk Organizations. | O13: Clerk Orgs free-tier cap (100 families × 5) is too tight; Clerk stays swappable via the seam (Habitat's choice, not Palladium's). |
| **D14** | **Local-first: auth shown only on sync opt-in.** | Discovery/use must not require an account. |
| **D15** | **Tenant = workspace (family), scoped per app**; one **shared Clerk identity** across the suite. Membership is **bespoke in Atrium**. | O7: one login across habitat/hearth/…, but a habitat family ≠ a hearth family — each app's Atrium scope is its own. |
| **D16** | **Record-level ACL sharing** — every record has an `owner_user_id` (default **private**). The owner grants access **household-wide** (all workspace members) or to **specific members** via `shares(root_id, grantee_user_id, perm)` (`read`/`write`). Grants are set at **aggregate-root granularity**; children inherit (`D21`). | O11 reversed (npalladium #2): supports "share this note with Bob," mixed-visibility tables, and household-wide vs private records — per-record, not per-table. |
| **D17** | **Server-authoritative scoping (anti-forgery)** — **Atrium** derives/validates `owner_user_id` (from the JWT `sub`), workspace membership, and every ACL grant; client-supplied scope/ACL metadata is **advisory**, validated or rejected. Reads are filtered by the caller's effective ACL; `/v1/blobs` is ACL-authorized. | Client stamps are forgeable — a member must not write as another, self-grant access, or read records they weren't shared. **Atrium is the security boundary.** |
| **D18** | **Blob sync in the POC** — `IDBBlobAdapter` binaries (a jot image) via `/v1/blobs`, **ACL-authorized** by Atrium. | Proves binary replication + per-record blob authorization end-to-end. |
| **D19** | **Family formation = claim-into-existing-workspace (promote-host), data-preservation merge** (O12, §5.6). Re-homed records keep their owner and stay **private by default**; the member opts into sharing afterward. | Reuses the claim path; no server-side merge endpoint; no accidental exposure on merge. |
| **D20** | **Deliver via a mock-habitat POC example app**, not a real-Habitat migration first. | De-risk the whole stack (hardened Palladium + Atrium + ACL + a Vue client) on a small, disposable surface before the costly real migration. |
| **D21** | **ACL is set on aggregate roots; children carry `root_id` and inherit** (§7.1). A child has no ACL of its own; its `owner_user_id` is **audit-only**; the root owner's ACL is the sole authority over child read/write/share. | Grants stay `O(roots)` not `O(rows)`; "share a list" moves its items atomically; a child is never visible when its root isn't; collaborator-created children can't assert their own audience. |
| **D22** | **One user, many devices — device identity is first-class.** Each device mints a stable **`nodeId`** (UUIDv7, `D2b`) that is *also* its **HLC tie-break id** and its **own-write-skip key**. Atrium keeps a **`devices(nodeId, user_id, …)` registry** (Phase 3b): a device self-registers on first authenticated sync; every change is attributable to `(user_id, nodeId)`. **Own-write skip is keyed by `nodeId` (device), never `user_id`** — otherwise a user's second device would ignore the first's edits and they'd never converge. `nodeId` is generic (Palladium/HLC); the *device↔user binding* is domain (Atrium). | Concern #1: a user logged in on N devices must (a) converge across their own devices, (b) have every edit attributable to a device for audit/LWW tie-break, and (c) support future per-device session revocation. Keeping own-write-skip per-device is a **correctness** requirement, not a nicety. |
| **D23** | **Conflict order is UTC-absolute; local wall-clock is display-only.** The LWW authority is the **HLC**, whose physical component is **UTC epoch millis** (monotonic, timezone-independent) — resolution is correct across members in different timezones **by construction**, with `nodeId` as the deterministic tie-break (`D3`/`D22`). A user-facing edit instant is a **separate `display_ts`** (stored **UTC**, optionally with the originating tz offset), rendered in the *viewer's* local timezone **at the edge** — it is **data, never a conflict input**. | Concern #2, made precise: never resolve conflicts on local wall-clock (a westward-timezone edit could read an *earlier* local time and wrongly lose). "Store local, resolve to UTC on sync, back to local on fetch" is exactly right **for `display_ts`** — and must be kept out of the conflict key. Overloaded "timestamp" split into two canonical terms: **`hlc`** (conflict order) vs **`display_ts`** (presentation). |

---

## 3. Current state

### 3.1 Palladium's sync engine — built vs. not

Source: `libs/palladium/STATUS.md` + direct code reading.

| Layer | Built | Detail |
|---|---|---|
| Engine (`@palladium/core`) | ✅ | `createEngine`/`PalladiumEngine` write-router over a `StorageAdapter`; `tx/insert/update/delete`, ``exec(sql`…`)``, HLC stamping (`nextSendHlc`/`receiveHlc`), emits `changes:local`, suppresses re-emit during `applyRemote`. `Hlc`, `generateUlid`, blob adapters, versioned migrations. |
| Transport (`core/src/sync.ts`) | ✅ | `SyncTransport<S>` — POSTs local changes to `/v1/changes` via a durable `_sync_pending_changes` outbox; polls `GET /v1/changes?after=<hlc-cursor>`; applies via `engine.applyRemote()`; skips its own `nodeId`. |
| Rust backend | ✅ | `palladium-axum` (generic over `ChangeStore`), SQLite/Postgres stores, blob storage, `palladium dev` CLI. Endpoints `POST/GET /v1/changes`, `/v1/health`, blobs, OpenAPI. **No auth.** |
| **Conflict resolution** | ❌ | `applyRemote` applies unconditionally — **no HLC guard, no LWW, no CRDT**. |
| **Auth / tenancy / auth seam** | ❌ | No identity, no scoping, **no seam to plug an app backend into**. |
| **Bootstrap snapshot** | ❌ | Cold clients replay full change history. |
| **App adoption** | ❌ | No app consumes the engine/transport. |

### 3.2 Findings from live testing (2026-07-25)

A headless two-client harness exercises the real engine against a real `palladium dev` server. **insert / update / delete / bidirectional propagation all pass** with UUID PKs. Two defects:

| # | Finding | Root cause | Status |
|---|---|---|---|
| **F1** | **No LWW → permanent divergence.** Two clients editing the same row concurrently never reconcile. | `SyncTransport.#poll` → `applyRemote()` applies remote ops with **no HLC comparison**. | **Blocking.** `it.fails` guard flips green when fixed. Buglog `sync-no-lww`. |
| **F2** | **Server rejects non-UUID `row_id`** (ULID → HTTP 422, stuck in outbox). | Rust wire type is `Uuid`. | Latent trap for ULID-keyed apps; UUIDs are fine (`D6`). Buglog `sync-uuid-rowid`. |

Two pre-existing harness bugs fixed in passing: `e2e/src/setup/server.ts` binary path (`e2e-binary-path`) and `e2e/tsconfig.json` extends path (`e2e-tsconfig-extends`).

### 3.3 Palladium's *intended* conflict model (design docs)

Source: `docs/DRAFT-ARCH.md` + `answers.md`. **None implemented** — the design target Phase 1 realizes (LWW only; CRDT deferred).

| Field type | Intended strategy |
|---|---|
| Plain columns (default) | **Last-Write-Wins by HLC timestamp** |
| Columns annotated `{"sync":{"crdt":"yjs"}}` | **Yjs CRDT merge** (rich text) |
| Delete vs. concurrent update | escalated via client `onRejected` (not v1) |
| Complex / unresolvable | Row flagged `__conflict` (not v1) |

- **Column-granular** per-column deltas → LWW per column by HLC. Opt-in CRDT via SQL `COMMENT`. Tombstones+TTL for deletes. PK reconciled on **UUIDv7** (`D6`); docs handle only accidental collision, not semantic natural-key duplicates → drives **D5**.

### 3.4 Habitat's data architecture (the eventual migration target)

Habitat is **deferred** behind the POC, but it's the real target the POC models. Key facts that shape both:

| Aspect | State |
|---|---|
| Write path | **Bypasses the engine** — raw SQL in `db-shared.ts` (~1300 lines, 100+ ops). No `changes:local`. |
| Schema | `db-schema.ts` — ~20+ tables (`habits`, `completions`, `checkin_*`, `todos`, `bored_*`, `voice_notes`/`image_notes`/`scribbles`, …), all `TEXT PRIMARY KEY` via `crypto.randomUUID()`. Dual source of truth (`SCHEMA_DDL` + `migrations`), parity-guarded. |
| Natural-key `UNIQUE` (conflict hotspots) | `completions UNIQUE(habit_id, date)`, `checkin_entries.entry_date`, `checkin_completions UNIQUE(template_id, date)`, `checkin_responses UNIQUE(question_id, logged_date)`. |
| Runtime | SQLite in a Web Worker + Capacitor native. Reactivity = bespoke refetch. |
| Auth | **None.** |

> The **POC's** schema is a *minimal slice* of this (a few tables) with sync + ACL wired from the start — no legacy migration — so it proves the architecture cheaply.

### 3.5 PR #33 — merged prerequisite (for the deferred Habitat migration)

[PR #33](https://github.com/HabitatHQ/habitathq/pull/33) migrated Habitat's DB worker to the `@palladium/worker` ownership bus (leader owns OPFS; followers proxy; `OwnerContext.invalidate(tables)` fans out to every tab's `onInvalidate` — the seam sync's downlink drives). **Merged as `74e11bf`.** It's a prerequisite for the *real Habitat migration* (deferred), not the POC.

---

## 4. Gap analysis (Palladium engine, robustness review)

Engine-level gaps that shape **Phase 1** (all generic, all still valid).

| # | Gap | Mechanism | Fix |
|---|---|---|---|
| **G1** | **Engine op model is PK-only.** | `TxBuilder`/`Op` supports only `insert(row)`/`update(id,patch)`/`delete(id)` — no upserts, no non-id `WHERE`, no multi-row. | The POC schema avoids non-id writes; the real Habitat migration rewrites ~6 as read-ids-then-emit. |
| **G2** | **`applyRemote` all-or-nothing → poison pill.** | One tx per batch; cursor advanced before apply; rejection unhandled → change skipped forever. | **Phase 1a** non-poisoning apply (`D2a`). Highest-severity. |
| **G3** | **Natural-key `UNIQUE` + toggle-by-existence fires G2.** | Two **of one owner's** devices insert different UUIDs for the same `(habit,date)`. | Owner-scoped deterministic IDs (`D5`) — converges within an owner's devices; shared-list items across members stay distinct records (no cross-owner dedupe in v1, `D5`). |
| **G4** | **FK cascades + enforcement ON.** | Out-of-order child insert after parent delete → FK violation → G2. | Adapter constraint-deferral capability in the apply tx (`PRAGMA defer_foreign_keys` in the SQLite adapter; `D2a`/`D2c`). |
| **G5** | **`ChangeStore` is globally scoped** — no tenant dimension; `AppState<S>` wraps one store. | Trait/schema take no scope. | **Phase 2**: add a generic **opaque tenant scope** to the store + the **auth seam** (`D11`). *(No Habitat concepts — that's Atrium.)* |
| **G6** | **Sync state non-durable across leader failover.** | Cursor + HLC in memory; re-hydrate from full history; `nodeId` churn. | Persist `nodeId`/cursor/HLC (`D2b`). |
| **G7** | **Invalidation is table-granular.** | `ctx.invalidate(tables)` refetches whole tables. | Acceptable for v1/POC. |
| **G8** | **`_sync_*` internal tables land in the app DB.** | Outbox, `_sync_row_meta`. | Exclude from schema-parity guards; handle in EXPORT/NUKE. |

---

## 5. Target architecture (three layers)

### 5.1 Overview

```text
        ┌──────────── App (Vue) — leader tab's worker (single writer) ────────────┐
 UI ─►  │  service.dispatch(req) ──► PalladiumEngine (insert/update/delete/tx)     │
 (any   │        │                        │ emits changes:local                    │
 tab)   │        │                        ▼                                        │
        │        │                  SyncTransport ── outbox ── HTTPS ──► Atrium ─┐  │
        │        │                        ▲ poll ◄──────────────────────────────┼──┘
        │        ▼                        ▼ applyRemote (+ LWW guard)            │
        │  ctx.invalidate(tables) ──► every tab's onInvalidate ──► refetch       │
        └────────────────────────────────────────────────────────────────────────┘
                                                                                 │ (Bearer: Clerk JWT)
   ┌──────────────────────────── Atrium (Rust backend) ───────────────────────────▼──┐
   │  verify Clerk JWT (sub) · resolve workspace membership · RECORD-LEVEL ACL authz  │
   │  set owner_user_id from sub · filter reads by effective ACL · authorize writes   │
   │  owns: workspaces / memberships / invites / roles / shares(record ACL)           │
   └───────────────────────────────────────┬──────────────────────────────────────────┘
                                            │  (Palladium AUTH SEAM: authenticated scope)
   ┌────────────────────────── Palladium (generic) ─────────────────────────────────▼─┐
   │  palladium-axum + ChangeStore keyed by an OPAQUE tenant scope · POST/GET /v1/changes │
   │  · /v1/blobs · no auth vendor, no app domain                                       │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

- **App** — local-first; the engine + `SyncTransport` live in the **leader worker**; the transport talks to **Atrium** (not Palladium directly).
- **Atrium** — the gateway: authenticates (Clerk), resolves tenancy/membership, enforces **record-level ACL**, then reads/writes Palladium's store via the seam.
- **Palladium** — generic, hardened engine + a scoped change store keyed by an *opaque* scope, exposed through an **auth seam**. It never knows what a "workspace," a "member," or "Clerk" is.

### 5.2 Palladium (generic) — scoped store + auth seam (`D11`, G5)

- **Scoped `ChangeStore`** — `insert(scope, change)` / `list_after(scope, after, limit)`; `palladium_changes` gains one **opaque `scope`** column (indexed). Palladium assigns no meaning to `scope`.
- **Auth seam** — a trait the host supplies: given a request, return an **authenticated scope** (+ reject). Plus a **request-decoration** hook client-side (attach a bearer token). Palladium calls the seam; the *implementation* (Clerk, membership) lives in Atrium.
- **Palladium is network-private — Atrium-only.** `/v1/changes` and `/v1/blobs` are **not client-reachable**; only Atrium calls them (private network / mTLS / service auth). **Clients never contact Palladium directly and never supply or select the opaque `scope`** — Atrium *derives* it from the authenticated request and authorizes it before forwarding. The app's `SyncTransport` `serverUrl` points at **Atrium**, which exposes the client-facing sync surface and proxies to Palladium.
- Result: `palladium-axum` is still publishable, vendor-neutral infra — the convergence principle holds.

### 5.3 Atrium (Rust) — the HabitatHQ ecosystem backend (`D12`, `D17`)

Owns everything app/domain that the earlier draft wrongly put in `palladium-axum`:

- **Identity** — verifies the **Clerk** JWT (JWKS / issuer / audience / expiry), derives the user `sub`. Clerk is swappable (`D13`).
- **Tenancy, membership & devices** — `workspaces` (families, per app), `memberships(workspace_id, user_id, role)`, `invites(token, email)`, coarse `owner`/`member` roles, and a **`devices(node_id, user_id, …)` registry** (`D22`, multi-device per user). Bespoke (not Clerk Orgs).
- **Record-level ACL** (§5.4) — owner + grants; authorizes every read/write.
- **Server-authoritative scoping** (`D17`) — sets `owner_user_id` from `sub`, validates membership + grants, **rejects forged client metadata**, filters reads by the caller's effective ACL. `/v1/blobs` ACL-authorized.
- **Implements Palladium's auth seam** — translates an authenticated, ACL-filtered request into an opaque Palladium `scope` + change read/write.

### 5.4 Record-level ACL sharing model (`D16`, `D17`)

**Every syncable record has an `owner_user_id`** (its creator, set by Atrium from the JWT `sub`). A record's audience:

| Grant | Who sees it | Set by |
|---|---|---|
| **Private** (default) | owner only | — |
| **Household** | all members of the workspace (`read` or `read/write`) | owner |
| **Shared-with** | specific members via `shares(root_id, grantee_user_id, perm)` (`read`/`write`) | owner |

**Effective visibility to caller C** (evaluated at the record's **root**, `D21`) =

```text
active_member(C, workspace)  AND  ( C == owner  OR  household grant  OR  C ∈ shares(root) )
```

**Active workspace membership is a mandatory predicate** — a grant or `shares` row alone is not enough. So **removing a member revokes all their access** even if stale grant rows linger: on membership removal Atrium stops streaming and emits revocation signals to purge the member's cached roots (§5.4a revoke path); on membership **join**, applicable **household** grants are backfilled to the new member. **Atrium enforces** on read (filter the change stream by the caller's effective ACL) and write (owner or `write` grant; membership active; grants mutable only by the owner). Client stamps are **advisory** (`D17`).

This directly answers npalladium's cases: *"share this note with one member"* (a `shares` grant), *"some todo lists shared, some private"* and *"some categories household-wide, others personal"* (per-record grant, mixed within a table), all with a private-by-default floor.

*Open design detail (O11a):* where the ACL/grants are indexed and how Atrium filters the change stream efficiently per caller — the POC's core thing to prove.

### 5.4a ACL transitions (grant / revoke / offline)

Sharing changes over time, so the model must define **propagation**, not just steady-state visibility. Atrium owns these:

| Transition | Semantics |
|---|---|
| **Grant** (owner shares R with C, or household) | C must converge R to its current state even though R's history predates C's poll cursor. Atrium serves R's history on a **separate backfill channel, decoupled from the incremental cursor** — the main cursor is **never rewound or bumped** past unrelated changes. Mechanics: (a) backfilled changes carry their **original HLC** and apply **idempotently** via column-LWW (Phase 1b/c), so overlap with later incremental delivery is safe — dedup on a **table-qualified, change-scoped key `(table, row_id, column, hlc)`** (PKs are table-scoped, so `(row_id, column, hlc)` alone collides across tables) with the **change `id`** as the coarse idempotency unit (`(scope, change_id, op_index)`) so a re-delivered multi-op change can't merge a tombstone op with a data op; (b) the client tracks a **per-root backfill watermark** and **acks** it, so an interrupted backfill resumes without re-sending or skipping; (c) once the watermark reaches R's latest HLC, R's future changes flow through the normal incremental cursor. No out-of-order bumping of the shared cursor. |
| **Revoke** (owner ungrants C) | Atrium **stops** streaming R's future changes to C **and emits a revocation signal** (tombstone-like) so C's client **purges the local copy** of R and its children (§7.1) — **including evicting any child blob from `IDBBlobAdapter`**, not just the rows. Not a normal delete (R still exists for the owner) — a *visibility* removal on C's device. |
| **Offline write after revoke** | If C edited R offline, then reconnects after being revoked, Atrium **rejects/discards** those writes (C no longer holds a `write` grant) — the client drops them from its outbox on the revocation signal. |

These are the sharp edges of record-level ACL; the POC (Phase 5) must exercise grant-backfill, revoke-purge, and offline-write-after-revoke explicitly. The backfill channel's cursor-safety leans on Phase 1's **idempotent, commutative column-LWW apply** — that is the precondition that makes replay/overlap safe. *(Extends O11a.)*

### 5.5 Identity & local-first gating (Clerk, via Atrium)

| # | Requirement |
|---|---|
| R-A1 | **Local-first** — fully usable offline with no account; no auth UI in the default flow. |
| R-A2 | **Auth gated on sync intent** — the sign-in / create-or-join-family prompt appears only on sync opt-in. |
| R-A3 | **Clerk provides identity**, behind Atrium (lazily mounted `@clerk/vue`). |
| R-A4 | **Sync scopes to a workspace + record ACL** — a member sees the workspace's records they own or were granted. |
| R-A5 | **Claim local data on first sync** — re-home local rows into the chosen workspace, owner = caller, **private by default** (§5.6). |
| R-A6 | **Account- *and workspace* -switch isolation** — local sync state is scoped by **`(Clerk user id, workspace id)`**, not account alone. A user in multiple workspaces (`D15`, `R-A7`) must not share one outbox/cursor across them, or a workspace switch would leave `_sync_pending_changes` rows and the poll cursor bound to a **different** workspace's scope. Use a **per-account-per-workspace store** (or workspace-qualified local keys for the outbox + cursor). `D5` IDs are owner-scoped (workspace-independent) so re-homing stays safe, but the **outbox and cursor are workspace-partitioned**. A different sign-in opens a different DB; the anonymous pre-auth store is claimed on first sign-in. |
| R-A7 | **Create or join a family**, **invite** members, coarse **owner/member** roles, **multi-workspace switch** (transport re-scopes). |
| R-A8 | **Multi-device per user** (`D22`) — a user may be signed in on N devices; all converge, each edit is attributable to a device, and no device ignores a sibling device's edits. The device **self-registers** (`nodeId`) with Atrium on first authenticated sync. |

**Token plumbing** — the main thread exposes a `getToken()` provider to the leader worker over the bus (refresh on 401; re-establish on leadership handoff; re-scope on workspace switch). The **`nodeId`** is a UUIDv7 minted on first launch, persisted with the durable sync state (`D2b`).

**Device identity (`D22`).** The `nodeId` is the device's stable identity end-to-end: HLC tie-break, own-write-skip key, and — once authenticated — the key Atrium stores in its **`devices(nodeId, user_id, first_seen, last_seen, label?)`** registry (Phase 3b). A given user's devices carry **distinct** `nodeId`s, so `SyncTransport`'s own-write skip (which drops changes whose `nodeId` matches self) correctly **still applies a sibling device's changes** — convergence across one user's devices is the same LWW path as across members. The device→user binding lives in Atrium (domain); Palladium only ever sees the opaque `nodeId` inside the HLC. Per-device session revocation is **deferred** (the registry makes it a later add, not a re-architecture).

### 5.6 Family formation & merge (`D19`, O12)

**Principle — data-preservation via merge; no accidental exposure.** Family formation = **claim-into-existing-workspace** (promote-host: the inviter's workspace becomes the family; invitees re-home into it). It reuses the `R-A5` claim path + `POST /v1/changes` — **no server-side merge endpoint**.

- **Personal records** re-home by a pure `scope` relabel with **stable IDs** (`D5` owner-scoped namespace → no FK fixup, idempotent), **owner preserved**, and stay **private by default** — the member opts into household/shared grants afterward.
- **Shared records** are re-homed too; whether a re-homed record keeps its grants or resets to private is the merge policy — default **reset to private** (safest), owner re-shares.
- Idempotent via a one-time migration marker; single transaction; every local row uploaded, never deleted.
- **Deferred (v-next):** *leaving* a family (personal records re-home back to a solo workspace; granted-away records stay).

---

## 6. Convergence inventory

**Principle:** apps adopt Palladium capabilities over bespoke equivalents; Palladium stays generic (`D11`). Atrium is a *new* shared layer, not a Palladium capability.

| Capability | Status | Action |
|---|---|---|
| Storage adapters, `applySchema`, `IDBBlobAdapter`, `dbg` | ✅ Used | — |
| `@palladium/worker` bus | ✅ Landed (PR #33) | — |
| `createEngine` / `SyncTransport` / `Hlc` | ❌ Not used | POC adopts; Habitat later |
| `LiveQuery` / `useLiveQuery` | ❌ Deprecated | **Excluded** (`D7`) — use bus `onInvalidate` |
| **Auth / tenancy / ACL** | ❌ Nowhere | **Atrium** (`D12`) — new layer, plugged into Palladium's seam (`D11`) |

---

## 7. Implementation plan (POC-first)

Layers are largely **parallelizable**: Phase 1–2 (Palladium) and Phase 3 (Atrium) can proceed together; Phase 4 (POC app) depends on both.

| Phase | Goal | Layer | Status |
|---|---|---|---|
| **1** | Harden the engine sync core (F1, G1–G8) | `@palladium/core` | Next |
| **2** | Generic scoped store + **auth seam** | `palladium-axum` + core | — |
| **3** | Build **Atrium** (Clerk, tenancy, membership, **record-level ACL**) | `atrium` (new Rust) | — |
| **4** | **Mock-habitat POC example app** (local-first + sync + sharing) | Vue example app | ⭐ POC |
| **5** | Verify the POC end-to-end | — | — |
| **Deferred** | Real Habitat migration; hearth/…; native; bootstrap; CRDT; leaving-a-family | — | post-POC |

### Phase 1 — Harden Palladium's engine sync core (`@palladium/core`)

Pure engine correctness — **no auth, no scope, no domain** (those are Phase 2 / Atrium). Everything downstream leans on this: the §5.4a **backfill channel** needs an idempotent, commutative apply, and 1a's split between *seen* and *durably-applied* cursor is exactly what makes grant-backfill cursor-safe. Red→Green TDD against the existing `two-client-sync` harness.

**1a — Non-poisoning apply (`D2a`; G2, G4) — highest severity.**
- *Problem.* `applyRemote()` (`core/src/engine.ts`) wraps the **whole batch in one `tx()`** (all-or-nothing); `SyncTransport.#poll` (`core/src/sync.ts`) advances `#cursor` **per change, before apply**. One failing op (an FK violation from an out-of-order child/parent, a constraint) rejects the batch — but the cursor has already moved, so the change is **skipped forever** (poison pill).
- *Change.* Apply **per-change in its own savepoint**; a failed change is **quarantined** (dead-letter / bounded retry), never silently dropped. **Decouple "seen" from "durably applied"**: persist the cursor only up to the **highest contiguous applied HLC**, not every change merely observed.
- *Change identity is the atomic unit (`WireChange.id` + HLC).* Today `applyRemote(ops: Op[])` (`engine.ts:176`) receives **flattened ops** — the poll's `wireOpToEngine` mapping drops each `WireChange`'s `id` and HLC, so a change can't be isolated, deduped, or retried as a unit. Change `applyRemote` to receive **grouped changes carrying `{id, hlc, ops}`**; the `(id, hlc)` pair is the **savepoint boundary, the idempotency key** (a re-delivered change with a seen `id` is a no-op — not a partial re-apply), and the retry unit. `#poll`/`wireOpToEngine` (`sync.ts`) must preserve that grouping end-to-end rather than concatenating ops.
- *Adapter-neutral constraint deferral (no SQLite in core).* `@palladium/core` stays storage-agnostic — it must **not** emit `PRAGMA defer_foreign_keys`. Instead the engine wraps the per-change apply in an **adapter capability hook** (e.g. a `Transactable` option / `deferConstraints` capability the `StorageAdapter` advertises); `@palladium/sqlite-browser` implements it as `PRAGMA defer_foreign_keys = ON`, adapters without deferral emulate or no-op. So out-of-order child↔parent resolve at commit (G4) without leaking SQLite into core.
- *Files.* `engine.ts` (`applyRemote` signature + per-change savepoints), `sync.ts` (`#poll`/`wireOpToEngine` change-identity preservation, cursor logic), `storage.ts` (`deferConstraints` capability), `@palladium/sqlite-browser` (PRAGMA impl).
- *Verify.* A batch with one FK-violating change still applies the rest and does **not** skip the good changes on the next poll; deferred-FK child-then-parent commits clean; the quarantined change is retryable, not lost; **duplicate delivery of a change never partially re-applies it** (idempotent by `id`); a failed change retries **atomically** (all-or-nothing within its savepoint); **a permanently-failed change (retries exhausted) followed by a successful one — the cursor advances past both, the skip is recorded durably, and neither replays after a restart**; core carries **no SQLite-specific statements** (adapter contract test).

**1b — Column-level LWW by HLC (`D3`; F1) — blocking.**
- *Problem.* `applyRemote` calls `t.update(table, id, patch)` with **no HLC comparison** — last writer to *arrive* wins, not last to *happen*. Two devices editing the same row concurrently **never reconcile** → permanent divergence (the `it.fails` guard, buglog `sync-no-lww`).
- *Change.* **Per-column LWW keyed by HLC.** Store a per-`(row, column)` write HLC in `_sync_row_meta` (extend the existing internal table, G8). On apply, **merge column-by-column**: accept a remote column iff its HLC **>** the stored column HLC (deterministic tie-break by `nodeId`), drop stale columns; same rule local↔remote. Update-vs-delete resolved by HLC (delete carries a tombstone HLC). This makes apply **idempotent + commutative** — the precondition for §5.4a backfill replay.
- *Durable delete tombstones (`D4`).* A delete is **not** a hard row removal — it writes a **durable row-level tombstone** (a `deleted` flag + its HLC in `_sync_row_meta`, keyed table-qualified per `D3`). Retention: (a) **stored** alongside `_sync_row_meta` so it survives restart/failover and is queryable by HLC; (b) an update whose HLC is **≤** the tombstone HLC **cannot resurrect** the row (LWW: tombstone wins), while an update **>** the tombstone HLC un-deletes it deterministically; (c) **backfill replay (§5.4a) preserves tombstones** — a late/offline/newly-granted client receives the delete like any other change (the tombstone is part of the root's replayable history); (d) tombstones are **retained indefinitely in v1** — **compaction/TTL is deferred** and may discard a tombstone only once every reachable client is provably past its HLC (else a lagging client resurrects the row). App SQLite exposes only live rows; the `deleted` marker lives in the `_sync_*` layer (G8).
- *Timezone correctness (`D23`).* The HLC physical component is **UTC epoch millis** — the total order is **timezone-independent**, so two members editing the same column from different timezones resolve by *true* occurrence order (tie-break `nodeId`), never by local wall-clock. **Do not** feed any local/wall-clock time into the comparator. A user-facing edit instant is a distinct `display_ts` **column** (ordinary data, LWW'd like any other column), stored **UTC** and rendered in the viewer's local tz at the edge — it is never a conflict input. Add an assertion that `createHlc`/`sendHlc` read a UTC epoch source.
- *Files.* `engine.ts` (`applyRemote` merge), `hlc.ts` (comparator, `recvHlc`, UTC-epoch source assertion), `_sync_row_meta` schema.
- *Verify.* The `two-client-sync` `it.fails` convergence guard **flips green**; add a concurrent-column test (A sets col X, B sets col Y at overlapping HLCs → both survive; two writes to col X → higher HLC wins **regardless of arrival order**); add a **cross-timezone** test — two engines whose OS clocks report different tz offsets but the same UTC instant resolve identically (the loser is the one with the lower HLC, not the westernmost clock); add a **delete-tombstone** test — a delete then a **lower-HLC** update does **not** resurrect the row; a **higher-HLC** update does; an offline client that missed the delete receives it via replay and converges to deleted.

**1c — Durable sync state (`D2b`; G6).**
- *Problem.* `#cursor`, the engine HLC, and `nodeId` live **in memory**. On leader-worker failover the new leader re-hydrates from **full history** and the `nodeId` **churns** — breaking own-write skip and causal ordering.
- *Change.* Persist `nodeId` (UUIDv7, minted once), the **durable applied cursor** (from 1a), and the engine HLC to a `_sync_state` table **through the `StorageAdapter`** (not OPFS directly — OPFS is `@palladium/sqlite-browser`'s concern; core only sees the adapter); rehydrate on leadership handoff instead of replaying from zero.
- *Atomic checkpoint + recovery boundary (single transaction).* `nodeId`, engine HLC, durable applied cursor, and outbox (`_sync_pending_changes`) state form **one checkpoint** that must advance **atomically within the same transaction** as the operation it records: a remote-apply commit persists `{applied change, new cursor, advanced HLC}` together; a local append persists `{outbox row, advanced send-HLC}` together. On crash/failover, recovery **replays or retries any incomplete operation** from the last committed checkpoint so no change is lost or double-applied and **an HLC value is never reused** (the persisted HLC is the floor for the next `nextSendHlc`). This is the durable analogue of 1a's "highest contiguous applied HLC."
- *Files.* `sync.ts` (checkpoint/cursor persistence, outbox), `engine.ts` (nodeId/HLC load+persist, transaction boundary), `storage.ts` (`_sync_state` via adapter).
- *Verify.* Kill + restart the leader mid-sync → resumes from the persisted checkpoint (no full replay, `nodeId` stable, own-writes still skipped); a crash **between** applying a change and advancing the cursor recovers without loss or duplication; the recovered engine never re-issues a previously persisted HLC.

### Phase 2 — Generic scoped store + auth seam (`palladium-axum` + core)

Make Palladium **multi-tenant-capable without knowing what a tenant is** — an opaque scope + an auth seam. Still **no vendor, no domain** (that's Atrium).

**2a — Opaque scope on the store (G5).**
- *Problem.* `ChangeStore` (`crates/palladium-core/src/store.rs`) is **globally scoped**: `insert(&Change)` / `list_after(after, limit)` / `get(id)` take **no tenant dimension**; `AppState<S>` wraps one store; `post_changes`/`get_changes` (`routes/changes.rs`) read/write the whole store.
- *Change.* Thread an **opaque `Scope`** (newtype over bytes/`String` — Palladium assigns it **no meaning**) through the trait: `insert(scope, &change)`, `list_after(scope, after, limit)`, `get(scope, id)`. Add an **indexed `scope` column** to `palladium_changes`; every query is `WHERE scope = ?`. Cursor format (`{millis}_{counter}_{node_hex}`) is unchanged — pagination is **within a scope**.
- *Files.* `store.rs` (trait), `palladium-sqlite` / `palladium-postgres` (impls + migration), `routes/changes.rs`, `routes/blobs.rs`, `state.rs`.
- *Verify.* Two scopes' changes never cross; `list_after` under scope A never returns scope B; contract test over both store impls.

**2b — Auth seam (`D11`).**
- *Change.* A host-supplied trait `AuthSeam`: `authenticate(request_parts) -> Result<Scope, Reject>` — Palladium calls it on every `/v1/changes` + `/v1/blobs` request to obtain the **authenticated scope**, then uses only that scope. The *implementation* (Clerk, membership, ACL) lives in **Atrium** (Phase 3); Palladium ships only the trait + a trivial in-repo impl for tests. Client side: a **request-decoration hook** in `SyncTransport` (`core/src/sync.ts`) to attach a bearer token to `#poll`/upload fetches (refresh on 401).
- *Note — selector ≠ scope.* Because a user can belong to **multiple workspaces** (`D15`, `R-A7`), the client attaches an **advisory workspace *selector*** (a workspace id) alongside the token — **not** the opaque Palladium `scope`. Atrium *authorizes* the selector against membership and *derives* the opaque scope; the scope stays a server-side secret (`D11`/`D17`). Switching workspace re-scopes by changing the selector, never by the client naming a scope.
- *Files.* `palladium-axum` (seam trait, extractor, wiring), `core/src/sync.ts` (decoration hook).
- *Verify.* A trivial in-repo seam maps two bearer tokens → two scopes; a request with no/invalid token is rejected (401) before touching the store; cross-scope isolation holds end-to-end.

> **Scope granularity is deliberately coarse (workspace-level), *not* per-caller.** Under record-level ACL every workspace member sees a *different* subset (owned + granted), so the scope alone **cannot** isolate members — **Atrium filters per-caller ACL on top** (Phase 3). ⚠️ **This makes `limit`-based pagination a correctness trap** (O11a): if Atrium fetches a scope page then post-filters by ACL, a page of `n` can shrink below `n` and the cursor can stall or skip. The filter must be **pushed into the read** (ACL-aware query) or the scope must be finer — resolved in Phase 3 / O11a, flagged here so Phase 2's seam contract doesn't bake in the naïve shape.

### Phase 3 — Build Atrium (Rust) — the ecosystem backend ⭐ (biggest new build, `D12`/`D17`)

A new Rust service that is the **client-facing gateway**: it authenticates, resolves tenancy + ACL, then reads/writes Palladium's store via the seam. Palladium sits **behind** it, network-private.

**3a — Identity (Clerk, `D13`).** Verify the Clerk JWT per request — fetch + cache **JWKS**, check `iss` / `aud` / `exp` / signature, derive user `sub`. Clerk is swappable behind an internal `IdentityProvider` trait.
- *Verify.* Valid token → `sub`; expired/wrong-aud/bad-sig → 401; JWKS cache refreshes on rotation.

**3b — Tenancy, membership & devices (bespoke, not Clerk Orgs — Clerk free tier caps Orgs).** Tables: `workspaces`, `memberships(workspace_id, user_id, role)` (`owner`/`member`), `invites(token, email, expires_at)`, and **`devices(node_id PK, user_id, first_seen, last_seen, label?)`** (`D22`). Create/join family, invite, accept, workspace switch; **device self-registration** — on first authenticated sync a device upserts its `node_id` under the JWT `sub` (idempotent; `last_seen` bumped each poll). Atrium can thus attribute every change to `(user_id, node_id)` and later revoke a device.
- *Verify.* Join-via-invite adds a membership; non-members are 403; roles enforced (only `owner` mutates membership); a device registers once and re-auth is idempotent; a `node_id` bound to user A cannot be claimed by user B.

**3c — Record-level ACL (§5.4, `D16`) + server-authoritative enforcement (`D17`).** Tables: a **roots registry** `record_acl(root_id, owner_user_id, workspace_id, household_perm)` and `shares(root_id, grantee_user_id, perm)`. On **insert** (new record only): set `owner_user_id` from `sub` (ignore/reject client-supplied owner). On **update/delete**: **preserve the stored `owner_user_id`** — never re-derive it from `sub`, or a collaborator's edit would silently transfer ownership (and it would contradict the child audit-only rule, `D21`); authorize instead by owner-or-`write`-grant on the row's **existing** `root_id` (treat client `root_id` as the *target* root, validate it against that root's ACL — don't derive it from `sub`). On **read**: emit only changes the caller may see (active-membership predicate, §5.4).
- *Verify.* Owner-only private floor; household visible to all members; `shares` visible only to grantees; can't self-grant; can't forge `owner_user_id`; child inherits root (collaborator-created child included).

**3d — Seam impl + ACL-aware read filter (resolves the Phase 2 ⚠️, O11a).** Atrium implements Palladium's `AuthSeam` and, crucially, **filters the change stream by the caller's effective ACL as part of the read, not after `limit`**. Concrete model for the POC: the workspace is the coarse Palladium `scope`; Atrium maintains an **audience index** (`root_id → {owner, household?, grantees}`) and every syncable change carries its `root_id`, so Atrium can resolve visibility per change. Pagination is made ACL-safe by **filtering before applying `limit`** (Atrium over-reads the scope page, filters, and re-pages against a *stable* HLC cursor) so a caller never gets a short page that stalls the cursor. The **grant-backfill / revoke-purge** channel (§5.4a) is Atrium-side, keyed by the audience index.

- *Single-root change constraint (multi-op audience safety).* ACL is resolved **per change** via one `root_id`, but a `Change` can carry **multiple ops** — if those ops spanned **different roots** (different audiences) a single visibility decision would either leak the private op or over-hide the shared one, and the change can't be atomically applied on the grantee. **Constraint (v1): a syncable `Change` is confined to a single `root_id`** (an app transaction never crosses aggregate roots; the engine splits a cross-root `tx` into one change per root, each independently HLC-stamped). Atrium **rejects** a change whose ops resolve to more than one root. This keeps the atomic-apply unit (Phase 1a) and the ACL-filter unit **identical** — no per-op audience metadata, split, or reassembly needed. *(Per-op audience metadata is the deferred alternative if a future feature genuinely needs cross-root transactions.)*
- *Verify (mixed-audience).* A change touching two roots with different audiences is **rejected** (not partially delivered); a member sees a shared root's change but never a private sibling's, and atomic-apply holds on the grantee.
- *Verify.* A `limit=n` poll for a member who may see only every other change still advances correctly and never stalls; grant backfills prior history on a **separate** watermark; revoke purges + rejects post-revoke offline writes.

**3e — Gateway + Palladium privacy (`D11`).** Atrium exposes the **client-facing** `/v1/changes` + `/v1/blobs` (ACL-authorized, `D18`) and proxies to Palladium over a **private** channel (mTLS / service auth); Palladium's endpoints are **not client-reachable** and clients never supply the opaque scope.
- *Verify.* A direct client→Palladium call is refused at the network boundary; blob GET is 403 for a non-grantee; the app's `SyncTransport.serverUrl` points only at Atrium.

### Phase 4 — Mock-habitat POC example app (Vue) ⭐ (`burrow`)

Surface fully specified in **§7.1 (O20)**; this is the client wiring. Depends on Phases 1 + 3.

**4a — Local-first data layer.** Fresh sync-native schema (§7.1); leader-worker owns OPFS SQLite via `BrowserSqliteAdapter` + the `@palladium/worker` bus (the PR #33 pattern: leader holds the `navigator.locks` lease, followers proxy, `onInvalidate` fans out). Writes route through `@palladium/core`'s `createEngine`/`TxBuilder` (not raw SQL) so the hardened apply (Phase 1) governs both local and remote.
- *Verify.* Fully usable offline, no account, no auth UI (`R-A1`).

**4b — Sync + auth.** `SyncTransport` (`serverUrl` → **Atrium**, never Palladium) mounted in the leader; a main-thread `getToken()` bridged over the bus feeds the request-decoration hook (Phase 2b); Clerk (`@clerk/vue`) **lazily mounted only on sync opt-in** (`R-A2`). **Per-account-per-workspace OPFS store keyed by `(Clerk user id, workspace id)`** (`R-A6`) — outbox and cursor workspace-partitioned; anonymous pre-auth store **claimed on first sign-in** (`R-A5`, §5.6).
- *Verify.* No network/auth until opt-in; opt-in → Clerk sign-in → create/join family; account switch opens a different DB; **offline workspace-switch** — queue writes in workspace W1 offline, switch to W2, confirm W2's outbox/cursor never contain W1's pending changes and W1's resume intact on switch-back.

**4c — Sharing UI + blobs.** Per-root controls: habits none (private-only), lists **"Share with household"** (`read`/`read-write`), notes **"Share with member…"** picker + **revoke**; each calls Atrium grant endpoints (not a client write to ACL). Note image via `IDBBlobAdapter` → `/v1/blobs` (`D18`). The client renders Atrium's advisory grant projection (§7.1); it never holds ACL truth.
- *Verify.* Builds; grants/revokes round-trip; a shared note's image syncs to grantees only.

### 7.1 — Mock-habitat POC surface (O20) ⭐

The smallest surface that exercises **every** ACL path (private / household / per-member) **and** the child-inheritance and blob paths, with nothing that doesn't earn its place. Name: **`burrow`** (a small habitat) — lives at `examples/burrow`, a Vue example app.

**Design decision — ACL is set on aggregate roots; children inherit (`D21`; resolves O20a).** Each syncable entity is either a **root** (owns an ACL) or a **child** (carries a `root_id`; it has **no ACL of its own**). The **root's owner and ACL are the sole access authority** over every child read, write, and sharing operation — including children created by a *collaborator* (a member holding a `write` grant on the root). "Share this list" grants the *list root*; its items ride along atomically — grants stay `O(roots)`, not `O(rows)`, and a child can never be visible when its root isn't. Atrium resolves a child's audience through `root_id`; the client never grants a child directly.

**Schema (fresh, sync-native).** Every row: `id`, `owner_user_id` (Atrium-set from `sub` **on insert only**, preserved on update/delete — never re-derived, `D17`/§3c), an optional `display_ts` (UTC edit instant, rendered in the viewer's local tz — presentation only, never a conflict key, `D23`), plus children `root_id` (client-supplied as the *target* root, **validated by Atrium against that root's ACL — not derived from `sub`**, `D21`/§3c). Roots add no ACL columns (ACL is Atrium-side, `D16`). A child's `owner_user_id` is **provenance/audit only** — it records *who created* the row and **carries no access authority**; visibility and grant authority flow exclusively from the child's root. So a collaborator-created `list_item` is authored by the collaborator (audit) yet fully governed by the root owner's ACL — no conflict, because the child never asserts its own audience. No `_sync_*`/ACL columns in app SQLite — sharing truth is Atrium's; the client renders an advisory grant projection Atrium pushes down.

| Table | Role | Sharing class | Proves |
|---|---|---|---|
| `habits` | root | **Private-only** (never shareable) | the private floor |
| `completions` | child of `habits` | inherits (private) | child of a **private** root — cascade stays private; **owner-scoped deterministic IDs** (`D5`) on `(habit_id, date)` — the natural-key UNIQUE hotspot (§3.4, G3) |
| `lists` | root | **Household** (`read` / `read-write`) | workspace-wide grant, mixed with private roots in the same app |
| `list_items` | child of `lists` | inherits (household) | child of a **shared** root — grant/revoke cascades to items atomically |
| `notes` | root | **Per-member** via `shares(root_id, grantee, perm)` | targeted grant → **backfill**; revoke → **purge**; offline-write-after-revoke → **reject** (§5.4a) |
| `note_images` | child of `notes` | inherits + **blob** | binary via `/v1/blobs`, **ACL-authorized through the parent note** (`D18`); revoke must purge the blob too |

**UI surface (thin, one screen each).**
- **Habits** — list + check-off (writes `completions`). No share control (private-only; proves a root can opt *out* of sharing entirely).
- **Lists** — a list with items + a **"Share with household"** toggle (`read` vs `read-write`).
- **Notes** — a note with body + **attach image** + a **"Share with member…"** picker (per-member grant, revocable).
- **Family** — create/join, invite link, member list; per-root share state + **revoke**; account switch (`R-A6`).

**Acceptance matrix** (each row = one ACL mechanic the POC must green; verified in Phase 5):

| # | Scenario | Mechanic proven |
|---|---|---|
| A1 | Owner's habit + completions never reach any other member | private floor + private-child cascade |
| A2 | Owner shares a list household-wide; all members see list **and** items | household grant + child inheritance (atomic) |
| A3 | Owner downgrades `read-write`→`read`; member's writes rejected | perm enforcement (server-authoritative, `D17`) |
| A4 | Owner shares a note with member B only; C never sees it; B's history backfills | per-member grant + **grant-backfill** (§5.4a) |
| A5 | Owner revokes B; note **and** its image purge from B's device | **revoke-purge** cascading to the child blob |
| A6 | B edited the note offline, reconnects post-revoke | **offline-write-after-revoke reject** |
| A7 | Image round-trips; B (granted) fetches it, C (not) is refused at `/v1/blobs` | blob ACL via parent (`D18`) |
| A8 | Two workspaces, no cross-leak; can't self-grant; can't forge `owner_user_id` | isolation + anti-forgery (`D17`) |
| A9 | Family formation: B's solo burrow data re-homes into A's workspace, private-by-default | claim/merge (§5.6) |
| A10 | Constraint violation / leader failover mid-sync | non-poisoning apply + resume (`D2a`/`D2b`) |
| A11 | **One user, two devices** — edit on device 1 appears on device 2 (not skipped as own-write); each change attributable to its `nodeId`; both registered in Atrium `devices` | per-**device** own-write skip + device registry (`D22`) |
| A12 | **Two members, different timezones** edit the same shared note column concurrently — both devices converge to the same winner by UTC-HLC order, independent of local wall-clock | timezone-robust LWW (`D23`) |
| A13 | **Member removed** from the workspace while holding a live `shares` grant — access is revoked and cached roots purged even though the grant row lingers | active-membership predicate (§5.4) |
| A14 | **Cross-root change rejected** — a change whose ops span two roots with different audiences is refused, not partially delivered | single-root change constraint (§3d) |
| A15 | **Offline workspace switch** — writes queued in W1 offline, switch to W2; W2's outbox/cursor never carry W1's pending changes; W1 resumes intact on switch-back | workspace-partitioned local state (`R-A6`) |

**Explicitly out of the POC:** categories/reminders/voice-notes/scribbles and the rest of Habitat's ~20 tables (they add domain, not a new ACL path); real Habitat's `db-shared.ts` write volume; CRDT; leaving a family; bootstrap snapshot. Three roots + three children + one blob is the whole minimal proof.

### Phase 5 — Verify the POC end-to-end
- **Harness:** two members × two devices (four engines against one Atrium + Palladium), driven by the **§7.1 acceptance matrix (A1–A15)** as the pass/fail contract: private floor + private-child cascade (A1); household grant + atomic child inheritance + perm-downgrade (A2–A3); per-member grant-backfill / revoke-purge / offline-reject (A4–A6, §5.4a); blob ACL via parent (A7, `D18`); cross-workspace/member isolation + anti-forgery (A8, `D17`); family merge (A9, §5.6); non-poisoning failover (A10, `D2a`/`D2b`); per-device convergence + device registry (A11, `D22`); cross-timezone UTC-HLC LWW (A12, `D23`); **membership-removal revoke (A13, §5.4); cross-root change rejection (A14, §3d); offline workspace-switch isolation (A15, `R-A6`)**. The four-engine harness is deliberately *two devices per member* precisely to exercise A11.
- **Also assert:** ACL-safe pagination (a filtered `limit=n` poll never stalls the cursor — the Phase 2 ⚠️ / O11a); a direct client→Palladium request is refused (`D11`); convergence guard (`two-client-sync` `it.fails`) is green.
- **Exit criteria → real-Habitat go/no-go:** every A-row green + no poison-pill under fault injection ⇒ the architecture is proven and the deferred real-Habitat migration is unblocked. Feature-flagged; internal dogfooding.

### Deferred (post-POC)
- **Real Habitat migration** — route `db-shared.ts` writes through the engine (100+ ops, ~6 non-id rewrites, G1), deterministic-ID data migration (O4), schema-parity for `_sync_*` (G8), on the PR #33 worker-bus foundation.
- Roll to hearth / halcyon / hephaestus (shared identity, per-app workspaces — `D15`).
- Native (Capacitor); bootstrap snapshot; tombstone **TTL/compaction** (durable tombstones ship in v1, `D4`); CRDT; **leaving a family**.

---

## 8. Risks & open questions

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Atrium is a net-new Rust service** — the biggest new build (auth + tenancy + ACL gateway). | Its own phase (3), parallel to Palladium; the POC scopes it to what the mock app needs. |
| R2 | **Record-level ACL filtering** — Atrium must filter each member's change stream by their effective ACL, efficiently. | Prove the indexing/filter model in the POC (O11a) before real scale. |
| R3 | **Remote-apply poison pill (G2/G3/G4)** — highest-severity engine bug. | Phase 1a mandatory before any real sync. |
| R4 | **Cross-layer surface** — engine (TS) + Palladium seam (Rust) + Atrium (Rust) + Clerk + Vue app. | POC-first is the mitigation: one thin slice proves every seam before the mammoth migration. |
| R5 | **Auth-seam shape** — a wrong abstraction couples Palladium to Atrium. | Keep the seam minimal (authenticated scope + decoration); validate with a trivial in-repo impl (Phase 2) before Atrium. |
| R6 | Cold-start replays full history (no bootstrap). | Acceptable for the POC; bootstrap is deferred. |
| R7 | Clerk free-tier **user** cap (~50k, verify) + native auth differs. | Fine early; native deferred. |

### Open questions

| # | Question | State |
|---|---|---|
| O11a | **ACL storage, filtering & transitions** — where grants (`shares`, household flags) live; how Atrium filters each caller's change stream efficiently (incl. **child `root_id` → root-ACL resolution**, `D21`); and the **grant-backfill / revoke-purge / offline-write-after-revoke** mechanics (§5.4a). | Open — **the POC's core thing to prove**. |
| O12a | **Merge grant policy** — on family formation, do re-homed shared records keep grants or reset to private? Lean: **reset to private** (safest), owner re-shares. | Leaning reset-to-private (§5.6). |
| O5a | **Auth-seam contract** — exact shape of Palladium's authenticated-scope provider + request-decoration hook. | Open (Phase 2). |
| O20 | **POC scope** — which minimal tables/features the mock-habitat app includes to exercise private / household / per-member sharing + a blob. | **Proposed — §7.1** (`burrow`: 3 roots + 3 children + 1 blob; A1–A15 matrix). |
| ~~O20a~~ | **Child-ACL model** — do children inherit their root's ACL, or is every row independently owned/shared? | **Resolved: root-inheritance** (`D21`, §7.1) — child `owner_user_id` is audit-only. *(Filter/index performance of `root_id` resolution folds into O11a.)* |
| Oprod | Where Atrium + Palladium run in production. | Open (deployment). |
| ~~O1–O14~~ | Prior questions (tenancy, nodeId, migration, JWT, token plumbing, suite scope, blobs, membership, account-switch, family merge, sharing granularity). | **Resolved** — folded into `D5`–`D20` / §5. |

---

## 9. References

- **Findings & harness:** `libs/palladium/e2e/src/__tests__/two-client-sync.test.ts`; buglog `sync-no-lww`, `sync-uuid-rowid`, `e2e-binary-path`, `e2e-tsconfig-extends`.
- **Palladium:** `libs/palladium/STATUS.md`; `docs/DRAFT-ARCH.md`; `docs/answers.md`; `core/src/{sync,engine,hlc,tx}.ts`; `crates/palladium-core/src/store.rs`; `crates/palladium-axum`.
- **Worker bus:** `docs/plans/worker-bus-spike.md`; `worker/src/{db-owner,client}.ts`.
- **Habitat (deferred target):** `apps/habitat/app/lib/{db-shared,db-schema}.ts`, `app/workers/database.worker.ts`.
- **Clerk:** https://clerk.com · `@clerk/vue`.
- **PRs:** [#33](https://github.com/HabitatHQ/habitathq/pull/33) (merged) · [#35](https://github.com/HabitatHQ/habitathq/pull/35) (this ERD).
