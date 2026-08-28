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
| Rust shared wire fixtures | `cargo test -p palladium-core shared_wire_fixtures_round_trip_and_classify_invalid_inputs` | Decodes the same valid page and invalid HLC/operation/cursor fixture files. |
| Bounded Atrium route corpus | `cargo test -p atrium bounded_hostile_route_corpus -- --nocapture` | Sends each checked-in hostile route case and asserts a client error plus a live health route; includes the empty cursor regression. |
| Generated deterministic Atrium hostile sequences | `cargo test -p atrium generated_hostile_route_sequences -- --nocapture` | Runs the bounded generated route sequence corpus and checks that the service remains responsive. |
| Atrium HTTP receipt/page/events behavior | `cargo test -p atrium --lib` | Runs the in-process SQLite HTTP tests for typed receipts, ACL-filtered pages, event acknowledgement, and cursor validation. |
| Generic Axum route/OpenAPI contract | `cargo test -p palladium-axum --test integration` | Verifies mounted v1 routes, typed page fields, and `/api-doc/openapi.json`. |
| Sanitizer-backed Rust change decoder | `cd libs/palladium/crates/atrium/fuzz && cargo +nightly fuzz run change_decoder -- -runs=1000 -max_len=8192` | Runs libFuzzer with AddressSanitizer over the bounded `palladium_core::Change` decoder corpus. |

The e2e fixture command is independent of a running server. Core Vitest commands use the package's in-memory/node adapter aliases. Rust commands compile the relevant crates and may require the repository's configured Cargo target directory.

## End-to-end prerequisites (not part of the fixture gate)

The live client/server suite requires a built core package and a Rust server binary:

```sh
pnpm --filter @palladium/core build
pnpm --filter @palladium/e2e typecheck
pnpm --filter @palladium/e2e test
```

`@palladium/e2e` imports the built `@palladium/core` package; run the build first or the suite can exercise stale `dist` output. The e2e setup requires Cargo and SQLite-compatible local server execution. If Cargo artifacts are redirected, set `CARGO_TARGET_DIR` so the server launcher can locate the binary. These are external prerequisites for live integration, not reasons to weaken the static fixture checks.

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
