---
scope: monorepo-root
applies_to: "**"
last_verified: 2026-05-26
---

# Habitat Monorepo — Agent Guide

pnpm workspace monorepo. All apps are Nuxt 4 SPAs with Capacitor 8, local-first SQLite WASM + OPFS.

Sub-tree guides live at `apps/<name>/AGENTS.md` and `libs/<name>/AGENTS.md` — read the one nearest your edit.

## Apps

| App | Port | Description |
|-----|------|-------------|
| habitat | 3000 | Habit tracker |
| hearth | 3100 | Family finance |
| halcyon | 3300 | Personal CRM |
| hephaestus | 3210 | Workout tracker |

## Commands

```bash
# Root-level (runs across all apps)
pnpm dev:<app>        # Dev server for specific app
pnpm check:fix        # Lint + format all
pnpm typecheck        # Typecheck all
pnpm test:unit        # Unit test all
pnpm ci               # Full CI (check + typecheck + test:unit)

# Per-app (from apps/<name>/ or via --filter)
pnpm --filter <app> dev
pnpm --filter <app> check:fix
pnpm --filter <app> typecheck
pnpm --filter <app> test:unit
```

## Conventions

1. Use Red/Green TDD.
2. Run `pnpm --filter <app> check:fix` before finishing work.
3. Conventional commits: `feat|fix|chore|...(scope): description`
4. Each app has its own AGENTS.md with app-specific architecture and schema docs.
5. Install deps from monorepo root (`pnpm install`), never from app subdirs.

## Collaboration

1. Ask interactively in batches when designing features.
2. Be mindful of parallel agents — use git worktrees in `<repo>/.worktrees/<branch>/` (Claude Code uses `.claude/worktrees/`; both are gitignored).
3. Quote shell args containing `[`, `{`, `*`.
4. Run `pnpm test:unit` after meaningful changes; `pnpm check:fix` before finishing.

## Guardrails (enforced)

These are checked mechanically — pre-commit and in `pnpm ci`. Do not paper
over a failure; fix the root cause or escalate.

| Tool | Config | What it catches |
|------|--------|-----------------|
| Biome | `biome.json` | Formatting, unused imports/vars, `noExplicitAny` (palladium), `noDefaultExport` (palladium) |
| Semgrep | `semgrep.yml` | `console.error` outside `utils/error.ts`, `db.queryOne` in `db-shared.ts`, `as any`, `@ts-ignore`/`biome-ignore` without reason, stray `console.log`, manual Teleport modals, UIcon usage |
| dependency-cruiser | `.dependency-cruiser.cjs` | App-to-app imports, palladium core importing framework bindings, cross-binding deps, circular deps, prod code importing tests |
| pnpm dedupe | `pnpm dedupe:check` | New duplicate transitive deps |
| lefthook | `lefthook.yml` | Conventional commits, 512KB file size cap, hand-edited `package.json` without lockfile diff |

```bash
pnpm lint:semgrep <files>     # scan specific files (pre-commit uses this)
pnpm lint:semgrep:all         # full-repo scan (includes WARNINGs)
pnpm lint:deps                # architecture rules
pnpm lint:deps:graph          # render dependency graph SVG
pnpm dedupe:check             # detect duplicate transitive deps
```

If you need to suppress a rule, leave an inline comment explaining why
(`// biome-ignore lint/x/y: <reason>`, `// nosemgrep: <rule-id> -- <reason>`).
Suppressions without a reason are themselves a lint error.

## Glossary

Overloaded terms (vault, envelope, scribble, SAH-pool, HLC, OPFS, …) live in [`GLOSSARY.md`](GLOSSARY.md). Skim once.

## Safety classes

- **Allowed without prompting**: see [`.agents/allowed-commands.md`](.agents/allowed-commands.md).
- **Forbidden**: see [`.agents/forbidden.md`](.agents/forbidden.md). Both files apply to every agent (Claude, Cursor, Aider, Copilot, etc.).

## Verify

```bash
pnpm verify                       # full repo
pnpm --filter <pkg> verify        # one package
just verify <pkg>                 # same, via just
just doctor                       # toolchain health check
just lint-changed                 # lint files diffed vs origin/main
just test-changed                 # unit tests for changed packages
```

## Shared Nuxt + Capacitor app architecture

All apps under `apps/` follow the same shape — read this once; per-app `AGENTS.md` only covers what differs.

**Web path**: Pages → `useDatabase()` composable → `database.client.ts` plugin (UUID message bus) → `database.worker.ts` (SQLite WASM via `@palladium/sqlite-browser`, `opfs-sah-pool` VFS).

**Native path**: same composable → `db-native.ts` (Capacitor SQLite via `@palladium/sqlite-capacitor`, no worker).

Both paths share a `WorkerRequest` / `WorkerResponse<T>` message union and the `DbAdapter` / `toDbAdapter` / `toCapacitorDbAdapter` bridges from `@palladium/core`. Schema migrations + seeds use Palladium's `SchemaConfig` + `applySchema()`.

### Adding a DB operation

1. Add the message type to `WorkerRequest` in `app/types/database.ts`.
2. Implement the body (`async function myOp(db: DbAdapter, …)`) where the app keeps shared ops (`db-shared.ts` in habitat, the worker `switch` in hearth/halcyon).
3. Add a `case 'MY_OP'` arm to `database.worker.ts` *and* to `db-native.ts` (`dispatchNative`).
4. Expose via `useDatabase.ts` using `sendToWorker()`.

### Schema migrations

Increment `version` in `SCHEMA_CONFIG`, add an entry to the `migrations` map (SQL or callback). Both worker and native paths call `applySchema(storage, SCHEMA_CONFIG)` automatically — no need to mirror the migration in two places.

### TypeScript conventions (all apps)

- `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` — use bracket notation for index properties.
- No `as` casts to silence errors — narrow with type guards or `unknown` instead.
- No default exports (`noDefaultExport` lint).
- `import type` for type-only imports.

### Pass-through parent pages

For nested routes, the parent (e.g. `contacts.vue`, `transactions.vue`) contains only `<NuxtPage />`. Don't put markup in the parent.

### Required headers

`nuxt.config.ts` must set COOP `same-origin` + COEP `require-corp` (OPFS / SharedArrayBuffer). PWA vs native is gated by `BUILD_TARGET`.

## Testing layout

Each app uses this layout (create directories as needed; missing ones mean that test class isn't written yet):

| Path | Runner | What goes here |
|------|--------|----------------|
| `tests/unit/` | Vitest + happy-dom | Pure functions, helpers, parsers. Fast, isolated. |
| `tests/integration/` | Vitest + `@vue/test-utils` | Composables / components with a mocked worker. |
| `tests/e2e/` | Playwright | Full navigation flows, dashboard render, form submission. |
| `tests/a11y/` | Playwright + `@axe-core/playwright` | axe-core per page, 44 × 44 px touch-target audit, keyboard nav. |

Current adoption: hearth + halcyon follow the full layout; habitat has `tests/unit/` + some a11y; hephaestus is pre-tests. Prefer Red/Green TDD — write the failing test in the lowest tier that proves the bug, then implement.

For Rust crates under `libs/palladium/crates/`, follow standard `#[cfg(test)] mod tests` + `tests/` integration-test directories. Mutation tests via `cargo-mutants`.

## Watch modes (long edit loops)

```bash
pnpm --filter <app> test:unit:watch    # Vitest watch
pnpm --filter <app> dev                # Nuxt HMR
cargo watch -x 'check -p <crate>'      # Rust incremental (requires cargo-watch)
cargo watch -x 'test -p <crate>'       # Rust test loop
pnpm exec biome check --write .        # one-shot lint+format
```

## CI

GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What runs |
|----------|---------|-----------|
| `ci.yml` | push to `main`, every PR | Per-app matrix (habitat, hearth, halcyon, hephaestus): `pnpm install --frozen-lockfile`, build palladium deps, then `pnpm --filter <app> ci`. Plus root `pnpm lint:deps`, `pnpm dedupe:check`, Rust workspace lint/test. |
| `build-android.yml` | manual (`workflow_dispatch`) | Builds an Android APK for the chosen app. |
| `deploy.yml` | push to `main` (paths under `apps/**`), manual | Deploys PWA builds to GitHub Pages. |

A local `pnpm --filter <app> verify` + `pnpm lint:deps` + `pnpm dedupe:check` should approximate CI green. If CI fails on something a local run didn't catch, that's a guardrail gap — file it.
