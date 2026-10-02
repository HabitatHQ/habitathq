# Local-first sync design checklist

For SQLite-backed browser/native clients, multiple devices, prolonged offline use, and an authenticated sync server. A checked item needs an explicit contract and executable evidence—not just a happy-path test.

## Identity and merge semantics

- [ ] Define object, replica, mutation, and workspace identities; handle restart, backup restore, and database cloning without duplicate writers.
- [ ] Specify every concurrent mutation pair: same/different field, insert/update/delete, relationship changes, and reorder. State whether merge, winner, rejection, or user resolution is intended.
- [ ] For each data type, record **CRDT/merge rule → causal metadata → conflict UX → GC rule**. Choose semantics before algorithms; ordinary assignments are not increments or collaborative text edits.
- [ ] Distinguish causally later from concurrent edits where required. HLC gives order, not concurrency detection; a history cursor gives delivery position, not causality.
- [ ] Define uniqueness, parent/child, cascade, and domain invariants; verify they survive merging and are enforced consistently across adapters.

## Delivery, clocks, and access

- [ ] Handle duplicate, reordered, delayed, and lost deliveries—including server commit followed by lost acknowledgement. Distinguish durable local success from accepted upload and applied download.
- [ ] Define ±10-year clock behavior on send, receive, and restart; preserve unsynced work and provide recovery without silently changing accepted mutation identity/payload.
- [ ] Explain six-month-offline return: catch-up, changed permissions/schema, expired history, and snapshot/reset without losing pending work.
- [ ] Separate global deletion from access-revocation purge; reject unauthorized offline writes and define revoke/regrant replay.

## Deletion and retention

- [ ] Define delete-vs-edit precedence, explicit restore, and stale-replay protection. Prove the result does not depend on delivery order.
- [ ] State precisely when history, duplicate IDs, pending operations, and tombstones can be collected; account for offline replicas, retirement, and restored backups.

## Durability, evolution, and operation

- [ ] Couple row writes, merge metadata, outbox, and checkpoints at explicit transaction boundaries; exercise interruption at each persistent write, commit, and acknowledgement. Distinguish process crash from power loss.
- [ ] Enforce one writer across tabs/workers/processes; recover ownership after failure. Reconcile separately stored blobs and database references.
- [ ] Specify old/new client and server compatibility, schema migration, and treatment of old pending mutations; never silently reinterpret them.
- [ ] Make a wrong record explainable: inputs, writer, schema/rule version, competing values, and winning decision. Make blocked work inspectable and recoverable.
- [ ] Define progress assumptions and limits: retries, terminal failures, storage quota, history growth, payload/page size, and observability of stalled sync.

Current findings and verification: [Palladium CRDT/HLC review](./CRDT-HLC-REVIEW-20261003.md). Wire contract: [Sync Protocol v1](./SYNC-PROTOCOL-v1.md).
