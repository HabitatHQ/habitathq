# Glossary

Disambiguation for overloaded terms in this monorepo. If a term shows up twice in different apps with different meanings, it's listed here.

## Cross-cutting

- **AGENTS.md** — the canonical agent guide (this repo's adoption of the community AGENTS.md convention). Every directory with a guide has one. Root + per-app + per-lib.
- **Palladium** — the local-first sync engine that lives in `libs/palladium`. Rust backend + TypeScript frontend. Apps use `@palladium/core` (framework-agnostic) plus adapters (`@palladium/sqlite-browser`, `@palladium/sqlite-capacitor`, etc.).
- **applied_defaults** — Palladium-managed table that records which seed defaults have already been inserted, so re-running `applySeeds()` is idempotent.
- **`_palladium_seeds`** — internal Palladium table that tracks seed application metadata. Don't write to it directly.
- **SchemaConfig** — Palladium's declarative migration descriptor: `{ version, migrations: Map<from→to, sql|callback>, seeds }`. Apps build one and call `applySchema(storage, config)`.
- **DbAdapter** — TS interface shared by the SQLite-WASM worker path and the Capacitor-SQLite native path. Bridges via `toDbAdapter()` and `toCapacitorDbAdapter()` from `@palladium/core`.
- **WorkerRequest / WorkerResponse** — the discriminated-union message types exchanged between Nuxt pages (via `useDatabase()`) and the SQLite worker. Add a new variant when adding a DB op.
- **HLC** — Hybrid Logical Clock; Palladium's ordering primitive for sync.
- **ULID** — universally unique lexicographically sortable identifier; used for ops/changes in Palladium.
- **CRDT** — conflict-free replicated data type; the family of structures Palladium reconciles.

## Storage / runtime

- **OPFS** — Origin Private File System. Where SQLite-WASM persists data in browsers. Requires COOP/COEP headers.
- **SAH-pool / `SahPoolAdapter`** — "SyncAccessHandle pool" VFS for `@sqlite.org/sqlite-wasm`. Older approach; new apps prefer `BrowserSqliteAdapter` from `@palladium/sqlite-browser` (which uses the same VFS under the hood but with better lifecycle).
- **IDBBlobAdapter** — IndexedDB-backed binary-blob storage from `@palladium/core`. Used by Habitat for voice/image notes (`habitat-blobs` DB); metadata stays in SQLite.
- **PWA** — Progressive Web App. The browser build of each Nuxt app. `BUILD_TARGET=pwa`.
- **Capacitor / "native" build** — the iOS/Android shell. `BUILD_TARGET=native`. Uses `@capacitor-community/sqlite` instead of SQLite-WASM.
- **COOP / COEP** — Cross-Origin Opener / Embedder Policy headers. Required by the browser to enable `SharedArrayBuffer` (which OPFS depends on).

## Habitat-specific

- **scribble** — freeform doodle/text note (SQLite table `scribbles`).
- **jot** — informal name for journal/scribble UI; route is `/jots`.
- **bored / Bored** — the "what should I do" picker (random activity from categories).
- **applied default** — like `applied_defaults` above; in Habitat this gates seeding habit-suggestion lists.

## Hearth-specific

- **envelope** — a budget category with a periodic allotment. Spending counts down within the period; rolls over per `envelope_periods`.
- **IOU split** — multi-party share of a transaction, tracked in `iou_splits`. Drives the `/household` balances widget.

## Halcyon-specific

- **vault** — top-level data partition. Every entity (contact, note, journal entry, …) carries `vault_id`. Active vault from `useVault()`.
- **stay-in-touch** — cadence tracker per contact. Resets on (a) any logged interaction OR (b) manual dismiss.
- **`last_contacted_at`** — auto-updated timestamp on contacts; drives stay-in-touch.
- **soft delete** — non-null `archived_at TEXT`; queries filter `WHERE archived_at IS NULL`.

## Tooling

- **dependency-cruiser** — the architecture lint that enforces app↔app boundaries and Palladium core's framework-agnosticism. Config: `.dependency-cruiser.cjs`. Run: `pnpm lint:deps`.
- **semgrep** — pattern lint catching `as any`, `@ts-ignore`/`biome-ignore` without reason, manual Teleport modals, `<UIcon>` in hearth, etc. Config: `semgrep.yml`.
- **lefthook** — pre-commit/pre-push/commit-msg runner. Config: `lefthook.yml`.
- **mise** — toolchain version manager. Config: `mise.toml`. Also reads `.tool-versions` as a fallback.
- **just** — task runner used as the canonical entrypoint. Config: `Justfile`. `just --list` to discover recipes.
