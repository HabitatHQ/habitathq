import { describe, expect, it } from 'vitest'
import {
  canonicalTargetValue,
  displayTargetValue,
  duplicatePrescriptionSet,
  setSummary,
} from '~/lib/prescription-presentation'
import type { PrescriptionSet } from '~/types/prescription'

const source: PrescriptionSet = {
  id: 'set-source',
  order: 2,
  role: 'working',
  reps: {
    kind: 'exact',
    value: { id: 'reps-source', rule: { kind: 'fixed', value: 8 }, resolvedValue: 8 },
  },
  weightKg: { id: 'weight-source', rule: { kind: 'fixed', value: 60 }, resolvedValue: 60 },
  restSec: {
    id: 'rest-source',
    rule: {
      kind: 'formula',
      source: 'load / 2',
      resultType: 'number',
      evaluatorVersion: 'cel-js-8.0.0-js-number-v1',
      bindings: [
        {
          id: 'binding-source',
          variable: 'load',
          source: { kind: 'target', targetId: 'weight-source', field: 'weightKg' },
        },
      ],
    },
  },
  rpe: { id: 'rpe-source', rule: { kind: 'fixed', value: 8 }, resolvedValue: 8 },
  rir: null,
  notes: null,
  legacyScheme: null,
}

describe('prescription presentation helpers', () => {
  it('duplicates set identity while preserving values and remapping intra-set formula references', () => {
    let next = 0
    const copy = duplicatePrescriptionSet(source, 3, () => `copy-${++next}`)
    expect(copy.order).toBe(3)
    expect(copy.weightKg?.id).not.toBe(source.weightKg?.id)
    expect(copy.weightKg?.rule).toEqual(source.weightKg?.rule)
    expect(copy.restSec?.rule.kind).toBe('formula')
    if (copy.restSec?.rule.kind !== 'formula') throw new Error('Expected formula target')
    expect(copy.restSec.rule.bindings[0]?.source).toEqual({
      kind: 'target',
      targetId: copy.weightKg?.id,
      field: 'weightKg',
    })
    expect(copy.restSec.rule.bindings[0]?.id).not.toBe('binding-source')
    expect(source.weightKg?.id).toBe('weight-source')
  })

  it('formats the same prescription with unit-boundary precision and selected effort fields', () => {
    expect(displayTargetValue(60, 'weightKg', 'lbs', 'km')).toBe(132.277)
    expect(
      canonicalTargetValue(
        displayTargetValue(60, 'weightKg', 'lbs', 'km'),
        'weightKg',
        'lbs',
        'km',
      ),
    ).toBeCloseTo(60, 2)
    expect(displayTargetValue(1609.344, 'distanceM', 'kg', 'mi')).toBe(1)
    expect(canonicalTargetValue(1, 'distanceM', 'kg', 'mi')).toBe(1609.344)
    expect(setSummary(source, 'kg', { showRpe: false, showRir: false })).toContain(
      'Set 2 · 60 kg · 8 reps',
    )
    expect(setSummary(source, 'kg', { showRpe: false, showRir: false })).not.toContain('RPE')
    expect(setSummary(source, 'kg', { showRpe: true, showRir: false })).toContain('RPE 8')
  })
})
