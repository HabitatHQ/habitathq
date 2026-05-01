import type { DropSetConfig, PyramidConfig, SetSchemeConfig } from '~/types/database'

export function parseSetScheme(json: string | null): SetSchemeConfig {
  if (!json) return { type: 'straight' }
  try {
    return JSON.parse(json) as SetSchemeConfig
  } catch {
    return { type: 'straight' }
  }
}

export function serialiseSetScheme(config: SetSchemeConfig): string {
  return JSON.stringify(config)
}

/** Round to nearest 2.5 */
function round2_5(n: number): number {
  return Math.round(n / 2.5) * 2.5
}

/** Generate planned weights for each set in a drop cluster (main set + N drops) */
export function generateDropSetPlan(
  baseWeight: number,
  config: DropSetConfig,
): Array<{ weight: number }> {
  const plan: Array<{ weight: number }> = [{ weight: baseWeight }]
  let current = baseWeight
  for (let i = 0; i < config.drops; i++) {
    if (config.dropType === 'percent') {
      current = round2_5(current * (1 - config.dropValue / 100))
    } else {
      current = current - config.dropValue
    }
    plan.push({ weight: Math.max(0, current) })
  }
  return plan
}

/** Generate full pyramid step plan */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pyramid plan has multiple branching config paths
export function generatePyramidPlan(
  config: PyramidConfig,
): Array<{ weight: number; reps: number; rest: number }> {
  const weights: number[] = []

  if (config.type === 'full') {
    // Up-then-down: steps covers all steps including the mirror descent
    // Calculate weights for full pyramid: up to peak then back down
    const half = Math.ceil(config.steps / 2)
    let w = config.startWeight
    for (let i = 0; i < config.steps; i++) {
      weights.push(round2_5(Math.max(0, w)))
      if (i < half - 1) {
        // ascending phase
        if (config.stepType === 'percent') {
          w = w * (1 + config.weightStep / 100)
        } else {
          w = w + config.weightStep
        }
      } else if (i >= half - 1) {
        // descending phase
        if (config.stepType === 'percent') {
          w = w / (1 + config.weightStep / 100)
        } else {
          w = w - config.weightStep
        }
      }
    }
  } else if (config.type === 'rep_only') {
    for (let i = 0; i < config.steps; i++) {
      weights.push(config.startWeight)
    }
  } else {
    // ascending or descending
    let w = config.startWeight
    for (let i = 0; i < config.steps; i++) {
      const rounded = config.stepType === 'absolute' ? round2_5(Math.max(0, w)) : Math.max(0, w)
      weights.push(rounded)
      if (config.type === 'ascending') {
        if (config.stepType === 'percent') {
          w = w * (1 + config.weightStep / 100)
        } else {
          w = w + config.weightStep
        }
      } else {
        // descending
        if (config.stepType === 'percent') {
          w = w * (1 - config.weightStep / 100)
        } else {
          w = w - config.weightStep
        }
      }
    }
  }

  return weights.map((weight, i) => ({
    weight,
    reps: config.repsPerStep[i] ?? 0,
    rest: config.restPerStep[i] ?? 90,
  }))
}

/** Generate warm-up weight suggestions based on working weight and ramp percentages */
export function warmupWeightSuggestions(workingWeight: number, ramps: number[]): number[] {
  return ramps.map((pct) => round2_5(Math.max(0, workingWeight * (pct / 100))))
}
