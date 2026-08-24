# PR #36 remediation plan

## Scope

Implement every blocking issue and all high-priority items from `PR36-review-20260824T080631Z.md`: Atrium ACL atomicity/workspace ownership/durable delivery; core wire identity, cursor ordering, and absent-row updates; PostgreSQL schema isolation plus durable scope migrations; and Burrow purge attribution plus thumbnail URL cleanup.

## Design contracts

1. **Atrium authority**: ACL records, shares, and grant events are keyed by `(workspace_id, row_id/root_id)`. A child inherits both root ownership and ACL. A request must atomically authorize, persist its ACL implications, and append its change or persist neither. A grant/revoke event remains deliverable until explicitly acknowledged by its intended client.
2. **Wire identity and core ordering**: `WireInsertOp.row_id` is the only record identity; `data.id` must never override it. Sync cursor persistence is monotonic. Updates arriving before their row are retained and replayed when their insert becomes available, without stamping phantom metadata.
3. **Store isolation/migration**: PostgreSQL schema isolation scopes every connection and all DDL/DML. SQLite and PostgreSQL migrations upgrade existing scope-less stores safely and are idempotent.
4. **Client purge/blob lifecycle**: a server-originated purge is local-only and cannot mint an outbound sync operation. Object URLs are released immediately when the corresponding image disappears.

## Verification

- Add regression coverage for each changed observable contract.
- Run relevant Rust crate tests, Palladium core Vitest tests, Burrow checks/tests, and the Atrium end-to-end sync suite.
- Review the diff for accidental changes and leave the existing handoff review intact in the primary checkout.
