# PR 37 error, versioning, and robustness implementation

## Goal

Complete the remaining production-readiness requirements recorded in
`libs/palladium/docs/pr37-error-versioning-robustness-todos-20260825T082724Z.md`.

## Work streams

1. Finish durable page/event commit semantics and quarantine recovery APIs.
2. Complete transport error classification, retry scheduling, timeout behavior, and tests.
3. Make schema identity enforceable, persisted, and migration-safe through examples and end-to-end coverage.
4. Add bounded protocol and route fuzzing with replayable corpora, then update release documentation and run the validation matrix.

## Integration rules

- Acknowledgement can occur only after the corresponding local durable write.
- A server receipt must be fully decoded and version-validated before deleting outbox work.
- Schema identity is a stable content-derived value, persisted with queued work, and mismatched work is not posted.
- Quarantine entries retain the full original payload and terminal disposition across restart.
- Fuzzers are bounded and their minimized regressions are deterministic repository fixtures.

## Verification

Run targeted TypeScript unit tests, the affected Rust crate tests, fuzz corpus regression tests, format/lint/typecheck, and the relevant Atrium end-to-end sync test.
