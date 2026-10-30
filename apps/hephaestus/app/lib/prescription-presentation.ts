import type { PrescriptionInputField, PrescriptionSet } from '../types/prescription'
import { fromKilograms, toKilograms } from './equipment'
import { formatWeight } from './format'

export function fieldLabel(
  field: PrescriptionInputField,
  unit: 'kg' | 'lbs',
  distance: 'km' | 'mi',
): string {
  return {
    weightKg: `Load (${unit})`,
    distanceM: `Distance (${distance})`,
    durationSec: 'Duration (seconds)',
    restSec: 'Rest (seconds)',
    reps: 'Reps',
    rpe: 'RPE',
    rir: 'RIR',
    scalar: 'Number',
    boolean: 'Yes / no',
  }[field]
}

export function displayTargetValue(
  value: number,
  field: PrescriptionInputField,
  unit: 'kg' | 'lbs',
  distance: 'km' | 'mi',
): number {
  if (field === 'weightKg') return Number(fromKilograms(value, unit).toFixed(3))
  if (field === 'distanceM')
    return Number((value / (distance === 'mi' ? 1609.344 : 1000)).toFixed(4))
  return value
}

export function canonicalTargetValue(
  value: number,
  field: PrescriptionInputField,
  unit: 'kg' | 'lbs',
  distance: 'km' | 'mi',
): number {
  if (field === 'weightKg') return toKilograms(value, unit)
  if (field === 'distanceM') return value * (distance === 'mi' ? 1609.344 : 1000)
  return value
}

export function setSummary(
  set: PrescriptionSet,
  unit: 'kg' | 'lbs',
  effort: { showRpe: boolean; showRir: boolean },
): string {
  const parts = [`Set ${set.order}`]
  if (set.role !== 'working')
    parts.push({ warm_up: 'Warm-up', top: 'Top set', back_off: 'Back-off' }[set.role])
  if (set.weightKg)
    parts.push(
      set.weightKg.resolvedValue === undefined
        ? 'Load needs configuration'
        : formatWeight(set.weightKg.resolvedValue, unit),
    )
  if (set.reps?.kind === 'exact') parts.push(`${set.reps.value.resolvedValue ?? 'Configure'} reps`)
  else if (set.reps?.kind === 'range') parts.push(`${set.reps.minimum}–${set.reps.maximum} reps`)
  else if (set.reps?.kind === 'minimum') parts.push(`${set.reps.minimum}+ reps`)
  if (set.restSec?.resolvedValue !== undefined) parts.push(`${set.restSec.resolvedValue}s rest`)
  if (effort.showRpe && set.rpe?.resolvedValue !== undefined)
    parts.push(`RPE ${set.rpe.resolvedValue}`)
  if (effort.showRir && set.rir?.resolvedValue !== undefined)
    parts.push(`RIR ${set.rir.resolvedValue}`)
  return parts.join(' · ')
}

// A duplicated set owns new identities, including references between its own targets.
// References to targets in other sets intentionally continue to refer to those targets.
export function duplicatePrescriptionSet(
  source: PrescriptionSet,
  order: number,
  uid: () => string,
): PrescriptionSet {
  const copy = structuredClone(source)
  copy.id = uid()
  copy.order = order
  const targets = [
    copy.weightKg,
    copy.restSec,
    copy.rpe,
    copy.rir,
    copy.reps?.kind === 'exact' ? copy.reps.value : null,
  ].filter((target) => target !== null)
  const identities = new Map(targets.map((target) => [target.id, uid()]))
  for (const target of targets) {
    const identity = identities.get(target.id)
    if (identity === undefined) throw new Error('Duplicated target identity is missing')
    target.id = identity
    if (target.rule.kind === 'formula')
      for (const binding of target.rule.bindings) {
        binding.id = uid()
        if (binding.source.kind === 'target')
          binding.source.targetId =
            identities.get(binding.source.targetId) ?? binding.source.targetId
      }
  }
  return copy
}
