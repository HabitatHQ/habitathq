export interface EquipmentProfile {
  exercise_id: string
  minimum_kg: number
  increment_kg: number
  maximum_kg: number | null
  additional_loads_kg: string | number[]
  updated_at: string
}

const KG_PER_LB = 0.45359237
const LOAD_PRECISION = 1000

type EquipmentLoadProfile = Pick<
  EquipmentProfile,
  'minimum_kg' | 'increment_kg' | 'maximum_kg' | 'additional_loads_kg'
>

function validateEquipmentProfile(profile: EquipmentLoadProfile): void {
  if (!Number.isFinite(profile.minimum_kg) || profile.minimum_kg < 0)
    throw new Error('Minimum load must be non-negative')
  if (!Number.isFinite(profile.increment_kg) || profile.increment_kg <= 0)
    throw new Error('Load increment must be positive')
  if (
    profile.maximum_kg != null &&
    (!Number.isFinite(profile.maximum_kg) || profile.maximum_kg < profile.minimum_kg)
  ) {
    throw new Error('Maximum load must be at least the minimum load')
  }
}

function parseAdditionalLoads(value: EquipmentLoadProfile['additional_loads_kg']): number[] {
  let parsed: unknown
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((load): load is number => typeof load === 'number' && Number.isFinite(load))
}

function availableLoadCandidates(targetKg: number, profile: EquipmentLoadProfile): Set<number> {
  const max = profile.maximum_kg ?? Number.POSITIVE_INFINITY
  const candidates = new Set<number>([profile.minimum_kg])
  const stepPosition = Math.max(0, (targetKg - profile.minimum_kg) / profile.increment_kg)
  for (const step of new Set([0, Math.floor(stepPosition), Math.ceil(stepPosition)])) {
    const load = profile.minimum_kg + step * profile.increment_kg
    if (load <= max) candidates.add(load)
  }
  if (Number.isFinite(max)) {
    const lastStep = Math.floor((max - profile.minimum_kg) / profile.increment_kg)
    candidates.add(profile.minimum_kg + lastStep * profile.increment_kg)
  }
  for (const load of parseAdditionalLoads(profile.additional_loads_kg)) {
    if (load >= profile.minimum_kg && load <= max) candidates.add(load)
  }
  return candidates
}

function nearestLoad(targetKg: number, candidates: Set<number>, fallback: number): number {
  let best = fallback
  let distance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const normalized = Math.round(candidate * LOAD_PRECISION) / LOAD_PRECISION
    const nextDistance = Math.abs(normalized - targetKg)
    if (nextDistance < distance || (nextDistance === distance && normalized < best)) {
      best = normalized
      distance = nextDistance
    }
  }
  return best
}

export function toKilograms(value: number, unit: 'kg' | 'lbs'): number {
  return unit === 'kg' ? value : value * KG_PER_LB
}

export function fromKilograms(value: number, unit: 'kg' | 'lbs'): number {
  return unit === 'kg' ? value : value / KG_PER_LB
}

/** Return the nearest available configured load, breaking ties toward the lighter load. */
export function roundToAvailableLoad(targetKg: number, profile: EquipmentLoadProfile): number {
  if (!Number.isFinite(targetKg)) throw new Error('Target load must be finite')
  validateEquipmentProfile(profile)
  return nearestLoad(targetKg, availableLoadCandidates(targetKg, profile), profile.minimum_kg)
}
