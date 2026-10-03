# Hephaestus UX and Configured Routines — Handoff

Date: 2026-10-02  
Source baseline: `bb294de35b76a3c7eba0d17d8a305c9242eb6831` (`main`)  
Status: confirmed-contract implementation and acceptance are complete through section 8. The integrated package gate, production browser suite and isolated phone-size/offline walkthroughs pass; evidence and verification limits are recorded below. Confirmed contracts supersede earlier open questions, not the historical release evidence.

## Goal

Make Hephaestus useful during ordinary training, not merely feature-complete: configure a routine once, use it quickly on a phone between sets, and correct actual workout records afterward.

This is the next iteration after [the completed local-PWA release](hephaestus-completion-20261002.md). Do not overwrite that release plan or reinterpret its verification results as proof of this new design.

Read the [domain vocabulary](hephaestus-domain-vocabulary-20261002.md), then the [conceptual model and feature exploration](hephaestus-conceptual-model-20261002.md). The follow-up interview confirms the contracts below. Exploratory features remain explicitly separate; none of these documents prescribes an on-disk schema.

## User decisions

- Phone use between sets is the primary experience. Retrospective editing after training is also required.
- Desktop must remain functionally usable, but desktop visual polish/redesign is not a priority.
- Templates currently feel too minimal, especially for defining and maintaining default set structure.
- Distinguish a reusable template, a reusable configured routine (the user's “realised template”), and the current gym session. Prescribed sessions capture their intended plan; actual session output is the next layer. Freestyle sessions need no manufactured prescription.
- Confirmed terminology: routine means a reusable configured workout, such as Push A at current loads; training plan means the broader arrangement, such as PPL x2. Do not use routine for the whole sequence.
- Confirmed organization modes: calendar, ordered workout rotation and frequency goals. Calendar appointments are independent per plan, rotations advance on linked finish or explicit skip, and weekly goals automatically count qualifying finished actual work.
- Confirmed plan relationships: a plan may combine organization modes, and multiple plans may be active together. Plans are optional grouping, not exclusive application modes; routines retain independent continuation behavior. Preserve one unfinished session and one writer, and do not require a plan for ad-hoc logging.
- Confirmed program distinction: a Program is a reusable multi-week template-based design with weeks/phases and progression intent; a Training Plan is a personal arrangement that may follow an adopted program revision and bind its slots to saved routines. Neither is mandatory for ad-hoc logging.
- Realisation changes values while preserving the template's structure. The configured routine is saved and reusable, not silently regenerated before every workout.
- Confirmed routine reuse: plans reference the same saved routine rather than implicitly creating private copies. Explicit prescription edits affect future starts from every referencing plan; different reusable targets use another saved realisation of the template. Captured intent and actual results remain unchanged, including in unfinished sessions. Session-only overrides do not update the shared routine.
- Logging should use directly editable rows plus completion ticks. Detailed set editing and adding extra sets remain available as escape hatches, not the normal interaction for every set.
- Ask about updating future prescriptions when finishing a changed workout. Do not automatically rewrite the template/routine from actual performance.
- Support multiple routines with independently configurable continuation behavior. Workout type and time of day must not determine the policy; morning/evening PPL/cardio are user examples, not architectural categories.
- For carry-forward routines, support both automatic deferral and an explicit Postpone action, selectable per routine. This is separate from the continuation policy itself.
- Evening lifting is trainer-led PPL twice per week on a rigid calendar: missing Monday Push does not change Tuesday Pull. Do not infer the remaining weekday assignments or rest day.
- Morning cardio is fluid: a missed planned run carries forward under the routine's selected automatic/manual mode. Automatic movement uses the next clear day for that same routine across active plans, within the confirmed four-week search horizon; it does not shift other commitments.
- The first screen should prioritize starting the next planned routine: one prominent card with an explanation and an override. Statistics are secondary.
- Lightweight expression support is wanted; CEL itself was not originally required. After research, the user accepted the recommendation to use a restricted scalar subset through `@marcbachmann/cel-js`.
- Confirmed progress measures: comparable exercise load/reps with supporting labeled e1RM; explainable commitment counts/timing and weekly goal progress; strength working-set totals, per-exercise tonnage, primary-muscle credits with secondary involvement separate, one primary movement pattern, and separate activity-appropriate non-strength totals.
- Before specifying more features, build a shared domain vocabulary and a storage-independent conceptual model. Explore near-term feature possibilities to test that model; exploration is not approval to implement them.
- Ad-hoc workouts are first-class, with or without a reusable prescription. No schedule, template or routine is a prerequisite; use the same applicable logging, recovery, correction, history, progress and portability behavior as scheduled workouts.
- This document is authorized. The follow-up interview updates these three planning documents only; no new commit, push, dependency installation, app implementation or application verification is implied.

## Routine continuation

Continuation and deferral settings belong to the saved routine; calendar schedules and occurrence identity belong to the referencing plan context. Two plans may independently schedule the same routine without making private prescription copies. Do not introduce mandatory morning/evening categories or a separate training-track concept. A scheduled occurrence is a commitment; captured session intent and actual results remain distinct.

```text
Routine A / calendar-bound continuation
  Miss an occurrence: leave it missed
  The next calendar slot remains unchanged
  User example: missed Monday Push does not replace Tuesday Pull

Routine B / carry-forward continuation
  Miss an occurrence: defer it to a later opportunity
  Other routines remain unchanged
  User example: missed run moves to a later clear day without changing PPL
```

Carry-forward settings:

```text
Continuation: carry forward
Deferral mode: automatic | manual Postpone
```

- Policy is independent of strength/cardio/mobility, time of day and other routines. Optional schedule times may be useful context, but are not the organizing principle.
- Support multiple planned sessions on the same day; do not introduce a global one-planned-workout-per-day constraint.
- Keep missed, moved and completed occurrences distinguishable. Deferral retains the occurrence identity and original planned date rather than duplicating a result.
- Today explains its choice and retains override, alternatives and Start ad-hoc. Priority is unfinished-session recovery, dated due/overdue commitments, rotation suggestions, then unmet frequency goals; use a stable, explainable order within each group.
- Do not use CEL for continuation. An open, unstarted occurrence becomes overdue after its current planned local day ends; fulfilled or explicitly skipped commitments do not become new misses. An appointment linked to an unfinished workout remains protected and recoverable. Reconcile idempotently when the app opens; an offline PWA cannot guarantee background execution at midnight.
- For automatic carry-forward, search today through the next 27 local dates for the earliest date clear of other appointments for the same saved routine across active plans. Other routines may share that date. Retain every occurrence's identity/original timing; never merge, drop or shift existing commitments. If no date is clear, leave the occurrence overdue and request manual resolution.
- Manual Postpone may select a later local date even when another same-routine appointment exists there, after a collision preview/warning. It may go beyond the automatic horizon. Calendar-bound misses do not replace later slots.

## Confirmed follow-up contracts

### Organization, program design and fulfillment

- A personal plan may mix calendar, rotation and frequency goals; multiple plans may be active. A routine's continuation/deferral policy is shared, but moving one independently scheduled appointment never moves another plan's appointment.
- One finished workout can fulfill at most one explicitly selected calendar appointment. At least one completed activity/set is required; shortened or under-target work qualifies, empty workouts do not. Target attainment is separate.
- Ad-hoc logging never silently fulfills an appointment. Offer explicit matching at finish; history permits link/unlink/relink with a preview of credit effects. These changes do not retroactively advance or rewind rotations.
- Finishing a workout explicitly linked to the current rotation item advances it once; an explicit Skip also advances. Starting, postponing or unrelated ad-hoc work does not. Do not manufacture calendar appointments for rotations.
- A frequency goal counts finished workouts containing completed actual work matching its activity filter. Count each workout once per goal, irrespective of matching segment count; qualifying scheduled and ad-hoc work count automatically. One workout may contribute to several applicable goals without duplicating its actual-work totals. Goals do not impose minimum-duration thresholds or accumulated-work targets in this iteration.
- Goal periods are Monday–Sunday calendar weeks. Reporting initially uses the saved start local date, retained across reload/travel and explicitly correctable later. Timestamps still determine elapsed duration.
- A Program references workout templates, not personal configured loads. Its personal Training Plan binds slots to compatible saved routines, including existing shared routines. Program edits require explicitly reviewed adoption; plans retain their adopted revision otherwise. Reconcile future organization/bindings under the same protected-appointment rules as schedule edits, without rewriting today's/overdue/historical commitments or captured/actual session data.
- Program weeks are seven-local-date blocks from the chosen plan start date: a Wednesday start advances to week two the following Wednesday. Misses do not delay weeks/phases. Program-relative weeks are distinct from Monday–Sunday goal/reporting weeks. Progression suggestions require explicit acceptance and never silently regenerate routines.
- Calendar schedule edits preview and change future unstarted appointments only. Preserve today's, overdue, fulfilled/skipped appointments and any appointment linked to an unfinished workout; alter those only through explicit individual actions. Do not reconstruct historical obligations from today's rules.

### Saved routine revisions and future updates

- A saved routine retains its adopted template structure, rules, defaults, inputs and resolved values until explicitly edited or reconciled. Show a newer template revision without blocking workout start; adoption is initiated from the routine and reviewed before saving.
- Reconciliation preserves compatible inputs, previews changed targets/structure and resolves missing or broken references before commit. Structural variants require editing or duplicating the template, not forking a routine into an independent authoring format.
- Retain source/adopted revision identity sufficient to explain which saved prescription supplied captured intent. Captured intent is immutable in this iteration; extra, skipped or changed work is recorded as actual deviation.
- Finish-time future updates may change configuration inputs or directly authored fixed target values after preview. Formula-derived targets are changed through inputs: never infer inverse formulas, turn actuals into fixed replacements or silently alter rules.
- Compare proposed changes against the current saved routine as well as captured intent and actuals. If a session captured 60 kg, the routine now says 62.5 kg and actual was 55 kg, expose all three and require an explicit choice for conflicts. Preserve unrelated newer edits; never overwrite the routine wholesale with the captured snapshot.
- Optional structural reuse opens a separate template-edit/duplicate review. Finishing itself never updates structure. Preview the shared impact on every referencing plan; declining leaves deviations session-only.

### Phone logging and retrospective correction

- A pending exact-value row may display editable suggestions. A completion tick explicitly accepts the visible valid values, including the latest edits, as actual performance without a modal. Rendering a suggestion alone is not completion; missing/invalid required actual values block it.
- A rep range remains a target range; enter a single achieved rep count before completing it. Do not invent the lower bound as actual reps.
- Save valid edits as durable drafts independently of completion. Reload/resume preserves drafts, which remain excluded from performed-work metrics. Completion captures the latest valid edits atomically; undo returns values to pending drafts without erasing them or altering captured targets.
- History may correct actual exercise identity, add/remove mistakenly recorded actual activity/set rows, and edit load/reps/duration/distance, effort/notes, title and performed date/time. This does not authorize whole-workout deletion.
- Recompute affected PRs, training load, volume, finish summaries, goal counts and linked appointment fulfillment atomically. If corrected work no longer qualifies, expose the unfulfilled commitment for deliberate resolution; do not rewind an advanced rotation or reschedule other appointments. Preserve untouched subjective notes and all captured intent.
- Report attainment per field: actual versus prescribed load, exact reps/range, effort and applicable activity measures. Distinguish matching an exact/range target from exceeding a minimum; absent targets/effort remain unknown. Do not introduce an overall passed/failed or weighted target score.

### Measurement and attribution

- Strength progress leads with comparable exercise/variant load and rep history, effort when known, and the existing labeled e1RM as supporting evidence. Preserve existing completed-strength eligibility and estimator rules; do not treat missing effort, different machines or unlike load conventions as equivalent.
- Strength volume uses completed working sets from finished workouts, including ad-hoc work. Exclude warm-ups, pending/skipped work and unfinished sessions. Total working sets counts each eligible actual set once.
- Show external-load × reps only within comparable exercises with explicit load conventions/units; do not aggregate global tonnage across unlike exercises/equipment or invent moved bodyweight/assistance loads.
- Give one set credit to each tagged primary muscle; show secondary involvement separately without fractional credits. Several primary tags may overlap, so muscle credits are not additive shares of overall volume. Keep unclassified work visible.
- Assign each eligible set one primary movement pattern, including Other/Unclassified. Pattern counts sum to eligible working-set totals.
- Use current exercise classification for historical distribution charts: classification corrections refresh attribution, not actual records or captured prescriptions.
- Cardio, conditioning and mobility use separate appropriate recorded measures such as duration/distance and applicable completed work. Mixed workouts contribute once to each applicable view; never sum unlike measures into a universal volume number.
- Consistency shows explainable fulfilled/missed/postponed/skipped/open commitments, original/current/actual timing and weekly goal progress. No composite adherence percentage is introduced; target attainment and frequency-goal credit remain separate.

## Domain model

```text
TEMPLATE
  Ordered exercise/set structure + defaults + target rules
       |
       | bind configuration values; preview and explicitly save
       v
REUSABLE CONFIGURED ROUTINE / REALISED TEMPLATE
  Same structure + saved inputs + resolved prescription values
       |
       | capture on session start
       v
SESSION PLAN
  Fixed copy of the intended exercises, sets, inputs and targets
       |
       | perform; record deviations separately
       v
SESSION RESULTS
  Actual loads/reps/effort/notes, completion, skips and extra sets
```

This is the prescribed-workout path, not a prerequisite chain for all training. An ad-hoc session may use a configured routine or start entirely freestyle. Scheduling and reusable prescription are independent; freestyle actuals need no dummy template, routine or captured targets.

### Invariants

1. A template is not merely an exercise list. It must express ordered set prescriptions and their relationships.
2. Realisation preserves exercise/set structure and grouping. Adding/removing/reordering sets or exercises is a structural edit, not an incidental value change.
3. Changing a configured input previews dependent targets and requires deliberately saving the configured routine.
4. Starting a prescribed session captures the current plan atomically. Subsequent routine/template changes must not rewrite that session's intended plan or history. Freestyle sessions have known absent prescriptions rather than fabricated targets.
5. Filled targets are not completed actual records. A completion tick records actual performance; pending rows must remain clearly pending.
6. Actual deviations do not silently change the plan or future defaults. Missing a rep is not permission to lower the future target.
7. Retrospective corrections change actual records and recompute affected derived data; they do not rewrite the captured intended plan.
8. Preserve legacy on-device data. For historical sessions without a captured plan, mark that information as unavailable rather than inventing an original prescription from current templates.
9. Expressions calculate values only. They cannot mutate structure, storage or session results.
10. Ad-hoc workouts are first-class actual training. They contribute to eligible strength/volume feedback without silently fulfilling planned occurrences or acquiring an invented original prescription.

### Example

```text
Template: Bench press
  Warm-up 1: 10 reps, fixed 20 kg, rest 60s
  Warm-up 2: 5 reps, two-thirds of top-set load, rest 90s
  Top set:   5 reps, configured working load, rest 180s
  Back-off 1: 8 reps, 90% of top-set load, rest 120s
  Back-off 2: same prescription as back-off 1

Configured routine:
  workingWeightKg = 60
  backoffRatio = 0.9
  equipment increment = 2.5 kg
  Resolved sets: 20x10, 40x5, 60x5, 55x8, 55x8

Captured plan: those targets as they stood when this session began.
Actual results may instead be: 20x10, 40x5, 60x4, 50x8,
  final planned set skipped, extra unplanned 45x12.
```

### Authoring direction

Recommended design: one underlying editable set-row model, with multiple authoring conveniences—not separate competing storage formats.

- Quick prescription such as `3 x 8–12, rest 90s, target 2 RIR` expands into editable repeated rows.
- Individual rows permit distinct warm-up, top-set and back-off targets.
- Scheme shortcuts generate inspectable/editable rows for existing straight/pyramid/drop/rest-pause behavior.
- Superset/circuit grouping describes execution relationships across exercises; it is separate from the prescription within an exercise.
- Ordinary controls cover fixed targets, references, percentages and equipment-aware rounding. An optional formula editor handles more complex value rules.

Rep ranges require achieved actual reps; exact visible values may be accepted on completion. Enumerate supported role labels, RPE/RIR field validation and shortcut/group execution details during API/UI mapping, preserving existing logging modes and warm-up exclusions. These authoring examples are not an approved exhaustive field list.

## Selected expression engine

**Candidate for adoption: `@marcbachmann/cel-js@8.0.0`, restricted to scalar prescription formulas.** Research used this exact published version. Recheck package/security state before adding it through the supported workspace package manager.

Why it fits:

- Zero runtime dependencies, ESM exports and TypeScript declarations.
- Declared variable/function types and static checking before evaluation.
- Parse-once reusable expressions, exposed ASTs and configurable parse-time structural limits.
- Registered pure helpers can handle equipment-specific rounding.
- No need to build or maintain a new parser/language.

This revises the earlier assumption that using CEL would necessarily be heavyweight. Keep CEL's larger language surface out of the product-facing contract.

### Proposed expression boundary

- Allow named configuration inputs and explicitly bound planned-target references, arithmetic, comparisons, boolean conditions, ternaries, and a small allowlist of pure numeric helpers.
- Use stable reference identity underneath display names; renaming an exercise must not break its dependencies.
- Parse/check before saving; require an appropriate scalar output type for each target field.
- Validate cross-formula dependencies, reject cycles and resolve in dependency order in the app. The library does not supply the product's dependency-graph policy.
- Construct narrow, validated contexts; do not expose application/database/session objects, getters, functions, arbitrary nested properties or collection inputs.
- Reject unsupported AST constructs, collection macros/literals and unregistered calls. Bound expression length, AST nodes/depth and call arguments. Structural limits are not an evaluation-time/fuel guarantee.
- Use only bounded synchronous helper implementations; no async lookups, network, filesystem, clock/randomness or database access.
- Validate finite outputs and field-specific range/integer/unit requirements. Weight remains canonically kilograms.
- Handle CEL integer (`BigInt`) versus double (`number`) semantics deliberately. Do not leak BigInt into persisted JSON or require ordinary controls to expose numeric-type details.
- Recalculate on deliberate configuration changes, not on each completion tick. Retain manual actual-value overrides.
- Store enough source, input, reference and evaluator-version information to explain/reproduce a prescription. Do not persist checked runtime AST objects directly: inspected checked metadata contains circular references and runtime objects.
- Show actionable errors beside the affected target; never silently substitute a weight or target after a formula error.

### Research and smoke evidence

Two read-only research scouts compared lightweight evaluators and browser CEL implementations. The parent exercised pinned packages in a separate Chromium browser; no packages were installed in the workspace.

| Case                                                | `@marcbachmann/cel-js@8.0.0`                                          | `expr-eval-fork@3.0.3` |
| --------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| `workingWeightKg * 0.9`, input 60                   | 54                                                                    | 54                     |
| Custom `roundLoad(..., incrementKg)`, increment 2.5 | 55                                                                    | 55                     |
| `deload ? workingWeightKg * 0.8 : workingWeightKg`  | 48 with deload true                                                   | 48 with deload true    |
| `workingWeightKg + true`, input 60                  | Static type rejection                                                 | Evaluated to 61        |
| Unknown input                                       | Static rejection                                                      | Evaluation error       |
| Dynamic JS generation blocked by CSP                | Evaluated rounding to 55; `new Function` separately threw `EvalError` | Same                   |
| Network disabled, `navigator.onLine=false`          | Evaluated deload to 48                                                | Same                   |

Additional CEL observations:

- Undeclared `fetch` and indexing `.constructor` on a declared numeric input failed checking.
- Configured `maxAstNodes=100` rejected an oversized expression; configured zero list elements rejected a list literal.
- Integer division by zero threw; double division by zero produced `Infinity`. Application output validation is mandatory.
- A double-only custom rounding signature rejected `roundLoad(60, 2.5)` but accepted `roundLoad(60.0, 2.5)`. The numeric boundary needs explicit design and tests.

**Not verified:** Hephaestus production bundling, final tree-shaken/gzip size, installed-PWA integration, complete CEL conformance or a comprehensive security audit. Npm reports 227,423 unpacked bytes; this is not a browser bundle-size measurement.

Alternatives:

- `expr-eval-fork` has convenient variable enumeration but weaker numeric/type semantics and a broader mathematical surface; not selected.
- Jexl supports the syntax but upstream's latest observed commit is 2021-04-26 and AST inspection is internal.
- Filtrex uses `new Function`, conflicting with the strict-CSP direction.
- Original `expr-eval` has a reviewed code-injection advisory with no patched original-package version; the fork has patched versions. Do not adopt the original.

Primary sources:

- [CEL JS repository/API](https://github.com/marcbachmann/cel-js)
- [Published CEL JS metadata](https://registry.npmjs.org/@marcbachmann%2Fcel-js/latest)
- [Version-8 evaluator source](https://github.com/marcbachmann/cel-js/blob/86cd97216a1cbb522eda81aaa0221c245d5913d7/lib/evaluator.js)
- [CEL language specification](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md)
- [expr-eval fork](https://github.com/jorenbroekema/expr-eval)
- [Reviewed expr-eval advisory](https://github.com/advisories/GHSA-jc85-fpwf-qm7x)
- [Jexl](https://github.com/TomFrost/Jexl)
- [Filtrex compiler](https://github.com/cshaa/filtrex/blob/main/src/filtrex.mjs)

## Current source and observed defects

Anchors refer to the source baseline; recheck after any intervening changes.

### Reproduced in the dev browser

1. **Pending-set row cannot be saved through its edit path.** Add an exercise, tap its blank set row, enter load/reps, choose Save Changes: `Set is not part of the active session` appears. The pending row is built only in composable state (`useWorkout.ts:256–261`); row selection uses `openEditSet` and confirmation routes any supplied ID through update (`pages/workout/index.vue:149–171`); worker update requires an existing saved row (`workout-storage.ts:312–317`). Fix the lifecycle distinction, not the error message or storage guard.
2. **Completion duplicates units:** weight/e1RM badges displayed `60 kg kg` and `76 kg kg`. See `pages/workout/index.vue:395`, which appends a unit to `formatWeight()` output.
3. **Progress PR feedback is misleading:** a Reps PR displayed `8 kg`, with no exercise identity. Query/render targets: `pages/progress/index.vue:33–35,143–162`.
4. **Recovery labels expose implementation details:** `gym` and a raw ISO start timestamp are shown instead of readable session/date context.

Successful dev smoke: adding a set through `+ Set` logged 60 kg x 8; reload/resume restored it; Finish/Save Workout produced a summary and saved history. These successes do not negate the pending-row failure.

### Source-grounded limitations

- Template creation supports set count, rep text, rest, per-set rest and optional schemes, but saved-template editing updates only name/description/cover emoji. Targets: `pages/templates/new.vue`, `pages/templates/[id]/edit.vue:39–47`, `useTemplates.ts`.
- History detail currently lacks a correction path. Target: `pages/history/[id].vue` and corresponding workout domain operations.
- Existing finish summaries and session modifiers are stored in `workout-schema.ts`; these are not the new intended-plan snapshot model.

### Further-discovery queue — not approved additional feature scope

- [ ] Browser-verify built-in program import: source review indicates named routines create week/modifier metadata but no training split/template assignments. Check the promise made by the import UI.
- [ ] Browser-verify weekday reassignment: source inserts another `program_days` row, and the current UI does not expose replacement/removal. Do not assume multiple same-day sessions are invalid without defining that contract.
- [ ] Examine calendar local-date/UTC consistency and chart interpretation/accessibility before claiming additional bugs.
- [ ] Check equipment-profile validation placement and saved/dirty feedback.
- [ ] Map the confirmed interview contracts above to concrete domain operations and walk their boundary examples. New pause/rest automation, scheduled freestyle slots, automatic substitutions and one-off intent amendment remain separate scope decisions.

## Ordered implementation TODOs

The follow-up domain choices are resolved below; unchecked items describe implementation, not requests to reopen those choices. Implementation began with the independent defect fixes in section 1; exploratory features remain outside scope.

### 1. Fix reproduced logging and feedback defects

- [x] Add a consumer-visible failing regression for tapping/editing a pending row, then fix create-versus-update routing for solo and grouped sets. Preserve worker ownership checks and idempotent writes; do not weaken storage guards.
- [x] Remove duplicated completion units; render record-type-appropriate units and exercise identity in PR feedback, including kg/lbs behavior.
- [x] Replace raw recovery enum/timestamp with readable context while retaining explicit resume/discard safety.

**Section 1 implementation evidence — 2026-10-03**

- Pending-row completion uses `WORKOUT_LOG_SET`; completed-row correction retains `WORKOUT_UPDATE_SET`. Selected row identity/order is preserved, and synthesized pending rows use the highest existing set number plus one. Worker writes first recognize an existing ID within the owned workout exercise, retaining slot-based retry matching and rejection of unknown update IDs. A failing SQLite regression reproduced `UNIQUE constraint failed: sets.id` when a persisted pending row became a warm-up; the corrected identity lookup passes that regression and retry.
- Completion and Progress PRs name the exercise, display rep counts as reps, and format weight/e1RM in the selected unit exactly once. Recovery shows the template/session label and a localized start time without changing explicit Resume/Discard behavior.
- Package Biome check passed with 22 informational diagnostics; Vue typecheck passed; all 490 unit/integration tests passed; production PWA generation passed; all 126 Chromium E2E tests passed, including solo pending completion/recovery/correction, grouped correction/recovery, PR attribution/units, offline operation and storage isolation.
- Initial verification required pnpm 10.18.3 with a temporary version-switch bypass and encountered TS2349 at `nuxt.config.ts:8`. Publication verification repaired the missing pnpm-managed executable path using the already-installed mise pnpm 11.13.1 binary and regenerated stale Nuxt 4.3.1 declarations against the installed/locked 4.5.2 package, preserving the old ignored generated state. Plain `pnpm --filter hephaestus verify` now passes in both the isolated publish worktree and the primary checkout; plain `pnpm --filter hephaestus test:e2e` passes all 126 tests in the publish worktree. No dependency-version changes, source casts, compiler exclusions or gate bypasses were needed.
- An isolated managed Chromium tab exercised the production PWA at 390 × 844: complete a pending squat at 97.5 kg × 6, reload/explicitly resume, correct the same completed row to 100 kg × 5, finish with one working set and named `100 kg` / `5 reps` / `116.7 kg` PRs, then switch to pounds and observe `220.5 lbs` / `5 reps` / `257.2 lbs` on Progress. A template-backed persisted pending row was also completed as a 40 kg × 8 warm-up and recovered with its template label, saved values and zero working sets. This is a phone-size browser walkthrough, not physical-device certification.
- Sections 2–7 now implement the domain cutover, including persisted revisions and scalar expressions. Section 8 records final integrated acceptance; the section 1 counts above remain historical milestone evidence.

### 2. Map confirmed contracts to domain operations

- [x] Use template, configured routine, reusable Program, personal Training Plan, captured intent and actual results as distinct concepts. Keep scheduled/unscheduled and prescribed/freestyle independent; no plan/routine is required for ad-hoc work.
- [x] Define revision capture and reviewed template/program adoption operations, shared routine references and template-based Program slots bound to compatible saved routines. Specify conservative migration of existing assignments without silently inventing configured loads or dropping multi-week functionality.
- [x] Map ordered set roles, exact/range reps, optional effort, rest, schemes and execution groups to one authoring model, preserving existing supported logging modes. Specify validation and grouped tick/rest behavior without conflating drafts with actuals.
- [x] Define atomic draft/completion/undo, correction/relink and future-update operations, including current-versus-captured revision conflict review and preservation of unrelated edits.
- [x] Define stable Today ordering, occurrence generation and bounded idempotent reconciliation. Preserve per-plan appointments and per-routine policy; ensure the four-week collision check includes same-routine appointments across active plans, including recurring slots not yet materialized.
- [x] Retain existing PR/e1RM eligibility/formulas and map the selected working-set, attribution and non-strength reporting contracts. Keep reporting periods, units, missing information and comparable load conventions explicit.

#### Implementation mapping — 2026-10-03

This is the operation/state contract for sections 3–7, not verification evidence. All mutations run through the existing worker's serial queue and Palladium-backed `DbAdapter.transaction`; pages never open another database.

| Boundary | Operations and state |
| --- | --- |
| Template | `TEMPLATE_CREATE`, `TEMPLATE_EDIT`, `TEMPLATE_DUPLICATE`, `TEMPLATE_GET_REVISION`: append immutable prescription revisions; metadata remains separately editable. One ordered activity/set model underlies quick repeated rows, schemes, individual roles and groups. |
| Saved routine | `ROUTINE_SAVE`, `ROUTINE_EDIT`, `ROUTINE_GET`, `ROUTINE_LIST`: retain an adopted template revision, stable structure, configuration inputs, fixed rules and resolved values. `ROUTINE_PREVIEW_TEMPLATE_ADOPTION` / `ROUTINE_APPLY_TEMPLATE_ADOPTION` validate compatible inputs/references and reject stale previews. Shared plan references point to routine identity, never copies. |
| Program / personal plan | `PROGRAM_CREATE`, `PROGRAM_EDIT`, `PROGRAM_GET_REVISION`: reusable template-based seven-date-block designs and explicit progression intent. `TRAINING_PLAN_SAVE`, `TRAINING_PLAN_BIND_ROUTINE`, `TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION` / `TRAINING_PLAN_APPLY_PROGRAM_ADOPTION`: personal start date, adopted revision and compatible shared-routine bindings. Calendar/rotation/goal operations belong to the personal plan, not the reusable design. |
| Start / recovery | `WORKOUT_START` optionally selects a saved routine or template and explicit appointment/rotation context. Create session, source revision provenance, immutable intent and actual-to-intent correspondence atomically. Freestyle stores known absent intent; legacy sessions store unavailable intent. Recover actuals and drafts without reading newer source targets. |
| Row logging | `WORKOUT_SAVE_DRAFT`, `WORKOUT_LOG_SET` for explicit pending completion, `WORKOUT_UPDATE_SET` for completed-result correction, `WORKOUT_UNDO_SET`, `WORKOUT_SKIP_SET`: preserve identity/order and the last valid values. Completion accepts the latest visible exact values in one write; range targets require achieved reps. Undo clears completion, retains the draft, and never changes intent. Extra actual rows have no invented prescription correspondence. |
| Finish / future review | Finish actuals independently of future prescription updates. Preview captured/actual/current values, proposed input/fixed-rule patches, dependent targets and all referencing plans. Apply against the reviewed current revision only; conflicts require explicit field choices. Preserve unrelated newer values, formula rules and structure. |
| Organization | Persist independent calendar occurrence identity, original/current local timing, status and explicit workout link; recurring rules belong to each plan. Preview/apply schedule and Program adoption changes only future unstarted occurrences. Reconcile on open idempotently; protect unfinished-linked occurrences. |
| Rotation / goals | A rotation has ordered routine identities, position and durable advancement receipts. Linked finish or explicit Skip advances once; history edits never advance/rewind. Goals have activity filters and positive weekly counts; credit each qualifying finished workout once per applicable goal using its saved performed local date. |
| Corrections / credit | Preview and atomically apply actual-row/context corrections and explicit appointment link/unlink/relink. Rebuild affected PR/load/summary/goal/fulfillment data within the same transaction. Preserve immutable intent, unrelated notes/history, rotation receipts and other appointments. No whole-workout deletion operation is added. |
| Portability / reports | Versioned backup and portable prescription/Program/routine/plan envelopes retain revisions, stable bindings, rules, drafts and credit relationships. Validate schema, expression semantics and references before mutation. CSV/cards use corrected completed actuals. Reports separate comparable strength, commitment/goal counts and activity-appropriate volume. |

Field and execution rules:

- Stable UUIDs identify activities, sets, inputs, numeric targets and bindings independently of display names. Realisation may change input/fixed values, not activity/set order, roles, grouping or exercise identity.
- Set roles are `warm_up`, `working`, `top`, `back_off`; warm-ups remain ineligible for strength PR/working-set volume. Preserve strength/cardio/distance logging modes and existing supported scheme/group behavior.
- Numeric values must be finite. Loads, rest, duration and distance cannot be negative; achieved reps are nonnegative integers, with zero accepted only for an explicitly failed strength attempt. Exact/range/minimum targets remain distinct. Optional RPE is 0–10 and RIR is 0–10; missing effort remains unknown. Required actual measurements depend on the activity's logging mode; bodyweight does not acquire a fabricated external load.
- Valid draft edits persist independently of completion. Invalid transient input remains visible as an error and cannot be completed. Group ticks complete one row, not an entire round; existing transition/rest-after-round policy applies only after successful completion. Undo cancels rest started by that completion without resetting draft values or scheduling anything.
- Expressions use finite JavaScript-number arithmetic in canonical units. Parse the selected CEL engine's AST, normalize safe integer literal source ranges to double literals, then type-check; validate integer-required target outputs afterward. Boolean inputs remain boolean; unitless ratios/scalars (for example, a backoff ratio) use the `scalar` input field with finite numeric bounds and never inherit load or rep conversion. Persist original source and `cel-js-8.0.0-js-number-v1` semantics, not BigInt or checked AST objects.
- Today order is recovery, due/overdue calendar occurrences, rotations, then unmet goals. Within calendar priority use current local date, optional time, plan creation order and stable identity; use plan/item order and stable identity for rotations/goals. Explain the source and retain alternatives/ad-hoc start.
- Generate commitments only from explicit schedules/adopted Program bindings; retain unassigned legacy slots as unresolved. Materialize/check all active same-routine recurrence rules for today through day 27 before automatic deferral. Never infer historical commitments from current rules.
- Reporting/goal weeks are Monday–Sunday based on saved performed local dates. Program week is `floor(local-calendar-days-since-start / 7) + 1`; misses never delay it. Timestamps determine elapsed duration.
- Keep existing completed-strength PR/e1RM eligibility and estimator. Working-set volume excludes warm-ups, pending/skipped rows and unfinished workouts. Attribute each eligible set once to its primary movement pattern, once to each primary muscle, and separately to secondary involvement. Compare external-load tonnage only within explicit comparable exercise/load conventions; keep unknown classification/conventions visible and non-strength measures separate.
- Legacy migration appends revisions conservatively, retaining schemes, rest, grouping, week/phase/progression metadata and unassigned slots. Never synthesize personal loads, historical intent or calendar obligations. Existing personal Program state becomes a personal plan with unresolved bindings where necessary; reusable Program design remains separate.

### 3. Establish persisted routine, program and snapshot boundaries

- [x] Extend schema through the existing Palladium-backed migration/transaction boundary. Preserve unversioned/partial legacy installs and existing workouts/templates/programs.
- [x] Migrate template prescriptions conservatively, retaining meaningful schemes/rest/groups; do not fabricate unknown load targets or historical intent/commitments.
- [x] Persist saved routine revisions, adopted Program design and personal plan bindings. Require explicit reconciliation for incompatible template structure; never make silent private routine copies.
- [x] Capture supplied prescriptions atomically with session creation, including source revision provenance. Permit freestyle sessions without manufactured targets and recover both actual data and durable drafts accurately.
- [x] Migrate all worker types, composables and startup/consumer paths; remove superseded source paths rather than adding parallel data APIs, aliases or connections.

Current persistence interfaces (native/Vue typechecks and 56 focused SQLite tests passed on 2026-10-03):

- `parseSerializablePrescription` validates the nested persisted boundary. `validatePrescriptionDraft` and `validateRoutineInputs` enforce authored/configured data before persistence; formula rules retain source and use the section 4 evaluator for validation and resolution.
- `migratePrescriptionDomain` idempotently creates missing template revisions, migrates legacy Programs while preserving design/progression metadata and unresolved assignments, restores missing legacy personal plans/bindings after partial startup, and records known-absent versus unavailable workout intent.
- `TEMPLATE_CREATE` / `TEMPLATE_EDIT` / `TEMPLATE_DUPLICATE` / `TEMPLATE_GET_REVISION`, `ROUTINE_SAVE` / `ROUTINE_EDIT` / `ROUTINE_GET` / `ROUTINE_LIST`, reviewed `ROUTINE_PREVIEW_TEMPLATE_ADOPTION` / `ROUTINE_APPLY_TEMPLATE_ADOPTION`, `PROGRAM_CREATE` / `PROGRAM_EDIT` / `PROGRAM_GET_REVISION`, and `TRAINING_PLAN_SAVE` / binding / reviewed Program-adoption operations are worker domain operations. Routine edits preserve structure and permit only compatible input/fixed-target changes; Program bindings must match the adopted slot's template revision structure. Preview tokens are stored and revalidated against current revisions before apply.
- Template authoring routes create prescription revisions through `useTemplates`; Programs and routines use their typed domain composables. `useRoutines` exposes list/get/create/edit and reviewed adoption; `usePrograms` exposes revision, plan, binding and adoption operations. These requests reuse the existing worker connection and Palladium transaction bridge.
- The section 3/4 integrated gate passed native/Vue typechecks and all 531 unit/integration tests. Production formula, draft/recovery, factual correction, backup/reset/restore and additive configuration import paths were exercised separately; section 8 records the subsequent complete acceptance run.

### 4. Integrate the restricted expression evaluator

- [x] Add the reviewed package using the supported workspace package manager, generating manifest/lockfile changes rather than editing dependency blocks. Exact `@marcbachmann/cel-js@8.0.0` is installed; the exact-version OSV query returned no vulnerabilities and the upstream repository reported no published advisories. An isolated full-export browser ESM bundle measured 87,218 raw / 25,251 gzip bytes; this is not the integrated production worker delta.
- [x] `app/lib/prescription-evaluator.ts` parses with the installed CEL `Environment`, applies AST shape/complexity/function restrictions, validates explicit input/target bindings and reference cycles, resolves dependencies and returns cloned prescriptions with resolved values. `resolvePrescription(prescription, inputs, fixedTargetValues?)` is the shared typed resolution boundary. `validatePrescriptionExpressions` runs during template create/edit, routine save/edit, and adoption apply before persistence.
- [x] Rules retain CEL source, stable target/input bindings, evaluator version and resolved scalar values; checked AST/runtime artifacts are never serialized. Inputs preserve booleans and finite numbers. Safe integer literals are normalized before CEL checking. `roundLoad(load, increment)` delegates to the bounded equipment helper; authored fixed targets must be finite and nonnegative.
- [x] Integrated Biome, native/Vue typechecks and all 531 unit/integration tests passed. The production worker measures 510,696 raw / 136,025 gzip bytes, versus the previously measured `badd792` worker's 253,721 / 71,548: an increase of 256,975 raw / 64,477 gzip bytes for the complete domain cutover, not CEL alone. A production 390 × 844 walkthrough authored and persisted `100 * 0.9`, rejected collection syntax, captured 90 kg × 8, persisted and completed 92.5 kg × 7, undid/recovered it, and finished offline under a CSP without JavaScript `unsafe-eval`. The complete browser acceptance suite remains a separate section 8 gate.

Current callable interfaces: `resolvePrescription(prescription, inputs, fixedTargetValues?)`; template persistence validates expressions on `TEMPLATE_CREATE` / `TEMPLATE_EDIT`, routine persistence on `ROUTINE_SAVE` / `ROUTINE_EDIT`, and template adoption validates current source expressions before committing the preview.

### 5. Deliver authoring, phone logging and future-update review

- [x] One `TemplateRevisionEditor` is mounted by `/templates/new` and `/templates/[id]/edit`; it authors repeated activity/set rows, exact/range/minimum reps, roles, notes, non-strength duration/distance targets, named bounded scalar/boolean/physical inputs, fixed/input/formula targets, stable formula bindings, and editable execution groups. A “3 × 8–12” shortcut expands into editable rows. Existing persisted scheme metadata remains preserved through the editor; users can duplicate a template to create structural variants. `/templates` links to create and expression-template/routine authoring.
- [x] `/routines` lists saved routines; `/routines/new` selects a template revision, accepts typed inputs and direct fixed target values, previews recalculated targets, chooses continuation/deferral policy and saves through `useRoutines`. `/routines/[id]/edit` exposes typed configuration and recalculation preview; `/routines/[id]` provides revision details, reviewed template adoption and start intent. Configured values and expressions resolve before persistence and capture.
- [x] Production/offline phone-size authoring, configured/formula routine start, valid draft persistence, completion, undo, reload/resume and finish were exercised in an isolated managed Chromium profile at 390 × 844. Captured formula targets stayed 90 kg × 8 while actual work became 92.5 kg × 7.
- [x] `WorkoutRoutineReview.vue` accepts `workoutId: string` and emits `close`; it calls `routines.previewFutureUpdate(workoutId)` and `routines.applyFutureUpdate({ previewId, selectedValues })`, displays captured/actual/current/proposed candidates and referencing plans, allows explicit selected values, and offers explicit refresh when a stale-review error occurs. Applies only accepted input/fixed-rule deltas and leaves formulas, structure and unselected newer fields intact.
- [x] Integrated SQLite review regressions cover exact-rep and non-strength duration/distance candidates, explicit input choices, dependent-target recalculation, stale-review refusal without a new revision, explicit refresh and preservation of a newer unrelated rest target. The production phone review listed both independent plans sharing one routine; applying only selected reps from 8 to 7 preserved the formula-derived 90 kg load and the completed 92.5 kg × 7 actual result.
- [x] Durable row-first valid drafts, exact-value acceptance, completion/undo, skips and extra-row boundaries are implemented through the existing worker transaction path. Focused SQLite tests and the production formula journey prove draft exclusion, identity-preserving recovery, undo retaining draft values and immutable captured intent. Final grouped/range/rest coverage is recorded in section 8.

### 6. Deliver organization and selected progress views

- [x] Implement independent calendar appointments, protected unfinished-session links, end-of-current-local-day overdue cutoff, per-routine automatic/manual continuation and four-week clear-day deferral. Leave unresolved collisions overdue with manual resolution; explicit Postpone may override after warning.
- [x] Implement future-unstarted-only schedule reconciliation, preserving today's/overdue/historical/protected appointments. Never rebuild past obligations from current schedules.
- [x] Advance rotations exactly once on linked finish or explicit skip, not on start/postponement/unrelated ad-hoc work. Do not rewind after factual history corrections.
- [x] Implement template-bound reusable Programs with reviewed adoption and seven-local-date program weeks from the chosen start date, independent of Monday–Sunday goals and missed workouts. Progression changes require explicit acceptance.
- [x] Count qualifying finished workouts automatically once per activity-filtered weekly goal, using saved performed local dates. Keep appointment fulfillment explicit and separate; offer ad-hoc matching at finish.
- [x] Implement Today priority: recovery, dated due/overdue appointments, rotation suggestions, then unmet goals. Explain the stable choice and retain overrides, alternatives and Start ad-hoc.
- [x] Deliver comparable load/reps with supporting e1RM; commitment counts/timing without a composite score; total working sets, per-exercise tonnage, primary/secondary muscle attribution, one-primary-pattern distribution and separate non-strength totals.
- [x] Recompute historical distribution using current classifications, showing overlapping primary-muscle credits and unknown classifications without inflating overall volume.

### 7. Deliver retrospective corrections and portability

- [x] Correct the agreed actual work and factual context, including adding/removing mistaken actual rows and performed-date corrections; recompute affected PR/load/volume/summaries and goal/appointment credit atomically.
- [x] Support explicit appointment link/unlink/relink with credit previews; at most one appointment per workout. Preserve captured intent, unrelated history, rotation position and other appointments.
- [x] Version complete backup/restore and portable template/Program/routine/plan contracts to include revisions, bindings, rules, drafts and credit relationships. Validate expressions/references before committing imported data.
- [x] Update CSV/cards for corrected actual data; never substitute prescribed targets for results.
- [x] Exercise populated export/reset/restore and legacy imports, preserving sibling-app storage and reset isolation.

Current correction/portability evidence: the integrated SQLite suite covers previews, stale/rollback protection, date/credit changes, explicit relinking, removals, added strength/non-strength results, legacy imports and portable Program/routine/plan graphs. The owned production profile exported a version-2 full backup with two workouts, a routine and captured formula intent; reset showed empty history/routines; restore recovered the routine and 92.5 kg × 7 actual result. Additive version-2 import created a second independent routine/revision without overwriting history. The downloaded CSV contained corrected 85 kg × 6 and 92.5 kg × 7 actuals, not the 90 kg prescription. No user workout data or sibling-app data was used or reset.

### 8. Verify end-to-end behavior and document the cutover

- [x] Run package-native formatting/checks, typechecks and targeted behavioral regressions, then the unit/integration suite. Avoid wording/default/wiring-only tests.
- [x] Run production browser coverage and an actual phone-size walkthrough: author, realise, preview/save, start, draft/edit/tick/undo/skip/add, reload/resume, finish/decline-or-accept updates, correct/relink history, export/restore.
- [x] Exercise ad-hoc prescribed/freestyle paths and eligible progress/goal inclusion without silent appointment fulfillment.
- [x] Exercise shared routines across plans, one-appointment fulfillment with multiple goal credits, clear-day/no-clear-day deferral, manual collision override and repeat-open reconciliation without duplicates.
- [x] Exercise template/Program adoption, stale finish-update conflicts, Wednesday program starts, Sunday-to-Monday workouts, factual date corrections, and preservation of protected/historical commitments.
- [x] Assert draft exclusion, range actuals, unchanged captured intent, empty versus shortened fulfillment, rotation idempotence/no historical rewind, warm-up exclusion, muscle overlap, movement totals and current-classification changes.
- [x] Recheck installed/offline PWA and relevant accessibility surfaces; dev-server behavior is not release proof.
- [x] Update architecture/release documentation after behavioral proof; do not suppress the workspace dedupe guardrail.

Current production walkthrough (2026-10-03): an isolated managed Chromium profile at 390 × 844 authored `100 * 0.9`, saved a 90 kg × 8 routine, and used the same routine in two independent personal plans. A 92.5 kg × 7 pending draft survived reload and explicit resume without becoming performed work. Offline completion, undo, cached reload/resume and finish retained identity and captured intent. Finishing the explicitly linked workout fulfilled only its selected appointment; other appointments remained open. The future-update review named both plans, and the selected reps-only update produced a 90 kg × 7 future prescription. A subsequent unlinked prescribed workout credited each of two applicable weekly goals once without fulfilling either remaining appointment. The controlled, activated service worker retained cross-origin isolation offline; cached manifest/icons were usable, and the phone surface had no horizontal overflow. The strict preview CSP omitted JavaScript `unsafe-eval` while permitting SQLite's WebAssembly compilation. These are browser/PWA proofs, not physical-device or native certification.

**Final acceptance evidence — 2026-10-03**

- Plain `pnpm --filter hephaestus check:fix && pnpm --filter hephaestus verify && pnpm --filter hephaestus test:e2e` passed in the implementation worktree. Biome checked 189 files with 28 informational single-word-component diagnostics and no errors/warnings; native `tsgo` and Nuxt/Vue typechecks passed; all **534 unit/integration tests across 47 files** and **110 production Chromium tests** passed. The existing Vite native-config-loader notice remained informational.
- `pnpm lint:deps` passed with no violations across 752 modules; `pnpm lint:semgrep apps/hephaestus` passed. The known workspace dedupe issue remains separately tracked in issue #54; no guardrail was suppressed and repository-wide CI is not claimed.
- SQLite acceptance covers independent recurring calendars, clear-day/exhausted-horizon deferral, manual collision overrides, repeat-open idempotence, protected/future-only Program adoption, Wednesday-anchored Program weeks, factual date/credit corrections, stale reviews and transaction rollback. Rotation receipts survive factual corrections; warm-ups and drafts do not receive working-set/goal credit; current classifications and overlapping muscle attribution remain explicit.
- Production browser coverage exercises exact/range template authoring, grouped completion/rest/recovery, routine drafts/completion/undo/skips, shared-plan fulfillment and rotations, factual correction, additive prescription imports and complete backup/reset/restore. Consumers now use current semantic activity/set controls and the explicit Start-once preview; the obsolete global-tonnage display assertion was removed.
- A further isolated production smoke started an explicitly linked appointment, finished with zero performed sets, and observed the appointment available to start again with **0 of 3** weekly goal credit. At verified **390 × 844** with no horizontal overflow, a replacement **30 kg × 8** workout fulfilled that same appointment and produced **1 of 3** credit. SQLite regressions also prove warm-up-only release and that later factual corrections cannot steal an appointment already claimed by a newer workout.
- PWA evidence covers the production service worker, offline navigation/recovery, install manifest/scope and usable cached icons, cross-origin isolation, headerless-host isolation recovery, mobile axe checks, keyboard focus and all three themes. The strict-CSP formula smoke ran without JavaScript `unsafe-eval`. These are browser/PWA checks, not physical-device/native certification or an OS-level installation certification.
- The configured-training architecture is recorded in `apps/hephaestus/design.md`, with the historical issue audit pointing to this cutover. Task-owned verification tabs and temporary preview servers are cleaned up; user data, the primary checkout and unrelated worktrees remain untouched by this implementation.

## Likely implementation targets

- Data/schema: `app/lib/db-schema.ts`, `workout-schema.ts`, `workout-storage.ts`, `palladium-database.ts`, `app/types/database.ts`, `app/workers/database.worker.ts`, `app/composables/useDatabase.ts`.
- Templates/routines: `app/composables/useTemplates.ts`, `usePrograms.ts`, `app/pages/templates/**`, `app/components/workout/SetSchemeWizard.vue`, `app/lib/set-schemes.ts`, `set-rest.ts`.
- Logging/correction: `app/composables/useWorkout.ts`, `app/pages/workout/index.vue`, `app/components/workout/ExerciseBlock.vue`, `SetRow.vue`, `AddSetSheet.vue`, grouped logging components, `app/pages/history/**`.
- Feedback/transfer: `app/pages/progress/index.vue`, `app/composables/useProgress.ts`, `app/lib/data-transfer.ts`, `template-export.ts`, `workout-card.ts`, `app/pages/profile/index.vue`.
- Existing behavioral suites: `tests/integration/templates.test.ts`, `workouts.test.ts`, `personal-records.test.ts`, `data-transfer.test.ts`, `migrations.test.ts`; relevant unit helpers and production `tests/e2e/` journeys.

## Continuation and safety

- Use the confirmed vocabulary and follow-up contracts above. The separate reusable Program, independent schedules, fulfillment/goal distinction, reconciliation/update review, correction/undo scope and progress measures are implemented through the mapping above. Exploratory features remain unapproved. Do not enable automatic rescheduling for routines that have not selected it or silently add coaching/deletion.
- Research baseline only: no new application implementation, production bundle measurement or package gate was run during the original research. Prior release counts (488 unit/integration, 121 browser tests) belong to the completed-release evidence. Section 1 above records the subsequent defect-fix verification separately.
- Dev server was started as `hephaestus-ux-dev` at `http://127.0.0.1:3210/`. Recheck availability before using it in a later session. Loopback is not access from a physical phone.
- Desktop automation lacked macOS Screen Recording permission; the user's browser was opened via the OS URL opener. Independent walkthrough/research used managed Chromium profiles, not the user's workout data. Review tabs were closed; no user data was reset.
- Respect existing single-writer recovery, app-scoped reset and Palladium local persistence. Sync/auth, native certification, GPS, body metrics and fitted statistical strength models remain outside this iteration unless separately chosen.
- Workspace dedupe remediation remains separate in [issue #54](https://github.com/HabitatHQ/habitathq/issues/54).
- Prior publication used `[skip ci]` at the user's request. Do not start Actions runs, disable workflows permanently, or assume prior commit/push authorization applies to new work. Preserve unrelated files, ignored artifacts and worktrees.
