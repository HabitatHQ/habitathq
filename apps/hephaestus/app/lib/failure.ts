import type { FailureType, SetRow } from '~/types/database'

export function describeFailureType(type: FailureType | null): string {
  if (!type) return ''
  const labels: Record<FailureType, string> = {
    muscular: 'Muscular failure',
    technical: 'Technical failure',
    near_failure: 'Near failure (1 rep left)',
  }
  return labels[type]
}

export function needsExtraRest(set: Pick<SetRow, 'failure_flag'>, bonusSec: number): number {
  return set.failure_flag === 1 ? bonusSec : 0
}
