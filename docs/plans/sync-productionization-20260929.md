# Sync productionization plan

**Protocol authority:** [`libs/palladium/docs/SYNC-PROTOCOL-v1.md`](../../libs/palladium/docs/SYNC-PROTOCOL-v1.md)

## Goals

1. Preserve local commits through response loss, retry, client restart, and server restart.
2. Prove page checkpoints advance only after validated, durable application.
3. Prove duplicate/reordered delivery and multi-replica concurrent writes converge under the documented LWW rule.
4. Exercise the TypeScript `SyncTransport` against a real Rust server, including controlled faults.
5. Make bounded verification required in pull-request CI and provide a replayable extended campaign.

## Required implementation boundaries

- The engine owns canonical operation application and durable replica metadata.
- `SyncTransport` owns outbox, receipt, checkpoint, and fault-recovery state.
- Rust stores own scoped idempotency, transactional append history, and server-issued cursors.
- Test-only proxies and process controls inject faults without production endpoints or behavior changes.

## Verification matrix

| Layer | Required evidence |
| --- | --- |
| Client state machine | Focused Vitest regressions for tombstones, terminal receipts, local atomicity, checkpoint safety, and restart recovery. |
| Deterministic simulation | Seeded multi-replica engine schedules with operation trace and seed replay; duplicate, reordered, partitioned, and reopened replicas converge to an independent oracle. |
| Live E2E | TypeScript clients with file-backed SQLite sync through an actual Rust process under acknowledgement loss, truncated downlink, partition/recovery, and persisted server/client restart. |
| Rust backend | SQLite and Postgres scoped idempotency/cursor behavior, Atrium authorization and device-scoped event delivery, plus OIDC compatibility through a container fixture. |
| CI | Pull requests run strict Rust linting, client checks, bounded simulation, real E2E, and architecture/dependency guards. Scheduled/manual runs expand deterministic simulation seeds. |

## Non-goals

- No new production fault-injection endpoints.
- No claim of arbitrary scheduler exploration or full distributed-systems verification. The simulation is bounded, deterministic, and replayable.
- No compatibility path for obsolete cursors, queues, or wire envelopes.
