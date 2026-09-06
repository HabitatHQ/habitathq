# Atrium productionization implementation plan

## Scope

Resolve the confirmed, code-addressable Atrium/Palladium audit defects in one protocol-v1 cutover. This plan intentionally does not claim to solve operational work that requires a deployment target (backup custody, TLS termination, image publishing) or product adoption that needs an application owner.

## Decisions

- Authentication is an explicit startup mode. Development bearer identities require `--auth-mode dev`; production OIDC is the default and requires issuer, audience, and discovery configuration regardless of listener address.
- A syncing replica is identified by the engine's UUIDv4 node ID in `X-Palladium-Node`. `SyncTransport` sends it on every protocol request.
- Atrium stores one ACL delivery state per workspace, user, node, and ACL generation. Acknowledge and backfill state is device-qualified.
- ACL changes are serialized in a SQLite transaction. A durable monotonic ACL generation makes a newer transition supersede older pending deliveries for the same root/device.
- Atrium admits only canonical, schema-valid changes. Every non-insert operation must bind to the stored table; immutable identity fields cannot change.
- Cursors cannot exceed the workspace append bound. Response collections and request acknowledgement batches are capped.
- The database keeps a schema version ledger, turns on foreign-key enforcement for every connection, and adds constraints/indexes needed by the new delivery model.

## Work

1. Add an `AuthMode` CLI value enum and fail closed for omitted or malformed OIDC configuration. Keep development auth as an explicit local-only mode.
2. Extend `SyncTransportOptions` with a stable node header sourced from `PalladiumEngine.nodeId`; include it in all POST/GET/ack requests. Preserve caller auth headers.
3. Migrate Atrium event delivery from user-level `grant_events` state to device-level deliveries. Register a valid device on protocol requests, fan out ACL transitions to known active devices, and reject acknowledgements that do not belong to that device.
4. Replace the existing separate share update/event calls with transactional transitions. Collapse superseded events and generate only the latest state for a root/device.
5. Validate a submitted `Change` before authorization/history append: canonical operations, UUIDv7 replicated IDs, immutable fields, a single scope/table binding for existing rows, and permitted nodes.
6. Apply cursor, page/event/ack limits and make grant-backfill scans bounded by selected rows rather than full workspace history.
7. Add versioned migrations with checksums and foreign keys; retain compatibility migrations only as ordered historical migrations.
8. Add focused Rust and TypeScript regressions for proxy auth selection, per-device grants/revokes, transition ordering, invalid cursors, request bounds, and server admission.

## Verification

- `cargo test -p atrium`
- `cargo clippy -p atrium --all-targets -- -D warnings`
- `cargo fmt -- --check`
- `pnpm --filter @palladium/core test`
- `pnpm --filter @palladium/core build`
- `pnpm --filter @palladium/e2e test`
- `pnpm --filter <changed package> check:fix` where configured
