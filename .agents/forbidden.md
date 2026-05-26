# Forbidden actions (any agent)

These actions are blocked across all agents working in this repo. If a workflow seems to require one of them, stop and ask the user.

## Lock + manifest

- **Don't hand-edit `pnpm-lock.yaml` or `Cargo.lock`.** Always go through the package manager (`pnpm add`, `pnpm install`, `cargo add`, `cargo update`).
- **Don't hand-edit `package.json` dependency blocks.** Use `pnpm add <pkg>` or `pnpm remove <pkg>`. Lefthook's `manifest-guard` will block commits where `package.json` changed without a matching `pnpm-lock.yaml` diff.
- **Don't install global pnpm packages** (`pnpm install -g`). All deps live in the workspace.

## Quality gates

- **Don't skip hooks.** No `--no-verify`, no `git commit -n`, no `--no-gpg-sign`. If a hook fails, fix the underlying issue.
- **Don't suppress a lint without a reason.** Inline disables must carry an explanation: `// biome-ignore lint/x/y: <reason>`, `// nosemgrep: <rule-id> -- <reason>`. Reasonless suppressions are themselves lint errors.
- **Don't paper over a guardrail.** If semgrep / dependency-cruiser / pnpm-dedupe flags something, fix the root cause or escalate.
- **Don't add `as any` or `@ts-ignore`** to silence type errors. Narrow with a type guard or `unknown` cast.

## Git

- **Don't force-push to `main`.** Don't `git reset --hard` or `git push --force` on shared branches without explicit user approval.
- **Don't amend published commits.** Always create a new commit.
- **Don't commit secrets.** No `.env`, `credentials.json`, API keys. If unsure, ask.
- **Don't `git add .` or `git add -A`.** Stage specific paths to avoid sweeping in untracked junk.

## Destructive shell

- **Don't `rm -rf` the workspace root, `target/`, or `node_modules/`** without confirming with the user. Use `cargo clean` / `pnpm clean` when you mean it.
- **Don't delete the `.worktrees/` or `.claude/worktrees/` directories.** They may hold in-progress work.

## Scope

- **Don't import across apps** (`apps/habitat/**` reading from `apps/hearth/**`, etc.). Promote shared code to `libs/` first. dependency-cruiser will block this.
- **Don't make `@palladium/core` depend on framework bindings** (`react`, `vue`, `svelte`, `nuxt`). It must stay framework-agnostic.
- **Don't have adapter packages import each other.** Cross-binding deps are blocked.

## Suspicious patterns flagged by semgrep

- `console.error` outside `utils/error.ts` — use `logError(context, err)` instead.
- `db.queryOne` in `db-shared.ts` (habitat) — use `db.queryAll`; tests override `queryOne` with call counters.
- `<UIcon name="i-…">` in hearth — use `<AppIcon name="semantic-key">`.
- Manual `Teleport` + fixed overlay — use `<AppModal>` instead.
- Stray `console.log` (warning) — remove before commit.
