import { describe, expect, it } from 'vitest'
import { validatePrescription } from '~/lib/prescription-domain'
import {
  PrescriptionTargetError,
  resolvePrescription,
  validatePrescriptionExpressions,
} from '~/lib/prescription-evaluator'
import type { NumericTarget, SerializablePrescription } from '~/types/prescription'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fixed = (id: string, value: number): NumericTarget => ({ id, rule: { kind: 'fixed', value } })
const formula = (
  id: string,
  source: string,
  variable: string,
  targetId: string,
  field: 'weightKg' | 'reps' = 'weightKg',
): NumericTarget => ({
  id,
  rule: {
    kind: 'formula',
    source,
    resultType: field === 'reps' ? 'integer' : 'number',
    evaluatorVersion: 'cel-js-8.0.0-js-number-v1',
    bindings: [{ id: uuid(50), variable, source: { kind: 'target', targetId, field: 'weightKg' } }],
  },
})
function prescription(target: NumericTarget): SerializablePrescription {
  return {
    schemaVersion: 1,
    evaluatorVersion: 'cel-js-8.0.0-js-number-v1',
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
    defaults: { incrementKg: 2.5, restSec: 90 },
    inputs: [
      {
        id: uuid(40),
        name: 'Use heavier load',
        field: 'boolean',
        required: true,
        defaultValue: true,
        minimum: null,
        maximum: null,
        integer: false,
      },
    ],
    groups: [],
    activities: [
      {
        id: uuid(1),
        exerciseId: uuid(2),
        order: 1,
        loggingMode: 'strength',
        executionGroupId: null,
        notes: null,
        targets: { durationSec: null, distanceM: null },
        sets: [
          {
            id: uuid(3),
            order: 1,
            role: 'working',
            reps: { kind: 'exact', value: fixed(uuid(4), 8) },
            weightKg: fixed(uuid(5), 60),
            restSec: null,
            rpe: null,
            rir: null,
            notes: null,
            legacyScheme: null,
          },
          {
            id: uuid(6),
            order: 2,
            role: 'working',
            reps: null,
            weightKg: target,
            restSec: null,
            rpe: null,
            rir: null,
            notes: null,
            legacyScheme: null,
          },
        ],
      },
    ],
  }
}

function fixtureValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing evaluator fixture ${label}`)
  return value
}

function setAt(value: SerializablePrescription, index: number) {
  const activity = fixtureValue(value.activities[0], 'activity')
  return fixtureValue(activity.sets[index], `set ${index}`)
}

function weightAt(value: SerializablePrescription, index: number) {
  return fixtureValue(setAt(value, index).weightKg, `weight target for set ${index}`)
}

function bindingAt(target: NumericTarget, index: number) {
  if (target.rule.kind !== 'formula') throw new Error('expected formula target')
  return fixtureValue(target.rule.bindings[index], `formula binding ${index}`)
}

describe('restricted prescription CEL evaluator', () => {
  it('resolves a forward target reference and conditional boolean binding without changing the source', () => {
    const value = prescription(
      formula(uuid(7), 'heavy ? base * 0.9 : base * 0.8', 'heavy', uuid(5)),
    )
    const rule = weightAt(value, 1).rule
    if (rule.kind !== 'formula') throw new Error('expected formula')
    bindingAt(weightAt(value, 1), 0).source = { kind: 'input', inputId: uuid(40) }
    rule.bindings.push({
      id: uuid(51),
      variable: 'base',
      source: { kind: 'target', targetId: uuid(5), field: 'weightKg' },
    })
    const resolved = resolvePrescription(value, { [uuid(40)]: true })
    expect(weightAt(resolved, 1).resolvedValue).toBe(54)
    expect(weightAt(resolved, 0).resolvedValue).toBe(60)
    expect(weightAt(value, 1).resolvedValue).toBeUndefined()
  })

  it.each(['base * true', '[base]', 'base / 0'])(
    'attributes invalid formula %s to the target without changing authored values',
    (source) => {
      const value = prescription(formula(uuid(7), source, 'base', uuid(5)))
      const authored = structuredClone(value)
      expect(() => resolvePrescription(value, { [uuid(40)]: true })).toThrow(
        expect.objectContaining({ targetId: uuid(7), name: 'PrescriptionTargetError' }),
      )
      expect(value).toEqual(authored)
      if (source !== 'base / 0') {
        expect(() => validatePrescriptionExpressions(value)).toThrow(PrescriptionTargetError)
      }
    },
  )

  it('uses the explicit bounded roundLoad helper', () => {
    const value = prescription(formula(uuid(7), 'roundLoad(base * 0.91, 2.5)', 'base', uuid(5)))
    const resolved = resolvePrescription(value, { [uuid(40)]: true })
    expect(weightAt(resolved, 1).resolvedValue).toBe(55)
  })

  it.each([
    '[1, 2][0]',
    'base.constructor',
    'unknown + 1',
    'size([1, 2])',
    'base / 0',
    'min(base)',
    'abs(base, 1)',
  ])('rejects unsupported or non-finite CEL expression %s', (source) => {
    const value = prescription(formula(uuid(7), source, 'base', uuid(5)))
    expect(() => resolvePrescription(value, { [uuid(40)]: true })).toThrow()
  })

  it('rejects a target dependency cycle before returning a partial recipe', () => {
    const value = prescription(formula(uuid(7), 'other + 1', 'other', uuid(5)))
    setAt(value, 0).weightKg = formula(uuid(5), 'other + 1', 'other', uuid(7))
    const secondRule = weightAt(value, 1).rule
    if (secondRule.kind !== 'formula') throw new Error('expected formula')
    bindingAt(weightAt(value, 1), 0).id = uuid(51)
    expect(() => resolvePrescription(value, { [uuid(40)]: true })).toThrow(/cycle/i)
  })
  it('preserves absent effort targets and range bounds during resolution', () => {
    const value = prescription(fixed(uuid(7), 42))
    const set = setAt(value, 1)
    set.reps = { kind: 'range', minimum: 6, maximum: 10 }
    set.rpe = null
    set.rir = null
    const resolved = resolvePrescription(value, { [uuid(40)]: true })
    const result = setAt(resolved, 1)
    expect(result.reps).toEqual({ kind: 'range', minimum: 6, maximum: 10 })
    expect(result.rpe).toBeNull()
    expect(result.rir).toBeNull()
  })

  it('rejects a formula reference whose declared field differs from the referenced target', () => {
    const value = prescription(formula(uuid(7), 'base + 1', 'base', uuid(5)))
    const target = weightAt(value, 1)
    if (target.rule.kind !== 'formula') throw new Error('expected formula')
    bindingAt(target, 0).source = { kind: 'target', targetId: uuid(4), field: 'weightKg' }
    expect(() => validatePrescription(value)).toThrow()
  })
})
