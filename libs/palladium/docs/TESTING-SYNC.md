# Palladium sync v1 validation matrix

[`SYNC-PROTOCOL-v1.md`](./SYNC-PROTOCOL-v1.md) is the normative contract. This page lists the release-integration checks for the implemented v1 receipt, typed page, schema identity, event, quarantine, lifecycle, and bounded hostile-input behavior. It intentionally does not use legacy HLC cursors, bare-array responses, or obsolete outbox names as acceptance criteria.

Run commands from the repository root unless a command changes directory explicitly. These are targeted checks; full lint, formatting, workspace test, and sanitizer campaigns are outside this release-integration pass.

## Deterministic fixture and transport checks

| Contract | Exact command | Evidence |
| --- | --- | --- |
| Shared page and invalid wire fixtures | `pnpm --filter @palladium/e2e exec vitest run src/__tests__/protocol-fixtures.test.ts` | Round-trips `changes-envelope.valid.json`, `receipt.valid.json`, and classifies `wire-invalid.json`. |
| Typed receipts, outbox retention/replay, schema identity, lifecycle, events, and quarantine | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync.test.ts` | Exercises malformed receipt retention, duplicate replay after response loss, disposal/replacement, stop cancellation, event acknowledgement loss, opaque cursor persistence, structured errors, and fingerprint quarantine. |
| Restart-safe cursor/event persistence | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync-durable.test.ts` | Verifies `append_cursor_v1`, derived `schema_identity_v1`, and restart resume. |
| Remote poison isolation | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync-poison.test.ts` | Verifies rejected remote changes are quarantined and do not permanently wedge later valid changes. |
| Bounded TypeScript hostile corpus | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-corpus.test.ts` | Uses the checked-in corpus only; materialized bodies are capped at 8 KiB and nested values at depth 32. |
| Generated deterministic TypeScript hostile sequences | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync-fuzz-generated.test.ts` | Runs the bounded generated decoder/lifecycle sequence corpus without adding a fuzz dependency. |
| Seeded multi-replica simulation | `pnpm --filter @palladium/core exec vitest run src/__tests__/sync-replica-simulation.test.ts` | Runs real file-backed SQLite engines through deterministic duplicate, reorder, partition, restart, and tombstone schedules against an independent LWW oracle. Replay a failing schedule with `PALLADIUM_SIM_SEED=<seed> PALLADIUM_SIM_SEEDS=1`; set `PALLADIUM_SIM_SEEDS=64` for the extended campaign. |
| Rust shared wire fixtures | `cargo test -p palladium-core shared_wire_fixtures_round_trip_and_classify_invalid_inputs` | Decodes the same valid page and invalid HLC/operation/cursor fixture files. |
| Bounded Atrium route corpus | `cargo test -p atrium bounded_hostile_route_corpus -- --nocapture` | Sends each checked-in hostile route case and asserts a client error plus a live health route; includes the empty cursor regression. |
| Generated deterministic Atrium hostile sequences | `cargo test -p atrium generated_hostile_route_sequences -- --nocapture` | Runs the bounded generated route sequence corpus and checks that the service remains responsive. |
| Atrium HTTP receipt/page/events behavior | `cargo test -p atrium --lib` | Runs the in-process SQLite HTTP tests for typed receipts, ACL-filtered pages, event acknowledgement, and cursor validation. |
| Generic Axum route/OpenAPI contract | `cargo test -p palladium-axum --test integration` | Verifies mounted v1 routes, typed page fields, and `/api-doc/openapi.json`. |
| Sanitizer-backed Rust change decoder | `cd libs/palladium/crates/atrium/fuzz && cargo +nightly fuzz run change_decoder -- -runs=1000 -max_len=8192` | Runs libFuzzer with AddressSanitizer over the bounded `palladium_core::Change` decoder corpus. |

The e2e fixture command is independent of a running server. Core Vitest commands use the package's in-memory/node adapter aliases. Rust commands compile the relevant crates and may require the repository's configured Cargo target directory.

## Bounded Quint delivery pilot

[`delivery.qnt`](../e2e/models/delivery.qnt) specifies delivery and checkpoint
recovery for one writer, one reader, one fixed-schema workspace, and at most
three immutable single-row insert Changes. It is not a second LWW simulator or
a specification of the entire library.

```sh
# Manual-only model checking requires Node 24, workspace dependencies, and Java 17+.
# First verification downloads Apalache 0.62.1; CI does not provision Java for this pilot.
pnpm --filter @palladium/e2e run model:check

# Manual-only trace replay requires built clients and Rust tooling, but not Java.
pnpm --filter @palladium/core build
pnpm --filter @palladium/sqlite-node build
pnpm --filter @palladium/e2e run test:model

# Regenerate and replay a failing seeded campaign.
PALLADIUM_QUINT_SEED=0x5eedc0de pnpm --filter @palladium/e2e run test:model
```

`model:simulate` samples 1,000 executions of up to 18 transitions with the
TypeScript evaluator. `model:verify` uses TLC to exhaust the reachable state
graph of this finite model, not Apalache's depth-bounded symbolic checker.
Apalache is still used to compile Quint to TLA+. Neither result proves the
implementation correct or establishes an unbounded distributed-system theorem.

The invariants require distinct queued/history IDs, retention of every local
commit in the outbox or server history, applied rows drawn only from history,
and complete durable application of every checkpointed history prefix. Wire
cursors remain opaque; the model's integer checkpoint is a history-prefix
abstraction rather than a cursor parser.

The replay test generates its expectations directly from Quint ITF: one fixed
13-transition recovery schedule plus eight seeded 18-transition executions.
It runs actual `PalladiumEngine`/`SyncTransport`, file-backed SQLite, and Atrium;
after each transition it checks row contents, queue/history identities and
order, retry payload stability, applied-change identities, and checkpoints.
The schedule includes atomic local rollback, committed upload followed by
receipt loss and duplicate retry, truncated download, independently committed
remote Changes followed by checkpoint failure, one rejected page Change,
client file reopen, and same-database server SIGKILL/restart. Failures identify
the seed, trace, transition, and expected state; regenerate with the displayed
seed rather than editing the expected values.

Atomic adapter transactions, a single writer per local database, fixed
authorization/schema, and durability of completed server appends are explicit
model assumptions. Replay advances a scoped client clock to persisted retry
eligibility instead of modifying queue IDs, payloads, or retry deadlines.
Client reopen occurs between completed transactions, not during a process kill.
Power loss, browser OPFS, multi-operation Change rollback, ACL grant/revoke
ordering, concurrent LWW edits, and liveness/fairness are outside this pilot;
their existing suites remain necessary. Model checking and trace replay are
manual-only: CI does not run either. The default E2E configuration excludes the
Quint replay; `test:model` selects it through `vitest.model.config.ts`.

## Maintained TypeScript package gates

`just test-ts` builds the core first to resolve its development dependency cycle with SQLite-node, builds the remaining maintained packages in dependency order, and runs each package's own unit suite. This covers SQLite adapters, Kysely, React/Vue/Svelte, notifications, Vite integration, and worker ownership. Examples and live-server E2E have separate gates; Nuxt currently has no unit suite.

`just lint-palladium-ts` uses the root Biome binary with the shared repository configuration for every maintained package, including the CLI wrapper. CI also typechecks these packages. Notification packages extend Palladium's strict shared TypeScript configuration.

Focused behavioral regressions include Kysely rollback/commit isolation and commit errors, atomic IndexedDB replacement/deletion, schema upgrade rollback and old-outbox quarantine, explicit discard/retry after restart, React query error recovery, notification permission fallback, and bounded Atrium backfill offer/ACK progression.

## End-to-end prerequisites (not part of the fixture gate)

The live client/server suite requires built core and SQLite-node packages plus Rust server binaries:

```sh
pnpm --filter @palladium/core build
pnpm --filter @palladium/sqlite-node build
pnpm --filter @palladium/e2e typecheck
pnpm --filter @palladium/e2e test
```

`@palladium/e2e` imports the built `@palladium/core` package; build it first so the suite cannot exercise stale `dist` output. The suite spawns isolated real Palladium and Atrium processes on ephemeral loopback ports, waits with bounded readiness checks, and cleans each process before deleting its SQLite state. It proves receipt loss after a real server commit, truncated downlink checkpoint safety, partition/reconnect, durable client reopen, crash/restart recovery, and two-device Atrium event delivery. Cargo and SQLite-compatible local server execution are required. If Cargo artifacts are redirected, set `CARGO_TARGET_DIR` so the launcher can locate the binaries.

Crash-boundary checks build the CLI with the default-off `crash-test-fixtures` feature. A change-ID-scoped failpoint terminates the server immediately before or after the SQLite append commit. The tests also SIGKILL a server after an acknowledged write and a separate client process after its durable outbox handshake. Recovery assertions cover exact row contents, append identity/count, receipts, and persisted checkpoints. These are process-crash tests, not power-loss or filesystem-corruption tests.

Atrium schedules cover partial grant backfill interrupted by revoke, revoke/regrant before device acknowledgement, lost device ACK responses, sibling-device isolation, and rejected offline writes followed by authoritative regrant. Assertions check intermediate authorization outcomes and root/child data, not only eventual convergence.

## Browser OPFS recovery

```sh
pnpm --filter @palladium/sqlite-browser build
pnpm --filter @palladium/worker build
pnpm --filter @palladium/react build
pnpm --filter @palladium/example-react build
pnpm --filter @palladium/example-multitab build
pnpm exec playwright install chromium
pnpm --filter @palladium/example-react exec playwright test
pnpm --filter @palladium/example-multitab exec playwright test
```

The React example runs the real engine and transport in a dedicated SQLite WASM/OPFS worker. Its suite retains create, title, rich-text, bidirectional edit, delete, and reload behavior checks, and adds tab/worker closure with a durable offline write followed by reopen/reconnect recovery. The multi-tab suite checks persisted state through leader loss and continued writes by the successor. CI runs both suites and uploads failure artifacts. Locally, `PLAYWRIGHT_CHANNEL=chrome` selects an already-installed Chrome instead of downloaded Chromium.

The seeded engine simulation controls generated remote changes and their delivery schedules against an independent LWW oracle; it does not simulate local transactions through the complete transport/server stack. Browser quota exhaustion, mobile lifecycle, arbitrary scheduler exploration, storage power loss, and sustained-load qualification remain outside these gates.

## Manual wire spot-check (optional)

With a compatible v1 server running, verify response shapes rather than treating HTTP success alone as acknowledgement:

```sh
curl -sS -X POST "$SERVER/v1/changes" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer alice' \
  -d "$CHANGE" | jq '{version,outcome,cursor}'

curl -sS "$SERVER/v1/changes?limit=100" \
  -H 'authorization: Bearer alice' | jq '{version,changes,purges,events,cursor,upperBound,caughtUp,control}'
```

The upload response must be a v1 receipt with `inserted` or `duplicate` and a non-empty cursor. The page must be a complete v1 envelope. Do not infer that a manual call proves transactional downlink, durable acknowledgement, or quarantine recovery; those guarantees require the targeted tests above.

## Fuzzing campaigns

The checked-in fuzz target and seed corpus support a repeatable, bounded sanitizer campaign. Run the command in the matrix to execute it. Longer differential and mutation campaigns remain optional expansion work; they are not required to establish the current bounded decoder and route-safety contracts.

OpenAPI generation is checked through the generic Axum integration test; no checked-in generated OpenAPI document is maintained. Changes to route annotations must be validated by that test and by the live e2e OpenAPI spec check when server prerequisites are available.
