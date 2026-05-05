// ─── Set scheme types ─────────────────────────────────────────────────────────

export type FailureType = 'muscular' | 'technical' | 'near_failure'
export type SetSchemeType =
  | 'straight'
  | 'drop_set'
  | 'pyramid_ascending'
  | 'pyramid_descending'
  | 'pyramid_full'
  | 'pyramid_rep'
  | 'rest_pause'

export interface DropSetConfig {
  drops: number
  dropType: 'percent' | 'absolute'
  dropValue: number
}

export interface PyramidConfig {
  type: 'ascending' | 'descending' | 'full' | 'rep_only'
  steps: number
  startWeight: number
  weightStep: number
  stepType: 'absolute' | 'percent'
  repsPerStep: number[]
  restPerStep: number[]
}

export interface RestPauseConfig {
  clusterRestSec: number
  clustersPlanned: number
}

export type SetSchemeConfig =
  | { type: 'drop_set'; config: DropSetConfig }
  | {
      type: 'pyramid_ascending' | 'pyramid_descending' | 'pyramid_full' | 'pyramid_rep'
      config: PyramidConfig
    }
  | { type: 'rest_pause'; config: RestPauseConfig }
  | { type: 'straight' }

// ─── Core reference types ─────────────────────────────────────────────────────

/** Broad equipment category — used for filter chips and grouping. */
export type Equipment =
  | 'barbell' // any barbell variant
  | 'dumbbell'
  | 'cable' // cable / pulley machines
  | 'machine' // selectorized / plate-loaded machines
  | 'bodyweight' // no equipment required
  | 'other' // kettlebells, bands, balls, sleds, etc.

/** Specific equipment subcategory — detailed type within a category. */
export type EquipmentSub =
  // barbell family
  | 'barbell' // standard Olympic barbell
  | 'ez-bar' // EZ curl / cambered bar
  | 'trap-bar' // hex / trap bar
  | 'smith-machine' // guided barbell
  // dumbbell
  | 'dumbbell'
  // cable / machine
  | 'cable' // pulley / cable stack
  | 'selectorized' // weight-stack machine
  | 'plate-loaded' // plate-loaded lever machine
  // bodyweight
  | 'bodyweight' // no equipment
  | 'pull-up-bar' // standalone pull-up / dip bar
  | 'suspension' // TRX / gymnastic rings
  // other / accessories
  | 'kettlebell'
  | 'bands' // resistance bands / tubes
  | 'swiss-ball' // stability / Swiss ball
  | 'medicine-ball'
  | 'foam-roller'
  | 'sled'
  | 'other'

/** Derive the broad Equipment category from a specific EquipmentSub. */
export function equipmentCategory(sub: EquipmentSub): Equipment {
  switch (sub) {
    case 'barbell':
    case 'ez-bar':
    case 'trap-bar':
    case 'smith-machine':
      return 'barbell'
    case 'dumbbell':
      return 'dumbbell'
    case 'cable':
      return 'cable'
    case 'selectorized':
    case 'plate-loaded':
      return 'machine'
    case 'bodyweight':
    case 'pull-up-bar':
    case 'suspension':
      return 'bodyweight'
    default:
      return 'other'
  }
}

export type MovementPattern = 'squat' | 'hinge' | 'press' | 'row' | 'carry' | 'isolation' | 'cardio'

export type LoggingMode = 'strength' | 'cardio' | 'distance'
export type GroupType = 'superset' | 'giant_set' | 'circuit' | 'pre_exhaust'
export type CircuitRestMode = 'after_round' | 'after_each'
export type TechniqueFlag = 'good' | 'grinding' | 'failed' | 'partial_range'
export type BodyFeel = 'pumped' | 'sharp_pain' | 'unusually_strong' | 'tight'
export type TagCategory = 'performance' | 'feel' | 'environment' | 'custom'
export type Environment = 'home_gym' | 'commercial' | 'travel' | 'competition'

export interface ExerciseRow {
  id: string
  name: string
  slug: string
  equipment: Equipment
  equipment_sub: EquipmentSub
  movement: MovementPattern
  muscles: string // JSON array
  muscles_sec: string // JSON array
  cues: string | null
  icon: string | null
  is_custom: 0 | 1
  logging_mode: LoggingMode
  created_at: string
}

export type TemplateSortOrder = 'recent' | 'last_used' | 'most_used' | 'name' | 'pinned_first'

export interface TemplateRow {
  id: string
  name: string
  description: string | null
  created_at: string
  archived_at: string | null
  sort_order: number
  pinned_at: string | null
  last_used_at: string | null
  use_count: number
  cover_emoji: string | null
  scheduled_days: string | null // JSON int[]
  notification_enabled: 0 | 1
  notification_time: string | null
}

export interface TemplateFolderRow {
  id: string
  name: string
  sort_order: number
  color: string | null
  created_at: string
}

export interface TemplateFolderItemRow {
  template_id: string
  folder_id: string
  sort_order: number
}

export interface TemplateTagRow {
  template_id: string
  tag_id: string
}

export interface TemplateUpdatePayload {
  name?: string
  description?: string | null
  sort_order?: number
  cover_emoji?: string | null
  pinned_at?: string | null
  archived_at?: string | null
  last_used_at?: string | null
  use_count?: number
  scheduled_days?: string | null
  notification_enabled?: 0 | 1
  notification_time?: string | null
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
  set_rest_seconds: string | null
  transition_rest_sec: number | null
  warmup_counts: 0 | 1
  set_scheme: string | null
  notes: string | null
  failure_target: 0 | 1
  rpe_targets: string | null // JSON number[]
  progression_rule: string | null // JSON AutoregulationRule
  deload_template_id: string | null
  substitutes: string | null // JSON string[]
  tempo: string | null // e.g. "3-1-2-0"
  resistance_note: string | null
  unilateral: 0 | 1
}

// ─── Programs & Mesocycles ────────────────────────────────────────────────────

export interface ProgramRow {
  id: string
  name: string
  description: string | null
  weeks: number
  is_builtin: 0 | 1
  created_at: string
  current_week: number
  started_at: string | null
  active: 0 | 1
}

export type ProgramPhase = 'accumulation' | 'intensification' | 'deload' | 'peak'

export interface ProgramWeekRow {
  id: string
  program_id: string
  week_num: number
  is_deload: 0 | 1
  intensity_modifier: number
  volume_modifier: number
  phase: ProgramPhase | null
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
  environment: Environment | null
  created_at: string
}

export interface TemplateGroupRow {
  id: string
  template_id: string
  label: string
  name: string | null
  group_type: GroupType
  transition_rest_sec: number
  rest_after_round_sec: number
  circuit_rest_mode: CircuitRestMode
  sort_order: number
  display_name: string | null
  rounds: number
  amrap: 0 | 1
  time_cap_sec: number | null
}

export interface TagRow {
  id: string
  name: string
  category: TagCategory
  is_predefined: 0 | 1
  color: string | null
  created_at: string
}

export interface WorkoutTagRow {
  workout_id: string
  tag_id: string
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
  distance_m: number | null
  duration_sec: number | null
  speed_kmh: number | null
  level: number | null
  technique_flag: TechniqueFlag | null
  body_feel: BodyFeel | null
  failure_flag: 0 | 1
  failure_type: FailureType | null
  partial_reps: number | null
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
  type: string // 'custom' | 'tabata' | 'emom' | 'amrap'
  work_sec: number | null
  rest_sec: number | null
  rounds: number | null
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

// ─── DbAdapter interface ─────────────────────────────────────────────────────

export interface DbAdapter {
  queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]>
  queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null>
  exec(sql: string, bind?: unknown[]): Promise<void>
}

// ─── Worker message types ─────────────────────────────────────────────────────

export interface WorkerRequest {
  id: string
  type: string
  payload?: unknown
}

export type WorkerResponse =
  | { type: 'READY' }
  | { type: 'LOCK_UNAVAILABLE' }
  | { type: 'INIT_ERROR'; message: string }
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }

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
