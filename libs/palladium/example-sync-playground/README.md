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

## What to try (maps 1:1 to the engine's guarantees)

| In the UI | Proves |
|---|---|
| Add a task on **Laptop** → it shows on **Phone** | basic replication |
| Edit a task's **text** on one device while toggling its **checkbox** on another | column-level merge (both edits survive) |
| **Go offline** on two devices, edit the **same** text differently, **go online** | conflict resolution / LWW convergence (F1 fix) |
| Switch a device's **workspace** to `team-beta` | tenant isolation (no cross-workspace leak) |

The status dot on each card shows the live sync state (idle / syncing / error /
paused). The `#xxxxxxxx` badge is that device's `nodeId`.
