/**
 * Shared sprout-stage geometry — the single source of truth for which line-art
 * parts make up each growth stage, used by SproutFigure (rendering) and
 * SproutPlant (computing which parts to animate on a stage advance).
 */
export const PARTS_BY_STAGE: Record<number, string[]> = {
  0: ['soil', 'seedRest'],
  1: ['soil', 'seed'],
  2: ['soil', 'stemMid', 'smallLeaf'],
  3: ['soil', 'stemFull', 'leafL'],
  4: ['soil', 'stemFull', 'leafL', 'branchR'],
  5: ['soil', 'stemFull', 'leafL', 'branchR', 'bud'],
  6: ['soil', 'stemFull', 'leafL', 'branchR', 'daisy'],
}

/** Part-ids that are newly present going from `prev` stage to `next`. */
export function enteringParts(prev: number, next: number): string[] {
  const before = new Set(PARTS_BY_STAGE[prev] ?? [])
  return (PARTS_BY_STAGE[next] ?? []).filter((id) => !before.has(id))
}

/** Frost crystal anchor points (viewBox 0 0 40 44 space). */
export const CRYSTAL_PTS = [
  [10, 16],
  [30, 14],
  [7, 28],
  [33, 26],
  [20, 9],
] as const

/** Crystals shown for a status: 3 when frozen, 1 while thawing, none when active. */
export function crystalsFor(
  status: 'active' | 'frozen' | 'thawing',
): ReadonlyArray<readonly [number, number]> {
  if (status === 'frozen') return CRYSTAL_PTS.slice(0, 3)
  if (status === 'thawing') return CRYSTAL_PTS.slice(0, 1)
  return []
}
