# Hephaestus Domain Vocabulary

Date: 2026-10-02  
Status: core terminology and follow-up interview contracts confirmed; physical storage/API design and explicitly exploratory features remain separate.
Repository baseline: `bb294de35b76a3c7eba0d17d8a305c9242eb6831`.

## Purpose and reading order

Establish the language of training before specifying more features or designing persistence. This is not a database glossary, API contract or implementation backlog.

1. Review this vocabulary.
2. Review the [conceptual model and feature exploration](hephaestus-conceptual-model-20261002.md).
3. Use the confirmed interview contracts; distinguish implementation mapping from genuinely new scope decisions.
4. Follow the [UX handoff](hephaestus-ux-routines-handoff-20261002.md) for implementation TODOs and verification scenarios.

The vocabulary describes desired product concepts, not a claim that the current app implements them. Existing source names and physical tables are not authoritative domain definitions. Historical ideas in `apps/hephaestus/design.md` and `template-improvements.md` are not newly approved scope.

## Confirmed product intent

- Configure a reusable workout once, log quickly on a phone and correct actual records afterward.
- Separate template structure, a saved realisation, captured session intent and actual performance.
- Realisation changes values without changing exercise/set structure. Nothing silently regenerates the saved realisation for every session.
- Confirmed terminology: a routine is one reusable configured workout; a training plan is the broader arrangement, such as PPL x2. Routine does not mean the whole multi-workout sequence.
- Confirmed organization modes: independent plan calendars, ordered rotations advancing on linked finish/explicit skip, and Monday–Sunday frequency goals automatically counting qualifying finished actual work. These modes never authorize automatic prescription progression.
- Confirmed plan relationships: one training plan may mix calendar, rotation and frequency-goal organization; multiple training plans may be active together. Plans are optional grouping, not exclusive application modes. Routines retain independent continuation behavior.
- Confirmed routine reuse: several plans may reference the same saved routine. Explicitly editing that routine's prescription affects future starts from every referencing plan; plans do not silently create private prescription copies. Different reusable targets require a separate saved realisation of the template. Captured session intent and actual results remain unchanged.
- Programs are distinct reusable multi-week template-based designs. Personal Training Plans adopt a reviewed Program revision and bind its slots to compatible saved routines, without private copies. Program weeks are seven-local-date blocks from the plan start date, not necessarily Monday–Sunday.
- Template and Program edits require explicitly reviewed adoption into saved routines/following plans; already captured intent and actuals remain unchanged.
- Support multiple routines with independent continuation behavior: calendar-bound or carry-forward. Carry-forward supports configurable automatic or manual postponement.
- Do not derive continuation behavior from exercise type, morning/evening or a mandatory training-track category.
- Prioritize starting the applicable planned workout; recovery of an unfinished session takes precedence.
- Ad-hoc workouts are first-class: neither a schedule nor a template/configured routine is required. They receive the same applicable logging, recovery, correction, history, progress and portability support.
- Progress should answer: am I getting stronger, following my plan consistently and balancing volume? Volume feedback must include muscle-group distribution, movement-pattern distribution and total volume, not choose only one view.
- Explore possible near-term features to test the model, without treating exploration as implementation approval.

## Prescription vocabulary

The meanings below follow the confirmed template/routine/intent/actual boundaries. Fine-grained role labels and field validation still require implementation mapping, not a new competing prescription model.

| Term                  | Meaning                                                                                                                                                                                                                                           | Not the same as                                                                                      | Example                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Exercise              | An identifiable movement/activity that can recur across workouts. Its relevant variant and load convention matter when comparing performance.                                                                                                     | An occurrence of that exercise in today's workout.                                                   | Barbell bench press.                                                    |
| Workout template      | A reusable blueprint: ordered activities, grouping, set structure, defaults and target rules. A template may contain one exercise or a full workout.                                                                                              | An exercise list, a dated appointment or completed workout.                                          | Push A with bench, incline press and accessories.                       |
| Activity prescription | An intended part of a workout: an exercise with sets, a cardio segment, conditioning intervals or mobility work.                                                                                                                                  | Actual activity performed.                                                                           | Bench with two warm-up sets, a top set and two back-off sets.           |
| Set prescription      | The intended role and targets for a particular strength set. Repeated sets remain individually inspectable and editable.                                                                                                                          | A completed set result.                                                                              | Back-off set: 8 reps at 90% of the top-set load.                        |
| Execution group       | A relationship governing how activities are performed together.                                                                                                                                                                                   | A category/folder or a per-exercise set scheme.                                                      | Alternating lateral raises and triceps extensions as a superset.        |
| Configuration input   | A deliberately supplied value used to realise targets.                                                                                                                                                                                            | A value inferred from each actual set or changed implicitly by logging.                              | Bench working load of 60 kg.                                            |
| Target rule           | A fixed value, reference, percentage, rounding rule or restricted scalar expression used to calculate a target.                                                                                                                                   | Scheduling logic, progression permission or a general script.                                        | Back-off load is 90% of the configured top-set load, equipment-rounded. |
| Resolved target       | The concrete intended value or range after rules and configuration are applied.                                                                                                                                                                   | A recorded result or evidence that a set was performed.                                              | 55 kg for 8 reps; alternatively a prescribed rep range.                 |
| Realisation           | The deliberate act of supplying values, previewing targets and saving a reusable prescription while preserving structure.                                                                                                                         | Starting a session or recording actual performance.                                                  | Save Push A with bench working load 60 kg.                              |
| Configured routine | A saved reusable realisation retaining an adopted template revision, structure/rules/defaults, configuration and explainable resolved targets. Shared prescription edits affect future starts through every referencing plan. | A temporary session plan, an independent structural fork, an implicit private plan copy or the whole PPL sequence. | Push A at current loads, referenced by two plans. |
| Equipment profile     | Available equipment/load choices and rounding context used for suggestions.                                                                                                                                                                       | A restriction prohibiting manual load entry.                                                         | Available load increments of 2.5 kg.                                    |
| Session-only override | A deliberate one-session deviation that leaves the reusable prescription unchanged.                                                                                                                                                               | An accepted update to future workouts.                                                               | Use 50 kg today instead of the prescribed 55 kg.                        |
| Template adoption | Explicitly review and save a newer template revision into a routine, preserving compatible inputs and resolving references. | Automatic propagation or a required interruption before every workout. | Update Push A after reviewing changed back-off rules. |
| Structural variant | A different reusable exercise/set/group structure authored by editing or duplicating a template. | An incidental value-only realisation change. | Duplicate Push A's template to add another exercise. |
| Saved revision / provenance | The deliberately saved source identity needed to explain a routine or captured prescription. | A live pointer that allows later edits to rewrite intent. | The routine revision that supplied this session's 60 kg target. |

Set roles such as warm-up, working, top and back-off describe intent; a scheme describes a pattern across sets; a superset/circuit groups activities. These do not become competing prescription formats. Warm-ups remain excluded from strength PR/e1RM and working-set volume. Exact visible suggestions may be accepted by ticking; rep ranges require achieved actual reps. Enumerate the supported role/effort fields during implementation mapping.

## Organization and continuation vocabulary

| Term                | Meaning                                                                                                                                                                             | Important boundary                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Training Plan | A personal arrangement of intended training. May mix organization modes, coexist with other active plans and optionally follow an adopted Program revision with personal start date/routine bindings. | Not one session's captured intent or an exclusive application mode; never mandatory for ad-hoc logging. |
| Program | A reusable multi-week design of template-based workout slots, weeks/phases and progression intent, independent of personal configured loads. | Not the personal calendar or a live edit that automatically updates every following plan. Adoption into a plan is explicit and reviewed. |
| Organization mode   | How intended training is arranged: calendar appointments, an ordered workout rotation or a frequency goal over a period. All three are selected for the conceptual model.           | Continuation after a missed appointment, prescription calculations or automatic progression.                                                           |
| Schedule | The dated/timed part of organization in a plan context. Two plans may independently schedule the same saved routine. | Not a shared routine prescription or an invented calendar for rotations/goals. |
| Planned occurrence / appointment | One independently identified commitment with original and current planned local timing. | Neither the reusable routine nor an actual workout. Moving it does not move another appointment. Scheduled freestyle slots remain exploratory. |
| Continuation policy | The saved routine's shared policy: calendar-bound leaves a miss and later slots unchanged; carry-forward retains that occurrence for a later opportunity. | Not schedule ownership, deferral mode, progression or a global workout-type/time-of-day policy. |
| Deferral mode       | For carry-forward, whether postponement happens automatically or through an explicit Postpone action.                                                                               | A per-routine setting, not a global morning/cardio behavior.                                                                                           |
| Postponement | Move one intended occurrence to a later local date, retaining identity/original timing. Automatic deferral uses the next same-routine-clear date within today plus 27 days; manual Postpone may override a collision after warning. | Not merging/deleting commitments or shifting another routine/plan. With no clear automatic date, retain overdue work for manual resolution. |
| Missed / overdue occurrence | An open, unstarted appointment after its current planned local day ends. Calendar-bound work stays missed; carry-forward work remains actionable under its selected mode. | Not a fulfilled/skipped commitment, rest day, unfinished linked workout, failed target or fabricated actual result. |
| Ad-hoc workout      | Training started without selecting a planned occurrence. May use a configured routine or be entirely freestyle.                                                                     | Not an inferior workout, missing data or an automatic fulfillment of a scheduled occurrence.                                                           |
| Rest day            | An intentionally unscheduled training day in the relevant plan.                                                                                                                     | A missed workout or zero adherence by default.                                                                                                         |
| Rotation | An ordered sequence of configured routines. Linked finish or explicit Skip advances the current item once. | Start, postponement, unrelated ad-hoc work and historical relinking/correction do not advance or rewind it. |
| Frequency goal | A target count of finished workouts containing completed work matching an activity filter within a Monday–Sunday week. Count each workout once per applicable goal. | No required appointments, minimum-work thresholds, accumulated-work targets or invented dated misses in this iteration. |
| Goal credit | Automatic credit from qualifying scheduled or ad-hoc actual work within the goal period. | Not explicit calendar fulfillment and not another copy of actual work for volume totals. |
| Appointment fulfillment | A finished workout explicitly linked to at most one appointment, with at least one completed activity/set. | Not meeting every target; empty workouts do not qualify. Multiple goals may independently receive credit. |
| Program week | A seven-local-date block relative to the personal plan start date; Wednesday starts imply Wednesday week boundaries. Misses do not delay phases. | Not necessarily a Monday–Sunday reporting/goal week or a completed training cycle. |
| Performed local date | Initially the saved workout-start local date, retained across reload/travel and explicitly correctable in history. | Not automatically the finish date or a UTC conversion; elapsed duration still uses timestamps. |

### Agreed routine and training-plan distinction

The user confirmed this terminology:

```text
Template: Push A structure and target rules
Routine: Push A at my configured working loads
Training plan: arrangement of Push A / Pull A / Legs A / ...
Workout: actual session, scheduled or ad hoc
Program: reusable eight-week template-based design
Training plan following it: my start date, arrangement and saved routine bindings
```

Use routine for the saved realisation, not for the entire PPL sequence. A training plan is optional; routine continuation remains independent of workout type/time of day, without adding a mandatory training-track category.

Shared routine identity is confirmed. For example, two plans can reference Push A at a bench working load of 60 kg. Explicitly changing that saved routine to 62.5 kg affects future starts from both plans; a session already started keeps its captured intent. For different reusable targets, save another realisation such as Light Push from the same template. A session-only override still changes neither saved routine nor other sessions.

The Program/Training Plan distinction, shared prescriptions, independent appointments and fulfillment/goal boundaries are now confirmed. This does not approve exploratory features such as combined prescriptions, scheduled freestyle slots or automatic substitutions.

### Program versus Training Plan: confirmed

A Program is reusable design; a Training Plan is personal arrangement/execution context. Program slots reference templates; the plan binds them to compatible saved routines at personal values. A plan may exist without a Program, and logging may exist without either.

Following plans retain an adopted Program revision until explicit reviewed adoption. Reconcile future organization/bindings under the same protected-appointment rules as schedule edits, preserving today's/overdue/historical commitments and captured/actual data. Program-relative weeks/phases advance by local dates from the plan start, independent of misses and weekly goal boundaries.

Preserve existing multi-week/progression functionality through explicit migration. Progression suggestions still need reviewed acceptance of input/fixed-target changes; neither phases nor rules silently regenerate routines.

## Execution and historical vocabulary

| Term                       | Meaning                                                                                                                             | Important boundary                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Workout / session          | One actual bout of training. These are working synonyms; choose a consistent UI term later.                                         | Not the reusable routine or a planned appointment.                                    |
| Captured session plan / intent | The supplied prescription as it stood at session start, with inputs, targets and source revision provenance. Immutable in this iteration. | Not a live reference to current templates/routines; absent for freestyle and unavailable for some legacy history. |
| Actual result | Completed performed work: exercise/activity identity, load/reps/duration/distance, effort/notes and deviations. | Not targets or pending draft values; missing measurements are not zero. |
| Pending set / draft | A durable editable row not yet recorded as performed. Valid edits survive reload/resume; exact suggestions can be explicitly accepted on completion, while ranges require achieved reps. | Not a failed or completed set, and never included in performed-work metrics. |
| Skipped set                | A planned set explicitly not performed.                                                                                             | An extra set, a pending set or deletion of original intent.                           |
| Extra activity/set         | Actual work beyond the captured plan.                                                                                               | An automatic structural edit to the template.                                         |
| Session completion         | Explicitly finish and save the actual workout.                                                                                      | Successfully meeting every prescribed target.                                         |
| Unfinished session         | A durable workout still awaiting resume, completion or discard.                                                                     | A missed appointment simply because the app is closed.                                |
| Retrospective correction | Repair actual exercise identity, add/remove mistaken actual rows, or edit result values, effort/notes, title and performed date/time; atomically recompute affected feedback and goal/appointment credit. | Does not rewrite captured intent, rewind rotation position, reschedule other appointments or authorize whole-workout deletion. |
| Future-prescription update | Review captured/actual/current routine values, then explicitly accept input or directly authored fixed-target changes with dependent-target/shared-impact preview. | Not automatic promotion of actuals, inferred inverse formulas, formula replacement or stale snapshot overwrite. Structural reuse requires separate template edit/duplicate review. |
| Completion tick | Explicitly record the currently visible valid values as actual performance, including the latest edits, without a modal. | Rendering a target is not completion; missing/invalid required values block it. |
| Completion undo | Return recorded values to pending durable drafts without erasing them or changing captured targets. | Not resetting edited values to the original suggestions. |
| Appointment relinking | Explicit history link/unlink/change of the workout's single appointment with a credit-effect preview. | Not automatic similarity matching or retroactive rotation advancement. |
| Schedule reconciliation | Preview and update future unstarted appointments after schedule changes. | Preserve today's/overdue/fulfilled/skipped/protected appointments; do not manufacture past obligations. |

An ad-hoc workout does not require a captured prescription or a manufactured template/routine. If it uses a reusable prescription, capture that intent normally; if it is freestyle, record that no prescription was supplied. This known absence is distinct from historical intent that is unavailable. Actual work remains eligible for strength and volume feedback under the same measurement rules as scheduled work.

## Progress vocabulary

The measurement conventions below are confirmed; concrete chart layout and implementation representation are not prescribed.

| Term                      | Meaning                                                                                                                                        | Avoid conflating it with                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Strength progress | Comparable exercise/variant load and rep history, effort when known, with the existing labeled e1RM supporting evidence. | Not global tonnage, guaranteed physiological gain, equal assumed effort or unqualified comparisons across machines/variants. |
| Personal record           | Best observed eligible performance for a named exercise and metric.                                                                            | A planned target or a number without exercise identity/appropriate units.                                                                    |
| Estimated 1RM             | A labeled estimate derived from eligible performed strength work under an explicit formula.                                                    | A measured max or the deferred fitted strength-curve model.                                                                                  |
| Plan consistency | Explainable fulfilled/missed/postponed/skipped/open appointment counts and original/current/actual timing, alongside weekly goal progress. | Not a streak or composite adherence percentage; goal credit and target attainment remain separate. |
| Prescription attainment | Per-field actual-versus-captured comparison: exact/range matching differs from exceeding a minimum; missing targets/effort remain unknown. | Not appointment fulfillment or an overall weighted passed/failed workout score. |
| Training volume | Actual completed working sets from finished workouts, per-comparable-exercise external-load × reps, and separate activity-appropriate non-strength measures. | No universal strength/cardio/mobility volume number; exclude warm-ups, pending/skipped work and unfinished sessions from strength working-set volume. |
| Volume balance | Primary-muscle credits with secondary involvement separate, one primary movement-pattern distribution, and overall working-set count over the same period/basis. | Not a clinical balance score, equal desired muscle volume or additive overlapping muscle shares. |
| Total strength volume | Count each eligible completed actual working set once, independent of category attribution. | Not sums of muscle credits, muscle-plus-movement totals or global tonnage across unlike exercises/equipment. |
| Muscle contribution | One set credit per tagged primary muscle, secondary involvement shown separately without fractional credits; current classification refreshes historical attribution. | Not an exact biological measure or a rewrite of actual work/captured intent. Multiple primary tags may overlap; unknown classification remains visible. |
| Training load / readiness | Descriptive estimates already in the app's product vocabulary.                                                                                 | The newly selected progress priorities, medical advice or permission for automatic coaching.                                                 |

Per-exercise tonnage uses explicit comparable load conventions and units; do not invent moved bodyweight/assistance loads. Movement-pattern counts include one primary pattern per exercise plus Other/Unclassified and sum to eligible working-set totals. Cardio, conditioning and mobility keep appropriate recorded duration/distance and applicable completed-work measures separate; mixed workouts contribute once to each applicable view. Ad-hoc work has the same eligibility as scheduled work, and absent intent never becomes an invented planned-volume baseline.

## Remaining implementation mapping and separate scope

The interview resolved Program semantics, ownership across plan references, calendar/rotation/goal behavior, deferral cutoff/collisions/horizon, routine reconciliation, completion/undo/correction, future-update conflicts and progress measures. Do not reopen these choices merely because existing table/API names differ.

Next, enumerate supported role/effort fields and validation, grouped completion/rest details, activity filters, expression numeric/unit semantics, stable references and portable import formats using existing app patterns. Map them to the Palladium transaction boundary and consumer-visible verification scenarios in the handoff.

Scheduled freestyle slots, one-off/later intent amendment, combined source prescriptions, automatic substitutions, pause/rest automation, broader goal types, fractional muscle modeling and composite adherence/attainment scores are not approved by this interview.

## Domain boundaries

Palladium remains the required local data boundary; physical storage design follows these confirmed contracts. Preserve existing data, unknown historical intent and the supported local-first single-writer PWA boundary. Account-backed sync, native certification, GPS, body metrics, health integrations and fitted statistical strength curves remain deferred unless separately chosen. No app implementation or application verification is claimed by this vocabulary update.
