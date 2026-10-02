import { describe, expect, it } from 'vitest'
import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import {
  buildExportPayload,
  EXPORT_VERSION,
  payloadToQrData,
  qrDataToPayload,
  validateImportPayload,
} from '~/lib/template-export'
import type { TemplateGroupRow, TemplateRow } from '~/types/database'

const mockTemplate: TemplateRow = {
  id: 'tpl-1',
  name: 'Push Day',
  description: 'Chest and triceps',
  cover_emoji: '💪',
  created_at: '2026-01-01T00:00:00Z',
  archived_at: null,
  sort_order: 0,
  pinned_at: null,
  last_used_at: null,
  use_count: 0,
  scheduled_days: null,
  notification_enabled: 0,
  notification_time: null,
}

const mockExercises: TemplateExerciseWithName[] = [
  {
    id: 'te-1',
    template_id: 'tpl-1',
    exercise_id: 'ex-1',
    order_num: 1,
    sets_planned: 3,
    reps_planned: '8',
    rest_seconds: 120,
    exercise_name: 'Bench Press',
    exercise_movement: 'press',
    exercise_icon: null,
    superset_group: null,
    rpe_target: null,
    increment_kg: 2.5,
    set_rest_seconds: null,
    transition_rest_sec: null,
    warmup_counts: 0 as const,
    set_scheme: null,
    notes: null,
    failure_target: 0 as const,
    rpe_targets: null,
    progression_rule: null,
    deload_template_id: null,
    substitutes: null,
    tempo: null,
    resistance_note: null,
    unilateral: 0 as const,
  },
]

const mockGroups: TemplateGroupRow[] = [
  {
    id: 'group-1',
    template_id: 'tpl-1',
    label: 'A',
    name: 'Press circuit',
    group_type: 'circuit',
    transition_rest_sec: 20,
    rest_after_round_sec: 90,
    circuit_rest_mode: 'after_round',
    sort_order: 1,
    display_name: 'Press circuit',
    rounds: 3,
    amrap: 1,
    time_cap_sec: 600,
  },
]

describe('buildExportPayload', () => {
  it('builds a valid export payload', () => {
    const payload = buildExportPayload(mockTemplate, mockExercises, mockGroups)
    expect(payload.version).toBe(EXPORT_VERSION)
    expect(payload.template.name).toBe('Push Day')
    expect(payload.exercises).toHaveLength(1)
    expect(payload.exercises[0].exercise_name).toBe('Bench Press')
    expect(payload.groups[0]).toMatchObject({
      name: 'Press circuit',
      transition_rest_sec: 20,
      rest_after_round_sec: 90,
      circuit_rest_mode: 'after_round',
      sort_order: 1,
      amrap: 1,
      time_cap_sec: 600,
    })
  })

  it('includes export timestamp', () => {
    const payload = buildExportPayload(mockTemplate, mockExercises, mockGroups)
    expect(payload.exportedAt).toBeTruthy()
  })

  it('keeps a one-exercise full payload below the existing QR size guard', () => {
    const qrData = payloadToQrData(buildExportPayload(mockTemplate, mockExercises, mockGroups))
    expect(JSON.stringify(qrData).length).toBeLessThan(3000 + 1)
  })
})

describe('validateImportPayload', () => {
  it('validates a correct payload', () => {
    const payload = buildExportPayload(mockTemplate, mockExercises, mockGroups)
    expect(validateImportPayload(payload)).toBe(true)
  })

  it('rejects payload without version', () => {
    expect(validateImportPayload({ template: {}, exercises: [] })).toBe(false)
  })

  it('rejects payload without template name', () => {
    const payload = buildExportPayload(mockTemplate, mockExercises, mockGroups)
    const bad = { ...payload, template: { ...payload.template, name: undefined } }
    expect(validateImportPayload(bad)).toBe(false)
  })
})

describe('QR encode/decode', () => {
  it('round-trips every exported field through QR encode/decode', () => {
    const payload = buildExportPayload(mockTemplate, mockExercises, mockGroups)
    const decoded = qrDataToPayload(payloadToQrData(payload))
    expect(decoded).toEqual(payload)
  })

  it('returns null for invalid QR data', () => {
    expect(qrDataToPayload('invalid-base64!!!')).toBeNull()
  })
})
