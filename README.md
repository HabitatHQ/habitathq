# Habitat

A monorepo of local-first apps built with Nuxt 4, SQLite, and Capacitor 8 for web and native platforms.

| App                            | Purpose          |
| ------------------------------ | ---------------- |
| [Habitat](apps/habitat/)       | Habit tracking   |
| [Hearth](apps/hearth/)         | Family finance   |
| [Halcyon](apps/halcyon/)       | Personal CRM     |
| [Hephaestus](apps/hephaestus/) | Workout tracking |

Shared libraries live in `libs/`, including [Palladium](libs/palladium/README.md), the local-first storage and sync engine.

## Getting started

Use Node.js 24.21.0, pnpm 11.13.1, and Rust 1.99.0, as pinned in `mise.toml`, `package.json`, and CI. Run `mise install` to provision these versions before verification.

The root `packageManager` pin keeps short commands and long-lived dev servers on the same pnpm version. Dependency updates and frozen installs retain a 24-hour release-age limit; newly published versions must age before adoption.

Run from the repository root:

```sh
pnpm install
pnpm dev:habitat
```

To start another app, use `pnpm dev:hearth`, `pnpm dev:halcyon`, or `pnpm dev:hephaestus`.

## Git worktrees

Use a separate Git worktree for parallel work so each checkout has its own `node_modules`, generated Nuxt files, and Rust `target/` artifacts. The stable team workflow uses native Git:

```sh
git fetch origin
git worktree add -b feature/my-change .worktrees/my-change origin/main
cd .worktrees/my-change
just worktree-setup
```

This creates a new branch from the fetched `origin/main`; it does not switch or reset an existing branch. Run `just worktree-setup` again from a worktree to safely rerun setup. The setup script installs frozen pnpm dependencies, builds Palladium TypeScript packages, and prepares Nuxt for all four apps. It keeps regular package-manager-managed `node_modules` contents and does not copy dependencies, ignored files, credentials, or configuration from another checkout.

[`k1LoW/git-wt`](https://github.com/k1LoW/git-wt) is an optional personal helper, not a team requirement. For a repo-local personal configuration and explicit branch creation from the fetched default branch:

```sh
git config --local wt.basedir .worktrees
git fetch origin
git wt -b feature/my-change my-change origin/main
```

Shell navigation/completion integration is optional; follow the helper's installation instructions only if you want it. Leave ignored-file copying, symlink options, and creation hooks off. Native `git worktree` remains the fallback and team convention; the repository does not install the helper or change shell startup.

The setup script sets `CARGO_TARGET_DIR` to this worktree's absolute `target/` directory for its own commands only; it cannot change the calling shell's environment. If mise has supplied another checkout's target path, run Rust or E2E commands **from the worktree root** with:

```sh
export CARGO_TARGET_DIR="$PWD/target"
```

Before removing a worktree, inspect and review what will be removed: worktree removal can delete ignored local data, and branch deletion can discard work. Do not remove a worktree or branch without checking its contents and branch state first; setup performs no automatic cleanup.

## Checks

```sh
pnpm check        # Lint and formatting checks
pnpm typecheck    # TypeScript checks
pnpm test:unit    # Unit tests
pnpm verify       # Full pnpm CI checks, including dependency checks
```

For one app, run `pnpm --filter habitat verify` (replace `habitat` with the app name).

For affected application and maintained Palladium unit suites, use `just test-changed` (or `just test-changed <base-ref>`). It includes committed, tracked working-tree, and untracked workspace changes plus dependent projects; shared configuration changes run all eligible suites. It builds Palladium exports first. Live server E2E, examples, and manual model replay remain separate—this is not a replacement for full CI.

CI runs core lint, typechecks, and unit contracts once in the maintained-package job. The sync job retains Rust/Postgres/OIDC integration, server/network-fault E2E, browser OPFS/ownership recovery, and architecture checks. The Hephaestus production-PWA browser gate remains in its app job.

See the [Habitat README](apps/habitat/README.md) for app details and native builds, and the [glossary](GLOSSARY.md) for shared terminology.
