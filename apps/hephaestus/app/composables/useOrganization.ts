import { localCalendarDate } from '@habitathq/utils'
import type {
  OrganizationFilter,
  OrganizationOperation,
  OrganizationOperationMap,
} from '~/types/organization'

export function useOrganization() {
  const db = useDatabase()
  async function request<K extends OrganizationOperation>(
    operation: K,
    payload: OrganizationOperationMap[K]['payload'],
  ): Promise<OrganizationOperationMap[K]['result']> {
    return db.organization(operation, payload)
  }
  function copyFilter(filter: OrganizationFilter): OrganizationFilter {
    return {
      sessionTypes: [...filter.sessionTypes],
      exerciseIds: [...filter.exerciseIds],
      movementPatterns: [...filter.movementPatterns],
    }
  }
  return {
    plans: () => request('ORGANIZATION_PLAN_LIST', {}),
    savePlan: (name: string, active = true, startDate = localCalendarDate(), id?: string) =>
      request('ORGANIZATION_PLAN_SAVE', { ...(id ? { id } : {}), name, active, startDate }),
    appointments: (planId?: string) =>
      request('ORGANIZATION_APPOINTMENT_LIST', planId ? { planId } : {}),
    createAppointment: (planId: string, routineId: string, date: string, time?: string | null) =>
      request('ORGANIZATION_APPOINTMENT_CREATE', {
        planId,
        routineId,
        date,
        ...(time === undefined ? {} : { time }),
      }),
    previewPostpone: (appointmentId: string, date: string) =>
      request('ORGANIZATION_APPOINTMENT_POSTPONE_PREVIEW', { appointmentId, date }),
    postpone: (appointmentId: string, date: string, overrideCollision: boolean) =>
      request('ORGANIZATION_APPOINTMENT_POSTPONE', { appointmentId, date, overrideCollision }),
    skipAppointment: (appointmentId: string) =>
      request('ORGANIZATION_APPOINTMENT_SKIP', { appointmentId }),
    recurrences: (planId?: string) =>
      request('ORGANIZATION_RECURRENCE_LIST', planId ? { planId } : {}),
    previewRecurrence: (
      input: OrganizationOperationMap['ORGANIZATION_RECURRENCE_PREVIEW']['payload'],
    ) => request('ORGANIZATION_RECURRENCE_PREVIEW', { ...input, weekdays: [...input.weekdays] }),
    applyRecurrence: (previewId: string, fingerprint: string) =>
      request('ORGANIZATION_RECURRENCE_APPLY', { previewId, fingerprint }),
    reconcileOpen: (today: string) => request('ORGANIZATION_RECONCILE_OPEN', { today }),
    previewSchedule: (
      planId: string,
      dates: { appointmentId: string; date: string; time?: string | null }[],
      today = localCalendarDate(),
    ) =>
      request('ORGANIZATION_SCHEDULE_PREVIEW', {
        planId,
        dates: dates.map((item) => ({ ...item })),
        today,
      }),
    applySchedule: (previewId: string, fingerprint: string, today = localCalendarDate()) =>
      request('ORGANIZATION_SCHEDULE_APPLY', { previewId, fingerprint, today }),
    rotations: (planId?: string) => request('ORGANIZATION_ROTATION_LIST', planId ? { planId } : {}),
    saveRotation: (planId: string, name: string, routineIds: string[], id?: string) =>
      request('ORGANIZATION_ROTATION_SAVE', {
        ...(id ? { id } : {}),
        planId,
        name,
        routineIds: [...routineIds],
      }),
    skipRotation: (rotationId: string, generation: number) =>
      request('ORGANIZATION_ROTATION_SKIP', { rotationId, generation }),
    goals: (planId?: string) => request('ORGANIZATION_GOAL_LIST', planId ? { planId } : {}),
    saveGoal: (
      planId: string,
      name: string,
      targetCount: number,
      filter: OrganizationFilter,
      active = true,
      id?: string,
    ) =>
      request('ORGANIZATION_GOAL_SAVE', {
        ...(id ? { id } : {}),
        planId,
        name,
        targetCount,
        filter: copyFilter(filter),
        active,
      }),
    today: (date: string) => request('ORGANIZATION_TODAY', { today: date }),
    creditPreview: (workoutId: string) => request('ORGANIZATION_CREDIT_PREVIEW', { workoutId }),
    programWeek: (planId: string, date: string) =>
      request('ORGANIZATION_PROGRAM_WEEK', { planId, date }),
    report: (startDate: string, endDate: string, today = localCalendarDate()) =>
      request('ORGANIZATION_REPORT', { startDate, endDate, today }),
  }
}
