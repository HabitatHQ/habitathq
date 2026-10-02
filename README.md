# Habitat

A monorepo of local-first apps built with Nuxt 4, SQLite, and Capacitor 8 for web and native platforms.

| App | Purpose |
| --- | --- |
| [Habitat](apps/habitat/) | Habit tracking |
| [Hearth](apps/hearth/) | Family finance |
| [Halcyon](apps/halcyon/) | Personal CRM |
| [Hephaestus](apps/hephaestus/) | Workout tracking |

Shared libraries live in `libs/`, including [Palladium](libs/palladium/README.md), the local-first storage and sync engine.

## Getting started

Use Node.js 24 and pnpm 9, as pinned in `mise.toml`. Rust stable is required for the Rust components.

Run from the repository root:

```sh
pnpm install
pnpm dev:habitat
```

To start another app, use `pnpm dev:hearth`, `pnpm dev:halcyon`, or `pnpm dev:hephaestus`.

## Checks

```sh
pnpm check        # Lint and formatting checks
pnpm typecheck    # TypeScript checks
pnpm test:unit    # Unit tests
pnpm verify       # Full pnpm CI checks, including dependency checks
```

For one app, run `pnpm --filter habitat verify` (replace `habitat` with the app name).

See the [Habitat README](apps/habitat/README.md) for app details and native builds, and the [glossary](GLOSSARY.md) for shared terminology.
