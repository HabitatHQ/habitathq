# Open-issue fixes—2026-10-04

## Scope and baseline

Base: latest `origin/main` at `cde2a24`, in an independent `fix/open-issues-20261004` worktree. Preserve the primary checkout and existing worktrees.

- #54: verify the published dependency consolidation against pnpm 11.13.1. Do not manufacture a new lockfile change when the gate already passes.
- #56: use local calendar keys consistently for daily records, history, ranges, and streak boundaries; keep instant timestamps and UTC arithmetic over already-normalized date-only strings intact.
- #58: preserve every selected voice/image record and its exact bytes despite timestamp/extension collisions.
- #59: undo the original completion without overwriting newer intent; serialize the undo with ordinary completion actions.
- #60: reject invalid Pomodoro edits and repair invalid persisted settings while valid settings continue to drive phase transitions.
- #61: replace Health logs atomically at the shared database boundary for steps, water, sleep, and meals; rollback preserves prior records, and zero values clear successfully.

Excluded: #52, #53, #57. The owner additionally selected keeping #55 open rather than claiming incomplete/unverified private backup support.

## Ownership

Scouts inspect the issue contracts and existing source/test patterns before implementation.

1. Calendar agent: Habitat date-key consumers and date/insight tests, except `index.vue`, `health.vue`, `db-shared.ts`, and shared DB/API tests.
2. Database/action agent: `index.vue`, `health.vue`, `db-shared.ts`, database facade/request/dispatch contracts, shared DB tests. Own #59/#61 and the local-calendar changes in these files.
3. Media agent: Settings Data Jots ZIP implementation and focused export tests only.
4. Timer agent: Settings Features, app-settings/timer validation and focused tests only.

Agents share the integration worktree with exclusive file ownership. They must not run builds, formatters, lint, or tests while others are implementing. The integrator owns plan/docs, dependency verification, final gates, browser/worker smoke proofs, and publication.

## Acceptance and delivery

Exercise local-day behavior west/east of UTC, immediate/stale Undo, colliding ZIP contents, invalid preference edits/reload and valid timer phases, and fault-injected atomic replacement for every Health type. Add durable behavioral regressions where consumer-visible state transitions or rollback are uncertain. Run Habitat formatting and native/Vue typechecks, workspace unit tests, architecture/Semgrep/dedupe guards, and frozen installation. Record actual output and distinguish unrelated baseline failures.

Publish one conventional-commit branch and one PR with closing references for resolved included issues. Do not close excluded issues or #55, merge the PR, or push main.

## Results

Implemented #56, #58, #59, #60, and #61. #54's frozen installation and dedupe
checks already pass on the fetched main baseline with pnpm 11.13.1, so this
branch intentionally contains no manifest or lockfile changes.

Verification:

- `pnpm --filter habitat check:fix` completed.
- `pnpm --filter habitat run ci` passed: Biome, native TypeScript, Nuxt/Vue
  checking, and 691 unit tests across 53 files. Informational existing lint
  warnings remain; no guardrail was suppressed.
- Workspace app unit checks passed: Hearth 334, Halcyon 230, and Hephaestus 528
  tests. Shared utilities passed 13 tests. The other apps' Biome/native
  TypeScript checks passed.
- The calendar/TODO/SQLite replacement suites passed all 36 tests under both
  `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`. Real SQLite tests use the app
  schema and cover replacement rollback, zero clearing, completion identity,
  and queued request isolation/recovery after rejection.
- At 390×844, the real running app's Today handler and SQLite worker agreed on
  schedule start, completion date, and a one-day streak on October 3 in Los
  Angeles and October 4 in Kolkata at the same UTC instant. Sunday-based week
  starts were September 27 and October 4 respectively. The temporary browser
  clock fixture explicitly aligned worker timezone getters with page
  emulation; Chromium page-only timezone emulation does not cover workers.
  The dev server was restarted after final database edits to discard stale
  worker modules.
- Immediate Undo removed its own completion. Stale Undo left an incomplete
  habit incomplete and preserved a newly created completion.
- Real Settings inputs rejected empty, zero, fractional, and out-of-range
  values; valid settings survived reload. Focus preserved its added minute
  through reload and followed work → short break → work → long break → work
  with valid custom durations and cycle counts.
- The Settings Jots download retained two voice and two image records with
  identical timestamps and matching extensions; decoding the actual ZIP
  byte-compared all four entries against their stored IndexedDB blobs.
- Fault-injected insertion failures through the Health page's real worker
  operation preserved both original rows and their values for steps, water,
  sleep, and meals. Successful replacement and zero-value clearing worked
  for all four types.

No native-device runtime is claimed; native dispatch shares the exercised
operation and passed TypeScript checks. Browser fixtures use synthetic local
data, not the owner's data. #52/#53/#57 and private backup issue #55 remain
outside this PR.

Final gates also passed: strict ERROR-severity Semgrep over Habitat app source,
workspace dependency-cruiser (763 modules, no violations), `pnpm dedupe:check`,
and a fresh `pnpm --filter habitat build:pwa` with the final database changes.
Task-owned browser pages and dev servers were closed/stopped.
