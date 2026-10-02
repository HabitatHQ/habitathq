import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import type { TemplateGroupRow, TemplateRow } from '~/types/database'

export const EXPORT_VERSION = 2

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableTimestamp(value: unknown): boolean {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function isScheduledDays(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(value)
    return (
      Array.isArray(parsed) &&
      parsed.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      new Set(parsed).size === parsed.length
    )
  } catch {
    return false
  }
}

function isNullableJsonStringArray(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(value)
    return (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string' && entry.length > 0) &&
      new Set(parsed).size === parsed.length
    )
  } catch {
    return false
  }
}

export interface ExportPayload {
  version: number
  exportedAt: string
  template: {
    name: string
    description: string | null
    created_at: string
    archived_at: string | null
    sort_order: number
    pinned_at: string | null
    last_used_at: string | null
    use_count: number
    cover_emoji: string | null
    scheduled_days: string | null
    notification_enabled: 0 | 1
    notification_time: string | null
  }
  exercises: Array<{
    exercise_name: string
    exercise_movement: string
    order_num: number
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
    rpe_targets: string | null
    progression_rule: string | null
    deload_template_id: string | null
    substitutes: string | null
    tempo: string | null
    resistance_note: string | null
    unilateral: 0 | 1
    superset_group: string | null
  }>
  groups: Array<{
    group_id: string
    label: string
    name: string | null
    group_type: string
    transition_rest_sec: number
    rest_after_round_sec: number
    circuit_rest_mode: string
    sort_order: number
    display_name: string | null
    rounds: number
    amrap: 0 | 1
    time_cap_sec: number | null
  }>
}

export function buildExportPayload(
  template: TemplateRow,
  exercises: TemplateExerciseWithName[],
  groups: TemplateGroupRow[],
): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    template: {
      name: template.name,
      description: template.description,
      created_at: template.created_at,
      archived_at: template.archived_at,
      sort_order: template.sort_order,
      pinned_at: template.pinned_at,
      last_used_at: template.last_used_at,
      use_count: template.use_count,
      cover_emoji: template.cover_emoji,
      scheduled_days: template.scheduled_days,
      notification_enabled: template.notification_enabled,
      notification_time: template.notification_time,
    },
    exercises: exercises.map((ex) => ({
      exercise_name: ex.exercise_name,
      exercise_movement: ex.exercise_movement,
      order_num: ex.order_num,
      sets_planned: ex.sets_planned,
      reps_planned: ex.reps_planned,
      rpe_target: ex.rpe_target,
      increment_kg: ex.increment_kg,
      rest_seconds: ex.rest_seconds,
      set_rest_seconds: ex.set_rest_seconds,
      transition_rest_sec: ex.transition_rest_sec,
      warmup_counts: ex.warmup_counts,
      set_scheme: ex.set_scheme,
      notes: ex.notes,
      failure_target: ex.failure_target,
      rpe_targets: ex.rpe_targets,
      progression_rule: ex.progression_rule,
      deload_template_id: ex.deload_template_id,
      substitutes: ex.substitutes,
      tempo: ex.tempo,
      resistance_note: ex.resistance_note,
      unilateral: ex.unilateral,
      superset_group: ex.superset_group,
    })),
    groups: groups.map((g) => ({
      group_id: g.id,
      label: g.label,
      name: g.name,
      group_type: g.group_type,
      transition_rest_sec: g.transition_rest_sec,
      rest_after_round_sec: g.rest_after_round_sec,
      circuit_rest_mode: g.circuit_rest_mode,
      sort_order: g.sort_order,
      display_name: g.display_name,
      rounds: g.rounds,
      amrap: g.amrap,
      time_cap_sec: g.time_cap_sec,
    })),
  }
}

const IMPORT_PAYLOAD_KEYS = ['version', 'exportedAt', 'template', 'exercises', 'groups'] as const
const IMPORT_TEMPLATE_KEYS = [
  'name',
  'description',
  'created_at',
  'archived_at',
  'sort_order',
  'pinned_at',
  'last_used_at',
  'use_count',
  'cover_emoji',
  'scheduled_days',
  'notification_enabled',
  'notification_time',
] as const
const IMPORT_EXERCISE_KEYS = [
  'exercise_name',
  'exercise_movement',
  'order_num',
  'sets_planned',
  'reps_planned',
  'rpe_target',
  'increment_kg',
  'rest_seconds',
  'set_rest_seconds',
  'transition_rest_sec',
  'warmup_counts',
  'set_scheme',
  'notes',
  'failure_target',
  'rpe_targets',
  'progression_rule',
  'deload_template_id',
  'substitutes',
  'tempo',
  'resistance_note',
  'unilateral',
  'superset_group',
] as const
const IMPORT_GROUP_KEYS = [
  'group_id',
  'label',
  'name',
  'group_type',
  'transition_rest_sec',
  'rest_after_round_sec',
  'circuit_rest_mode',
  'sort_order',
  'display_name',
  'rounds',
  'amrap',
  'time_cap_sec',
] as const

function isImportObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isBinaryFlag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isImportTemplate(value: unknown): value is ExportPayload['template'] {
  if (!isImportObject(value) || !hasExactKeys(value, IMPORT_TEMPLATE_KEYS)) return false
  return (
    typeof value['name'] === 'string' &&
    value['name'].trim().length > 0 &&
    isNullableString(value['description']) &&
    typeof value['created_at'] === 'string' &&
    Number.isFinite(Date.parse(value['created_at'])) &&
    isNullableTimestamp(value['archived_at']) &&
    Number.isInteger(value['sort_order']) &&
    isNullableTimestamp(value['pinned_at']) &&
    isNullableTimestamp(value['last_used_at']) &&
    isNonnegativeInteger(value['use_count']) &&
    isNullableString(value['cover_emoji']) &&
    isScheduledDays(value['scheduled_days']) &&
    isBinaryFlag(value['notification_enabled']) &&
    (value['notification_time'] === null ||
      (typeof value['notification_time'] === 'string' &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value['notification_time'])))
  )
}

function hasValidExercisePlan(value: Record<string, unknown>): boolean {
  return (
    isNonnegativeInteger(value['order_num']) &&
    (value['sets_planned'] === null || isNonnegativeInteger(value['sets_planned'])) &&
    isNullableString(value['reps_planned']) &&
    (value['rpe_target'] === null || isFiniteNumber(value['rpe_target'])) &&
    isNonnegativeFiniteNumber(value['increment_kg']) &&
    isNonnegativeFiniteNumber(value['rest_seconds']) &&
    isNullableString(value['set_rest_seconds']) &&
    (value['transition_rest_sec'] === null ||
      isNonnegativeFiniteNumber(value['transition_rest_sec']))
  )
}

function hasValidExerciseOptions(value: Record<string, unknown>): boolean {
  return (
    isBinaryFlag(value['warmup_counts']) &&
    isNullableString(value['set_scheme']) &&
    isNullableString(value['notes']) &&
    isBinaryFlag(value['failure_target']) &&
    isNullableString(value['rpe_targets']) &&
    isNullableString(value['progression_rule']) &&
    isNullableString(value['deload_template_id']) &&
    isNullableJsonStringArray(value['substitutes']) &&
    isNullableString(value['tempo']) &&
    isNullableString(value['resistance_note']) &&
    isBinaryFlag(value['unilateral']) &&
    isNullableString(value['superset_group'])
  )
}

function isImportExercise(value: unknown): value is ExportPayload['exercises'][number] {
  if (!isImportObject(value) || !hasExactKeys(value, IMPORT_EXERCISE_KEYS)) return false
  return (
    typeof value['exercise_name'] === 'string' &&
    value['exercise_name'].trim().length > 0 &&
    typeof value['exercise_movement'] === 'string' &&
    value['exercise_movement'].length > 0 &&
    hasValidExercisePlan(value) &&
    hasValidExerciseOptions(value)
  )
}

function hasValidGroupTiming(value: Record<string, unknown>): boolean {
  return (
    isNonnegativeInteger(value['transition_rest_sec']) &&
    isNonnegativeInteger(value['rest_after_round_sec']) &&
    ['after_round', 'after_each'].includes(String(value['circuit_rest_mode'])) &&
    Number.isInteger(value['sort_order']) &&
    Number.isInteger(value['rounds']) &&
    Number(value['rounds']) >= 1 &&
    isBinaryFlag(value['amrap']) &&
    (value['time_cap_sec'] === null || isNonnegativeInteger(value['time_cap_sec']))
  )
}

function isImportGroup(value: unknown): value is ExportPayload['groups'][number] {
  if (!isImportObject(value) || !hasExactKeys(value, IMPORT_GROUP_KEYS)) return false
  return (
    typeof value['group_id'] === 'string' &&
    value['group_id'].length > 0 &&
    typeof value['label'] === 'string' &&
    value['label'].length > 0 &&
    isNullableString(value['name']) &&
    ['superset', 'giant_set', 'circuit', 'pre_exhaust'].includes(String(value['group_type'])) &&
    isNullableString(value['display_name']) &&
    hasValidGroupTiming(value)
  )
}

export function validateImportPayload(payload: unknown): payload is ExportPayload {
  if (!isImportObject(payload) || !hasExactKeys(payload, IMPORT_PAYLOAD_KEYS)) return false
  return (
    payload['version'] === EXPORT_VERSION &&
    typeof payload['exportedAt'] === 'string' &&
    Number.isFinite(Date.parse(payload['exportedAt'])) &&
    isImportTemplate(payload['template']) &&
    Array.isArray(payload['exercises']) &&
    payload['exercises'].every(isImportExercise) &&
    Array.isArray(payload['groups']) &&
    payload['groups'].every(isImportGroup)
  )
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Encode the complete, versioned template payload for QR transfer. */
export function payloadToQrData(payload: ExportPayload): string {
  return utf8ToBase64(JSON.stringify(payload))
}

/** Decode and validate a complete QR template payload without inventing defaults. */
export function qrDataToPayload(data: string): ExportPayload | null {
  try {
    const parsed: unknown = JSON.parse(base64ToUtf8(data))
    return validateImportPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}
