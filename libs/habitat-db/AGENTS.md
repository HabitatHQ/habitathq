# @habitathq/db — Agent Guide

Shared local-first database plumbing for all Habitat apps. Pure TS source, no build step (consumers compile via Vite/Vitest/Jiti).

> **Transitional package.** The contents here belong upstream:
> - `SahPoolAdapter` should become a `vfs: { type: 'opfs-sah-pool' }` variant on `@palladium/sqlite-browser`'s `BrowserSqliteAdapter` (today palladium only ships the slower `oo1.OpfsDb` VFS).
> - Native (`db-native.ts`) currently constructs a `DbAdapter` directly from `@capacitor-community/sqlite`; it should switch to `@palladium/sqlite-capacitor`'s `CapacitorSqliteAdapter` + `toCapacitorDbAdapter`.
> - Once both above land in palladium, `@habitathq/db` collapses to (at most) the `DbAdapter` shim type, and can probably be deleted entirely.
>
> This package exists today only to deduplicate four byte-identical copies that lived in each app. Treat it as a holding pen, not the long-term home.

## Modules

| File | Purpose |
|------|---------|
| `src/types.ts` | `DbAdapter` interface — `queryAll` / `queryOne` / `exec` over an arbitrary backend |
| `src/sah-pool-adapter.ts` | `SahPoolAdapter` — SQLite-WASM OPFS SAH pool VFS implementing palladium's `StorageAdapter`; also exposes `serialize()` for binary export |
| `src/adapter-bridge.ts` | `toDbAdapter(storage)` and `toCapacitorDbAdapter(storage, txControl)` — wrap a palladium `StorageAdapter` to satisfy `DbAdapter`. The Capacitor variant intercepts `BEGIN/COMMIT/ROLLBACK` SQL and routes through Capacitor's transaction API. |

## Wiring a new app

Each app's `app/workers/database.worker.ts` imports the web pieces:

```ts
import { SahPoolAdapter, toDbAdapter } from '@habitathq/db'

const storage = new SahPoolAdapter({ directory: '/myapp', filename: '/myapp.db' })
await storage.open()
const adapter = toDbAdapter(storage)
```

App-specific concerns stay per-app: schema (`db-schema.ts`), domain operations + dispatch switch (`db-shared.ts`), the worker message loop, the Nuxt plugin entry, the `WorkerRequest` union, and the native bridge (`db-native.ts`) which talks to `@capacitor-community/sqlite` directly.

## Conventions

- TS source exports only — no `dist/` build step. Mirror the `@habitathq/utils` pattern.
- Pure infrastructure — no Vue, no Nuxt-specific imports.
- Don't add domain logic here. Schema-aware helpers belong in the app.
