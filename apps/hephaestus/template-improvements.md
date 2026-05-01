# Template Feature Improvement Ideas

> Generated 2026-03-11. Based on current implementation: full CRUD (no edit), superset/variable-rest/set-scheme behind feature flags, no program UI yet.

---

## Editing & CRUD

### 1. Edit template
Add `/templates/[id]/edit` route mirroring `new.vue` but pre-populated. Needs a `useTemplates.update()` method that diffs existing template_exercises (insert new, delete removed, update changed rows). Preserve exercise IDs to keep history associations intact. Show unsaved-changes guard on back navigation.

### 2. Inline edit on detail page
Tap the template name or description on `/templates/[id]` to reveal a text input in place. On blur or Enter, call update. Avoids a full edit page for minor renames. Use `contenteditable` or a transparent `<input>` overlay.

### 3. Duplicate / clone template
"Duplicate" action in the detail page overflow menu. Copies template row + all template_exercises + all template_groups with new IDs. Default name: "Copy of {name}". Navigate to the new template's detail page immediately.

### 4. Archive template
Add `archived_at TIMESTAMP` column to `templates`. Archived templates are hidden from the list by default. Toggle "Show archived" in list header. Archived templates can still be linked to past workouts. Prevents deletion of templates with sentimental/historical value.

### 5. Rename via long-press on list
Long-press (or right-click on desktop) on a template card opens a context menu: Rename / Duplicate / Archive / Delete. Avoids navigating to detail just to rename.

### 6. Reorder templates
Drag handles on template list cards. Persist `sort_order INTEGER` in templates table. Default sort by `sort_order ASC, created_at DESC`. Only show handles when user enters "edit mode" (pencil icon in header).

### 7. Undo delete
When user taps Delete + confirms, show a toast: "Template deleted · Undo" for 5 seconds. If tapped, re-insert the template and all exercises/groups (keep deleted rows in memory during this window). After timeout, commit the cascade delete.

---

## Organization

### 8. Folders / categories
Add `template_folders` table: `id, name, color, sort_order`. Add `folder_id` FK to templates. Folder chips shown above template list as horizontal scrollable filter. Default folders: Push, Pull, Legs, Full Body, Upper, Lower, Cardio. User can create custom folders.

### 9. Tags on templates
Reuse existing `tags` system. Add `template_tags` join table mirroring `workout_tags`. Show tag chips on template cards. Filter template list by tag. Predefined tags: `#strength`, `#hypertrophy`, `#endurance`, `#powerlifting`, `#rehab`.

### 10. Pin / favorite templates
Add `pinned_at TIMESTAMP` to templates. Pinned templates appear in a "Pinned" section above the main list. Max 5 pins to avoid clutter. Star icon on template card, tap to toggle. Also expose pinned templates as quick-launch options on the Today page.

### 11. Sort options
Dropdown or segmented control in list header: Last Used · Most Used · Name A–Z · Date Created. "Last Used" requires joining `workouts` on `template_id`. Persist selected sort in app settings.

### 12. Search / filter
Search bar at top of template list (collapsible on scroll). Searches template name, description, and exercise names within the template. Debounced 200ms. Show "No results for 'X'" empty state.

### 13. Custom cover image or emoji
Per-template emoji picker (like Notion) or color accent. Stored as `cover_emoji TEXT` on templates. Shown large on the detail page header and as a colored dot on list cards. Replaces the exercise avatar strip when set.

---

## Template Content

### 14. Exercise notes
`notes TEXT` column on `template_exercises`. Shown below the exercise name on the detail page as a muted italic line. Editable in the template editor. Examples: "Pause at bottom", "3-second eccentric", "Narrow grip".

### 15. Warm-up set definition
`warmup_sets INTEGER` already exists on template_exercises but may not be wired to UI. Show warm-up sets as grey rows above working sets in the template editor. Warm-up rows default to 50%, 70%, 90% of target weight. Excluded from volume and e1RM calculations.

### 16. Failure set marker
`failure_target BOOLEAN` per template_exercise (or per planned set). When checked, the workout UI shows a flame icon on that set row prompting the user to go to failure. Feeds into the failure-sets analytics page.

### 17. RPE / RIR targets per set
Currently `rpe_target` is per-exercise. Add `rpe_targets JSON` array (parallel to `set_rest_seconds`) for per-set RPE targets. In the workout, each set row shows the target RPE next to the input. Helps with wave loading (e.g., set 1 @7, set 2 @8, set 3 @9).

### 18. Autoregulation rules
`progression_rule JSON` on template_exercises. Fields: `metric` (e1rm | reps | rpe), `threshold` (hit all reps for N sessions), `action` (increase_weight | increase_reps | next_variant), `amount`. UI: simple "Auto-progress" toggle in exercise config with a rule picker. Runs at workout-start to suggest adjusted targets.

### 19. Deload variant
`deload_template_id INTEGER` FK on templates pointing to another template. A deload template is a sibling with reduced volume/intensity. In Programs, every Nth week auto-routes to the deload variant. Can also be manually triggered from template detail: "Start Deload Week."

### 20. Exercise substitutions
`substitutes JSON` array of exercise IDs on template_exercises. When starting a workout, a "Swap" button appears per exercise. Tapping shows the substitution list with a preview of sets/reps copied over. Selected substitute is remembered per template slot for future sessions.

### 21. Tempo prescription
`tempo TEXT` column on template_exercises. Format: `3-1-2-0` (eccentric-pause-concentric-pause). Shown as a badge next to sets/reps on template detail. In workout mode, a metronome-style animation or beep cues the tempo. Optional: tempo is advisory only, not enforced.

### 22. Band / chain resistance notes
Free-text `resistance_note TEXT` on template_exercises. Shown as a small badge in the exercise row. Examples: "Light band", "25lb chains". Purely informational — no calculation impact.

### 23. Bilateral / unilateral flag
`unilateral BOOLEAN` on template_exercises (derive from exercise.equipment or allow override). When true, logged reps are per-side and volume is doubled for muscle frequency calculations. Show "×2" badge next to the rep count on the template detail.

---

## Superset / Group Improvements

### 24. Rename group labels
Currently groups are labeled A, B, C auto-assigned. Allow user to set a custom `display_name` on template_groups in addition to the single-letter `label`. Show custom name in the superset card header: "A · Chest Pre-Exhaust".

### 25. Reorder groups
In the template editor, drag-to-reorder entire superset blocks. Reordering a group moves all its member exercises together. Re-labels letters automatically after reorder (A, B, C…).

### 26. Tri-set / giant set visual distinction
Color-code group type badges: superset = blue, tri-set (3 exercises) = purple, giant set (4+) = magenta, circuit = green, pre-exhaust = amber. Show the group type label in the badge tooltip/subtitle.

### 27. Pre-exhaust grouping visualization
When `group_type = 'pre_exhaust'`, show the exercises in a specific visual order with an arrow connecting isolation → compound. Label the isolation exercise "Pre-exhaust" and the compound "Target". Explain in a tooltip: "Fatigue the muscle before the main lift."

### 28. Circuit lap count
`rounds INTEGER` on template_groups (default 1). For circuits, the workout UI loops through the exercises `rounds` times before moving on. Show "Round 2/3" in the superset card header during the workout.

### 29. AMRAP round
`amrap BOOLEAN` + `time_cap_sec INTEGER` on template_groups. In workout mode, start a countdown timer when entering the AMRAP block. User logs as many rounds as possible before the cap. Record total rounds completed in a new `group_performance` table.

---

## Workout Start Flow

### 30. "Save as Template" after freestyle workout
On the workout finish sheet, if no template was used, show "Save as Template" button. Pre-fills template name with the date or "Workout {n}". Copies the exercise order and planned sets from that session.

### 31. Template preview sheet before start
On template detail, tapping "Start Workout" first opens a bottom sheet preview: scrollable exercise list, estimated duration, last-session weights. Confirm button inside the sheet triggers `startWorkout()`. Lets user verify they have equipment ready.

### 32. Swap exercise on start
In the preview sheet (or at workout start), each exercise row has a "Swap" icon. Tapping opens the exercise picker filtered to the same muscle groups. The swap applies only to this session (not the template). Useful for equipment availability.

### 33. Scale template on start
In the preview sheet, a "Scale" option: slider from 50%–150% that adjusts planned sets (round down) and weights. Useful for active recovery days or ambitious days. Scaling factor is not saved to the template.

### 34. Select exercises to include
Checkboxes on each exercise in the start preview sheet. Unchecked exercises are skipped for this session. Default: all checked. Useful for time-constrained sessions or injury modifications.

### 35. Last session comparison on start
In the start preview sheet, each exercise shows the weight × reps from the last time this template was used. Gives the user a target to beat. Fetched via: `SELECT s.weight, s.reps FROM sets s JOIN workout_exercises we ... WHERE we.exercise_id = ? AND w.template_id = ? ORDER BY w.started_at DESC LIMIT 1`.

### 36. Estimated duration
Calculate at template load time: `(total_sets × 45s) + sum(rest_seconds per set)`. Add warm-up buffer (+5 min if warmup_sets > 0). Show as "~47 min" in the template list card and detail page header. Recalculate live in the editor as exercises are added/removed.

---

## History & Usage Stats (on detail page)

### 37. Last performed date
Join `workouts` on `template_id`, get `MAX(started_at)`. Show as "Last done: 5 days ago" below the template name on both list card and detail page.

### 38. Times used count
`COUNT(*)` of workouts linked to this template. Show as "Used 12 times" on detail page. Could also show a weekly usage sparkline (dot grid filtered to this template).

### 39. Performance chart per exercise
On template detail, each exercise block has a collapsible mini chart showing e1RM trend across the last 8 uses of this template. Uses `buildExerciseHistory()` from `analytics.ts` filtered by `template_id`. Tapping opens the full progress chart for that exercise.

### 40. Personal records hit
Count PRs from `personal_records` where the workout's `template_id` matches. Show "🏆 14 PRs set" on detail page. Badge on template card if a PR was set in the last 7 days.

### 41. Average session duration
Mean of `(completed_at - started_at)` across all workouts using this template. Show as "Avg 52 min". Helps user plan their day.

### 42. Consistency score
Define an expected frequency (e.g., once per week). Score = `actual_sessions / expected_sessions` over the last 4 weeks × 100. Show as a percentage with color coding: green ≥80%, amber 50–79%, red <50%. Motivates adherence to the program.

---

## Programs (schema exists, no UI)

### 43. Program builder UI
Wire up `programs`, `program_weeks`, `program_days` tables. A program has a name, duration (weeks), and a weekly structure. Each day slot (Mon–Sun) can have 0 or 1 template assigned + optional notes. Builder page: `/programs/new`. View page: `/programs/[id]`.

### 44. Assign templates to program days
Drag-and-drop (or tap-to-assign) templates onto a weekly calendar grid in the program builder. Support rest days (no template). Save as `program_days` rows with `day_of_week` (0–6) and `template_id`.

### 45. Program progress view
On Today page, if an active program is set: show "Week 3 of 12 · Day 2: Squat A" with the next due template highlighted. Track current position via `current_week` and `current_day` on the program row. Auto-advance day on workout completion.

### 46. Built-in program library
Seed with 5–10 popular programs: Starting Strength, GZCLP, 5/3/1 BBB, PHUL, PPL. Each pre-creates the needed templates and full program structure. Accessible from a "Browse Programs" section. User selects a program → it clones to their local DB.

### 47. Periodization support
On a program_week, add `intensity_modifier REAL` (default 1.0) and `volume_modifier REAL`. These scale target weights/sets when auto-calculating workout targets. Supports linear progression (add 2.5kg/week) and wave loading (week 1: 65%, week 2: 70%, week 3: 75%, week 4: deload 50%).

### 48. Mesocycle tracking
Programs can be structured as mesocycles with phases: `accumulation` (high volume, low intensity), `intensification` (low volume, high intensity), `deload`. Add `phase TEXT` to program_weeks. Analytics page shows phase timeline and readiness trend per phase.

---

## Import / Export / Sharing

### 49. Export template as JSON
"Export" option in template detail overflow menu. Serializes template + exercises + groups to a well-defined JSON schema. Uses the Web Share API on mobile or downloads a `.json` file on desktop. Useful for backup and cross-device transfer.

### 50. Import from JSON
"Import Template" button on the template list page. Accepts pasted JSON or a file picker. Validates against the schema, previews the exercise list, then inserts to DB. Shows a warning if any exercise names don't match local exercises (offers to create custom exercises).

### 51. Share as QR code
Encode the exported JSON (or a compact binary format) as a QR code. Show in a modal. Another user can scan it with their phone camera to import. Works fully offline. Limit to templates with ≤20 exercises to keep QR scannable.

### 52. Import from popular formats
- **Hevy CSV**: parse Hevy export format, map exercise names to local exercises.
- **Strong CSV**: same approach.
- **Google Sheets / CSV**: generic "date, exercise, sets, reps, weight" import wizard.
- Show a column-mapping UI for unrecognized formats.

### 53. Share via local network (LAN)
Start a temporary HTTP server (via Capacitor plugin or Tauri equivalent) that serves the template JSON. Display the local IP + port as a QR code. Receiving device opens the URL in browser, downloads, then imports via the JSON import flow. Fully P2P, no cloud.

---

## Discovery & Recommendations

### 54. Neglected template surfacing
On the Today page, if a template hasn't been used in `X` days (where X = expected frequency × 1.5), show a card: "You haven't done Squat A in 12 days." Tapping pre-loads the template start flow. Threshold configurable in settings.

### 55. Muscle balance checker
After saving a template, analyze the exercise muscle groups. If push volume > pull volume by >50%, show a warning: "This template is push-heavy. Consider adding a row or pull-up." Uses `muscles_primary` from exercises. Advisory only — user can dismiss permanently.

### 56. Volume recommendations
Per muscle group in the template, compare planned weekly sets against MEV/MRV guidelines (minimum effective volume / maximum recoverable volume). Show a stacked bar on template detail: green = in range, yellow = near MRV, red = exceeds MRV. Values configurable in settings.

### 57. Similar templates suggestion
On template detail, show "You might also like" with 2–3 other templates that share ≥50% of the same exercises. Calculated client-side using Jaccard similarity on exercise ID sets. Useful for discovering neglected variants.

### 58. Auto-generate template from history
Analyze the last 30 workouts. If the user consistently does the same 4+ exercises on the same weekday (cosine similarity > 0.8), show a prompt: "You always do these 5 exercises on Mondays — save as a template?" Pre-fills the new template form.

---

## UX / Polish

### 59. Edit transition animation
From template detail, tapping "Edit" slides in the editor as a side panel (desktop) or pushes a new page (mobile) with a shared-element transition on the template name. On save, animate back to detail with the updated data.

### 60. Drag-to-reorder on detail page
Currently reorder only works in `new.vue`. Add drag handles to the exercise list on the detail page (requires edit mode). Use the same `@vue-draggable/next` or native HTML5 drag approach. Persist new `order_num` values on drop.

### 61. Swipe-to-delete exercise in editor
Swipe left on an exercise row in `new.vue` to reveal a red "Remove" button (iOS-style). Requires a custom swipe gesture component or `@vueuse/gesture`. Provides a faster alternative to the explicit remove button.

### 62. Haptic feedback on drag
On mobile (Capacitor), call `Haptics.impact({ style: ImpactStyle.Light })` on drag start and `ImpactStyle.Medium` on drop. Makes reordering feel physical and satisfying.

### 63. Skeleton loaders
While `useTemplates.load()` is pending, render 3 skeleton cards (grey shimmer boxes matching card dimensions). Same for exercise list on detail page. Prevents layout shift and communicates loading state.

### 64. "Add Exercise" placeholder row
At the bottom of the exercise list in the template editor, always show a dashed "Add Exercise" row. Tapping opens the exercise picker modal. More discoverable than a floating button, especially on long lists.

### 65. Muscle group summary bar
On template detail page header, show a horizontal stacked bar: each segment is a muscle group color, width proportional to planned sets. Provides an instant visual of the workout's muscle balance (e.g., big blue=quads segment, medium orange=chest). Computed from `exercises.muscles_primary`.

### 66. Collapse / expand exercise details
On template detail, default to showing just exercise names and set counts in compact rows. Tap to expand a row and reveal rest time, RPE target, notes, and set scheme badge. Saves vertical space on long templates.

### 67. Keyboard navigation in exercise picker
In the exercise search modal, support: `↑/↓` to navigate results, `Enter` to add, `Escape` to close. Tab-trapping inside the modal. Useful on iPad with keyboard attached.

---

## Interval Templates (schema exists, no UI)

### 68. Interval template builder
New page: `/templates/interval/new`. Fields: name, rounds, work duration (seconds), rest duration (seconds), optional exercise assignment per interval. Stored in `interval_templates` table. Displays in a separate "Interval" tab on the template list.

### 69. HIIT template types
Support three modes in the interval builder:
- **Tabata**: 8 rounds × 20s on / 10s off, fixed.
- **EMOM**: Every Minute on the Minute — user sets reps/exercise, system controls the minute timer.
- **AMRAP**: user sets total time cap, logs as many rounds as possible.
Each mode renders a different timer UI in the workout screen.

### 70. Cardio template
A template type for steady-state cardio. Fields: exercise (Run/Row/Bike/Swim), target distance or duration, target pace zone (easy/moderate/threshold/VO2max), notes. Stored as a specialization of the `templates` table via `template_type TEXT` discriminator. Feeds into `runs` table on completion.

---

## Notifications & Scheduling

### 71. Schedule template to a day
Add `scheduled_days JSON` (array of 0–6) to templates. User picks days in a weekday picker on the detail page. On those days, the Today page surfaces the template in a "Scheduled Today" card. Uses local notifications (Capacitor LocalNotifications) at a user-configured time (default 8:00 AM).

### 72. Overdue alert
If a template has `scheduled_days` and hasn't been completed on its scheduled day by 8 PM, send a push notification: "Don't forget: Squat A is scheduled for today." Requires Capacitor Push Notifications or LocalNotifications with a daily repeating trigger.

### 73. Workout suggestion on Today page
On the Today page, below the readiness card, show a "Suggested Workout" card. Logic:
1. If a program is active → next program day's template.
2. Else if a template is scheduled today → that template.
3. Else → the template not done longest (neglect-based).
Show estimated duration + last performance. One-tap start.
