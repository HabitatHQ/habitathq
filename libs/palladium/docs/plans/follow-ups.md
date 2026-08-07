# Palladium sync — follow-ups & deferred work

Tracks everything **not** done on the Habitat↔Palladium sync branch
(`docs/habitat-sync-erd`, PR #36): remaining features, and the CodeRabbit
findings that were consciously deferred rather than fixed. Each deferred item
has a matching `TODO(cr/…)` or `TODO(clerk)` marker in the code — grep for it.

Companion to the ERD: [`habitat-sync-integration.md`](./habitat-sync-integration.md).

## Where things stand

| Phase | Status |
| ----- | ------ |
| 1 — hardened engine (column-LWW, non-poisoning apply, durable state) | ✅ done |
| 2 — opaque tenant `Scope` + auth seam | ✅ done |
| 3a/3b/3c — Atrium identity, tenancy, record ACL, blob ACL | ✅ done |
| 4 — `burrow` POC app (dev identity, OPFS) | ✅ done |
| 5 — headless A1–A7 acceptance matrix (real client stack) | ✅ done (7/7) |
| **Clerk** — real identity | ⛔ **not started** (scheduled last) |

The CodeRabbit review (PR #36) surfaced 30 findings; ~18 were fixed in
`fix: address CodeRabbit review (PR #36)`. The rest are below.

---

## 1. Clerk — the one remaining feature

Deliberately deferred to last. The seam is built; Clerk slots in as one trait
impl + one header change. Nothing in the ACL/sync/UI model needs to change.

- **`ClerkProvider` (Atrium)** — `libs/palladium/crates/atrium/src/identity.rs:43`
  (`TODO(clerk)`). Implement `IdentityProvider` by verifying a Clerk session JWT
  against the instance JWKS (RS256): check `exp`/`iss`/`azp`, return
  `UserId(claims.sub)`. **Open design decision:** the trait is currently
  synchronous, so either (a) background-refresh the JWKS into a cache and verify
  synchronously, or (b) make `authenticate` async and update the `Caller`
  extractor. Wire behind `--auth clerk` in `main.rs` (env `CLERK_JWKS_URL` /
  `CLERK_ISSUER`); see `main.rs:53`.
- **burrow bearer** — `libs/palladium/example-burrow/src/atrium.ts:267`
  (`TODO(clerk)`). Swap the dev bearer for `await clerk.session.getToken()`.
- **burrow sign-in gating** — `libs/palladium/example-burrow/src/App.vue:11`
  (`TODO(clerk)`). Replace the preset-user picker with Clerk sign-in, gated on
  sync opt-in (local-first: no prompt until sync is enabled).
- **You** set up the Clerk account + keys when we get here.

---

## 2. Deferred CodeRabbit findings

### 2a. Core CRDT / concurrency correctness

- **F21 — concurrent `applyRemote` could drop a local change event. ✅ FIXED**
  (round 2). `tx()` and `applyRemote()` now run their write critical-sections
  through a shared `#serialize` promise chain in `engine.ts`, so their
  `#suppressLocalEmit` windows can't overlap; live-query notification stays
  outside the chain to avoid subscriber-reentrancy deadlock. Regression test:
  `engine.test.ts` "a local tx concurrent with applyRemote still emits
  changes:local (F21)".
- **F22 — a remote insert after a remote update discards the newer update.**
  ⛔ still deferred (needs update-buffering — a focused fix + tests, not a
  hot-patch). `libs/palladium/core/src/engine.ts:650` (`TODO(cr/F22)`). When an
  update for a not-yet-present row arrives first, it stamps column metadata but
  can't store
  its value (patch is a no-op on an absent row); a later lower-HLC insert then
  overwrites both value and metadata. Correct fix: **buffer updates for absent
  rows** (or persist their values) rather than stamp metadata for a row that
  doesn't exist. Stamping only the winning columns would keep the metadata but
  still restore the stale value — a paper-over, so avoided.

### 2b. Atrium data-integrity / delivery protocol

- **F9 — grant/revoke events marked delivered before client ack.**
  `libs/palladium/crates/atrium/src/routes/changes.rs:200` (`TODO(cr/F9)`).
  Events are consumed as soon as the handler builds a response; a dropped
  connection can make a grantee miss backfill or a revoked client miss its
  purge. Stronger contract: return durable event ids, mark delivered only on an
  explicit client ack, keep backfill/purge idempotent until then. *At-most-once
  is acceptable for the POC.*
- **F10 — record metadata and change persistence aren't atomic.**
  `libs/palladium/crates/atrium/src/routes/changes.rs:144` (`TODO(cr/F10)`). ACL
  metadata (Atrium DB) and the change log (separate store) aren't written in one
  transaction; a failed `changes().insert` leaves orphan metadata. Mitigated
  today by INSERT-OR-IGNORE idempotency + one-row-per-change; full atomicity
  needs both facts in one store (or a durable rollback), which lands with the
  two-service prod topology (`Oprod`).
- **F2 — no `devices` registry (D22).**
  `libs/palladium/crates/atrium/src/db.rs:14` (`TODO(cr/F2)`). Atrium can't bind
  a `nodeId` to its user, reject cross-user device rebinds, or drive multi-device
  auditing. Add `devices(node_id PK, user_id, created_at)` + an authenticated
  upsert (many devices per user, reject another user rebinding a node_id) with
  acceptance tests. Separate feature from the ACL/sync proof.

### 2c. Infra / migration (pre-release hardening)

- **F1 — store `scope` upgrade migration.**
  `libs/palladium/crates/palladium-sqlite/src/store.rs:12` (`TODO(cr/F1)`).
  `CREATE TABLE IF NOT EXISTS` won't add `scope` to a pre-`scope` table, so the
  `(scope, hlc_key)` index would fail on an in-place upgrade. Palladium is
  pre-release with no shipped scope-less DBs, so a guarded `ALTER TABLE … ADD
  COLUMN scope … + backfill 'default'` is deferred to the first release that
  must migrate an existing store. **Mirror in `palladium-postgres/src/store.rs`
  when added.**
- **F20 — FK deferral without FK enforcement.**
  `libs/palladium/sqlite-node/src/adapter.ts:129` (`TODO(cr/F20)`). SQLite
  defaults `PRAGMA foreign_keys` OFF, so `deferForeignKeys()` currently guards
  nothing. Turning enforcement on (`PRAGMA foreign_keys = ON` in `open()`, both
  adapters, all VFS types; remove the manual pragma in `defer-fk.test.ts`) can
  surface latent violations in the Habitat app's existing schema/seeds — it needs
  its **own validated migration**, not a ride-along on this PR.

### 2d. Won't-fix (documented reason)

- **F25 — `noUnusedImports` off for `**/*.vue`** (`biome.json`). Kept: Biome
  lints only the `<script>` block of an SFC, not `<template>`, so template-only
  imports read as unused. The override is already `.vue`-scoped (narrow, not
  repo-wide); `vue-tsc` still catches genuinely unused symbols; `biome.json` is
  strict JSON here so the rationale can't live inline (it's in the fix commit).
  Revisit if Biome ships template-aware usage (biomejs/biome#1854).
- **F5 / F6 — haptics + 44px touch targets in `example-sync-playground`.** The
  playground is a desktop developer tool, not the shipped mobile app;
  `useHaptics` isn't available there and the mobile touch-target guideline
  doesn't apply. (The same a11y items **were** applied to `burrow`.)

---

## 3. Other follow-ups

- **burrow OPFS, same-user multi-tab.** Each account uses an `opfs-sah-pool`
  store keyed by a per-user pool directory, so two tabs of *different* users are
  fine, but two tabs of the *same* user + workspace contend for one SAH pool
  (falls back to in-memory). Real multi-tab needs the OPFS worker bus (PR #33
  lineage) as the single leader. Fine for the demo (alice tab + bob tab).
- **Live 2-tab eyeball. ✅ DONE.** Ran the full alice+bob flow in Chrome against
  a live Atrium: private floor, household grant (+ child), per-member
  grant→backfill, revoke→purge, and reload/rehydrate all behaved correctly. One
  bug found + fixed during that run (returning-user workspace list, below).
- **Prod topology (`Oprod`).** ERD §5.2's two-service private-network split
  (Atrium ⇄ a separate `palladium-axum`) is the eventual production deployment;
  the POC embeds the store as a library. Deferred.

## 4. Self-review findings (burrow POC + sync interaction)

From a CodeRabbit-style self-review + the live browser run. One fixed inline;
the rest are low-severity POC polish, tracked here.

- **Returning user saw an empty family list on reload. ✅ FIXED** (`App.vue`).
  `refreshWorkspaces()` only ran via `watch(user)`, which doesn't fire for the
  initial URL-preset `?user=`, so a reload showed no families and no way back to
  a joined workspace. Fixed with `{ immediate: true }`. Verified live: bob's
  family reappears and rehydrates on reload.
- **Client sync cursor can regress after a grant.** `changes.rs` grant-backfill
  appends older-HLC changes after newer ones, and `SyncTransport.#poll` sets the
  cursor to each applied change's HLC with no monotonic guard — so the cursor
  moves backward once per grant, forcing a redundant (idempotent) re-fetch on the
  next poll. Self-heals; fix is a one-line monotonic-max guard on the client
  cursor. Medium; worth doing with the F9 delivery work.
- **`crypto.subtle` assumed present** (`HabitsSection.completionId`). Works on
  `localhost` (a secure context) but is `undefined` over plain-HTTP LAN origins,
  where toggling a habit would throw. Guard with a `crypto.randomUUID()` fallback
  if the demo ever needs to run off-localhost.
- **New-list-item input doesn't clear after add** (`ListsSection`). `draftItem`
  is a `Map` inside a `ref`; `.set()` mutation isn't reactive, so the typed text
  lingers. Use a reactive record or reassign the Map. UX only.
- **Orphan blob on failed row insert** (`NotesSection.attachImage`). The blob is
  PUT before the `note_images` row insert; if the insert throws, the blob is
  stored with no referencing row. Minor; acceptable for the POC.
- **`today` captured at mount** (`HabitsSection`). A session left open past
  midnight writes completions under the previous day. Recompute per toggle.
- **Object URL created after unmount leaks** (`NotesSection.loadThumb`). If a
  `getBlob` resolves after the component unmounts, its object URL escapes the
  `onUnmounted` revoke. Guard with a cancelled flag. Minor.
