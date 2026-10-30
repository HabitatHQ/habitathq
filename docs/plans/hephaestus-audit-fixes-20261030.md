# Hephaestus audit fixes—2026-10-30

## Scope

Repairs for the [browser UX audit](hephaestus-browser-ux-audit-20261030.md) and [defect audit](hephaestus-defect-audit-20261030.md), based on `origin/main` at `fdc327a`. Implementation is isolated in branch `fix/hephaestus-audit-20261030`; the primary checkout and unrelated user changes are untouched. No native, sync, GPS, or health-integration expansion.

A strong default implementation subagent handled UI/lifecycle work; the parent integrated and strengthened persistence, recovery, unit boundaries, and verification. Separate implementation/test handoffs did not substitute for final combined checks.

## Acceptance matrix

“Suite” below means the relevant paths are covered by the final unit/integration or generated-PWA browser run. “Interactive” identifies additional agent-browser observations; it is not a claim of exhaustive manual coverage for every row.

| ID | Implemented behavior | Evidence |
| --- | --- | --- |
| UX-01 | Interval starts capture configuration and clock state atomically; reload/resume returns to the same timer and round. | Suite; interactive paused countdown identical before/after reload, recovery from Workout, and eventual automatic completion. |
| UX-02 | Run history, completion, and summary cards use performed duration, with logging elapsed time distinguished. | Suite; interactive 5 km / 30-minute run completed and rendered as 30 minutes. |
| UX-03 | Discard requires explicit confirmation. | Suite. |
| UX-04 | Template drafts survive navigation/reload; route leave is guarded. | Suite; interactive Back restored the template name and three duplicated 60 kg sets. |
| UX-05 | Built-in holds default to duration logging without rewriting historical workout activities. | Suite, including a completed 45-second Plank and its History duration. |
| UX-06 | Detailed load inputs use bounded display precision without reinterpreting stored kilograms. | Suite; shared presentation conversion cases. |
| UX-07 | Captured and corrected workout titles identify History and recent activity. | Suite; interactive saved Smoke strength title in History. |
| UX-08 | Finish and History share the same mood labels/icons. | Suite; interactive Good selection remained Good in History. |
| UX-09 | RPE/RIR preferences govern inline and detailed editors without deleting saved targets. | Suite. |
| UX-10 | Template start goes directly to one preview/configuration page, then the session. | Suite; interactive template → Start once → active session. |
| UX-11 | Optional overrides are disclosed, populated, unit-aware, and labeled. | Suite. |
| UX-12 | Basic load/reps editing is primary; formulas, inputs, groups, and other advanced controls are disclosed. | Suite; interactive compact authoring screenshot. |
| UX-13 | Explicit duplication preserves the selected prescription, creates fresh target identities, and does not submit on Enter. | Suite; interactive Enter stayed in authoring and Add duplicates created two matching sets. |
| UX-14 | Template detail and previews summarize current per-set load, reps, and rest. | Suite; interactive three 60 kg × 8 / 90-second prescriptions. |
| UX-15 | Only the next pending set is expanded by default; future rows remain compact and editable. | Suite; interactive mobile workout screenshot. |
| UX-16 | Skipping the final prescribed set does not manufacture an expected extra set. | Suite. |
| UX-17 | Template/routine input and preview units follow preferences; storage stays canonical. | Suite; unit-boundary tests. |
| UX-18 | Failure-rest feedback is bound to the current active workout/rest period. | Suite. |
| UX-19 | Run duration accepts minutes/seconds, reports save state, and is also saved by Finish. | Suite; interactive 30-minute run. |
| UX-20 | Progress defaults to a recently trained exercise. | Suite. |
| UX-21 | Exercise-history and PR entries link to their source workouts. | Suite. |
| UX-22 | Overlapping appointments show distinct manual/recurring/Program sources and a warning. | Suite. |
| UX-23 | Appointment and recurrence routine selectors have independent state. | Suite. |
| UX-24 | Plan creation, recurrence, rotation, goals, and adoption use disclosures; appointments are grouped by week. | Suite. |
| UX-25 | Program handoff preselects the chosen design during plan creation. | Suite; interactive chosen Program ID present at destination. |
| UX-26 | Built-in designs are individually selectable and explicitly described as design presets requiring template assignments. | Suite; interactive only 5/3/1 BBB imported. |
| UX-27 | Equipment profiles use search/select and one editor instead of catalog-wide forms. | Suite. |
| UX-28 | Interval pause/resume is durable and uses the same recovery contract as running intervals. | Suite; interactive paused remaining time preserved across reload. |
| UX-29 | Exercise rows expose usable details and custom-exercise editing. | Suite. |
| UX-30 | Revision numbers and product labels replace raw IDs/storage vocabulary on the changed surfaces. | Suite. |
| UX-31 | Empty configuration sections and unknown effort/load fragments are omitted. | Suite. |
| UX-32 | History renders the SVG summary preview with type labels and pluralization; title/totals are included, notes/account details excluded. | Suite; interactive actual image preview. |
| UX-33 | Reset confirmation uses a centered, theme-matched Nuxt modal with Cancel/Escape. | Suite; interactive Daylight screenshot and cancellation without reset. |
| UX-34 | Today has one relevant start/resume action; fresh installs do not lead with zero streak/unavailable readiness. | Suite; interactive generated-PWA first-run screenshot. |
| UX-35 | Library navigation wraps on mobile; back links and bounded desktop navigation/content stay aligned. | Suite, including small-screen and accessibility routes. |
| UX-36 | Stable strength/conditioning/mobility labels, uppercase EMOM/AMRAP, and shorter review feedback. | Suite. |
| H-01 | Stable logical Program slot IDs can recur across revisions of the same Program, not unrelated Programs; imports remap consistently. | Integration regressions; interactive three-revision export, cross-origin portable import, and full-backup restore. |
| H-02 | Goal-filter exercise arrays participate in export dependency selection and destination identity remapping, including goal-only exercises. | Cross-installation integration regression verifying goal credit after imported workout. |
| H-03 | Routine template changes invalidate the former revision immediately; async requests cannot overwrite a newer selection. | Suite. |
| H-04 | History correction accepts fractional RIR in the logging range; title-only changes preserve the recorded value. | Integration regression; invalid negative/out-of-range cases remain rejected. |
| H-05 | Exercise history includes workout identity; effort is joined by workout ID, not date. | Analytics regression with distinct same-day workouts. |
| H-06 | Goal edits rebuild derived credits transactionally; deactivation clears credits and reactivation recomputes. | Integration regression covering changing filters and week boundaries. |

## Earlier findings and additional boundaries

- Rest countdowns use deadlines rather than callback counts. Interactive six-second main-thread blocking advanced the countdown by six seconds.
- Readiness uses the latest completed calendar week plus four preceding weeks, fills missing weeks with zero, and excludes the current partial week. Regression includes a year boundary and sparse weeks.
- Recurrence previews fingerprint the persisted rule and appointment snapshot; applying a stale preview fails instead of deleting a newly postponed appointment.
- Future-appointment cards wrap within mobile width; manual run distance follows km/mi preferences.
- Interval configuration is an immutable session snapshot. Start/capture is transactional; early finish records active elapsed time, excluding pauses. Removing the reusable interval plan does not remove the recoverable session configuration.
- Failed startup releases the writer lock and terminates the worker. A real Chromium/SQLite-WASM fault probe initially demonstrated that connection close plus lock release still left SAH-pool OPFS handles held. After terminal worker exit was added, injected schema failure returned `INIT_ERROR`, the lock was absent, and another real worker reached `READY` on the same isolated database without caller-side termination of the first worker.
- App smoke caught Vue proxies at the worker boundary during template start and interval pause. Requests now copy the necessary plain arrays/records/scalar clock fields before posting; both actual paths were exercised after repair.

## Verification

Final combined run:

- `pnpm --filter hephaestus check:fix`—passed; informational Nuxt filename/component-name diagnostics remain.
- `pnpm --filter hephaestus verify`—passed Biome, TypeScript, Vue typecheck, and **544 unit/integration tests across 49 files**.
- `pnpm --filter hephaestus test:e2e`—generated the production PWA and passed **110 Chromium tests**, including offline/reload, accessibility, history, routine workflows, portability, and interval recovery.
- `pnpm lint:deps`—passed, 806 modules / 598 dependencies, no violations.
- `pnpm lint:semgrep apps/hephaestus`—passed.
- `pnpm dedupe:check`—not green: the existing workspace lock resolution proposes Nuxt UI/transitive dependency deduplication. No package manifests or lockfiles were changed by this work; dependency updates are outside the app repair.

Additional agent-browser verification used isolated synthetic origins. Full-backup restore through Profile's file picker/confirmation retained all three Program revisions and saved workout history; cross-origin portable import accepted the same graph. A generated-PWA first-run check confirmed `crossOriginIsolated === true` and document width equal to the 390 px viewport. No personal browser storage was reset.

Physical devices, Safari/iOS, native builds, and cross-device synchronization were not qualified. Root-wide `pnpm ci` was not run; affected-app verification, architecture checks, and the root dedupe result are reported separately rather than presented as full-monorepo green.
