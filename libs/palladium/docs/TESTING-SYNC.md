# Testing the Palladium sync engine

A hands-on guide to exercising everything built in **Phase 1** (hardened engine)
and **Phase 2** (scoped store + auth seam). Covers the automated test suites and
a manual end-to-end demo you can drive by hand with `curl`.

> **What's covered**
> - Phase 1a — non-poisoning remote apply (quarantine + cursor safety)
> - Phase 1b — column-level LWW by HLC (fixes F1, permanent divergence)
> - Phase 1c — durable sync state (nodeId + HLC + cursor survive restart)
> - D2c — adapter-neutral foreign-key deferral
> - Phase 2a — opaque tenant **Scope** on the change store
> - Phase 2b — **AuthSeam** (per-request scope) + client token decoration

---

## The easy way: the UI Sync Playground (start here)

If you just want to **see sync work** — no test files, no `curl` — run the visual
playground. One page shows several independent "devices" (each its own local
database) syncing through the real server. Type in one, watch it land in the
others.

```bash
pnpm install                                               # once, from the repo root
pnpm --filter @palladium/example-sync-playground demo      # builds + starts server AND UI
```

Then open **http://localhost:5173**. (First run compiles the Rust CLI; the
launcher puts cargo on `PATH` for you.)

| In the UI | Proves |
|---|---|
| Add a task on **Laptop** → it appears on **Phone** | basic replication |
| Edit a task's **text** on one device while ticking its **checkbox** on another | column-level LWW merge (both survive) |
| **Go offline** on two devices, edit the **same** text differently, **go online** | conflict convergence (the F1 fix) |
| Switch a device's **workspace** to `team-beta` | tenant isolation (no cross-workspace leak) |

Details in `libs/palladium/example-sync-playground/README.md`. The rest of this
guide is the automated + `curl` proof, if you want it.

---

## 0. Prerequisites

```bash
# Node deps (from the repo root)
pnpm install

# Rust toolchain. NOTE: on this machine `cargo` is not on the default PATH.
# Either add it for the session:
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
# …or add it to your shell profile permanently:
#   echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.zshrc   # if the shim exists
cargo --version   # should print 1.9x
```

`cd libs/palladium` for all commands below unless stated otherwise.

---

## 1. Fast automated proof (recommended first run)

### 1a. TypeScript engine unit tests (Phase 1 + 2b client)

```bash
cd libs/palladium/core
pnpm verify         # biome lint + tsc + vitest (245 tests)
```

Targeted files, if you want to read one capability at a time:

| File | Proves |
|---|---|
| `src/__tests__/lww.test.ts` | column-LWW: higher-HLC wins regardless of arrival; disjoint columns coexist; delete-tombstone; idempotent replay (Phase 1b / F1) |
| `src/__tests__/sync-poison.test.ts` | a bad change is quarantined + dead-lettered without wedging the cursor (Phase 1a) |
| `src/__tests__/sync-durable.test.ts` | nodeId + HLC + cursor resume after a restart (Phase 1c) |
| `src/__tests__/defer-fk.test.ts` | out-of-order child/parent in one change applies whole; a dangling FK still rolls back (D2c) |
| `src/__tests__/sync.test.ts` | transport incl. the `authHeaders` decoration hook + 401 refresh/retry (Phase 2b) |

```bash
pnpm vitest run src/__tests__/lww.test.ts        # e.g. just the LWW proofs
```

### 1b. Rust server + store + auth seam tests (Phase 2)

```bash
cd libs/palladium/crates
cargo test --workspace          # scoped store, seam, HTTP handlers
cargo clippy --workspace -- -D warnings
```

Highlights:
- `palladium-sqlite` → `store::tests::scopes_are_isolated` — two scopes never cross.
- `palladium-axum` → `auth::tests::*` — the bearer seam maps a token → scope, rejects a missing token.
- `palladium-axum` → `routes::changes::http_tests::bearer_seam_scopes_by_token_and_rejects_unauthenticated`
  — end-to-end over HTTP in-process: a token scopes writes, another token sees
  nothing, no token → 401.

### 1c. End-to-end sync (two real clients ↔ the real Rust server)

This is the headless equivalent of the browser app: two `PalladiumEngine` +
`SyncTransport` pairs talking to a live `palladium` server.

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"  # cargo on PATH
cd libs/palladium/core && pnpm build     # publish engine changes to dist (the e2e imports the built package)
cd ../e2e
pnpm test                                # builds the server, boots it, runs all e2e specs
```

| Spec | Proves end-to-end |
|---|---|
| `two-client-sync.test.ts › insert/update/delete propagates` | basic replication A→B through the server |
| `two-client-sync.test.ts › concurrent update to the same column converges (LWW)` | **F1 fixed**: both clients converge to the same higher-HLC winner |
| `two-client-sync.test.ts › concurrent writes to different columns both survive` | column-level granularity survives a real round-trip |
| `auth-scope.test.ts › same token → same workspace` | a bearer token scopes a workspace; two clients with it converge |
| `auth-scope.test.ts › different token → isolated workspace` | a different token never sees the other workspace's data |
| `auth-scope.test.ts › no token → 401` | the server rejects unauthenticated requests |

> **Gotcha:** `pnpm build` in `core` first. The e2e imports the **built**
> `@palladium/core`; if you skip the build, the transport runs stale code (e.g.
> the `authHeaders` hook won't exist and auth requests silently 401).

---

## 2. Manual end-to-end demo with `curl`

Drive the wire protocol by hand to see scoping and LWW for yourself.

### 2a. Build + start a single-tenant server

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd <repo-root>
cargo build -p palladium-cli
mkdir -p /tmp/pd && cd /tmp/pd
<repo-root>/target/debug/palladium --db sqlite:demo.db dev --port 3000
# leave running; open a second terminal for the curl calls below
```

Post a change and read it back:

```bash
CHANGE='{
  "id":"11111111-1111-1111-1111-111111111111",
  "hlc":{"wallMs":1700000000000,"counter":0,"nodeId":"22222222-2222-2222-2222-222222222222"},
  "ops":[{"op":"insert","table":"tasks","row_id":"33333333-3333-3333-3333-333333333333",
          "data":{"id":"33333333-3333-3333-3333-333333333333","text":"hello","done":0}}]
}'
curl -s -X POST localhost:3000/v1/changes -H 'content-type: application/json' -d "$CHANGE"   # → 201
curl -s localhost:3000/v1/changes | jq                                                       # → [the change]

# Pagination cursor: ?after=<hlc sort key> — millis_counter_nodeHex
curl -s 'localhost:3000/v1/changes?after=00000001700000000000_0000000000_00000000000000000000000000000000' | jq
```

Inspect what's stored (CLI):

```bash
<repo-root>/target/debug/palladium --db sqlite:demo.db inspect
```

### 2b. Multi-tenant server (auth seam)

Start the server in bearer mode — the store scope is derived from the
`Authorization: Bearer <token>` header:

```bash
<repo-root>/target/debug/palladium --db sqlite:demo.db dev --port 3000 --auth bearer
```

```bash
# alice's workspace
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/v1/changes \
  -H 'content-type: application/json' -H 'authorization: Bearer alice' -d "$CHANGE"   # → 201
curl -s localhost:3000/v1/changes -H 'authorization: Bearer alice' | jq   # → [alice's change]

# bob's workspace — isolated
curl -s localhost:3000/v1/changes -H 'authorization: Bearer bob' | jq     # → []

# no token — rejected
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/v1/changes        # → 401
```

---

## 3. Capability → how to verify, at a glance

| Capability | Automated | Manual |
|---|---|---|
| **F1 fix — LWW convergence** | `core` `lww.test.ts`; e2e `concurrent update … converges` | two `curl` POSTs to the same `(table,row,col)` with different HLCs → higher HLC wins on read |
| **Column granularity** | `lww.test.ts`; e2e `different columns both survive` | POST two changes editing different columns of one row → both persist |
| **Non-poisoning apply** | `sync-poison.test.ts` | — (fault injection) |
| **Durable state / restart** | `sync-durable.test.ts` | restart `palladium dev`; the server resumes the same DB |
| **FK deferral (D2c)** | `defer-fk.test.ts` | — |
| **Opaque Scope isolation** | `scopes_are_isolated` (Rust); e2e `isolated workspace` | `--auth bearer` + two tokens (§2b) |
| **Auth seam / 401** | `auth::tests`, HTTP test; e2e `no token → 401` | `curl` without a token → 401 |
| **Client token decoration** | `sync.test.ts` auth-decoration tests | — (in the transport) |

---

## 4. Where the client sends auth (for app integration)

`SyncTransport` accepts an `authHeaders` hook. The app supplies a bearer token
(and, in the full design, an advisory workspace *selector*) — never the opaque
store scope, which the server derives:

```ts
new SyncTransport(engine, {
  serverUrl: "https://your-server",   // Atrium in production; palladium dev locally
  authHeaders: async ({ refresh }) => ({
    Authorization: `Bearer ${await getToken({ forceRefresh: refresh })}`,
  }),
});
```

On a `401` the transport re-invokes the hook once with `refresh: true` and
retries, so an expired token recovers transparently.
