export interface AutoregulationRule {
  metric: 'e1rm' | 'reps' | 'rpe'
  threshold: number
  action: 'increase_weight' | 'increase_reps' | 'next_variant'
  amount: number
}

export interface TempoComponents {
  ecc: number
  pause: number
  con: number
  top: number
}

export function parseRpeTargets(json: string | null): number[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as number[]
    return []
  } catch {
    return []
  }
}

export function serialiseRpeTargets(targets: number[]): string | null {
  if (targets.length === 0) return null
  return JSON.stringify(targets)
}

export function parseTempo(str: string | null): TempoComponents | null {
  if (!str) return null
  const parts = str.split('-')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (p.toUpperCase() === 'X' ? 0 : Number.parseInt(p, 10)))
  if (nums.some(Number.isNaN)) return null
  const [ecc, pause, con, top] = nums as [number, number, number, number]
  return { ecc, pause, con, top }
}

export function formatTempo(str: string | null): string | null {
  if (!str) return null
  if (!parseTempo(str)) return null
  return str
}

export function parseAutoregulation(json: string | null): AutoregulationRule | null {
  if (!json) return null
  try {
    return JSON.parse(json) as AutoregulationRule
  } catch {
    return null
  }
}

export function serialiseAutoregulation(rule: AutoregulationRule): string {
  return JSON.stringify(rule)
}

export function parseSubstitutes(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as string[]
    return []
  } catch {
    return []
  }
}
