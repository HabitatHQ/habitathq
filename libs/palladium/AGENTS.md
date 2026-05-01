# Palladium — Agent Instructions

Local-first sync engine. Rust backend, TypeScript frontend, pnpm monorepo.

## Layout

```
crates/          Rust workspace (palladium-core, -axum, -postgres, -sqlite, -cli)
packages/        TS packages (@palladium/core, react, vue, svelte, kysely, vite-plugin, cli-wrapper, e2e)
docs/            Stub — no tooling yet
```

## Commands

```sh
just lint        # biome + clippy
just fmt         # biome format + cargo fmt
just test        # vitest (workspace) + cargo test
just build       # tsc + cargo build
just ci          # lint + test + cargo-deny + cargo-audit
just deny        # cargo-deny license/advisory check
just audit       # cargo-audit
just machete     # cargo-machete (unused deps)
just test-e2e    # E2E: live binary + TS Vitest client (packages/e2e)
just cats        # CATS contract/fuzz via testcontainers Docker (requires Docker)
```

## Tooling

- **TS**: Biome (lint + format), Vitest, TypeScript 5.x strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- **Rust**: Clippy deny all/pedantic/nursery, no `unwrap`/`expect`/`panic`/`todo`/`unsafe`
- **Task runner**: Justfile only — no npm scripts for cross-cutting tasks
- **Releases**: Changesets; `@palladium/*` packages are version-linked
- **Git hooks**: lefthook (pre-commit: biome + clippy; commit-msg: Conventional Commits)

## Conventions

- No default exports (`noDefaultExport` is an error in Biome)
- `import type` for type-only imports (`useImportType` enforced)
- Rust: all crates inherit `[workspace.lints]`, no per-crate lint overrides
- Commit messages: `type(scope): description` — e.g. `feat(core): add delta model`

## Philosophy
- Functions as pure as possible.
- Use a layered framework with high-level APIs optimised for productivity and low-level APIs designed for power and expressiveness.
- MISU. Type safety.
