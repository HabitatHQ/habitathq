# PR 37 review remediation

## Goal

Resolve every blocking sync-protocol review finding with regression-first changes while preserving the version-one wire contract and clean-cutover policy.

## Invariants

- One `Change` is atomic: no rejected change may leave a partial mutation.
- A failed remote change is quarantined without advancing the page checkpoint; valid changes remain replay-safe.
- Raw non-canonical wire operation sequences are rejected, never silently normalized.
- Request timeout and cancellation cover headers and body consumption.
- Retryable uploads honor their scheduled retry time; terminal failures are not automatically retried.
- Quarantine inspection and recovery always reflect durable state.
- Atrium grant backfill cannot be acknowledged before all newly visible history is deliverable.
- `upperBound` is the captured scope snapshot bound, independent of the page cursor.
- Generic stores reject future HLCs using a real bounded clock window.
- Scoped duplicate insertion is conflict-safe under concurrency.

## Red phase

1. Add core engine regressions for partial multi-operation failure and deferred foreign-key commit failure.
2. Add transport regressions for body timeout, retry scheduling, stale quarantine cache, non-canonical wire input, and degraded-status recovery.
3. Add Atrium route regressions for grant history beyond one page and snapshot upper-bound semantics.
4. Add generic store and Axum regressions for bounded future HLC rejection and concurrent duplicate insertion.
5. Run only the new targeted tests and record the expected failures before production changes.

## Green phase

1. Introduce a real per-change rollback boundary for page application and make deferred constraints attributable before the page transaction commits.
2. Validate canonicality on raw wire operations before conversion.
3. Keep request cancellation active through bounded response decoding and gate outbox retries by durable scheduling state.
4. Invalidate quarantine cache entries after every durable state transition and replace stale failure statuses after successful recovery.
5. Add resumable Atrium grant backfill state and return the captured append snapshot upper bound.
6. Enforce future-HLC bounds with stable protocol errors and make PostgreSQL duplicate insertion conflict-safe.

## Verification

- Run the new regression tests until green.
- Run the existing core sync, Atrium, generic Axum, SQLite, and PostgreSQL targeted suites.
- Run package-native formatting, type checking, linting, and builds for affected Palladium packages/crates.
- Smoke-test the in-process version-one upload/download/event path.
- Review the final diff against every invariant above and remove obsolete code or tests.
