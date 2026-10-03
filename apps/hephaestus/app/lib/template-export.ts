export interface LegacyTemplatePayload {
  version: 2
  exportedAt: string
  template: Record<string, unknown> & { name: string }
  exercises: Array<
    Record<string, unknown> & {
      exercise_name: string
      exercise_movement: string
      order_num: number
    }
  >
  groups: Array<Record<string, unknown> & { group_id: string; label: string }>
}

const templateKeys = [
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
]
const exerciseKeys = [
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
]
const groupKeys = [
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
]
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

/** Read adapter for the retired v2 single-template JSON format. */
export function parseLegacyTemplatePayload(value: unknown): LegacyTemplatePayload | null {
  if (
    !object(value) ||
    Object.keys(value).length !== 5 ||
    value['version'] !== 2 ||
    typeof value['exportedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['exportedAt'])) ||
    !object(value['template']) ||
    !exactKeys(value['template'], templateKeys) ||
    typeof value['template']['name'] !== 'string' ||
    !value['template']['name'].trim() ||
    !nullableString(value['template']['description']) ||
    typeof value['template']['created_at'] !== 'string' ||
    !Number.isFinite(Date.parse(value['template']['created_at'])) ||
    !Array.isArray(value['exercises']) ||
    !Array.isArray(value['groups'])
  )
    return null
  const template = value['template']
  if (
    !(template['archived_at'] === null || typeof template['archived_at'] === 'string') ||
    !Number.isInteger(template['sort_order']) ||
    !(template['pinned_at'] === null || typeof template['pinned_at'] === 'string') ||
    !(template['last_used_at'] === null || typeof template['last_used_at'] === 'string') ||
    !Number.isInteger(template['use_count']) ||
    !nullableString(template['cover_emoji']) ||
    !(template['scheduled_days'] === null || typeof template['scheduled_days'] === 'string') ||
    (template['notification_enabled'] !== 0 && template['notification_enabled'] !== 1) ||
    !(template['notification_time'] === null || typeof template['notification_time'] === 'string')
  )
    return null
  const exercises = value['exercises']
  if (
    !exercises.every(
      (item) =>
        object(item) &&
        exactKeys(item, exerciseKeys) &&
        typeof item['exercise_name'] === 'string' &&
        item['exercise_name'].trim() &&
        typeof item['exercise_movement'] === 'string' &&
        item['exercise_movement'] &&
        Number.isInteger(item['order_num']) &&
        (item['sets_planned'] === null || Number.isInteger(item['sets_planned'])) &&
        nullableString(item['reps_planned']) &&
        (item['rpe_target'] === null || finite(item['rpe_target'])) &&
        finite(item['increment_kg']) &&
        item['increment_kg'] >= 0 &&
        finite(item['rest_seconds']) &&
        item['rest_seconds'] >= 0 &&
        nullableString(item['set_rest_seconds']) &&
        (item['transition_rest_sec'] === null || finite(item['transition_rest_sec'])) &&
        (item['warmup_counts'] === 0 || item['warmup_counts'] === 1) &&
        nullableString(item['set_scheme']) &&
        nullableString(item['notes']) &&
        (item['failure_target'] === 0 || item['failure_target'] === 1) &&
        nullableString(item['rpe_targets']) &&
        nullableString(item['progression_rule']) &&
        (item['deload_template_id'] === null || typeof item['deload_template_id'] === 'string') &&
        nullableString(item['substitutes']) &&
        nullableString(item['tempo']) &&
        nullableString(item['resistance_note']) &&
        (item['unilateral'] === 0 || item['unilateral'] === 1) &&
        nullableString(item['superset_group']),
    )
  )
    return null
  const groups = value['groups']
  if (
    !groups.every(
      (item) =>
        object(item) &&
        exactKeys(item, groupKeys) &&
        typeof item['group_id'] === 'string' &&
        item['group_id'] &&
        typeof item['label'] === 'string' &&
        item['label'] &&
        nullableString(item['name']) &&
        ['superset', 'giant_set', 'circuit', 'pre_exhaust'].includes(String(item['group_type'])) &&
        finite(item['transition_rest_sec']) &&
        finite(item['rest_after_round_sec']) &&
        ['after_round', 'after_each'].includes(String(item['circuit_rest_mode'])) &&
        Number.isInteger(item['sort_order']) &&
        nullableString(item['display_name']) &&
        Number.isInteger(item['rounds']) &&
        Number(item['rounds']) > 0 &&
        (item['amrap'] === 0 || item['amrap'] === 1) &&
        (item['time_cap_sec'] === null || finite(item['time_cap_sec'])),
    )
  )
    return null
  return value as unknown as LegacyTemplatePayload
}
