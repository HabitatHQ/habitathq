# Palladium — Status and Historical Inventory

## Protocol authority

[`docs/SYNC-PROTOCOL-v1.md`](docs/SYNC-PROTOCOL-v1.md) is the sole normative
contract for Palladium sync. It defines the public wire protocol, persisted
sync state, row identity, page application, errors, and `SyncTransport`
lifecycle. The implementation and conformance evidence ledger is
[`docs/sync-engine-contract-review-20260824T164225Z.md`](docs/sync-engine-contract-review-20260824T164225Z.md).

This file is an implementation inventory. It MUST NOT be used to choose a
sync protocol, public API, persisted schema, or release gate. Where this
inventory and the v1 protocol differ, the protocol controls.

## Current v1 integration requirements

A sync integration MUST follow the v1 contract:

- Replicated table rows use canonical lowercase UUIDv7 `id` values. `NodeId`
  and `Change.id` remain distinct UUIDv4 identities.
- A locally committed canonical change is stored atomically in the durable
  `_sync_outbox`; the row remains until the client has decoded a matching,
  durable v1 uplink receipt.
- Downlink uses `GET /v1/changes` with an optional opaque `cursor` and a
  positive bounded `limit`. The response is a versioned, typed page envelope;
  a client validates the complete envelope before applying it or advancing a
  checkpoint.
- Built-in typed page application atomically applies canonical changes,
  idempotent ACL purges, deduplicated events, and the returned checkpoint.
  Event acknowledgements are separate typed, idempotent requests after durable
  event processing.
- One live `SyncTransport` exclusively owns an engine. Callers use its
  explicit `start`, `poll` or `syncOnce`, `stop`, and idempotent `dispose`
  lifecycle rather than compatibility wrappers.

## Package inventory

The following components are present in the repository. This list is not a
statement that a particular protocol release is complete; consult the v1
conformance evidence ledger for that status.

| Area | Inventory |
| --- | --- |
| Core | `@palladium/core` supplies `PalladiumEngine`, transactions, schema helpers, storage abstractions, blob support, and `SyncTransport`. |
| Storage | SQLite adapters exist for Node, browser, and Capacitor environments. |
| Frameworks | React, Vue, Svelte, Kysely, Nuxt worker-bus, and Vite-plugin packages are maintained separately. |
| Server | Rust crates provide core wire/store types, Axum routing, SQLite and Postgres stores, blob storage, and the CLI. |
| Examples | Vue, React, Capacitor, and Burrow examples exercise selected integrations; they are not protocol specifications. |
| Notifications | `notifications-*` packages provide local and push-notification adapters independent of sync. |

## Historical record — 2026-05 import snapshot

> **Archived evidence, not current guidance.** This section summarizes the
> status document reviewed on 2026-05-27 after the sync-engine import. It is
> retained to explain later review findings and references to revision
> `1483e4a`. It neither describes the release contract nor authorizes an
> integration choice.

The imported snapshot reported a generic client engine, Rust change-store
backends, and an early transport implementation. Subsequent review identified
that its bootstrap, conflict handling, persistence, transport ownership, and
ACL behavior did not satisfy the later v1 contract. The production-readiness
review records the findings, their historical source revisions, and the
required source-level evidence.

The snapshot also recorded that no HabitatHQ application had adopted
`@palladium/core` as its primary data layer, and that the worker-bus package
was independently consumed. Those adoption observations are historical and do
not change the v1 protocol requirements above.

## Reference map

- **Normative sync contract:** [`docs/SYNC-PROTOCOL-v1.md`](docs/SYNC-PROTOCOL-v1.md)
- **Implementation and conformance evidence:**
  [`docs/sync-engine-contract-review-20260824T164225Z.md`](docs/sync-engine-contract-review-20260824T164225Z.md)
- **Historical architecture material:** `docs/DRAFT-ARCH.md`, `docs/answers.md`,
  and archived plans. They are not protocol authorities.
