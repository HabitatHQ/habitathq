@apps/habitat/AGENTS.md
@apps/hearth/AGENTS.md
@apps/halcyon/AGENTS.md
@libs/palladium/AGENTS.md

# Habitat Monorepo

pnpm workspace monorepo. All apps are Nuxt 4 SPAs with Capacitor 8, local-first SQLite WASM + OPFS.

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
