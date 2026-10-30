# Hephaestus hands-on browser UX audit — 2026-10-30

## Method and scope

This is an interaction audit, not a source review or an implementation pass. I used the agent browser to operate the app through its visible links, buttons, fields, keyboard, browser Back, and reload. No worker/API writes or database fixtures were used to prepare these scenarios. Page JavaScript was used only to inspect rendered controls, native select options, dimensions, values, and accessibility semantics.

Baseline: upstream `fdc327a`, verified current with `origin/main`, served from the existing `.worktrees/easter-egg-audition-20261030` checkout. Fresh synthetic installation at `http://127.0.0.1:3224/`; unrelated user data and the primary checkout's application changes were untouched. Nuxt development mode, Chromium, 390×844 primary mobile viewport, additional 320×568 and 1440×1000 checks. Hephaestus dark and Daylight light themes were exercised; Forge was not separately qualified.

Created through the UI: one custom exercise, a three-set bench template, a saved routine, strength workouts, a manual 5 km/30-minute run, a personal plan, manual and recurring appointments, imported built-in Programs, two interval templates, completed intervals, and an interrupted interval. Also attempted a mobility plank, unsaved template navigation, invalid set entry, factual title correction, and database-reset confirmation cancellation. All data was synthetic.

**This is broad coverage, not a claim to have found every issue.** No generated-PWA/offline/update, physical-phone keyboard/safe-area, Safari, screen-reader speech, notification/audio, exhaustive accessibility, or large-history qualification was performed. Development tooling overlays visible in screenshots are not counted as product defects. Transient modal animation frames were not treated as layout bugs; the pounds overflow and reset placement were checked again after settling.

Prior correctness findings remain in [the defect audit](hephaestus-defect-audit-20261030.md). Some observations here overlap that report. The identifiers below are UX triage IDs, not a count of distinct root causes.

## Priority key

- **A — Repair first:** loses/reinterprets work, blocks a supported task, or materially misrepresents recorded facts.
- **B — Daily friction:** a supported flow works but has unnecessary steps, poor affordances, or inconsistent behavior.
- **C — Polish:** terminology, hierarchy, formatting, and presentation.
- **Observed** means the behavior was exercised. **Judgment** means the recommendation is a usability assessment grounded in the exercised surface, not an assertion that a specified contract was violated.

## A. Repair first

### UX-01 — Reload strands an interval session

**Observed.** Create a two-round interval with 30 seconds work and 10 seconds rest. Start it, observe WORK / round 1, and reload before completion.

- Timer returns to READY / round 1 with Start session.
- Start session fails with `An unfinished session already exists; resume or discard it first.`
- Workout → Resume opens an empty conditioning workout, with Finish and Add Exercise, but no interval timer, round, or recovery action.
- Finishing that recovered shell saved a conditioning session with zero logged sets. It did not recover the original interval choreography.

**Recommendation:** Persist the interval's identity and recoverable timing/round state with its unfinished workout. Reload should offer resume/end for that interval, not an apparently fresh Start that cannot work. An error directing the user to resume must link to a recovery path that actually resumes the same activity.

### UX-02 — Manual run duration is replaced by app-entry elapsed time in the presentation

**Observed.** Enter 5 km and 1800 seconds in a manual run, then finish. The run fields were committed even without separately clicking Save run details.

- Completion summary: 5.00 km, elapsed 11s.
- History list: Run · 11s.
- Detail summary: 11s Duration and 0 Completed working sets.
- Summary-card text: `run workout … 0 minutes. 0 exercises · 0 working sets. 5.00 km`.
- Opening correction showed the saved run duration was still 1800 seconds.

**Recommendation:** Present performed run duration and pace as the primary run facts. If time spent inside the logging session is useful, label it separately. Do not make a 30-minute run look like an 11-second run or lead with irrelevant strength-set counts.

### UX-03 — Discard immediately removes an unfinished workout

**Observed.** Reloaded the synthetic mobility session, then clicked Discard on its unfinished-session panel. The app went straight to the start screen. No confirmation or undo was surfaced.

**Recommendation:** Use an explicit confirmation naming the session, or provide a reliable undo. Resume and irreversible Discard sit next to each other in the recovery path, so an accidental tap is consequential.

### UX-04 — Leaving a template draft silently loses it

**Observed.** In Create template, entered `Unsaved draft audit`, clicked Today in the bottom navigation, then used browser Back. There was no navigation warning, and the restored Name field was empty.

**Recommendation:** Persist an authoring draft or guard dirty navigation. This matters especially because normal template authoring is long and scroll-heavy. Protect browser Back and bottom-nav exits, not only an explicit Cancel.

### UX-05 — A built-in plank cannot be logged as a timed hold in mobility

**Observed.** Start Empty Session → Mobility / recovery → Add Exercise → Plank.

- The row requests Weight and Reps.
- Complete fails with `Enter achieved reps before completing this set.`
- Details offers Weight, Reps, RPE, and RIR, not duration.

**Recommendation:** Classify built-in timed holds appropriately and offer duration logging. Selecting the mobility session type must not imply usable timed-hold support while its basic catalog example requires invented repetitions. A custom-exercise workaround is not a polished default path.

### UX-06 — Pounds conversion overflows the detailed set editor

**Observed.** Set Profile weight units to lbs, start the routine whose first set is 60 kg, and open that set's Details.

- Inline row displays a sensible 132.3 lbs.
- Detailed editor displays `132.27735731092653`.
- The long number visibly runs across the neighboring decrement/repetition controls at 390 px width.
- The overflow remained on a second settled screenshot.

Equipment profiles also display a raw increment such as `5.511556554621939` lbs.

**Recommendation:** Separate canonical storage precision from editable display precision. Use a deliberate display value without mutating saved kilograms simply by opening or saving the editor.

### UX-07 — Saved titles do not identify workouts in history

**Observed.** A workout started from Morning strength appears as Gym Session. A routine workout started from Morning A also appears as Gym Session. Correcting the first workout's title to `Morning strength — completed` persisted—the correction field retained it on reopening—but the history row still said Gym Session. The detail header remained Workout Detail.

**Recommendation:** Show the performed title, with a sensible captured template/routine name as its default. Multiple same-day Gym Session rows cannot be distinguished by activity identity without opening them.

### UX-08 — Mood changes meaning between finish and history

**Observed.** Selected Mood rating 4, visibly represented by 💪 in the finish sheet. Saved history detail displayed 🙂.

**Recommendation:** Use the same scale labels and symbols for entry and display. Prefer a textual meaning alongside the icon so that the recorded observation is unambiguous.

### UX-09 — A preference can say a field is hidden when it is not

**Observed.** Turned Show RPE field off and Show RIR field on in Profile. In the next workout, expanding Effort & notes still showed RPE and RIR. Details also exposed RPE.

**Recommendation:** Honor the preference consistently or remove/rename the control. The user's configuration should not be a false promise. This is a runtime confirmation of a previously source-suspected preference issue.

## B. Daily friction and sharp edges

| ID | Surface | Exercised observation | Recommended change |
|---|---|---|---|
| UX-10 | Starting a template | Detail Start Workout → preview-modal Start Workout → Start once page → Start workout. Three successive start actions before logging. | One preview/configuration step, then start. Keep advanced overrides optional. |
| UX-11 | Start once | Direct fixed target inputs were blank even though the resolved preview used 60 kg, 8 reps, and 90 sec. Seven blank inputs had no associated labels/accessible names in DOM inspection. | Prefill saved values or clearly distinguish optional overrides from current values; associate labels with inputs. |
| UX-12 | Template authoring | A single exercise/set exposes Mode, Execution group, Role, rep kind, per-target Fixed/Input/Formula choices, RPE/RIR, notes, inputs, groups, and resolved preview. The one-set page was roughly 2200 CSS px tall before adding more sets. | A compact sets/reps/load editor by default; progressively reveal formulas and reusable-input machinery. **Judgment.** |
| UX-13 | Repeat sets | Entering 2 into Repeat sets and pressing Enter added two sets and navigated to the saved template. There is no explicit repeat/apply button or keyboard hint. New sets inherited default reps/rest but not the first set's 60 kg. | Separate “add N sets” from Save; say whether it duplicates the selected set or creates defaults. Avoid accidental form submission. |
| UX-14 | Template detail/preview | The saved 60 kg is absent from the compact detail and preview. Expanded detail showed Rest / Variable rest rather than the three explicit 90-second prescriptions. | Summarize actual per-set prescriptions, not legacy/incomplete metadata. |
| UX-15 | Workout scrolling | Three unfinished prescribed sets are three large expanded forms with repeated explanatory text. No compact queue/current-set emphasis. | Compact future rows and emphasize the next action; allow expanding the set being edited. **Judgment.** |
| UX-16 | Skipping the last prescribed set | Skip on set 3 immediately exposes a new Extra set 4 with its own blank/draft form. | Do not make “skip the final planned set” look as though another set is now expected; make extras an explicit action or a compact affordance. **Judgment.** |
| UX-17 | Routines and authoring units | With lbs selected, routine configuration and resolved prescription still show kg while workout entry shows lbs. | Use the selected input/display unit consistently; retain kilograms only as storage semantics. |
| UX-18 | Failure feedback lifetime | Failure toast with +60s remained on the completion summary, subsequent Workout start screen, and the newly started run. | Scope the action to the relevant active rest period and dismiss it when that session ends. No post-finish +60s mutation was attempted. |
| UX-19 | Manual run entry | Duration is an unlabeled-by-format total-seconds field; the ordinary 30-minute run required entering 1800. Separate Save run details exists, but Finish also commits the fields. | Minutes/seconds entry, clear save state, and an intentional single completion flow. **Judgment.** |
| UX-20 | Progress default | After a completed bench workout, Progress selected untrained Ab Rollout and led with No completed strength history for this exercise variant. | Default to a recent trained exercise or offer recent/trained choices first. |
| UX-21 | Progress navigation | Exercise-session and PR cards are not links to the underlying workout. | Make records traceable to their source sessions; use explicit non-interactive styling if not actionable. **Judgment.** |
| UX-22 | Appointment overlap | A manual Morning A appointment plus a Mon/Wed/Fri recurrence including today produced two indistinguishable Morning A cards in Today. No overlap warning or source distinction appeared. | Warn about overlap and show manual/recurring source or another meaningful discriminator. Distinct appointments may be legitimate; silent ambiguity is the problem. |
| UX-23 | Planning form coupling | Choosing Saved routine for a manual appointment also changed Recurring saved routine. | Independent form state unless shared selection is explicitly presented. |
| UX-24 | Plans information architecture | Plan creation remains above selected-plan editing. A 28-day recurrence materializes many appointment rows before recurrence/rotation/goal controls. Even the initially empty selected plan page was 2808 CSS px tall. | Separate schedule browsing from plan configuration; summarize future appointments by week and move creation out of the persistent top section. **Judgment.** |
| UX-25 | Program handoff | Follow in a personal Training Plan navigated to Plans but did not preselect the Program; Optional reusable Program remained Personal plan without a Program. | Carry the chosen Program into the creation/adoption flow. |
| UX-26 | Built-in Program promise | Import Built-in Programs imported all five designs without individual selection. Opened 5/3/1 BBB; weeks 1 and 2 showed no slots or exercises, only suggested multipliers and an Add template slot form. | Explain that these are incomplete shells, or provide actual usable prescriptions/setup guidance. Do not imply a ready-to-follow program when users must author its workouts themselves. Other imported Programs/weeks were not exhaustively inspected. |
| UX-27 | Equipment profiles | 780 inputs, no search field, roughly 59,890 CSS px document height at mobile width. Even bodyweight Ab Rollout receives a full load-profile form. Save profile is repeated throughout. | Search/select an exercise first, show configured profiles, and edit on demand. No need to render the catalog as hundreds of simultaneous forms. |
| UX-28 | Interval controls | Active interval offers Finish session but no Pause; the home shortcut “Interval timer” first requires an interval template. | Add a clear pause/resume contract and consider quick-start presets. **Judgment.** Reload recovery is separately broken in UX-01. |
| UX-29 | Exercise library | Clicking Bench Press or the created UX Test Press row did nothing. Keyboard semantics expose neither row as a link/button. No edit/archive action for the new custom exercise was available on the exercised library surface. | If the library is meant to be browsed, give it details/edit actions; otherwise explain its catalog-only role and avoid suggesting actionable rows. Do not infer that editing is impossible anywhere in the app. |

## C. Presentation and polish

| ID | Surface | Observation and recommendation |
|---|---|---|
| UX-30 | Internal vocabulary | Routine list/detail expose full UUIDs and `calendar_bound`. Progress exposes `front_delts`, `press`, `barbell/barbell`, “external-load tonnage,” and storage-oriented explanatory copy. Show revision numbers, human labels, useful summaries, and put implementation identifiers behind diagnostics. |
| UX-31 | Empty/unknown machinery | Empty Configuration inputs sections appear on routine/start forms. Routine prescriptions repeat RPE unknown / RIR unknown / load not prescribed kg. Hide inapplicable sections and say “No load target” rather than assembling broken sentences. |
| UX-32 | History summary card | Workout summary card is a text fallback and download button, not a visual preview—DOM inspection found no image element. Copy includes `1 minutes`, `1 exercises`, and raw `gym` / `run` wording. Render a preview or present it honestly as a downloadable card, and fix pluralization/type labels. |
| UX-33 | Reset confirmation | In Daylight, the reset alertdialog remained a dark rectangle at the viewport's top-left, not a centered theme-matched modal. Its settled box was x=0/y=0/352×232 in a 390px viewport. It does have modal semantics, Cancel, and explicit irreversible wording; Cancel/Escape were used, no reset performed. Fix placement/theme without weakening the safety step. |
| UX-34 | Entry/return hierarchy | Fresh Today offers Start ad-hoc and Start Workout for the same start screen. With an unfinished workout, it offers Resume unfinished workout in a large card and another Resume Workout button below. Zero streak/unavailable readiness dominate fresh installation instead of a recommended next step. Consolidate the primary action and tailor the empty state. **Judgment.** |
| UX-35 | Discoverability/navigation | Template secondary links live in a horizontally clipped strip; Intervals and Equipment are offscreen at 390px. Equipment and Saved routines lack an in-page back affordance. Desktop retains the narrow column and full-window bottom navigation; safe, but does not improve authoring density. Use an explicit library navigation pattern and deliberate responsive behavior. **Judgment.** |
| UX-36 | Type names and feedback | Strength / hypertrophy → Strength → Gym; Conditioning / intervals → conditioning; EMOM/AMRAP rendered Emom/Amrap. Success and zero-change reviews are surrounded by implementation-heavy prose (“captured routine revision”, “Refresh stale review”). Use stable product language, concise results, and show advanced mechanics on demand. |

## Concrete repair order

1. Interval reload/resume and safe draft/discard behavior (UX-01, UX-03, UX-04).
2. Faithful performed facts: run duration, workout identity, mood, mobility holds (UX-02, UX-05, UX-07, UX-08).
3. Unit/display consistency and honest preferences (UX-06, UX-09, UX-11, UX-17).
4. Reduce routine/template start and logging friction (UX-10–16), then retire stale session actions (UX-18).
5. Simplify planning and equipment navigation; improve contextual handoffs and catalog promises (UX-22–29).
6. Humanize terminology, empty states, summary presentation, and theme/modal details (UX-30–36).

These are related workstreams, not 36 unrelated tickets. For example, a single coherent unit/display policy should address both the overflow and kg-only authoring, while a proper interval lifecycle should address pause, reload, and resume together.

## What worked

- Normal strength-set completion, invalid negative-load/zero-rep rejection, skip/undo affordances, and persisted ordinary workout reload/resume worked in the exercised flow.
- Template/routine creation and one-click routine start worked; no API seeding was needed.
- Filled manual run fields were committed when finishing, so UX-02 is presentation of the wrong duration, not loss of the 1800-second record.
- Title correction persisted; UX-07 is failure to use that title on the normal viewing surfaces.
- The template preview trapped keyboard focus and closed with Escape. The finish sheet provided an accessible focusable control set.
- Template search had a useful no-results state; exercise filtering and custom-exercise creation worked.
- A short interval advanced through two rounds and saved automatically when uninterrupted.
- Light-theme switching and normal workout pounds conversion worked outside the detailed-input precision issue.
- Small-screen template creation fit 320px without document-wide horizontal overflow in the checked state. This does not clear the previously confirmed future-appointment overflow.
- Database reset required a confirmation and it was canceled. No full database reset, real-data import, or personal-data deletion was performed.

## Verification boundaries and session outcome

No application code, tests, dependencies, or configuration were changed. This document is the new audit artifact; no commit or push was made. No unit/integration suite was run because the deliverable is an investigation, not a fix.

The final synthetic interrupted interval was finished through the ordinary workout fallback to avoid leaving an unfinished writer-blocking session. The browser and development server were closed after recording findings. Synthetic records remain scoped to the agent browser's dedicated local origin; no user-origin data was cleared.

Screen evidence was captured throughout using the browser screenshot tool, with settled rechecks for the critical visual issues. Screenshots are session-tool artifacts, not checked-in assets. The reproduction descriptions and exact observed values above are the durable evidence record.
