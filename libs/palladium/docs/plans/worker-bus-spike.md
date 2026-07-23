# Spike: Palladium multi-tab worker bus (Comlink + Web Locks + BroadcastChannel)

*Branch `spike/palladium-worker-bus`. Status: spike — proves the mechanism, not production-hardened.*

## Problem (from the current codebase)

- OPFS SQLite (`opfs-sah-pool`) is **single-connection**: only one agent may open the DB file. Today each app
  hand-rolls a dedicated worker that grabs a Web Lock `{ifAvailable:true}` and, if it loses, tells the user
  *"already open in another tab — close it and refresh."* Multi-tab is a **dead-end for the second tab**.
- `hearth` additionally falls back to `{steal:true}` — two workers can then open the same OPFS DB → **corruption risk**.
- The worker RPC is a hand-rolled UUID `postMessage` bus (`@palladium/nuxt`) plus a per-app `WorkerRequest` union
  and `dispatch()` switch, **duplicated across habitat/hearth/halcyon/hephaestus**.
- No cross-tab reactivity: a write in tab A never updates tab B (and B is locked out anyway).

## Goal of the spike

One DB owner, many live follower tabs, seamless failover — packaged once so no app hand-writes a worker again.

| API | Role in the spike |
|-----|-------------------|
| **Web Locks** | Leader election. Every tab's worker `request`s one held lock; the holder is the **leader** and is the only agent that opens the OPFS DB. Losers wait in the lock queue as followers and take over automatically when the lock releases. No `steal`, no double-open. |
| **Comlink** | Typed RPC. `main thread ⇄ its own worker` (full Comlink, incl. a proxied invalidation callback). `follower worker → leader worker` over a BroadcastChannel-backed Comlink endpoint (plain data calls only — no port transfer, which BroadcastChannel can't do). |
| **BroadcastChannel** | Cross-worker coordination: leader announcements (`{type:'leader', epoch}`), the follower→leader RPC transport, and post-write invalidation fan-out (`{type:'invalidate', tables}`) that drives every tab's live queries. |

## Topology

```
Tab A  main ──Comlink(worker)──►  Worker A  ──holds lock──►  OPFS DB   (LEADER)
Tab B  main ──Comlink(worker)──►  Worker B  ──queued──┐
Tab C  main ──Comlink(worker)──►  Worker C  ──queued──┤
                                                      └─ Comlink-over-BroadcastChannel ─► Worker A

Leader A closes → lock releases → Worker B's callback fires → B opens OPFS, broadcasts {leader, epoch}
                → C reconnects its Comlink proxy to B. Main threads never notice.

Any write on the leader → broadcast {invalidate, tables} → every worker relays to its main thread → live queries re-run.
```

Key invariant: **exactly one worker holds the lock ⇒ exactly one open OPFS connection.** Web Locks provides this by
construction, which is why `steal` can be deleted.

## Why not SharedWorker (chosen against)

A SharedWorker is a single owner by construction (no election needed), but **Android Chrome has no SharedWorker**
and Safari only added it back in 16.4 — a non-starter for the Capacitor/mobile-web target. Dedicated worker + Web
Locks works everywhere the apps ship. (A SharedWorker fast-path could be added later behind the same interface.)

## Deliverables

1. `libs/palladium/worker/` — the bus package (`@palladium/worker`):
   - `broadcast-endpoint.ts` — Comlink `Endpoint` over `BroadcastChannel` with `{from,to}` addressing.
   - `leadership.ts` — Web Locks election (`becomeLeaderWhenAvailable`).
   - `db-owner.ts` — worker-side: elect → (leader) open OPFS + expose `DbApi` to main + followers + broadcast
     invalidations; (follower) proxy calls to the current leader.
   - `client.ts` — main-thread handle: stable typed proxy + `subscribe(tables, cb)` live-query trigger.
   - `protocol.ts`, `index.ts`.
2. `libs/palladium/example-multitab/` — hello-world: a shared notes list in OPFS SQLite. Add/clear notes; every open
   tab stays live-consistent; a badge shows LEADER/follower; closing the leader tab fails over invisibly.
3. Playwright check: two pages in one browser context (= two tabs sharing OPFS + locks + BroadcastChannel) —
   assert cross-tab propagation and leader failover.

## Known spike limitations (call out, don't hide)

- Invalidation table extraction is a naive regex (same shortcut as the existing `liveQuery`).
- In-flight follower→leader calls to a leader that dies are retried against the new leader after reconnect; not
  idempotent-safe for non-CRUD ops. Fine for the CRUD hello-world; a journal (see ARCHITECTURE_REVIEW §1) is the real fix.
- No auth, no server sync — orthogonal to this spike.
- Epoch is a random per-term id (uniqueness only); not a durable monotonic counter.
