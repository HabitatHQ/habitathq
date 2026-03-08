// ─── Core reference types ─────────────────────────────────────────────────────

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'

export type MovementPattern = 'squat' | 'hinge' | 'press' | 'row' | 'carry' | 'isolation' | 'cardio'

export interface ExerciseRow {
  id: string
  name: string
  slug: string
  equipment: Equipment
  movement: MovementPattern
  muscles: string // JSON array
  muscles_sec: string // JSON array
  cues: string | null
  is_custom: 0 | 1
  created_at: string
}

export interface TemplateRow {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface TemplateExerciseRow {
  id: string
  template_id: string
  exercise_id: string
  order_num: number
  superset_group: string | null
  sets_planned: number | null
  reps_planned: string | null
  rpe_target: number | null
  increment_kg: number
  rest_seconds: number
}

// ─── Programs & Mesocycles ────────────────────────────────────────────────────

export interface ProgramRow {
  id: string
  name: string
  description: string | null
  weeks: number
  is_builtin: 0 | 1
  created_at: string
}

export interface ProgramWeekRow {
  id: string
  program_id: string
  week_num: number
  is_deload: 0 | 1
}

export interface ProgramDayRow {
  id: string
  week_id: string
  day_num: number
  template_id: string | null
  label: string | null
}

export type TrainingPhase = 'hypertrophy' | 'strength' | 'peaking' | 'deload' | 'base'

export interface TrainingBlockRow {
  id: string
  name: string
  phase: TrainingPhase | null
  program_id: string | null
  start_date: string
  end_date: string | null
  notes: string | null
  created_at: string
}

// ─── Workout Sessions ─────────────────────────────────────────────────────────

export type SessionType = 'gym' | 'run' | 'other'

export interface WorkoutRow {
  id: string
  date: string
  started_at: string
  ended_at: string | null
  session_type: SessionType
  training_block_id: string | null
  template_id: string | null
  mood_rating: number | null
  energy_rating: number | null
  notes: string | null
  created_at: string
}

export interface WorkoutExerciseRow {
  id: string
  workout_id: string
  exercise_id: string
  order_num: number
  superset_group: string | null
  rest_seconds: number
}

export interface SetRow {
  id: string
  workout_exercise_id: string
  set_num: number
  is_warmup: 0 | 1
  weight_kg: number | null
  reps: number | null
  rpe: number | null
  rir: number | null
  notes: string | null
  completed: 0 | 1
  logged_at: string | null
}

// ─── Running ─────────────────────────────────────────────────────────────────

export type RunType = 'easy' | 'tempo' | 'interval' | 'long' | 'race' | 'other'

export interface RunRow {
  id: string
  workout_id: string
  run_type: RunType
  distance_m: number | null
  duration_sec: number | null
  avg_pace_sec_km: number | null
  avg_hr: number | null
  max_hr: number | null
  elevation_gain_m: number | null
  avg_cadence: number | null
  avg_power_w: number | null
  manual_entry: 0 | 1
}

export interface RunSplitRow {
  id: string
  run_id: string
  split_num: number
  distance_m: number
  duration_sec: number
  pace_sec_km: number | null
  hr_avg: number | null
  elevation_m: number | null
}

export interface IntervalTemplateRow {
  id: string
  name: string
  intervals: string // JSON
  created_at: string
}

// ─── Body Metrics ─────────────────────────────────────────────────────────────

export interface BodyWeightRow {
  id: string
  date: string
  weight_kg: number
  notes: string | null
}

export type BodyMeasurementMetric =
  | 'waist'
  | 'chest'
  | 'hips'
  | 'left_arm'
  | 'right_arm'
  | 'left_thigh'
  | 'right_thigh'
  | 'neck'

export interface BodyMeasurementRow {
  id: string
  date: string
  metric: BodyMeasurementMetric
  value_cm: number
}

export interface BodyPhotoRow {
  id: string
  date: string
  angle: 'front' | 'side' | 'back' | null
  blob_key: string
}

// ─── Analytics Cache ──────────────────────────────────────────────────────────

export type RecordType = 'weight' | 'reps' | 'e1rm'

export interface PersonalRecordRow {
  id: string
  exercise_id: string
  record_type: RecordType
  value: number
  set_id: string | null
  date: string
}

export interface WeeklyTrainingLoadRow {
  week: string // ISO week: '2025-W10'
  gym_volume: number | null
  gym_sets: number | null
  run_distance_m: number | null
  run_duration_sec: number | null
  acute_load: number | null
  chronic_load: number | null
}

// ─── Worker message types ─────────────────────────────────────────────────────

export interface WorkerRequest {
  id: string
  type: string
  payload?: unknown
}

export interface WorkerResponse {
  id?: string
  type: string
  payload?: unknown
  error?: string
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isSetRow(value: unknown): value is SetRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'workout_exercise_id' in value &&
    'set_num' in value
  )
}

export function isExerciseRow(value: unknown): value is ExerciseRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'slug' in value &&
    'equipment' in value &&
    'movement' in value
  )
}

export function isWorkoutRow(value: unknown): value is WorkoutRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'date' in value &&
    'started_at' in value &&
    'session_type' in value
  )
}
