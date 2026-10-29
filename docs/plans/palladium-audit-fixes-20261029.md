# Palladium audit fixes — 2026-10-29

## Baseline and scope

Work in an isolated branch from `origin/main` at `5bd9c63`, preserving the primary checkout's existing edits and untracked files. The preceding audit used an older local checkout. Current main already rejects insert identity mismatches, suppresses stale initial framework results and disposed Svelte lifetimes, and checks Web Push subscription-registration HTTP responses. Verify those upstream fixes rather than duplicating them.

Remaining changes:

1. Replace Web Push's unconditional delivery success with a real configurable HTTP send. A subscription-only channel must not claim delivery. Send the full notification and acknowledged subscription, surface HTTP/network failures through `ChannelStatus`, and preserve ordinary fallback behavior.
2. Implement repeatable CLI `dev --instance NAME:PATH` using the existing API router mounted at `/instances/NAME`. Explicit instances override `--db`; default single-store routing and authentication remain unchanged. Reject duplicate or unsafe route names before opening stores.

## Verification

- Reproduce outstanding behavior before editing using baseline source or the actual baseline CLI.
- Run full Web Push, notifications-core, React, Vue and Svelte suites; build and typecheck affected TypeScript packages.
- Run Rust core, generic HTTP, Atrium and CLI suites, plus strict Clippy and formatting checks for changed Rust code.
- Exercise actual HTTP send/fallback with a loopback receiver and the compiled CLI with two named stores, distinct replicated changes, unknown-instance requests, explicit database override and bearer authentication.
- Check all matching constructors/callers, stage only intended paths, and publish normally to `main` after fetching again; never force-push.

## Delivery semantics

Web Push `delivered` means the configured application backend accepted the send request with HTTP success; it does not certify device receipt. The application backend owns VAPID credentials and provider delivery. No private signing material belongs in the browser channel.

Named CLI instances expose the complete existing API under `/instances/NAME`; clients use that instance base URL. No implicit default database is opened when explicit instances are supplied.

## Results

- Before implementation, the compiled CLI returned HTTP 404 for a named instance
  while opening the default database. The new Web Push regression module also
  demonstrated false delivery and suppressed fallback against the baseline.
- `just test-ts`: 894 maintained TypeScript tests passed, including all 43 Web
  Push cases and the existing framework lifetime regressions.
- `just typecheck-palladium-ts`: passed.
- `cargo test --workspace`: 217 tests and 4 doc tests passed. This includes the
  existing Atrium malformed-insert rejection coverage and six new real-process
  CLI integration cases. Child servers are terminated and awaited before their
  temporary databases are removed.
- `cargo clippy --workspace --all-features --all-targets -- -D warnings`: passed.
- `just lint-palladium-ts`, `pnpm lint:deps` and changed-file Semgrep: passed.
  Biome still reports existing non-fatal complexity/static-class warnings.
- Actual compiled CLI HTTP smoke verified isolated named histories, rejection
  of mismatched insert IDs, unknown-instance 404, untouched default database,
  override of an invalid `--db`, bearer authentication and unchanged root routing.
- Built Web Push HTTP smoke used a loopback application receiver to verify
  registration, complete send payload, HTTP 503 fallback into the real toast
  implementation, missing-endpoint skip and network-failure reporting.

Push-provider/device delivery and Docker-gated PostgreSQL, CATS and OIDC suites
were not exercised. Backend HTTP acceptance is not evidence of device receipt.
