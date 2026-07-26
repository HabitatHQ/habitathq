# ERD — HabitatHQ Sync Architecture (Palladium + Atrium)

**Status:** Reframed to a **three-layer** architecture + **record-level ACL** + **POC-first** delivery — 2026-07-26 · PR #33 **merged** (`74e11bf`) · prior O1–O14 resolved; the reframe opens O11a / O5a / O12a / O20 (§8)
**Owner:** Jeel Bhavsar
**Created:** 2026-07-25 · **Revised:** 2026-07-26
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
- **CRDT / Yjs**, bootstrap snapshots, tombstones/TTL, *leaving* a family — documented future work. *(Blob sync **is** in the POC — `D18`.)*

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
| D2a | **Remote-apply must be non-poisoning** — **per-op isolation** + `PRAGMA defer_foreign_keys`; **duplicate-specific** resolution (LWW/upsert on the unique key), **not** a blanket `INSERT OR IGNORE`; the poll **cursor advances only past the contiguous applied prefix**; a failed op is **dead-lettered** for bounded retry + surfaced. | **G2/G3/G4**: one violation must not roll back the batch, silently drop a change, or hide a non-duplicate failure. |
| D2b | **Durable sync state** — persist `nodeId` (stable per device), poll cursor, HLC alongside the outbox. | **G6**: survive leader failover without full re-hydration or identity churn. |
| D3 | **Column-level LWW** via a `_sync_row_meta` (per-column) shadow table. | The documented model; concurrent edits to *different* columns of a row both survive. Fixes **F1**. |
| D4 | **Deletes LWW'd by HLC in v1** — not escalated. | Simpler; the §2.3 escalation model is documented future work. |
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
| **D16** | **Record-level ACL sharing** — every record has an `owner_user_id` (default **private**). The owner grants access **household-wide** (all workspace members) or to **specific members** via `shares(row_id, member_id, perm)` (`read`/`write`). | O11 reversed (npalladium #2): supports "share this note with Bob," mixed-visibility tables, and household-wide vs private records — per-record, not per-table. |
| **D17** | **Server-authoritative scoping (anti-forgery)** — **Atrium** derives/validates `owner_user_id` (from the JWT `sub`), workspace membership, and every ACL grant; client-supplied scope/ACL metadata is **advisory**, validated or rejected. Reads are filtered by the caller's effective ACL; `/v1/blobs` is ACL-authorized. | Client stamps are forgeable — a member must not write as another, self-grant access, or read records they weren't shared. **Atrium is the security boundary.** |
| **D18** | **Blob sync in the POC** — `IDBBlobAdapter` binaries (a jot image) via `/v1/blobs`, **ACL-authorized** by Atrium. | Proves binary replication + per-record blob authorization end-to-end. |
| **D19** | **Family formation = claim-into-existing-workspace (promote-host), data-preservation merge** (O12, §5.6). Re-homed records keep their owner and stay **private by default**; the member opts into sharing afterward. | Reuses the claim path; no server-side merge endpoint; no accidental exposure on merge. |
| **D20** | **Deliver via a mock-habitat POC example app**, not a real-Habitat migration first. | De-risk the whole stack (hardened Palladium + Atrium + ACL + a Vue client) on a small, disposable surface before the costly real migration. |

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
| **G4** | **FK cascades + enforcement ON.** | Out-of-order child insert after parent delete → FK violation → G2. | `PRAGMA defer_foreign_keys` in the apply tx (`D2a`). |
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
- **Tenancy & membership** — `workspaces` (families, per app), `memberships(workspace_id, user_id, role)`, `invites(token, email)`, coarse `owner`/`member` roles. Bespoke (not Clerk Orgs).
- **Record-level ACL** (§5.4) — owner + grants; authorizes every read/write.
- **Server-authoritative scoping** (`D17`) — sets `owner_user_id` from `sub`, validates membership + grants, **rejects forged client metadata**, filters reads by the caller's effective ACL. `/v1/blobs` ACL-authorized.
- **Implements Palladium's auth seam** — translates an authenticated, ACL-filtered request into an opaque Palladium `scope` + change read/write.

### 5.4 Record-level ACL sharing model (`D16`, `D17`)

**Every syncable record has an `owner_user_id`** (its creator, set by Atrium from the JWT `sub`). A record's audience:

| Grant | Who sees it | Set by |
|---|---|---|
| **Private** (default) | owner only | — |
| **Household** | all members of the workspace (`read` or `read/write`) | owner |
| **Shared-with** | specific members via `shares(row_id, grantee_user_id, perm)` (`read`/`write`) | owner |

**Effective visibility to caller C** = `C == owner` **OR** a household grant **OR** `C ∈ shares(row)`. **Atrium enforces** on read (filter the change stream by the caller's effective ACL) and write (owner or `write` grant; `owner_user_id` from `sub`; grants mutable only by the owner). Client stamps are **advisory** (`D17`).

This directly answers npalladium's cases: *"share this note with one member"* (a `shares` grant), *"some todo lists shared, some private"* and *"some categories household-wide, others personal"* (per-record grant, mixed within a table), all with a private-by-default floor.

*Open design detail (O11a):* where the ACL/grants are indexed and how Atrium filters the change stream efficiently per caller — the POC's core thing to prove.

**ACL transitions (grant / revoke / offline)** — sharing changes over time, so the model must define propagation, not just steady-state visibility. Atrium owns these:

| Transition | Semantics |
|---|---|
| **Grant** (owner shares R with C, or household) | C's stream must **backfill** R and its prior history even though those changes predate C's poll cursor. Atrium serves a **grant-triggered backfill** (surface R's changes to C out of cursor order, or bump them) so C converges to R's current state. |
| **Revoke** (owner ungrants C) | Atrium **stops** streaming R's future changes to C **and emits a revocation signal** (tombstone-like) so C's client **purges the local copy** of R. Not a normal delete (R still exists for the owner) — a *visibility* removal on C's device. |
| **Offline write after revoke** | If C edited R offline, then reconnects after being revoked, Atrium **rejects/discards** those writes (C no longer holds a `write` grant) — the client drops them from its outbox on the revocation signal. |

These are the sharp edges of record-level ACL; the POC (Phase 5) must exercise grant-backfill, revoke-purge, and offline-write-after-revoke explicitly. *(Extends O11a.)*

### 5.5 Identity & local-first gating (Clerk, via Atrium)

| # | Requirement |
|---|---|
| R-A1 | **Local-first** — fully usable offline with no account; no auth UI in the default flow. |
| R-A2 | **Auth gated on sync intent** — the sign-in / create-or-join-family prompt appears only on sync opt-in. |
| R-A3 | **Clerk provides identity**, behind Atrium (lazily mounted `@clerk/vue`). |
| R-A4 | **Sync scopes to a workspace + record ACL** — a member sees the workspace's records they own or were granted. |
| R-A5 | **Claim local data on first sync** — re-home local rows into the chosen workspace, owner = caller, **private by default** (§5.6). |
| R-A6 | **Account-switch isolation** — a **per-account OPFS store keyed by the Clerk user id**; a different sign-in opens a different DB; the anonymous pre-auth store is claimed on first sign-in. |
| R-A7 | **Create or join a family**, **invite** members, coarse **owner/member** roles, **multi-workspace switch** (transport re-scopes). |

**Token plumbing** — the main thread exposes a `getToken()` provider to the leader worker over the bus (refresh on 401; re-establish on leadership handoff; re-scope on workspace switch). The **`nodeId`** is a UUIDv7 minted on first launch, persisted with the durable sync state (`D2b`).

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
- **1a Non-poisoning apply** (`D2a`, G2/G4) · **1b Column-level LWW by HLC** (`D3`, F1) · **1c Durable sync state** (`D2b`, G6). No auth changes.
- **Verify:** the `it.fails` convergence guard flips green; add non-poisoning + failover-resume tests.

### Phase 2 — Generic scoped store + auth seam (`palladium-axum`)
- Add an **opaque `scope`** to `ChangeStore` + `palladium_changes` (G5); add the **auth-seam trait** (authenticated-scope provider + request-decoration hook) and client wiring in `SyncTransport` (`D11`). **No vendor, no domain.**
- **Verify:** a trivial in-repo seam impl scopes two logical tenants; contract tests.

### Phase 3 — Build Atrium (Rust)
- New `atrium` service: **Clerk JWT verification**; `workspaces`/`memberships`/`invites`/roles; **record-level ACL** (`shares`, household/private) with **server-authoritative** owner/grant enforcement (`D17`); implements Palladium's seam; `/v1/blobs` ACL authorization.
- **Verify:** contract + isolation tests — cross-workspace, cross-member, and **ACL grant/revoke** (a member sees a record only while granted; can't self-grant; can't forge owner).

### Phase 4 — Mock-habitat POC example app (Vue) ⭐
- A **minimal Habitat slice** (e.g. `habits` [private], a `list` [household-shareable], `notes` [private, per-member shareable] + one image blob), fresh schema (no legacy migration).
- Local-first + `@palladium/core` engine + `SyncTransport` through **Atrium**; Clerk opt-in gating (`R-A1`/`R-A2`); create/join family + invite; **record-level sharing UI**; per-account store (`R-A6`); blob sync (`D18`).
- **Verify:** builds; default flow shows no auth; opt-in → Clerk + family; sharing UI grants/revokes.

### Phase 5 — Verify the POC end-to-end
- **Two members × two devices**: a **private** habit stays private; a **household** list is shared; a **note shared with one member** reaches only them (grant backfills their history); **revoke** purges it from their device and rejects their post-revoke offline writes (per §5.4a); an image round-trips via `/v1/blobs`; cross-workspace/cross-member isolation; family merge (§5.6); constraint-violation / failover pass without poisoning. Feature-flagged; internal dogfooding.

### Deferred (post-POC)
- **Real Habitat migration** — route `db-shared.ts` writes through the engine (100+ ops, ~6 non-id rewrites, G1), deterministic-ID data migration (O4), schema-parity for `_sync_*` (G8), on the PR #33 worker-bus foundation.
- Roll to hearth / halcyon / hephaestus (shared identity, per-app workspaces — `D15`).
- Native (Capacitor); bootstrap snapshot; tombstones/TTL; CRDT; **leaving a family**.

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
| O11a | **ACL storage, filtering & transitions** — where grants (`shares`, household flags) live; how Atrium filters each caller's change stream efficiently; and the **grant-backfill / revoke-purge / offline-write-after-revoke** mechanics (§5.4a). | Open — **the POC's core thing to prove**. |
| O12a | **Merge grant policy** — on family formation, do re-homed shared records keep grants or reset to private? Lean: **reset to private** (safest), owner re-shares. | Leaning reset-to-private (§5.6). |
| O5a | **Auth-seam contract** — exact shape of Palladium's authenticated-scope provider + request-decoration hook. | Open (Phase 2). |
| O20 | **POC scope** — which minimal tables/features the mock-habitat app includes to exercise private / household / per-member sharing + a blob. | Open (Phase 4) — proposal in §7. |
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
