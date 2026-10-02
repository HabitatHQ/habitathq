# Palladium audit hardening

## Scope

Implement the eight findings from the current-main audit without changing unrelated application code.

1. Provide atomic Kysely transactions with exclusive connection ownership; never silently simulate transaction success.
2. Commit IndexedDB blob chunks, metadata, and obsolete-chunk cleanup atomically and await transaction completion.
3. Permit explicit versioned engine schema upgrades while rejecting same-version identity changes and downgrades. Persist the new identity atomically with migrations; retain old outbox identity for quarantine.
4. Make operator-initiated terminal uplink discard unblock delivery while preserving payload/error evidence and explicit retry semantics.
5. Make React query loading/error state correspond to the active query, including recovery after failure.
6. Classify notification permission failures and continue configured fallback delivery; retain existing permission-prompt policy.
7. Bound Atrium grant-backfill history scans while preserving stable offers, replay, device ACKs, and captured upper bounds.
8. Repair aggregate Palladium test execution and add package-level CI verification for maintained packages.

## Integration

Work in `fix/palladium-audit-hardening`; four implementation subagents own bindings/query, blob storage, engine/sync recovery, and Atrium backfill. Integration owner owns test-runner/CI changes and shared documentation. Coordinate any new engine transaction interface before editing it. No commits or checks mid-flight; integrated checks run after implementation.

## Verification

Keep behavior-focused regressions for rollback, aborted blob writes, version upgrade/failure rollback, discarded outbox restart recovery, query error recovery, permission fallback, and bounded backfill progression/replay. Exercise actual public runtime paths with local throwaway probes. Run maintained TypeScript package verification, focused Rust tests/Clippy, architecture checks, and real-server E2E where local prerequisites are available. Remove throwaway artifacts, update existing protocol/testing docs, commit green atomic changes, and push the integrated verified result to main.

## Outcome

All eight findings are implemented. Integration review also closed transaction-start rejection, commit-error preservation, live-query rollback isolation, unknown-discard cache mutation, and repeated-discard timestamp preservation.

Observed verification:

- `just test-ts`: 641 passing tests across maintained package suites.
- Maintained package typechecks and `just lint-palladium-ts`: passed; lint retains an existing static-only test-fixture warning in web-push.
- `cargo fmt --all -- --check`, workspace all-feature/all-target Clippy, and `cargo test --locked --workspace`: passed; 206 Rust tests.
- E2E typecheck and real-server E2E: 53 passing tests.
- `pnpm lint:deps`: passed.
- Compiled public-API SQLite smokes: schema upgrade preserves rows across reopen and rejects downgrades; Kysely rollback/commit and live-query transaction isolation passed.
- Actual React/SQLite-WASM browser smoke: failed query displayed its SQL error; switching to a valid query displayed the stored row with loading cleared and no error.

`pnpm dedupe:check` remains a repository-wide failure against the unchanged lockfile, which is byte-identical to the primary checkout's lockfile. This change does not modify dependency manifests or the lockfile. No dependency refresh is included.

Throwaway files, the smoke dev server/tab, and the temporary PostgreSQL container were removed.
