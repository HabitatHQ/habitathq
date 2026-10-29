# Palladium core invariant ownership fixes

## Scope

Address six reproduced core defects on top of `2669d3850221eb0e1156afe916967133a4e50e0d`. Keep the existing engine, storage, and transport architecture. Preserve wire identities, remove-wins row retirement, replay after ACL purge, and documented observer failure semantics. Do not include unrelated background scheduling or architecture refactors.

## Implementation

1. Serialize transport storage access through the engine ownership queue so only committed outbox entries are published. Read a snapshot while owning storage, release ownership before network I/O, and serialize durable acknowledgement separately. Check related direct storage access for the same race without introducing nested queue deadlocks.
2. Establish owned immutable operation payloads before asynchronous execution. Keep local application, durable outbox capture, and notifications consistent; preserve independently received change identity and nested JSON values.
3. Apply identical canonical SQLite cell identities to local and remote conflict metadata without changing immutable wire payload identity.
4. Make standalone local purge transactional across application rows, conflict registers, and pending updates. Failed purge must preserve replayability and emit no successful invalidation.
5. Own asynchronous observer failures, including thenables. Keep committed mutation success separate from observer failure, preserve manual live-query refresh rejection, and avoid awaiting reentrant observer work inside the storage queue.
6. Make configured request deadlines and stop/dispose cancellation cover authentication, refresh, network fetch, and body decoding. Late authentication completion must not send a cancelled request.

## Regression coverage

Use the existing public engine/transport interfaces and real SQLite. Cover the exact six reproductions plus nearby behavioral boundaries: commit versus rollback publication; caller mutation of updates, inserts, and nested payloads; canonical column aliases on insert/update; failure during purge metadata cleanup; synchronous, asynchronous, thenable, and error-observer rejection; cancellation and deadlines during initial authentication and refresh, including late completion. Avoid assertions on private representation or incidental wording.

## Verification and delivery

One default subagent owns implementation and regression tests; the parent reviews, runs verification, executes direct source/runtime smoke scenarios, updates existing documentation, and commits/pushes to main. Run core verification, maintained Palladium TypeScript consumer suites and typechecks, and relevant end-to-end coverage where available. Preserve all unrelated primary-checkout changes. Publish only after the verified branch contains current main; never force-push.

## Results

Implemented all six fixes with one default subagent, followed by parent review and integration. Added 18 regression tests for gated commit/rollback publication, mutable local and remote payloads, remote-page admission, column aliases, purge rollback, observer failures/reentrancy, and authentication cancellation.

Verification:

- `pnpm --filter @palladium/core verify`: 480 tests passed; typecheck and lint passed. The three pre-existing cognitive-complexity warnings remain unchanged.
- `just test-ts`: maintained packages built successfully and 912 tests passed across 18 package suites, including the 480 core tests.
- `just typecheck-palladium-ts` and `just lint-palladium-ts`: passed; existing warnings remain.
- `pnpm --filter @palladium/e2e test`: 50 tests passed against real local Palladium and Atrium Rust processes.
- `pnpm lint:semgrep libs/palladium/core/src` and `pnpm lint:deps`: passed, with no dependency violations.
- Seven direct source-executed Node/SQLite scenarios passed: async observer error ownership; row/outbox snapshot agreement; case-alias conflict ordering; purge rollback/replay; real loopback HTTP excluding rolled-back writes and receiving committed writes; authentication timeout; stop during authentication with a pending durable outbox.
- Four strengthened regression tests were also run against baseline source `2669d3850221eb0e1156afe916967133a4e50e0d`. All four failed for the intended behavior: mutable checkpoint payload, older remote alias winning, pre-rollback publication, and pre-commit publication. The temporary baseline-loading configuration was removed.

Existing storage/lifecycle documentation and the wire-protocol client guarantees were updated. No browser, physical-device, production-server, or full Rust unit-suite verification is claimed. The primary dirty checkout was not modified; publication uses the isolated fix branch and a normal fast-forward push to `main`.
