# Issues Audit

## Bugs

### B1 — `logSet` INSERT drops cardio/advanced columns
**File:** `app/composables/useWorkout.ts:174–190`

The `INSERT OR REPLACE INTO sets` statement only covers 11 columns:
`id, workout_exercise_id, set_num, is_warmup, weight_kg, reps, rpe, rir, notes, completed, logged_at`.

The in-memory `set` object is built with all 20 fields (including `distance_m`, `duration_sec`,
`speed_kmh`, `level`, `technique_flag`, `body_feel`, `failure_flag`, `failure_type`,
`partial_reps`) populated from `...partial`. Those values are never written to the DB — they
get default NULL on INSERT. Any cardio set with distance/duration data silently loses it on
app reload.

The `INSERT OR REPLACE` is also redundant: pending sets are in-memory only (never inserted
into the DB), so the conflict that `OR REPLACE` guards against cannot occur.

---

### B2 — `weekly_training_load` table is never populated
**Files:** `app/pages/index.vue:45–52`, `app/pages/progress/index.vue:37`,
`app/composables/useProgress.ts:171,183`

The only `INSERT INTO weekly_training_load` in the entire codebase is in a test fixture
(`tests/integration/personal-records.test.ts:233`). There is no production code that writes
to this table after a workout finishes.

Consequences:
- `thisWeekVolume` / `lastWeekVolume` on the Today page are always 0.
- ACWR in `readinessData()` is always 0.
- `weeklyVolume()` (used in Progress charts) always returns empty.

---

### B3 — `muscleFrequency` and `exerciseHistory` include in-progress workouts
**File:** `app/composables/useProgress.ts:38, 57–63`

`muscleFrequency` query:
```sql
SELECT we.* FROM workout_exercises we
JOIN workouts w ON w.id = we.workout_id WHERE w.date >= ?
```
Missing: `AND w.ended_at IS NOT NULL`

`exerciseHistory` workouts sub-query (line 57) similarly lacks the filter. Both functions
treat an abandoned/in-progress workout identically to a completed one, inflating muscle
frequency counts and exercise history.

---

### B4 — `workoutComparison` never finds previous ad-hoc workouts
**File:** `app/composables/useProgress.ts:94`

```typescript
[workoutId, current.template_id ?? '']
```

When `current.template_id` is null (ad-hoc workout), this passes the empty string `''` as
the bind parameter. The SQL `WHERE template_id = ''` never matches a row with `template_id
IS NULL`, so `vsLast` is always `{ duration: null, volume: null, sets: null }` for ad-hoc
workouts.

---

### B5 — `daysSinceLast` set to 0 when user has no workouts
**File:** `app/composables/useProgress.ts:159–161`

```typescript
const daysSinceLast = lastWorkout
  ? Math.floor(...)
  : 0
```

When there are no completed workouts, `daysSinceLast` is 0, meaning "trained today". This
accidentally satisfies the `acwr === 0 && daysSinceLastWorkout === 0` guard in
`calculateReadiness` and returns the correct "no history" result. But it will break if ACWR
is ever non-zero without a workout row (e.g., manually inserted `weekly_training_load` data),
returning misleadingly positive readiness. The correct sentinel is a large number like 999
(or a separate null path).

---

### B6 — Streak date arithmetic uses UTC slice on a local-time Date
**File:** `app/pages/index.vue:60–70`

```typescript
const d = new Date(todayDate)
d.setDate(d.getDate() - i)
const ds = d.toISOString().slice(0, 10)  // UTC date
```

`new Date()` is local time; `.toISOString()` returns UTC. For users west of UTC (e.g. UTC-5)
before midnight local time, `toISOString()` returns yesterday's date, making today's workout
invisible to the streak counter. The workout `date` column stores local dates (set as
`now.slice(0, 10)` where `now = new Date().toISOString()` — also UTC), so the mismatch
compounds. Both should use a consistent local-date helper.

---

### B7 — `RestTimerBar.vue` is dead code with a broken internal design
**File:** `app/components/workout/RestTimerBar.vue`

Nuxt auto-imports `components/workout/RestTimerBar.vue` as `<WorkoutRestTimerBar>`. Nothing
in the app uses `<WorkoutRestTimerBar>`. The working timer is `RestTimer.vue` (auto-imported
as `<WorkoutRestTimer>`), which is a pure display component driven by `useWorkout`'s
`restTimer` state.

`RestTimerBar` manages its own internal `setInterval`, which would have run independently
from the `useWorkout` timer — double-ticking and drifting. The +/-30s `adjust` event it
emits is never handled and is not applied to `remaining` within the component itself either,
so the buttons would have been no-ops.

---

## Inconsistencies / Missing Features

### I1 — `energyRating` ref exists but has no UI
**File:** `app/pages/workout/index.vue:18, 100–104`

`energyRating` is declared as `ref<number | null>(null)` and passed to `finishWorkout()`,
but the inline finish sheet only renders a mood picker — there is no energy rating input.
`energyRating.value` is always null when the workout is saved.

The separate `FinishSheet.vue` component (never used — see I2) did have an energy rating UI.

---

### I2 — `FinishSheet.vue` is dead code with a different feature set
**File:** `app/components/workout/FinishSheet.vue`

The component is never referenced anywhere. The finish UI lives inline in
`pages/workout/index.vue`. `FinishSheet.vue` additionally accepted `prs` and `energyRating`
props that the inline version lacks.

---

### I3 — `session_type` hardcoded to `'gym'` in `startWorkout`
**File:** `app/composables/useWorkout.ts:38`

```typescript
await db.exec(
  `INSERT INTO workouts (...,session_type,...) VALUES (?,?,?,'gym',?,?,?)`,
```

The schema supports `'gym' | 'run' | 'home' | 'outdoor'`, but the composable always inserts
`'gym'`. A cardio or run template started from the workout page will be recorded as a gym
session.

---

### I4 — `superset_group` column name misleading for non-superset groups
**File:** `app/types/database.ts`, `app/workers/database.worker.ts`

`WorkoutExerciseRow.superset_group` and `template_exercises.superset_group` are used for
all group types: `'superset' | 'circuit' | 'tri-set'`. The column name implies only
supersets. `TemplateGroupRow.group_type` differentiates them, but anyone reading a raw
`workout_exercises` row has no way to know the group type without a join.

---

### I5 — `nextSetNum` display in AddSetSheet can diverge from actual set number
**File:** `app/pages/workout/index.vue:79`, `app/composables/useWorkout.ts:145–148`

The page computes:
```typescript
nextSetNum.value = sets.filter((s) => s.completed === 1).length + 1
```
at the moment the sheet opens. `logSet` independently computes `setNum` from the pending
slot or existing sets length. If the user opens the sheet multiple times quickly (unlikely
but possible), the displayed set number shown in the sheet header could be stale while the
logged `set_num` in the DB is correct.

---

### I6 — `workoutComparison` 30-day window excludes same-day workouts
**File:** `app/composables/useProgress.ts:134`

```sql
WHERE w.date >= ? AND w.date < ?
```

The upper bound is `current.date`, so workouts on the same calendar day as the current
workout (but with different IDs) are excluded from the 30-day average. For most users this
is one workout per day, but for two-a-days, the same-day earlier workout is omitted.

---

### I7 — `recentWorkouts` (Today page) not linked to history detail
**File:** `app/pages/index.vue:148–163`

Recent activity list items show a chevron indicating they are tappable, but they have no
`@click` handler and no `NuxtLink` wrapping. They navigate nowhere. The history detail page
at `/history/[id]` exists.
