# Palladium subscription lifetime and cursor correctness

## Scope

Fix confirmed defects in framework live-query completion ownership, worker subscription fan-out and completion ownership, and Rust AppendCursor construction/deserialization. The added overlap regressions also reproduced delayed-initial-result failures in React and Vue. Preserve unrelated app work; do not perform speculative protocol, settings, adapter, or grant-backfill refactors.

## Invariants

- Each subscription owns its asynchronous results; teardown prevents publication of pending results or errors.
- Concurrent worker listeners coexist; unsubscribe removes only its own listener and is idempotent. Diagnostic replay remains bounded and cleanup is explicit.
- Binding initial results/errors cannot replace newer change notifications; worker live-query requests publish only the latest active request.
- Every AppendCursor construction path accepts only canonical positive decimal u64 positions; wire JSON stays a decimal string. Start-of-history remains absence rather than an invalid cursor. Database signed-range checks stay at database boundaries.

## Implementation

1. Add deterministic failing regressions and related teardown, replacement, overlap, error, and boundary cases.
2. Apply the smallest coherent fixes in framework bindings, worker ownership, and cursor representation; migrate all affected callers.
3. Run complete affected TS and Rust suites, typechecks, scoped lint/format, reference/duplicate searches, and real SQLite/Comlink/HTTP smoke probes.
4. Update public documentation for changed guarantees and record exercised verification below.
5. Commit scoped changes with normal hooks and fast-forward push verified HEAD to origin/main. Never force-push; integrate intervening upstream changes if needed.

## Verification

- Test-first failures reproduced stale Svelte errors/results, React/Vue initial-result precedence, independent worker subscriptions, and invalid cursor deserialization before their fixes.
- Maintained Palladium TypeScript suites: all 882 tests passed in the final full package run, including complete React (20), Vue (6), Svelte (9), and worker (21) suites. Added async-observer regressions failed with unhandled rejections before the promise-ownership fix and passed afterward.
- Maintained TypeScript builds, typechecks, and lint passed. Existing lint warnings remain in unrelated modules; changed files pass scoped Biome checks.
- Rust workspace: 211 tests plus four Rustdoc tests passed; all-features/all-targets strict Clippy and formatting checks passed.
- Real Rust-server/TypeScript-client E2E: 50 tests passed, including paging, receipts, recovery, and Atrium device-qualified grants/revokes.
- Throwaway runtime smoke checks passed against current source/public artifacts: Svelte restart/initial-notification ordering over real SQLite; concurrent worker subscriptions, independent/idempotent unsubscribe, late-completion suppression, SQL-error reporting, and async-observer rejection ownership over real MessageChannels/Comlink and SQLite; public Rust cursor max-u64 string roundtrip and malformed-input rejection. Temporary executables were removed.
- Dependency architecture check passed. Dedupe check remains non-green on unchanged app dependency resolutions (`vue-router`, Nuxt peer snapshots, and `magic-string`); no manifests or lockfiles are changed by this fix.
- Scope/reference review found no remaining singleton worker subscription fields, and every Rust cursor constructor caller and Rustdoc example uses a nonzero position. Existing app diagnostic subscriptions remain source-compatible.
