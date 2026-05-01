import type { MovementPattern } from '~/types/database'

/**
 * Parse per-set rest overrides from a JSON string.
 * Returns an array of length `setsPlanned`, using overrides where present,
 * falling back to `defaultRest` for missing entries.
 */
export function parseSetRests(
  json: string | null,
  setsPlanned: number,
  defaultRest: number,
): number[] {
  if (!json) return Array.from({ length: setsPlanned }, () => defaultRest)

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return Array.from({ length: setsPlanned }, () => defaultRest)
  }

  if (!Array.isArray(parsed)) return Array.from({ length: setsPlanned }, () => defaultRest)

  return Array.from({ length: setsPlanned }, (_, i) => {
    const v = parsed[i]
    return typeof v === 'number' && v > 0 ? v : defaultRest
  })
}

/**
 * Serialise per-set rest overrides to a JSON string.
 */
export function serialiseSetRests(rests: number[]): string {
  return JSON.stringify(rests)
}

/**
 * Get rest seconds for a specific set (1-based set_num).
 */
export function getRestForSet(json: string | null, setNum: number, defaultRest: number): number {
  if (!json) return defaultRest

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return defaultRest
  }

  if (!Array.isArray(parsed)) return defaultRest

  const val = parsed[setNum - 1]
  return typeof val === 'number' && val > 0 ? val : defaultRest
}

/**
 * Smart default rest based on movement pattern.
 * Heavy compound = 180s, isolation = 90s, cardio = 60s.
 */
export function smartDefaultRest(movement: MovementPattern): number {
  switch (movement) {
    case 'squat':
    case 'hinge':
    case 'press':
    case 'row':
    case 'carry':
      return 180
    case 'isolation':
      return 90
    case 'cardio':
      return 60
    default:
      return 120
  }
}
