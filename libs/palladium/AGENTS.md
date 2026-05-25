# Palladium — Agent Instructions

Local-first sync engine. TypeScript frontend packages, part of habitat-monorepo.

## Layout

```
libs/palladium/
├── core/             @palladium/core — engine, HLC, SQL, blob adapters
├── react/            @palladium/react — React hooks
├── vue/              @palladium/vue — Vue composables
├── svelte/           @palladium/svelte — Svelte stores
├── kysely/           @palladium/kysely — Kysely dialect adapter
├── sqlite-browser/   @palladium/sqlite-browser — WASM/OPFS SQLite
├── sqlite-capacitor/ @palladium/sqlite-capacitor — Capacitor SQLite
├── sqlite-node/      @palladium/sqlite-node — Node SQLite
├── vite-plugin/      @palladium/vite-plugin — Vite plugin
├── e2e/              E2E tests
├── example-*/        Example apps (React, Vue, Capacitor)
└── docs/             Architecture docs
```

## Commands

```sh
pnpm --filter @palladium/core test    # Test a single package
pnpm --filter @palladium/core build   # Build a single package
pnpm --filter @palladium/core lint    # Lint a single package
```

## Tooling

- **Lint + format**: Biome (extends root biome.json — double quotes, semicolons, stricter rules)
- **Tests**: Vitest (workspace config at `libs/palladium/vitest.workspace.ts`)
- **TypeScript**: Strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- **Base tsconfig**: `libs/palladium/tsconfig.base.json` (packages extend via `../tsconfig.base.json`)

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
- Commit messages: `type(scope): description` — e.g. `feat(core): add delta model`

## Philosophy
- Functions as pure as possible.
- Layered framework: high-level APIs for productivity, low-level for power.
- MISU. Type safety.
