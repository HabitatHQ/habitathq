# Habitat schema migration hardening plan

## Goal

Repair the Habitat iOS PWA database-start failure `SQLITE_ERROR: no such column: entry_date` and make schema upgrades recoverable across interrupted or incomplete migration states.

## Scope

- Palladium's `applySchema()` and seed-application transaction semantics.
- Habitat schema migration 25 and migration-level regression coverage.
- No data reset, schema downgrade, compatibility alias, or unrelated application changes.

## Implementation

1. Read the persisted SQLite `user_version` before replaying current baseline DDL.
2. On transaction-capable adapters, apply all pending migrations, replay baseline DDL, and stamp the target version in one transaction.
3. Reject existing upgrades before mutation when an adapter lacks transaction support; retain fresh-install support through idempotent baseline replay and post-success version stamping.
4. Replay baseline repair DDL transactionally when the stored version is already current.
5. Apply each seed and its `_palladium_seeds` marker atomically on transaction-capable adapters.
6. Make Habitat migration 25 backfill `scribbles.entry_date` independently of whether the column must be added, so retry after an interruption completes safely.

## Safety invariants

- A baseline index never references a column whose pending migration has not run.
- Any failed transactional upgrade leaves data, DDL, and `user_version` unchanged.
- `user_version` reaches the target only after both migrations and baseline DDL succeed.
- Failed seeds leave neither their data writes nor their marker on transactional adapters.
- Existing non-transactional adapters fail before mutation rather than risking an unrecoverable partial upgrade.
- Habitat v24 user rows are preserved and receive their derived `entry_date` on upgrade.

## Verification

- Core migration tests cover migration ordering, failed-migration rollback/retry, failed baseline rollback, current-version baseline repair rollback, non-transactional rejection, and seed rollback/retry.
- Habitat tests cover the production v24-to-v25 `entry_date` upgrade, data preservation, index creation, idempotence, and retry after a partial v25 state.
- Run core typecheck/lint/build; Habitat and Hearth unit tests/typechecks; Habitat Biome/Semgrep checks; and a local PWA startup smoke test.
