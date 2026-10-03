export type AppointmentStatus = 'open' | 'fulfilled' | 'skipped'
export type AppointmentSourceKind = 'manual' | 'recurrence' | 'program'

export type OrganizationFilter = {
  sessionTypes: string[]
  exerciseIds: string[]
  movementPatterns: string[]
}

export interface OrganizationPlan {
  id: string
  name: string
  active: boolean
  startDate: string
  createdAt: string
  updatedAt: string
}

export interface Appointment {
  id: string
  occurrenceKey: string | null
  sourceKind: AppointmentSourceKind
  sourceId: string | null
  planId: string
  routineId: string
  originalDate: string
  originalTime: string | null
  plannedDate: string
  plannedTime: string | null
  status: AppointmentStatus
  workoutId: string | null
  postponed: boolean
  createdAt: string
}

export interface OrganizationRecurrenceRule {
  id: string
  planId: string
  routineId: string
  weekdays: number[]
  startDate: string
  endDate: string | null
  plannedTime: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface OrganizationRotation {
  id: string
  planId: string
  name: string
  routineIds: string[]
  position: number
  generation: number
  currentRoutineId: string
}

export interface OrganizationGoal {
  id: string
  planId: string
  name: string
  targetCount: number
  filter: OrganizationFilter
  active: boolean
  createdAt: string
}

export interface OrganizationTodayItem {
  kind: 'recovery' | 'appointment' | 'rotation' | 'goal'
  id: string
  planId: string | null
  planName: string | null
  title: string
  explanation: string
  date: string | null
  time: string | null
  routineId: string | null
  workoutId: string | null
  rotationId: string | null
  generation: number | null
  progress: number | null
  alternatives: string[]
}

export interface AppointmentReview {
  previewId: string
  planId: string
  changed: Appointment[]
  fingerprint: string
}

export interface RecurrenceReview {
  previewId: string
  rule: OrganizationRecurrenceRule
  createDates: string[]
  updateAppointments: Appointment[]
  removeAppointmentIds: string[]
  protectedAppointmentIds: string[]
  fingerprint: string
}

export interface OrganizationCreditPreview {
  qualifies: boolean
  appointmentIds: string[]
  rotationId: string | null
  goalIds: string[]
}

export interface OrganizationOperationMap {
  ORGANIZATION_PLAN_LIST: { payload: Record<string, never>; result: OrganizationPlan[] }
  ORGANIZATION_PLAN_SAVE: {
    payload: { id?: string; name: string; active: boolean; startDate?: string }
    result: OrganizationPlan
  }
  ORGANIZATION_APPOINTMENT_LIST: { payload: { planId?: string }; result: Appointment[] }
  ORGANIZATION_APPOINTMENT_CREATE: {
    payload: { id?: string; planId: string; routineId: string; date: string; time?: string | null }
    result: Appointment
  }
  ORGANIZATION_APPOINTMENT_POSTPONE_PREVIEW: {
    payload: { appointmentId: string; date: string }
    result: { appointment: Appointment; targetDate: string; collisionIds: string[] }
  }
  ORGANIZATION_APPOINTMENT_POSTPONE: {
    payload: { appointmentId: string; date: string; overrideCollision: boolean }
    result: { appointment: Appointment; collisionIds: string[] }
  }
  ORGANIZATION_APPOINTMENT_SKIP: { payload: { appointmentId: string }; result: Appointment }
  ORGANIZATION_RECURRENCE_LIST: {
    payload: { planId?: string }
    result: OrganizationRecurrenceRule[]
  }
  ORGANIZATION_RECURRENCE_PREVIEW: {
    payload: {
      id?: string
      planId: string
      routineId: string
      weekdays: number[]
      startDate: string
      endDate?: string | null
      time?: string | null
      active: boolean
      today: string
    }
    result: RecurrenceReview
  }
  ORGANIZATION_RECURRENCE_APPLY: {
    payload: { previewId: string; fingerprint: string }
    result: OrganizationRecurrenceRule
  }
  ORGANIZATION_RECONCILE_OPEN: { payload: { today: string }; result: Appointment[] }
  ORGANIZATION_SCHEDULE_PREVIEW: {
    payload: {
      planId: string
      today: string
      dates: { appointmentId: string; date: string; time?: string | null }[]
    }
    result: AppointmentReview
  }
  ORGANIZATION_SCHEDULE_APPLY: {
    payload: { previewId: string; fingerprint: string; today: string }
    result: Appointment[]
  }
  ORGANIZATION_ROTATION_LIST: {
    payload: { planId?: string }
    result: OrganizationRotation[]
  }
  ORGANIZATION_ROTATION_SAVE: {
    payload: { id?: string; planId: string; name: string; routineIds: string[] }
    result: OrganizationRotation
  }
  ORGANIZATION_ROTATION_SKIP: {
    payload: { rotationId: string; generation: number }
    result: number
  }
  ORGANIZATION_GOAL_LIST: { payload: { planId?: string }; result: OrganizationGoal[] }
  ORGANIZATION_GOAL_SAVE: {
    payload: {
      id?: string
      planId: string
      name: string
      targetCount: number
      filter: OrganizationFilter
      active: boolean
    }
    result: OrganizationGoal
  }
  ORGANIZATION_TODAY: { payload: { today: string }; result: OrganizationTodayItem[] }
  ORGANIZATION_CREDIT_PREVIEW: {
    payload: { workoutId: string }
    result: OrganizationCreditPreview
  }
  ORGANIZATION_PROGRAM_WEEK: {
    payload: { planId: string; date: string }
    result: { week: number; weekStart: string; weekEnd: string }
  }
  ORGANIZATION_REPORT: {
    payload: { startDate: string; endDate: string; today?: string }
    result: OrganizationReport
  }
}

export interface OrganizationReport {
  commitments: Record<AppointmentStatus | 'postponed' | 'overdue', number>
  commitmentTiming: {
    id: string
    status: AppointmentStatus
    originalDate: string
    plannedDate: string
    performedDate: string | null
    postponed: boolean
    overdue: boolean
  }[]
  weeklyGoals: { id: string; name: string; weekStart: string; count: number; target: number }[]
  workingSets: number
  exerciseTonnage: {
    exerciseId: string
    exerciseName: string
    equipment: string
    tonnageKgReps: number
    sets: number
  }[]
  movementPatterns: { pattern: string; sets: number }[]
  primaryMuscles: { muscle: string; sets: number }[]
  secondaryMuscles: { muscle: string; sets: number }[]
  unclassifiedSets: number
  activities: { mode: string; distanceM: number; durationSec: number; items: number }[]
}

export type OrganizationOperation = keyof OrganizationOperationMap
export const ORGANIZATION_OPERATIONS = [
  'ORGANIZATION_PLAN_LIST',
  'ORGANIZATION_PLAN_SAVE',
  'ORGANIZATION_APPOINTMENT_LIST',
  'ORGANIZATION_APPOINTMENT_CREATE',
  'ORGANIZATION_APPOINTMENT_POSTPONE_PREVIEW',
  'ORGANIZATION_APPOINTMENT_POSTPONE',
  'ORGANIZATION_APPOINTMENT_SKIP',
  'ORGANIZATION_RECURRENCE_LIST',
  'ORGANIZATION_RECURRENCE_PREVIEW',
  'ORGANIZATION_RECURRENCE_APPLY',
  'ORGANIZATION_RECONCILE_OPEN',
  'ORGANIZATION_SCHEDULE_PREVIEW',
  'ORGANIZATION_SCHEDULE_APPLY',
  'ORGANIZATION_ROTATION_LIST',
  'ORGANIZATION_ROTATION_SAVE',
  'ORGANIZATION_ROTATION_SKIP',
  'ORGANIZATION_GOAL_LIST',
  'ORGANIZATION_GOAL_SAVE',
  'ORGANIZATION_TODAY',
  'ORGANIZATION_CREDIT_PREVIEW',
  'ORGANIZATION_PROGRAM_WEEK',
  'ORGANIZATION_REPORT',
] as const satisfies readonly OrganizationOperation[]
