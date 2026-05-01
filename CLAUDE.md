@apps/habitat/AGENTS.md
@apps/hearth/AGENTS.md
@apps/halcyon/AGENTS.md

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
