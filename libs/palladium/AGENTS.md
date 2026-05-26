# Palladium — Agent Instructions

Local-first sync engine. **Rust backend + TypeScript frontend**, part of habitat-monorepo.

## Layout

```
libs/palladium/
├── crates/                              ← Rust backend (workspace at monorepo root)
│   ├── palladium-core/                  shared types (NodeId, Hlc, Op, Change)
│   ├── palladium-axum/                  Axum router + middleware
│   ├── palladium-postgres/              Postgres backend + LISTEN/NOTIFY broadcaster
│   ├── palladium-sqlite/                SQLite server backend
│   ├── palladium-blobs/                 Blob storage
│   └── palladium-cli/                   `palladium` CLI (migrations, codegen)
│
├── core/             @palladium/core — engine, HLC, SQL, blob adapters, migrations
├── react/ vue/ svelte/                  framework bindings
├── kysely/                              Kysely dialect adapter
├── sqlite-browser/ sqlite-capacitor/    storage adapters
├── sqlite-node/
├── nuxt/             @palladium/nuxt — worker-bus utility
├── vite-plugin/                         COOP/COEP dev headers
│
├── notifications-core/                  @palladium/notifications-core + channel adapters
├── notifications-{browser,capacitor,expo,react,svelte,toast,vue,web-push}/
│
├── cli-wrapper/                         palladium-cli npm shim
├── e2e/                                 end-to-end tests (TS client ↔ Rust server)
├── example-vue/ example-react/ example-capacitor/
└── docs/                                architecture docs (DRAFT-ARCH.md, idea.md)
```

Rust workspace root is the **monorepo root** (`Cargo.toml`, `Cargo.lock`, `deny.toml`, `.cargo/`).
Members glob: `libs/palladium/crates/*`.

## Commands

```sh
pnpm --filter @palladium/core test    # Test a single TS package
pnpm --filter @palladium/core build   # Build a single TS package
pnpm --filter @palladium/core lint    # Lint a single TS package

cargo test -p palladium-core          # Test a single Rust crate
cargo run -p palladium-cli -- --help

just lint                             # lint TS + Rust
just test                             # test TS + Rust
just ci                               # full CI pipeline
```

## Tooling

- **TS lint + format**: Biome (extends root `biome.json` — double quotes, semicolons, stricter rules)
- **TS tests**: Vitest (workspace at `libs/palladium/vitest.workspace.ts`)
- **TS base tsconfig**: `libs/palladium/tsconfig.base.json` (packages extend via `../tsconfig.base.json`)
- **TypeScript**: Strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- **Rust lint**: Clippy with workspace lints (`-D warnings`)
- **Rust security**: `cargo deny` (`deny.toml`), `cargo audit`, `cargo machete`
- **Mutation testing**: Stryker (TS) at `libs/palladium/stryker.config.mjs`; cargo-mutants (Rust)
- **Pre-commit**: `lefthook.yml` at root (biome + clippy + taplo + prettier + semgrep + size + manifest guard)
- **Toolchain**: `mise.toml` at root (node, pnpm, rust, just, cargo-deny/audit/machete)
- **Architecture lint**: `dependency-cruiser` enforces `@palladium/core` stays framework-agnostic and adapters don't loop back into core. Config: `.dependency-cruiser.cjs` at root. Run: `pnpm lint:deps`.
- **Pattern lint**: `semgrep.yml` at root catches `as any`, `@ts-ignore` without reason, stray `console.log`. Run: `pnpm lint:semgrep:all`.

## Key Modules (`@palladium/core`)

| Module | Purpose |
|--------|---------|
| `storage.ts` | `StorageAdapter` interface — foundational DB abstraction |
| `db-adapter.ts` | `DbAdapter` interface + `toDbAdapter()` / `toCapacitorDbAdapter()` bridges for app use |
| `migration.ts` | `SchemaConfig`, `applySchema()`, `applySeeds()` — declarative migration framework |
| `idb-blob-adapter.ts` | `IDBBlobAdapter` — IndexedDB-backed binary blob storage with optional chunking |
| `debug.ts` | `dbg()` — gated debug logging, zero-cost when disabled, worker-safe |
| `hlc.ts` | Hybrid Logical Clock primitives |
| `ulid.ts` | ULID generation |

## Conventions

- No default exports (`noDefaultExport` is an error in Biome)
- `import type` for type-only imports (`useImportType` enforced)
- Rust: no `unsafe_code`, no `unwrap`/`expect`/`panic` in production code (clippy denies)
- Commit messages: conventional commits — `type(scope): description`

## Philosophy

- Functions as pure as possible.
- Layered framework: high-level APIs for productivity, low-level for power.
- MISU. Type safety.
