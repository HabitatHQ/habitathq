# Palladium Sync Playground

A **visual** way to test the sync engine — no test files to read. Every card on
the page is an independent device (its own local SQLite) syncing through the
`palladium dev` server. Type in one card, watch it appear in the others.

## Run it (one command)

```bash
pnpm install                                              # once, from the repo root
pnpm --filter @palladium/example-sync-playground demo
```

That builds + starts the Rust sync server **and** the web UI, then open:

- **UI:** http://localhost:5173
- Sync server: http://localhost:3000 (bearer auth)

> First run compiles the Rust CLI, so it takes a minute. The launcher adds
> `~/.cargo/bin` and `~/.rustup/toolchains/*/bin` to `PATH` for you — no need to
> fiddle with cargo yourself. Needs Rust: https://rustup.rs

Prefer two terminals? Run the pieces separately:

```bash
pnpm --filter @palladium/example-sync-playground server   # Rust server only
pnpm --filter @palladium/example-sync-playground dev       # Vite UI only
```

### One device per port (separate windows)

The default page shows several device cards at once. To instead run **one
device per port** — a separate browser window per device, closer to real
separate machines — use `devices`:

```bash
pnpm --filter @palladium/example-sync-playground devices 3   # 3 devices (default 2)
```

It starts the server once and one Vite server per device on consecutive ports,
then prints the URLs:

- Device 1 → http://localhost:5173/?single
- Device 2 → http://localhost:5174/?single
- Device 3 → http://localhost:5175/?single

Each window is a single device (labelled by its port) and they all sync through
the one server. You don't strictly need separate ports — opening the default
page (or `/?single`) in multiple browser windows works too, since each page load
is an independent in-memory client. Single-device mode also honours query params:
`/?single&label=Phone&workspace=team-beta&server=http://localhost:3000`.

## What to try (maps 1:1 to the engine's guarantees)

| In the UI | Proves |
|---|---|
| Add a task on **Laptop** → it shows on **Phone** | basic replication |
| Edit a task's **text** on one device while toggling its **checkbox** on another | column-level merge (both edits survive) |
| **Go offline** on two devices, edit the **same** text differently, **go online** | conflict resolution / LWW convergence (F1 fix) |
| Switch a device's **workspace** to `team-beta` | tenant isolation (no cross-workspace leak) |

The status dot on each card shows the live sync state (idle / syncing / error /
paused). The `#xxxxxxxx` badge is that device's `nodeId`.
