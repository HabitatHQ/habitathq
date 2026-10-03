import type { RunRow, SetRow, WorkoutExerciseRow, WorkoutRow } from '~/types/database'
import type { OrganizationCreditPreview } from '~/types/organization'

export type CorrectableWorkout = WorkoutRow & { title: string | null; correction_version: number }
export type CorrectableActivity = WorkoutExerciseRow & {
  removed_at: string | null
  removed_by_correction_id: string | null
  exercise_name: string
}
export type CorrectableSet = SetRow & {
  removed_at: string | null
  removed_by_correction_id: string | null
}
export interface CapturedActivityIntent {
  workout_exercise_id: string
  intent_activity_id: string
  intent_order: number
  execution_group_id: string | null
}
export interface CapturedSetIntent {
  set_id: string
  intent_set_id: string
  target_snapshot_json: string
  workout_exercise_id: string
}
export interface FieldComparison {
  field: 'weightKg' | 'reps' | 'rpe' | 'rir' | 'durationSec' | 'distanceM'
  target: { kind: 'exact' | 'range' | 'minimum'; minimum: number; maximum?: number } | null
  actual: number | null
  status: 'matches' | 'below' | 'above' | 'unknown'
}
export interface HistoryActivityDetail {
  activity: CorrectableActivity
  sets: CorrectableSet[]
  comparisons: Array<{ setId: string; fields: FieldComparison[] }>
}
export interface HistorySetValues {
  weightKg?: number | null
  reps?: number | null
  rpe?: number | null
  rir?: number | null
  durationSec?: number | null
  distanceM?: number | null
  notes?: string | null
  completed?: boolean
  isWarmup?: boolean
}

export interface HistoryCorrectionDraft {
  workoutId: string
  expectedVersion: number
  title?: string | null
  performedDate?: string
  startedAt?: string
  endedAt?: string
  activities?: Array<{
    id: string
    exerciseId?: string
    removed?: boolean
    sets?: Array<{ id: string; removed?: boolean; values?: HistorySetValues }>
    addSets?: HistorySetValues[]
  }>
  addActivities?: Array<{ exerciseId: string; sets: HistorySetValues[] }>
  run?: { distanceM?: number | null; durationSec?: number | null }
  appointmentId?: string | null
}

export interface HistoryCorrectionPreview {
  previewId: string
  fingerprint: string
  workoutId: string
  version: number
  before: { title: string | null; date: string; startedAt: string; endedAt: string | null }
  after: { title: string | null; date: string; startedAt: string; endedAt: string | null }
  run: {
    before: { distanceM: number | null; durationSec: number | null } | null
    after: { distanceM: number | null; durationSec: number | null } | null
  }
  appointment: { beforeId: string | null; afterId: string | null }
  credit: { before: OrganizationCreditPreview; after: OrganizationCreditPreview }
  comparisons: Array<{
    activityId: string
    exerciseName: string
    setId: string
    setNumber: number
    fields: FieldComparison[]
  }>
  impact: {
    removedActivities: number
    removedSets: number
    addedActivities: number
    addedSets: number
  }
}

export interface HistoryCorrectionDetail {
  workout: CorrectableWorkout
  activities: HistoryActivityDetail[]
  intentActivities: CapturedActivityIntent[]
  intentSets: CapturedSetIntent[]
  skippedSetIds: string[]
  run: RunRow | null
  appointmentId: string | null
  version: number
}

export interface AppointmentCandidate {
  id: string
  planId: string
  planName: string
  routineId: string
  routineName: string
  plannedDate: string
  status: string
  workoutId: string | null
  protected: boolean
}

export interface HistoryCorrectionResult {
  workoutId: string
  version: number
  detail: HistoryCorrectionDetail
  unfulfilledAppointmentId: string | null
}

export interface HistoryOperationMap {
  HISTORY_CORRECTION_READ: { payload: { workoutId: string }; result: HistoryCorrectionDetail }
  HISTORY_CORRECTION_PREVIEW: { payload: HistoryCorrectionDraft; result: HistoryCorrectionPreview }
  HISTORY_CORRECTION_APPLY: {
    payload: { previewId: string; fingerprint: string }
    result: HistoryCorrectionResult
  }
  HISTORY_APPOINTMENT_CANDIDATES: { payload: { workoutId: string }; result: AppointmentCandidate[] }
}

export type HistoryOperation = keyof HistoryOperationMap
export const HISTORY_OPERATIONS = [
  'HISTORY_CORRECTION_READ',
  'HISTORY_CORRECTION_PREVIEW',
  'HISTORY_CORRECTION_APPLY',
  'HISTORY_APPOINTMENT_CANDIDATES',
] as const satisfies readonly HistoryOperation[]
