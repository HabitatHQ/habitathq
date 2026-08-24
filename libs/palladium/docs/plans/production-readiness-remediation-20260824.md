# Production readiness remediation

## Scope

Resolve every release-blocking finding from the PR #36 readiness review without weakening the local-first protocol:

1. Persist every locally committed change into the durable outbox in the same adapter transaction.
2. Prevent ACL disclosure from mixed-visibility changes and replace HLC-based delivery cursors with an append-only server cursor.
3. Make blobs immutable within their workspace/note binding and enforce a server-side size limit.
4. Replace unsafe remote deployment of development bearer identity with verified JWT/JWKS authentication, and bind HLC node IDs to their workspace owner.
5. Make the Palladium e2e global setup locate the actual Cargo target directory.

## Contracts

- A successful local `tx()` commit has a corresponding durable outbox row before it is observable through `changes:local`; failed checkpointing aborts the write.
- Every operation in a returned change is readable by the caller. A server cursor advances in durable insertion order, including over changes filtered from that caller.
- A blob ID is immutable: retries for the exact same workspace, note, owner, content type, and bytes are idempotent; every conflicting reuse is rejected. Requests larger than the configured maximum are rejected before persistence.
- Non-loopback Atrium starts only with a configured, verified JWT issuer, audience, and JWKS source. HLC node IDs are bound atomically to one workspace member; another member cannot submit a change under that node.
- E2E setup respects `CARGO_TARGET_DIR` and launches Atrium’s documented health endpoint.

## Verification

Add focused regression tests for each contract, then run the changed Rust crate tests, Palladium core tests, and the full e2e suite. Review the final diff and leave no temporary repro tests or generated state tracked.