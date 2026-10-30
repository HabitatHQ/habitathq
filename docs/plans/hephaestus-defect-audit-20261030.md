# Hephaestus defect audit — 2026-10-30

## Scope and evidence

Read-only application assessment, not an implementation pass. The authoritative runtime was upstream `origin/main` at `fdc327a`, using `.worktrees/easter-egg-audition-20261030`. The primary checkout was behind upstream and contained unrelated user changes; those were preserved. The two Hephaestus differences from the primary checkout were database-reset and service-worker changes, so runtime conclusions use the upstream worktree, not the older versions of those files.

Three independent read-only scouts reviewed transfer integrity, prescription/scheduling, and workout/correction logic. Their suggestions were leads, not verification. The findings below come from parent-reviewed source and direct runtime reproductions.

Verification used isolated Chromium origins (`127.0.0.1:3222` and `localhost:3222`), synthetic data, the real database worker, SQLite WASM/OPFS, and supported dispatcher operations. Routine switching, fractional-RIR correction, and same-day effort attribution were exercised through the UI. Transfer and goal-credit defects were exercised through the actual worker API and checked against persisted rows. No personal data was used.

This pass confirms **six additional user-facing defects**, alongside five reproduced in the preceding assessment. A separate dispatcher-level stale-review weakness is recorded with its UI reachability limitation. No application fixes, permanent tests, commits, or pushes were made. This report is the requested deliverable.

Priority meanings: **P1**—recovery or imported-configuration integrity; **P2**—supported workflows or reports return incorrect results.

## New confirmed defects

| ID | Priority | Defect | Verification |
|---|---|---|---|
| H-01 | P1 | Normal Program revision history makes full backups and portable exports fail their own import validation | Real worker export and preflight |
| H-02 | P1 | Portable exercise-filtered goals retain the source installation's exercise identities | Cross-origin export/import and completed workout |
| H-03 | P2 | Switching templates while creating a routine clears the form and disables Save | Browser UI and runtime error |
| H-04 | P2 | A normally logged fractional RIR blocks unrelated historical corrections | Browser UI, persisted value, visible rejection |
| H-05 | P2 | Same-day sessions overwrite each other's displayed RPE | Browser UI and comparison with persisted sets |
| H-06 | P2 | Editing a weekly-goal filter leaves old credits counted under the new filter | Worker mutation/report and title-only correction |

### H-01 — Program revision history invalidates the app's own exports

**Impact:** Users can successfully download a full backup or portable training configuration that the app subsequently refuses to restore/import. Ordinary Program authoring is sufficient; the data does not need to be manually corrupted. This is a recovery blocker, not evidence that the live database has already lost data.

**Reproduction:**

1. Create a template and a one-week Program with no slots.
2. Add the first Program day through `PROGRAM_ADD_SLOT`.
3. Export portable configuration and preview its import: valid.
4. Add a second day through the same operation. Existing slot identities are retained in successive immutable Program revisions.
5. Export portable configuration again and preview import.
6. Export a full backup and preview restore.

**Observed:**

- The revisions contained slot counts of zero, one, and two. The first slot correctly appeared in both later revisions.
- Portable preflight returned `valid: false` with `Duplicate portable Program slot identity: <id>.`
- Full-backup preflight returned `valid: false` with `Backup Program slot identity is duplicated.`

**Cause:** Validation treats stable slot identity across revision history as a globally duplicated entity. Full-backup validation keeps one slot set across all Program revisions. Portable validation does the same; its identity-registration phase independently rejects the repeated slot too. Fixing only the preview validator would therefore leave import broken.

**Source:** [data-transfer.ts:572–591](../../apps/hephaestus/app/lib/data-transfer.ts#L572), [data-transfer.ts:1771–1773](../../apps/hephaestus/app/lib/data-transfer.ts#L1771), [data-transfer.ts:1859–1869](../../apps/hephaestus/app/lib/data-transfer.ts#L1859), [data-transfer.ts:2038–2046](../../apps/hephaestus/app/lib/data-transfer.ts#L2038); revision-preserving slot addition in [prescription-storage.ts:1726–1773](../../apps/hephaestus/app/lib/prescription-storage.ts#L1726).

**Correction direction:** Distinguish duplicate slots inside one revision from the same logical slot recurring in valid revision history. Preserve one consistent destination identity for that logical slot across imported revisions and plan bindings. Reject genuinely incompatible identity reuse rather than removing duplicate checks wholesale.

**Acceptance:** A Program with multiple successive revisions must survive both full-backup restore and portable import. Repeated imports must remain independent; references within each imported graph must remain consistent.

### H-02 — Portable goal filters are not remapped to destination exercises

**Impact:** An import is reported successful, but an exercise-specific weekly goal no longer counts the intended activity. This is silent semantic corruption of imported configuration.

**Reproduction:**

1. In installation A, create a squat template and a personal plan with a goal filtered to Barbell Squat.
2. Export the portable configuration.
3. Import it into installation B, whose built-in Barbell Squat has a different database identity.
4. Complete a working set using the imported squat template.
5. Inspect the imported goal, credit preview, and weekly report.

**Observed:**

- Source exercise: `9330518d-c534-45f4-b0e8-296ea06f06d4`.
- Destination catalog exercise: `c8f33a16-3734-4d5a-a774-f5acafe14241`.
- Import preview was valid and reported one reused catalog exercise.
- The imported template used the destination exercise correctly.
- The imported goal's `filter_json.exerciseIds` still contained the source identity.
- The completed workout qualified as actual work, but its credit preview had `goalIds: []`; the imported squat goal remained at zero.

**Cause:** Recursive JSON remapping recognizes scalar exercise references and selected reference-array keys, but not `exerciseIds`. Import validation does not catch the resulting mismatch.

**Source:** [data-transfer.ts:1227–1262](../../apps/hephaestus/app/lib/data-transfer.ts#L1227), [data-transfer.ts:1970–2016](../../apps/hephaestus/app/lib/data-transfer.ts#L1970), [data-transfer.ts:2075–2109](../../apps/hephaestus/app/lib/data-transfer.ts#L2075).

**Correction direction:** Include goal-filter exercise references in graph dependency selection, validation, and identity remapping. The exporter currently derives exercise dependencies from templates and routine revisions, not goal filters ([data-transfer.ts:1144–1167](../../apps/hephaestus/app/lib/data-transfer.ts#L1144)); that companion dependency gap was source-inspected, not separately runtime-qualified here.

**Acceptance:** Cross-installation imports must count the same intended activities despite different catalog IDs. Cover catalog reuse, newly imported custom exercises, repeated imports, and an exercise referenced only by a goal.

### H-03 — Routine creation retains the previous template's revision ID

**Impact:** The visible Template selector offers a valid action that leaves the routine editor unusable without restarting/recovering the form. The failure is not explained in the page.

**Reproduction:** Create two templates with distinct loads, open `/routines/new`, allow the first template to load, then select the second template.

**Observed:** The initial form showed the first prescription. Changing the selector cleared its fields and resolved preview, disabled Save, and emitted `Template revision for <second-template-id> not found` as a page error. No corresponding visible error explained the disabled form.

**Cause:** `refreshRevision()` clears the current state, then requests the newly selected template using the previous template's `templateRevisionId`. The watcher observes both IDs, but changing the template does not first clear/reset its dependent revision ID. The asynchronous watcher also does not catch this failure.

**Source:** [routines/new.vue:67–95](../../apps/hephaestus/app/pages/routines/new.vue#L67).

**Correction direction:** Treat template identity and selected revision as dependent state. Reset/reselect the revision on template change, prevent stale responses from replacing the latest selection, and surface load errors visibly without discarding unrelated user input.

**Acceptance:** A→B→A selection works; opening with an explicit valid revision still works; failed or rapidly changed selections do not silently disable the editor.

### H-04 — Fractional RIR accepted during logging blocks history correction

**Impact:** An existing workout cannot be corrected through the normal history editor, even when the user changes only its title. The user must change an unrelated recorded fact to get past validation.

**Reproduction:** Log a squat with RIR `1.5` through the set editor, complete the set, finish the workout, open Correct workout, change only Title, and choose Review correction.

**Observed:** SQLite contained `{ rir: 1.5, completed: 1 }`. Correction displayed `rir must be a whole number` and did not produce a review.

**Cause:** Active-workout validation explicitly accepts a finite fractional RIR from zero through ten. Historical correction requires integer RIR. The correction form resubmits all existing set values, so the mismatch also blocks unrelated edits. Correction additionally lacks the logging path's RIR upper bound; the reproduced defect is the fractional-value rejection, not an upper-bound exploit.

**Source:** [workout-storage.ts:943–951](../../apps/hephaestus/app/lib/workout-storage.ts#L943), [history-correction.ts:65–73](../../apps/hephaestus/app/lib/history-correction.ts#L65), [HistoryCorrectionPanel.vue:151–175](../../apps/hephaestus/app/components/history/HistoryCorrectionPanel.vue#L151).

**Correction direction:** Establish one RIR contract for logging, correction, and persisted legacy values. Do not silently round existing observations or require users to rewrite unrelated facts.

**Acceptance:** A title-only correction preserves every previously accepted set value. Both entry paths enforce the same documented bounds and numeric precision.

### H-05 — Same-day exercise history associates effort by date, not session

**Impact:** Two workouts on one local day display incorrect or missing effort, despite retaining distinct load/repetition rows. This undermines comparisons between sessions.

**Reproduction:** Finish two same-day Barbell Squat workouts: the first at 100 kg × 5 with no RPE, the second at 80 kg × 8 with RPE 9. Open Progress and choose Barbell Squat.

**Observed:** Both session rows displayed `average recorded RPE Not recorded`. The underlying sets retained `rpe: null` and `rpe: 9`, respectively. Depending on result ordering, either same-day value can overwrite the other.

**Cause:** The effort query groups by workout ID and date, but `Object.fromEntries` keys its result only by date. Session statistics also expose date without a durable workout identity for this join.

**Source:** [progress/index.vue:66–82](../../apps/hephaestus/app/pages/progress/index.vue#L66), [analytics.ts:129–175](../../apps/hephaestus/app/lib/analytics.ts#L129).

**Correction direction:** Keep workout identity on each per-session statistic and join effort by that identity. A local calendar date is a grouping/display value, not a unique session key.

**Acceptance:** Same-day sessions retain their own RPE averages, including null-versus-recorded effort, regardless of query order.

### H-06 — Goal filter edits leave stale derived credits

**Impact:** The weekly report counts workouts that do not match the displayed goal's current filter. An unrelated history correction can then change that count, making the report inconsistent over time.

**Reproduction:**

1. Create an active gym-only weekly goal.
2. Finish a qualifying gym workout: weekly count becomes one.
3. Edit the same goal to run-only.
4. Read the report and the gym workout's current credit preview.
5. Apply a title-only historical correction to that workout and read the report again.

**Observed:** The renamed run-only goal still showed count one immediately after the filter edit, while credit preview returned no matching goal IDs. After changing only the workout title, its count became zero.

**Cause:** Goal save updates the filter without reconciling `organization_goal_credits`; reports trust those materialized credits. Historical correction recomputes credit for the corrected workout against current filters, exposing the inconsistency.

**Source:** [organization-storage.ts:432–447](../../apps/hephaestus/app/lib/organization-storage.ts#L432), [organization-storage.ts:1236–1256](../../apps/hephaestus/app/lib/organization-storage.ts#L1236), [history-correction.ts:624–626](../../apps/hephaestus/app/lib/history-correction.ts#L624).

**Correction direction:** Define whether a goal edit applies retrospectively or creates a new effective-dated goal definition. Whichever contract is chosen, update/filter credits consistently and transactionally. Do not show an old definition's credits under a new filter while other operations silently reinterpret them.

**Acceptance:** Editing a filter and editing an unrelated workout title must not produce contradictory counts for unchanged performed work. Cover narrowing and widening filters and the relevant weekly boundaries.

## Additional boundary weakness—not counted as an established UI defect

### Recurrence apply accepts a stale appointment snapshot

**Runtime evidence:** Create a Monday recurrence, materialize its appointments, preview changing it to Tuesday, then postpone one Monday appointment to Wednesday through the worker. Applying the old recurrence preview succeeded and deleted that newly postponed appointment. The persisted row changed from `{ planned_date: '2026-11-04', postponed: 1 }` to absent.

**Cause:** Apply compares the supplied fingerprint with the stored preview, not the current mutable appointments/rule. Only the previously protected appointments receive a current-state check. Deletions and updates otherwise check that a row is still open, unlinked, and future-dated, not that it still matches what was reviewed.

**Source:** [organization-storage.ts:181–227](../../apps/hephaestus/app/lib/organization-storage.ts#L181).

**Reachability limit:** The normal Plans page clears recurrence previews when it reloads after changes ([plans/index.vue:142–149](../../apps/hephaestus/app/pages/plans/index.vue#L142)). The app also allows only one browser writer. Therefore the dispatcher sequence is confirmed, but a normal sequential UI path retaining that stale preview was not established. Do not present it as reproduced user data loss through the UI.

**Hardening direction:** Bind review tokens to current affected state at apply time, following the stronger history-correction fingerprint approach. Reject and request a new review when an affected appointment has changed.

## Previously reproduced defects retained from the first assessment

These were confirmed earlier in this conversation, not newly discovered or rerun in the deeper pass.

| Issue | Prior observed evidence | Source |
|---|---|---|
| Rest countdown drifts under execution stalls | A six-second blocked UI event loop reduced the countdown by only one second | [useWorkout.ts:536–542](../../apps/hephaestus/app/composables/useWorkout.ts#L536) |
| Readiness omits one chronic-load week | Five weekly loads `[5000, 500, 500, 500, 500]` produced High/85 in the app versus Moderate/50 using the documented four-prior-week calculation | [useProgress.ts:188–195](../../apps/hephaestus/app/composables/useProgress.ts#L188), [training-load.ts:18–22](../../apps/hephaestus/app/lib/training-load.ts#L18) |
| Failed startup retains the writer lock | Injected schema failure returned INIT_ERROR; a second worker received LOCK_UNAVAILABLE until the failed worker was terminated | [database.worker.ts:14–25](../../apps/hephaestus/app/workers/database.worker.ts#L14), [database.worker.ts:75–80](../../apps/hephaestus/app/workers/database.worker.ts#L75) |
| Future appointments overflow mobile layout | At a 390 px viewport, a future appointment expanded document width to 438 px and overlapped controls | [plans/index.vue:529–536](../../apps/hephaestus/app/pages/plans/index.vue#L529) |
| Miles preference is ignored in manual run entry | Stored preference was `mi`; the form still displayed Distance (km) and used kilometre conversion | [workout/index.vue:299–300](../../apps/hephaestus/app/pages/workout/index.vue#L299), [workout/index.vue:499–501](../../apps/hephaestus/app/pages/workout/index.vue#L499) |

Other apparently unused preferences were source-search leads only, not individually runtime-qualified. The interval-training timer shares the callback-counting concern, but was not separately reproduced.

## Negative results and limits

- An unassigned Program slot with no saved binding row did not by itself break portable preview. That attempted case is not a finding.
- Finish operations are dispatched inside the worker transaction; hypothetical partial PR writes without that transaction are not a demonstrated defect.
- A cached finish summary for an impossible/orphaned workout was suggested during review, but no supported path creating that state was established. It is not a finding.
- A future-routine-update preview can contain older workout facts, but the proposed active-set mutation after finishing is rejected by the writable-session guard. Whether later factual corrections should invalidate an explicitly chosen future proposal requires contract analysis; no additional defect is asserted here.
- The preceding assessment successfully exercised start, set logging, reload/resume, finish, PR feedback, template/routine creation, scheduling, history/progress navigation, and Escape/focus restoration. Its simple full backup restored 50 tables and 229 rows identically. That successful fixture did not include the multi-revision Program history that triggers H-01.
- This was targeted investigation, not a full regression suite. No unit/integration suite, generated-production-PWA offline/update qualification, physical-device testing, exhaustive migration matrix, or native certification was run in this deeper pass. The runtime was Nuxt development mode with built local Palladium dependencies.
- Data-transfer validation remains generally fail-closed and transactional. H-01 is over-rejection of valid graphs; H-02 is acceptance of incorrectly remapped semantics. They need different fixes.
- Existing historical issue lists are superseded product context, not evidence of current bugs. Deferred native releases, sync, GPS, health integrations, and body metrics remain outside this audit's release scope.

## Recommended repair order

1. Repair backup/portable graph contracts (H-01, H-02) and failed-startup ownership. Recovery must work before expanding features.
2. Repair routine template selection and correction/logging validation consistency (H-03, H-04).
3. Repair identity-based reporting and derived-credit invalidation (H-05, H-06), then the readiness window.
4. Fix timer deadline accounting, distance-unit propagation, and mobile appointment layout.
5. Qualify the repaired paths in a generated PWA, including reload/offline recovery and cross-installation transfer. Use behavior-level regression fixtures for the scenarios above; existing happy-path coverage alone did not establish these contracts.
