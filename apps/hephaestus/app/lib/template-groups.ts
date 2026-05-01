import type { GroupType, TemplateGroupRow } from '~/types/database'

export const GROUP_TYPE_COLORS: Record<GroupType, string> = {
  superset: 'blue',
  giant_set: 'indigo',
  circuit: 'green',
  pre_exhaust: 'amber',
}

export function groupTypeColor(type: GroupType): string {
  return GROUP_TYPE_COLORS[type] ?? 'zinc'
}

export function groupDisplayLabel(group: TemplateGroupRow): string {
  if (group.display_name) return `${group.label} · ${group.display_name}`
  return group.label
}

/**
 * Estimates total duration of a group in seconds.
 * Assumes ~45s per exercise set, plus rest between rounds.
 */
export function estimateGroupDuration(group: TemplateGroupRow, exCount: number): number {
  const rounds = group.rounds ?? 1
  const workPerRound = exCount * 45
  const restPerRound = group.rest_after_round_sec
  return (workPerRound + restPerRound) * rounds
}
