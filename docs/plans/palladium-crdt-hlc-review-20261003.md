# Palladium runtime findings remediation

## Scope and decisions

Remediate the two reproduced findings in [`CRDT-HLC-REVIEW-20261003.md`](../../libs/palladium/docs/CRDT-HLC-REVIEW-20261003.md#follow-up-runtime-findings), not every suggested CRDT or future feature in that review. User authorized implementation and pre-alpha breaking changes.

User-selected contracts:

- Deletion permanently retires a row UUID. Explicit restoration inserts with a fresh UUID; references must be deliberately updated. Ordinary edits and same-ID inserts cannot restore a deleted record.
- Clock recovery is explicit re-authoring. Preserve original rejected Changes unchanged as durable superseded evidence; new Changes have fresh IDs and corrected clocks. Never re-author accepted or uncertain uploads.

Baseline: `bb05191ff185be7ca9868d5ac8acafc37b6d058a`. Implementation and verification use `.worktrees/palladium-lifecycle-clock`; preserve unrelated primary-checkout changes. Publish the scoped change on `fix/palladium-lifecycle-clock`.

## Implementation

1. Make deletion remove-wins regardless of arrival order. Clear pending updates for retired IDs, reject local reuse, retain max-delete evidence, and preserve ACL purge/regrant replay.
2. Separate structural HLC validity from server-relative fresh-upload admission. Downlink consumes authenticated accepted history independently of device wall time. Keep server future-skew protection, duplicate-first idempotency, node ownership, and ACL checks; accept reordered new node uploads.
3. Expose an authenticated server clock endpoint on generic and Atrium servers. Persist server-calibrated authoring time, advance it with monotonic process elapsed time, and resume a conservative trusted floor after restart.
4. Add explicit recovery that re-confirms original upload outcomes, preserves accepted receipts, refuses unresolved failures, and transactionally archives confirmed clock rejections and enqueues fresh replacements. Verify the outbox snapshot under the engine write lock; never lower unrelated/accepted versions.

## Acceptance and verification

- Permanent regressions cover all counterexample delivery permutations, duplicates, restart, deletion before insert, fresh-ID restore, and ACL replay.
- Clock regressions cover ±10-year device clocks, wall rollback, persisted trusted time, rejected-transaction rollback, immutable original evidence, fresh replacement IDs, uncertain/lost acknowledgements, concurrent writes, and recovery restart.
- Exercise real file-backed SQLite and real Rust server sync: future-clock pending writes, reopen, explicit recovery, slow receiver, and subsequent bounded writes.
- Run affected TypeScript package gates, Rust formatting/strict lint/tests, maintained dependents, and live E2E. Update the normative protocol and review with observed evidence and limitations.

No GC, sequence/set/counter CRDT suite, or application-level conflict UI is introduced by this remediation.

## Outcome

Both selected runtime findings are fixed and integrated into the primary checkout, preserving unrelated work. The isolated worktree passed maintained source gates and live-server scenarios; primary core verification and the same behavioral smoke passed. See the review for exact evidence and the unrelated generated-report architecture-gate caveat.

The [review](../../libs/palladium/docs/CRDT-HLC-REVIEW-20261003.md#verification-and-limits) is the canonical evidence and limitations record; the [protocol](../../libs/palladium/docs/SYNC-PROTOCOL-v1.md) defines the breaking contracts. No GC or broader semantic-CRDT implementation is claimed.
