# Hephaestus — Design Document

> Named after the Greek god of the forge. Local-first PWA for tracking gym workouts and running.

---

## 1. Overview

**Hephaestus** is a local-first Progressive Web App (and optional native Capacitor build) for tracking strength training and running. It prioritizes a frictionless logging experience (GymKeeper-inspired one-page workout view) with deep analytics (Outsiders-inspired training load and readiness). All data lives on-device using SQLite WASM + OPFS.

### Goals
- Fast, one-tap set logging that doesn't get in your way
- Full program/periodization support with mesocycle tracking
- Deep analytics: PRs, e1RM trends, training load, muscle balance
- Unified dashboard showing both gym and run activity
- Purely local — no accounts, no sync, no telemetry

---

## 2. Tech Stack

Directly mirrors Habitat's architecture:

| Layer | Technology |
|---|---|
| Framework | Nuxt 4 + Vue 3 + TypeScript (strict) |
| Build | Vite (via Nuxt) |
| Styling | Tailwind CSS 4 + Nuxt UI 4 |
| State | `useState` composables (no Pinia) |
| Routing | File-based (Nuxt `/pages/`) |
| Database | SQLite WASM (`@sqlite.org/sqlite-wasm`) + OPFS |
| DB thread | Web Worker (`database.worker.ts`) |
| PWA | `@vite-pwa/nuxt` + Workbox |
| Native | Capacitor 8 (iOS + Android) |
| Native DB | `@capacitor-community/sqlite` |
| Health | Google Fit / Health Connect (write workouts) |
| Linting | Biome |
| Testing | Vitest + Playwright |

### Theme System
Three switchable palettes via `data-theme` attribute (like Habitat):
- **Hephaestus** (default dark): `#1a1a1a` background, `#f97316` orange-amber accent — fire/forge aesthetic
- **Forge** (dark steel): `#0f1117` background, `#60a5fa` steel-blue accent
- **Daylight** (light): `#f8fafc` background, `#ea580c` accent

Dark + light mode via `.dark` class and system preference detection. Default follows system.

---

## 3. Navigation Structure

Bottom tab bar (5 tabs), matching Habitat's pattern:

```
[ Today ] [ Workout ] [ History ] [ Progress ] [ Profile ]
```

- **Today** — Dashboard: planned workout for today, quick-start button, recent activity summary
- **Workout** — Active session view (one-page log). Also entry point to start/resume a session.
- **History** — Chronological log of all past workouts and runs, filterable
- **Progress** — Analytics: PRs, e1RM charts, training load, muscle balance, run trends, body metrics
- **Profile** — Settings, themes, export, training blocks, exercise library management

---

## 4. Data Model (SQLite Schema)

### Core Reference Tables

```sql
-- Exercises
CREATE TABLE exercises (
  id          TEXT PRIMARY KEY,          -- ulid
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  equipment   TEXT NOT NULL,             -- 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight'|'other'
  movement    TEXT NOT NULL,             -- 'squat'|'hinge'|'press'|'row'|'carry'|'isolation'|'cardio'
  muscles     TEXT NOT NULL,             -- JSON array: ['quads','glutes',...]
  muscles_sec TEXT NOT NULL DEFAULT '[]',-- JSON array secondary muscles
  cues        TEXT,                      -- text form cues
  is_custom   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Workout templates
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE template_exercises (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id),
  order_num     INTEGER NOT NULL,
  superset_group TEXT,                   -- null or group label ('A','B',...)
  sets_planned  INTEGER,
  reps_planned  TEXT,                    -- e.g. '8-12' or '5'
  rpe_target    REAL,                    -- target RPE for auto-progression
  increment_kg  REAL DEFAULT 2.5,        -- auto-progression step
  rest_seconds  INTEGER DEFAULT 120
);
```

### Programs & Mesocycles

```sql
-- Named training programs (e.g. 5/3/1, PPL)
CREATE TABLE programs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  weeks       INTEGER NOT NULL,
  is_builtin  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE program_weeks (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_num    INTEGER NOT NULL,
  is_deload   INTEGER DEFAULT 0
);

CREATE TABLE program_days (
  id           TEXT PRIMARY KEY,
  week_id      TEXT NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
  day_num      INTEGER NOT NULL,           -- 1-7
  template_id  TEXT REFERENCES templates(id),
  label        TEXT                        -- e.g. 'Push A', 'Lower'
);

-- Training blocks / mesocycles
CREATE TABLE training_blocks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,              -- 'Hypertrophy Block 1', 'Strength Phase'
  phase       TEXT,                       -- 'hypertrophy'|'strength'|'peaking'|'deload'|'base'
  program_id  TEXT REFERENCES programs(id),
  start_date  TEXT NOT NULL,              -- ISO date
  end_date    TEXT,                       -- null if ongoing
  notes       TEXT,
  created_at  TEXT NOT NULL
);
```

### Workout Sessions

```sql
-- A single workout session (gym or run)
CREATE TABLE workouts (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,           -- ISO date
  started_at      TEXT NOT NULL,           -- ISO datetime
  ended_at        TEXT,
  session_type    TEXT NOT NULL,           -- 'gym'|'run'|'other'
  training_block_id TEXT REFERENCES training_blocks(id),
  template_id     TEXT REFERENCES templates(id),
  mood_rating     INTEGER,                 -- 1-5
  energy_rating   INTEGER,                 -- 1-5
  notes           TEXT,
  created_at      TEXT NOT NULL
);

-- Exercises within a gym session
CREATE TABLE workout_exercises (
  id              TEXT PRIMARY KEY,
  workout_id      TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id     TEXT NOT NULL REFERENCES exercises(id),
  order_num       INTEGER NOT NULL,
  superset_group  TEXT,
  rest_seconds    INTEGER DEFAULT 120
);

-- Individual sets
CREATE TABLE sets (
  id                  TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_num             INTEGER NOT NULL,
  is_warmup           INTEGER DEFAULT 0,
  weight_kg           REAL,
  reps                INTEGER,
  rpe                 REAL,                -- 6.0–10.0
  rir                 INTEGER,             -- 0–5
  notes               TEXT,
  completed           INTEGER DEFAULT 0,
  logged_at           TEXT                -- ISO datetime (for rest timer calculation)
);
```

### Running

```sql
-- Run-specific data (linked to a workout row)
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  workout_id      TEXT NOT NULL UNIQUE REFERENCES workouts(id) ON DELETE CASCADE,
  run_type        TEXT NOT NULL DEFAULT 'easy', -- 'easy'|'tempo'|'interval'|'long'|'race'|'other'
  distance_m      REAL,
  duration_sec    INTEGER,
  avg_pace_sec_km REAL,
  avg_hr          INTEGER,
  max_hr          INTEGER,
  elevation_gain_m REAL,
  avg_cadence     INTEGER,                -- steps per minute
  avg_power_w     INTEGER,               -- running power in watts
  manual_entry    INTEGER DEFAULT 0      -- 0 = GPS tracked, 1 = manual
);

-- Per-km/mile splits for GPS runs
CREATE TABLE run_splits (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  split_num   INTEGER NOT NULL,
  distance_m  REAL NOT NULL,
  duration_sec INTEGER NOT NULL,
  pace_sec_km REAL,
  hr_avg      INTEGER,
  elevation_m REAL
);

-- Structured interval templates
CREATE TABLE interval_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,             -- e.g. '5×1km Threshold'
  intervals   TEXT NOT NULL,            -- JSON: [{type,distance_m,duration_sec,rest_sec,target_pace}]
  created_at  TEXT NOT NULL
);
```

### Body Metrics

```sql
CREATE TABLE body_weights (
  id      TEXT PRIMARY KEY,
  date    TEXT NOT NULL UNIQUE,
  weight_kg REAL NOT NULL,
  notes   TEXT
);

CREATE TABLE body_measurements (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  metric      TEXT NOT NULL,   -- 'waist'|'chest'|'hips'|'left_arm'|'right_arm'|'left_thigh'|'right_thigh'|'neck'
  value_cm    REAL NOT NULL
);

CREATE TABLE body_photos (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  angle       TEXT,            -- 'front'|'side'|'back'
  blob_key    TEXT NOT NULL    -- stored in IndexedDB, key reference
);
```

### Analytics Cache

```sql
-- Personal records (maintained by triggers / post-set logic)
CREATE TABLE personal_records (
  id          TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  record_type TEXT NOT NULL,  -- 'weight'|'reps'|'e1rm'
  value       REAL NOT NULL,
  set_id      TEXT REFERENCES sets(id),
  date        TEXT NOT NULL
);

-- Weekly training load cache (recalculated on workout completion)
CREATE TABLE weekly_training_load (
  week        TEXT PRIMARY KEY,  -- ISO week: '2025-W10'
  gym_volume  REAL,              -- total tonnage (sets × reps × weight)
  gym_sets    INTEGER,
  run_distance_m REAL,
  run_duration_sec INTEGER,
  acute_load  REAL,              -- 7-day rolling
  chronic_load REAL              -- 28-day rolling
);
```

---

## 5. Feature Specifications

### 5.1 Today Screen

Three sections:

**Planned workout** (if active program): Shows today's scheduled session from the active training block. Tap to start. If rest day, shows "Rest Day — recover well."

**Quick-start**: Large CTA button. Tapping opens workout start modal with two options: "From Template" or "Empty Session."

**Recent activity**: Last 3 activities (gym or run) shown as compact cards. Streak counter. Weekly volume vs last week delta.

---

### 5.2 Active Workout (One-Page View)

The core logging experience. Inspired by GymKeeper's single-page approach — all exercises and sets visible without drilling into sub-pages.

**Layout:**
```
┌─────────────────────────────────────────┐
│  ⏱ 42:17   Push A – Week 3             │
│  [  Finish Workout  ]                   │
├─────────────────────────────────────────┤
│  Bench Press (Barbell)          [+ Set] │
│  ○ W  60kg × 10                        │
│  ● 1  80kg × 8   RPE 7.5   RIR 2      │
│  ● 2  80kg × 8   RPE 8.0   RIR 1      │
│  ● 3  80kg × 7   RPE 9.0   RIR 0  📝  │
├─────────────────────────────────────────┤
│  Incline DB Press               [+ Set] │
│  ● 1  32kg × 12  RPE 7     RIR 3      │
│  [ ] 2  ——                             │
├─────────────────────────────────────────┤
│  [+ Add Exercise]                       │
└─────────────────────────────────────────┘
```

**Tap `[+ Set]`:** Bottom sheet slides up with pre-filled values from last set (weight, reps, RPE). Single tap "Log Set" confirms. Sheet dismisses automatically.

**Set states:**
- `○` warmup (grayed, excluded from volume)
- `●` completed working set
- `[ ]` pending set (added but not done)

**Rest timer:** Starts automatically after logging a set. Per-exercise duration. Shown as countdown in the header area. Tapping it dismisses or resets.

**Superset groups:** Exercises paired with the same superset_group label show a colored left-border stripe and `A` / `B` badges. Alternating between them is manual.

**Finish:** Tap "Finish Workout" → summary sheet: total sets, total volume, PRs hit, session duration, mood/energy check-in (1–5), notes field. Confirm to save.

**Auto-progression suggestion:** After saving, the system checks each exercise. If avg working RPE < (target_rpe – 1), flag it as "Ready to progress." Next time that template is loaded, the suggested weight is pre-filled (last weight + increment_kg).

---

### 5.3 Exercise Library

**Seeded built-in exercises** (~150 common exercises) covering:
- Barbell compounds (Squat, Deadlift, Bench, OHP, Row, RDL…)
- Dumbbell variations
- Machine exercises
- Bodyweight
- Cable movements
- Cardio machines (treadmill, bike, rower — for logging in gym sessions)

Each exercise: `name`, `equipment`, `movement pattern`, `primary muscles`, `secondary muscles`, `text cues`.

**Search / filter:** Free-text search + filter chips for equipment and muscle group. Results show movement pattern badge.

**Custom exercises:** User can add their own with the same fields. Marked with a user icon.

**Equipment variants are separate exercises** (Barbell Squat ≠ Goblet Squat — separate history, separate PRs).

---

### 5.4 Programs & Templates

**Built-in programs** (seeded, read-only base that users can fork):
- 5/3/1 (4-day, 4-week cycle)
- Push-Pull-Legs (6-day)
- GZCLP (3-day linear progression)
- Upper/Lower (4-day)
- Starting Strength (3-day)

**Template builder:** Drag-and-drop exercise order, set planned sets/reps/RPE target, rest time, superset groupings.

**Program builder:** Assign templates to days of the week across N weeks. Mark deload weeks.

**Training block (mesocycle):**
- Create a named block with start date, phase (hypertrophy/strength/peaking/deload), and optionally link a program
- All workouts during the active date range are automatically associated
- Block completion summary: total volume, PR count, average RPE trend
- Blocks shown on a timeline in the Progress tab

---

### 5.5 Running

**Start a run:** Options — GPS live track or manual entry.

**GPS live tracking:** Uses Geolocation API with `watchPosition`. Records coordinate trail with timestamps. On finish: calculates distance, pace, splits, elevation gain (from coordinates altitude field if available). Saved to `runs` + `run_splits`.

**Manual entry:** Form with: date, run type (easy/tempo/interval/long/race), distance, duration, avg HR, avg pace, avg cadence, power, notes.

**Interval templates:** Builder for structured runs. Example: "5×1km Threshold" = {5 reps of {1000m at threshold pace, 90s recovery}}. During a GPS run, interval template can be loaded for lap-based tracking (manual lap tap or auto-lap by distance).

**Metrics tracked per run:**
- Distance (km), Duration, Avg & split pace (min/km), Avg & max HR, Elevation gain, Avg cadence, Avg power

---

### 5.6 Progress & Analytics

#### Gym Analytics

**Personal Records board:** Per-exercise PRs for best weight, best reps at any weight, best estimated 1RM (Epley: `weight × (1 + reps/30)`). New PRs detected on workout save, stored in `personal_records`.

**e1RM Progression chart:** Line chart per exercise over time. Tap exercise to view full history with all sets as dots.

**Muscle group frequency:** Heatmap showing each muscle group and how many times it was trained in the last 4 weeks. Helps identify imbalances.

**Training load dashboard (Outsiders-inspired):**
- Acute load (7-day rolling average tonnage, normalized)
- Chronic load (28-day rolling average)
- Acute:Chronic ratio — color-coded: green (0.8–1.3 optimal), yellow (caution), red (overreaching risk)
- Week-over-week volume change %

**Volume chart:** Weekly total tonnage (kg), sets per week, with mesocycle block color bands in background.

#### Running Analytics

**Weekly mileage chart:** Bar chart by week. Current week highlighted.

**Pace progression:** Line chart of avg pace per run over time. Filter by run type.

**Training load for running:** Weekly distance × intensity factor (easy=1.0, tempo=1.4, interval=1.8) as TRIMP-lite proxy.

#### Body Metrics

**Bodyweight trend:** Line chart with 7-day rolling average. Log weight via quick entry on Today screen or Progress tab.

**Measurements:** Table + chart per measurement site over time.

**Photos:** Grid view organized by date. Side-by-side comparison mode (pick two dates).

---

### 5.7 Data Export / Import

- **JSON export:** Full SQLite dump as JSON for backup / migration. `hephaestus_backup_YYYY-MM-DD.json`
- **CSV export:** Per-exercise training history as CSV (date, weight, reps, RPE, e1RM)
- **Workout card (image):** Share sheet generates a styled PNG card for a completed workout — exercise list + top stats. Uses HTML Canvas.
- **Google Fit / Health Connect:** Write completed workouts as activity sessions (gym session or running session) with duration and calories.

No import from other apps in v1 (can add later).

---

### 5.8 Settings & Profile

- App theme switcher (Hephaestus / Forge / Daylight)
- Dark/Light/System mode toggle
- Units: kg/lbs toggle, km/miles toggle
- Rest timer default duration
- Google Fit / Health Connect connection toggle
- Active training block switcher
- Export / import
- Exercise library management (view, edit, delete custom exercises)

---

## 6. Architecture

### File Structure

```
app/
  pages/
    index.vue             → Today dashboard
    workout/
      index.vue           → Active workout (one-page view)
      start.vue           → Start session modal / template picker
    history/
      index.vue           → Workout list
      [id].vue            → Workout detail
    runs/
      index.vue           → Run list
      [id].vue            → Run detail
    progress/
      index.vue           → Analytics dashboard
      exercise/[id].vue   → Per-exercise detail
      body.vue            → Body metrics
    profile/
      index.vue           → Settings
      library.vue         → Exercise library
      programs.vue        → Programs & templates
      blocks.vue          → Training blocks / mesocycles
  components/
    workout/
      SetRow.vue
      ExerciseBlock.vue
      AddSetSheet.vue
      RestTimer.vue
      FinishSheet.vue
    progress/
      TrainingLoadChart.vue
      EpleyChart.vue
      MuscleHeatmap.vue
      WeeklyVolumeChart.vue
    run/
      RunMetricsCard.vue
      SplitsTable.vue
    body/
      WeightChart.vue
      PhotoGrid.vue
    common/
      BottomNav.vue
      Sheet.vue
      StatCard.vue
  composables/
    useDatabase.ts        → DB worker interface
    useWorkout.ts         → Active workout state & logic
    useRun.ts             → GPS tracking state
    useExercises.ts       → Exercise library queries
    usePrograms.ts        → Program / template CRUD
    useTrainingBlocks.ts  → Mesocycle management
    useProgress.ts        → Analytics queries
    useBodyMetrics.ts     → Body weight / measurements
    useAutoProgress.ts    → Progressive overload suggestion logic
    useAppSettings.ts     → localStorage settings
    useTheme.ts           → Theme management
  workers/
    database.worker.ts    → SQLite WASM operations
    sw.ts                 → Service worker (Workbox)
  types/
    database.ts           → All DB row types
    workout.ts            → Domain types
    analytics.ts          → Analytics types
  assets/
    css/
      themes.css          → CSS custom properties per theme
    seed/
      exercises.json      → Built-in exercise library seed data
      programs.json       → Built-in program seed data
```

### Database Worker Pattern

Mirrors Habitat exactly:
- All SQL runs in `database.worker.ts` via `postMessage` RPC
- `useDatabase()` composable wraps the worker with typed request/response
- Web Locks API prevents multi-tab conflicts
- OPFS persistence via SQLite WASM OPFS VFS
- Migrations managed as versioned SQL strings

### Active Workout State

`useWorkout.ts` maintains in-memory state for the active session:
- `activeWorkout: Ref<Workout | null>`
- `workoutExercises: Ref<WorkoutExercise[]>`
- `sets: Ref<Map<string, Set[]>>` (keyed by workout_exercise_id)
- `elapsedSeconds: Ref<number>` (interval timer)
- `restTimer: Ref<{active, remaining, exerciseId}>`

On each set log: write to DB immediately (durability), update in-memory state reactively. If app crashes, session is recoverable from DB on next open.

---

## 7. UI Patterns

### Set Logging Sheet

```
┌─────────────────────────────────┐
│  Set 3 · Bench Press            │
│                                 │
│  Weight (kg)    Reps            │
│  [ 80    ↑↓ ]  [ 8    ↑↓ ]    │
│                                 │
│  RPE   [ 8.0 ↑↓ ]              │
│  RIR   [ 1   ↑↓ ]              │
│                                 │
│  Note (optional) ____________   │
│                                 │
│  [ Warmup ]    [ LOG SET ✓ ]   │
└─────────────────────────────────┘
```

Stepper inputs with +/- tap zones for quick adjustment. Weight shows last used value (pre-filled). RPE/RIR fields optional — shown but not required.

### Theme Tokens

```css
/* Hephaestus dark (default) */
[data-theme="hephaestus"] {
  --color-bg: #111111;
  --color-surface: #1c1c1e;
  --color-surface-2: #2c2c2e;
  --color-accent: #f97316;        /* orange */
  --color-accent-dim: #7c2d12;
  --color-text: #f2f2f7;
  --color-text-muted: #8e8e93;
  --color-success: #30d158;
  --color-warning: #ffd60a;
  --color-danger: #ff453a;
}
```

### Rest Timer

Persistent bar at top of active workout, below nav. Shows exercise name + countdown. Subtle pulse animation as it counts down. Tapping dismisses (skip rest). Color shifts from green → yellow → red as time exceeds configured rest duration.

---

## 8. PWA Configuration

- **Manifest**: name "Hephaestus", short_name "Hephaestus", display "standalone", theme_color per active theme
- **Icons**: 192×192, 512×512, maskable variants
- **Shortcuts**: Today, New Workout, Log Run
- **Offline**: All assets precached via Workbox. DB is local (OPFS). Full offline capability.
- **Install prompt**: Custom install banner shown after 3rd session

---

## 9. Progressive Web App + Native Targets

- **PWA**: Primary target. Deploy as static site (GitHub Pages or self-hosted).
- **Android**: Capacitor wrapper. Uses `@capacitor-community/sqlite` instead of WASM. Health Connect integration via Capacitor plugin.
- **iOS**: Capacitor wrapper. Same SQLite native bridge.
- `BUILD_TARGET` env var switches DB adapter (identical to Habitat pattern).

---

## 10. Implementation Phases

### Phase 1 — Core Logging (MVP)
- [ ] Project scaffold from Habitat structure
- [ ] DB schema + migrations + seeded exercise library
- [ ] Template builder + program CRUD
- [ ] Active workout: one-page view, set logging, rest timer, finish flow
- [ ] Workout history list + detail view
- [ ] Basic PR tracking
- [ ] Today dashboard (basic)

### Phase 2 — Analytics
- [ ] e1RM progression charts
- [ ] Training load (acute/chronic)
- [ ] Muscle group frequency heatmap
- [ ] Weekly volume charts

### Phase 3 — Running
- [ ] Manual run entry
- [ ] GPS live tracking
- [ ] Splits display
- [ ] Interval templates
- [ ] Run analytics (weekly mileage, pace trends)

### Phase 4 — Mesocycles & Programs
- [ ] Training block CRUD + timeline
- [ ] Built-in programs (5/3/1, PPL, etc.)
- [ ] Auto-progression suggestion engine
- [ ] Block completion summary

### Phase 5 — Body Metrics & Polish
- [ ] Bodyweight log + trend chart
- [ ] Body measurements
- [ ] Progress photos (IndexedDB storage)
- [ ] Theme system (all 3 palettes)
- [ ] Google Fit / Health Connect export
- [ ] JSON/CSV export
- [ ] Workout card image share
- [ ] PWA install prompt

---

## 11. Decisions & Constraints

| Decision | Choice | Rationale |
|---|---|---|
| No route maps | Skipped | User explicitly doesn't need them |
| No plate calculator | Skipped | User does own math |
| No gamification | Skipped | User prefers utilitarian |
| No cloud sync | Skipped | Purely local-first |
| No social features | Skipped | Fully private |
| Exercise demos | Text cues only | No media assets needed |
| Equipment variants | Separate exercises | Clean separate history per variant |
| Progression model | RPE-based + manual override | More nuanced than linear |
| HR zones in gym | Later / optional | Only for MetCon/HIIT, not core |
| Session timer | Always-on elapsed | Visible but not intrusive |
