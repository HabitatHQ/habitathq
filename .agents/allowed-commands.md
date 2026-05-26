# Allowed commands (any agent)

Read-only and side-effect-free commands that agents can run without prompting. Anything outside this list — especially anything that writes outside the workspace, talks to a remote, or installs software — should ask before running.

This list mirrors the permission allowlists in `.claude/settings.json` and equivalents for other agents. Update both together.

## Repo introspection

- `ls`, `find` (scoped to repo), `tree`
- `cat`, `head`, `tail`, `less` on tracked files
- `wc`, `du`, `stat`
- `git status`, `git log`, `git diff`, `git show`, `git branch`, `git remote -v`
- `git blame`, `git rev-parse`, `git ls-files`

## Lint / typecheck / test (read-only signal)

- `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test:unit`, `pnpm --filter <pkg> verify`
- `pnpm check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm verify`
- `pnpm lint:semgrep`, `pnpm lint:semgrep:all`, `pnpm lint:deps`, `pnpm dedupe:check`
- `pnpm exec biome check .`
- `cargo check`, `cargo clippy`, `cargo test` (read-only side effects on `target/` are fine)
- `cargo deny check`, `cargo audit`, `cargo machete`
- `just doctor`, `just lint`, `just test`, `just lint-changed`, `just test-changed`, `just verify <pkg>`
- `just lint-ts`, `just typecheck-ts`, `just test-ts`, `just lint-rust`, `just check-rust`, `just test-rust`
- `shellcheck` on scripts

## Format (mutates files, but reversible)

- `pnpm --filter <pkg> check:fix`, `pnpm --filter <pkg> lint:fix`, `pnpm --filter <pkg> format`
- `pnpm exec biome check --write .`, `pnpm exec biome format --write .`
- `cargo fmt --all`
- `just fmt`, `just fmt-ts`, `just fmt-rust`

## Search

- `rg` / `grep` / `ag` over repo paths
- `gh search code`, `gh search prs`, `gh search issues` (read-only)

## Dev servers + builds (local only)

- `pnpm --filter <app> dev`, `pnpm dev:<app>`
- `pnpm --filter <pkg> build` (local artefacts only)
- `cargo build`, `just build`
- `just doctor`

## Ask first

- Anything that installs software (`pnpm add`, `pnpm install`, `cargo add`, `mise install`, `brew install`).
- Anything that writes outside the workspace.
- Anything that talks to a remote: `git push`, `git fetch <remote>` (fine), `gh pr create`, `gh pr merge`, anything that posts to Slack/email/etc.
- Anything destructive: `rm -rf`, `git reset --hard`, `git clean -f`, branch deletion.
- Anything that runs the production app against real data or external APIs.
