import { type EquipmentProfile, roundToAvailableLoad } from '~/lib/equipment'
import type { SetRow } from '~/types/database'

export interface ProgressionSuggestion {
  weightKg: number
  reason: string
  editable: true
}

/** Suggest a weight progression based on average working RPE vs target. */
export function suggestProgression(
  sets: SetRow[],
  targetRpe: number,
  lastWeight: number,
  incrementKg: number,
): number | null {
  const workingSets = sets.filter((s) => s.is_warmup === 0 && s.completed === 1 && s.rpe !== null)
  if (workingSets.length === 0) return null
  const avgRpe = workingSets.reduce((sum, s) => sum + (s.rpe ?? 0), 0) / workingSets.length
  return avgRpe < targetRpe - 1.0 ? lastWeight + incrementKg : null
}

export function explainProgression(
  sets: SetRow[],
  targetRpe: number,
  lastWeightKg: number,
  incrementKg: number,
): ProgressionSuggestion | null {
  const suggestion = suggestProgression(sets, targetRpe, lastWeightKg, incrementKg)
  if (suggestion == null) return null
  const workingRpes = sets
    .filter((set) => set.is_warmup === 0 && set.completed === 1 && set.rpe != null)
    .map((set) => set.rpe as number)
  const average = workingRpes.reduce((sum, rpe) => sum + rpe, 0) / workingRpes.length
  return {
    weightKg: suggestion,
    reason: `Average working-set RPE ${average.toFixed(1)} was below target ${targetRpe.toFixed(1)} by more than 1.`,
    editable: true,
  }
}

export function applyProgramIntensity(weightKg: number, modifier: number): number {
  if (!Number.isFinite(weightKg) || weightKg < 0 || !Number.isFinite(modifier) || modifier <= 0) {
    throw new Error('Weight and intensity modifier must be positive finite values')
  }
  return weightKg * modifier
}

export function applyProgramVolume(sets: number, modifier: number): number {
  if (!Number.isInteger(sets) || sets < 0 || !Number.isFinite(modifier) || modifier < 0) {
    throw new Error('Set count and volume modifier are invalid')
  }
  return Math.max(0, Math.round(sets * modifier))
}

export interface HistoricalWeightSuggestionInput {
  completedSessions: SetRow[][]
  lastWeightKg: number | null
  targetRpe: number
  incrementKg: number
  intensityModifier: number
  equipmentProfile?: Pick<
    EquipmentProfile,
    'minimum_kg' | 'increment_kg' | 'maximum_kg' | 'additional_loads_kg'
  > | null
}

export interface HistoricalWeightSuggestion {
  weightKg: number | null
  reason: string
  editable: boolean
  enabled: boolean
}

/** Build one editable load suggestion from the latest completed-session performance. */
export function historicalWeightSuggestion(
  input: HistoricalWeightSuggestionInput,
): HistoricalWeightSuggestion {
  const sessionSets = input.completedSessions[0] ?? []
  if (sessionSets.length === 0 || input.lastWeightKg == null) {
    return {
      weightKg: null,
      reason: 'Log a completed workout to get a progression suggestion.',
      editable: false,
      enabled: false,
    }
  }
  const baseWeight = suggestProgression(
    sessionSets,
    input.targetRpe,
    input.lastWeightKg,
    input.incrementKg,
  )
  if (baseWeight == null) {
    return {
      weightKg: null,
      reason: 'Recent working-set effort does not support increasing the load yet.',
      editable: false,
      enabled: false,
    }
  }
  const intensityAdjusted = applyProgramIntensity(baseWeight, input.intensityModifier)
  const equipmentProfile = input.equipmentProfile ?? {
    minimum_kg: 0,
    increment_kg: input.incrementKg,
    maximum_kg: null,
    additional_loads_kg: [],
  }
  const weightKg = roundToAvailableLoad(intensityAdjusted, equipmentProfile)
  return {
    weightKg,
    reason: `Latest completed-session RPE supports progression; ${input.intensityModifier.toFixed(2)}× program intensity applied once${input.equipmentProfile ? ' and rounded to configured equipment loads' : ''}.`,
    editable: true,
    enabled: true,
  }
}
