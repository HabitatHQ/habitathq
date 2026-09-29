# Habitat iOS PWA worker-leader recovery plan

## Goal

Reproduce and fix the Habitat PWA startup failure that surfaces as `palladium/worker: no leader for "habitat"`, while adding privacy-safe startup diagnostics that distinguish election, routing, worker, SQLite, and application readiness failures.

## Scope

- Palladium worker-bus leadership, request routing, lifecycle cleanup, and tests.
- Habitat web database plugin/worker startup, error propagation, and telemetry.
- Deterministic macOS test coverage plus an actual local PWA lifecycle smoke test.
- No changes to native Capacitor startup, sync transport, application data schema, or unrelated FunctionGemma work.

## Implementation sequence

1. Trace the exported Palladium worker-bus symbols and every Habitat startup caller using LSP references. Map election, leader loss, request routing, timeout, retry, cleanup, database readiness, and UI error propagation.
2. Extend the existing worker unit and browser multi-tab harnesses with deterministic leader-loss and recovery scenarios. Establish the pre-fix same-epoch reconnect failure without sleep-based timing.
3. Change the Palladium state machine so a missing/stale proxy reconnects on an incumbent's same-term announcement, while a failed promotion closes partial resources and re-enters the normal lock queue. Individual routed calls retain their original bounded deadline.
4. Add structured, gated startup diagnostics at the Palladium bus and Habitat database plugin/worker boundaries: correlation ID, monotonic elapsed time, ephemeral tab/leader identity, generation/attempt, visibility state, supported capabilities, startup stage, and sanitized errors. Never log SQL, records, auth data, or persistent identifiers.
5. Run the new regression, affected Palladium tests/typecheck/build, Habitat tests/typecheck/check:fix, relevant guardrails, and a real local PWA lifecycle exercise on macOS. Report WebKit/macOS as an approximation rather than exact iOS process behavior.

## Safety invariants

- At most one current leader may accept work for a worker name and election generation.
- A former leader cannot continue serving after ownership loss.
- Replayed requests retain one logical identity and remain bounded by the caller's original deadline.
- Leader loss during worker initialization is recoverable without concurrent OPFS writers.
- Closing all tabs releases locks, channels, listeners, workers, and timers; a new tab initializes cleanly.
- Promotion retry is paced and lock-queue based; request retries remain bounded by the caller's original deadline.
- Telemetry contains no application data or stable personal/device identifiers.

## Verification

- The deterministic same-epoch reconnect regression fails with the former epoch-only decision and passes with proxy-presence-aware recovery.
- Palladium worker tests/typecheck/build pass.
- Habitat targeted tests/typecheck/check:fix pass.
- Changed files pass Semgrep and architecture checks where applicable.
- The macOS Chromium multi-tab test proves normal OPFS/Web Locks/BroadcastChannel failover. It is an approximation, not a claim that iOS worker suspension or jetsam was reproduced.

## Platform research

- [Safari 15.4 WebKit features](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/) records Web Locks and BroadcastChannel support on iOS/iPadOS 15.4; older installed PWAs need an explicit capability error.
- [WebKit’s iOS power guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/) documents complete suspension and timer throttling for background tabs. A leader worker and BroadcastChannel announcement are therefore treated as ephemeral, not durable liveness.
- The [Web Locks specification](https://w3c.github.io/web-locks/) defines cleanup on agent termination; recovery waits in the normal exclusive queue and never uses `steal`.
- The [File System Access specification](https://fs.spec.whatwg.org/) and [WebKit OPFS guidance](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/) describe dedicated-worker, exclusive SyncAccessHandle usage. Failed promotions now close the adapter before yielding the lock.
