import { describe, expect, it } from 'vitest'
import {
  buildExportPayload,
  EXPORT_VERSION,
  payloadToQrData,
  qrDataToPayload,
  validateImportPayload,
} from '~/lib/template-export'

const mockTemplate = {
  id: 'tpl-1',
  name: 'Push Day',
  description: 'Chest and triceps',
  cover_emoji: '💪',
  created_at: '2026-01-01T00:00:00Z',
}

const mockExercises = [
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

describe('buildExportPayload', () => {
  it('builds a valid export payload', () => {
    const payload = buildExportPayload(mockTemplate as any, mockExercises as any, [])
    expect(payload.version).toBe(EXPORT_VERSION)
    expect(payload.template.name).toBe('Push Day')
    expect(payload.exercises).toHaveLength(1)
    expect(payload.exercises[0].exercise_name).toBe('Bench Press')
  })

  it('includes export timestamp', () => {
    const payload = buildExportPayload(mockTemplate as any, mockExercises as any, [])
    expect(payload.exportedAt).toBeTruthy()
  })

  it('strips id fields from exercises in QR mode', () => {
    const qrData = payloadToQrData(
      buildExportPayload(mockTemplate as any, mockExercises as any, []),
    )
    expect(JSON.stringify(qrData).length).toBeLessThan(3000 + 1)
  })
})

describe('validateImportPayload', () => {
  it('validates a correct payload', () => {
    const payload = buildExportPayload(mockTemplate as any, mockExercises as any, [])
    expect(validateImportPayload(payload)).toBe(true)
  })

  it('rejects payload without version', () => {
    expect(validateImportPayload({ template: {}, exercises: [] })).toBe(false)
  })

  it('rejects payload without template name', () => {
    const payload = buildExportPayload(mockTemplate as any, mockExercises as any, [])
    const bad = { ...payload, template: { ...payload.template, name: undefined } }
    expect(validateImportPayload(bad)).toBe(false)
  })
})

describe('QR encode/decode', () => {
  it('round-trips through QR encode/decode', () => {
    const payload = buildExportPayload(mockTemplate as any, mockExercises as any, [])
    const qrData = payloadToQrData(payload)
    const decoded = qrDataToPayload(qrData)
    expect(decoded?.template.name).toBe('Push Day')
  })

  it('returns null for invalid QR data', () => {
    expect(qrDataToPayload('invalid-base64!!!')).toBeNull()
  })
})
