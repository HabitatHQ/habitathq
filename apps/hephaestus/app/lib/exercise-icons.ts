import type { MovementPattern } from '~/types/database'

/** Default Phosphor icon per movement pattern. */
export const movementIcon: Record<MovementPattern, string> = {
  squat: 'i-ph-barbell',
  hinge: 'i-ph-barbell',
  press: 'i-ph-arrow-fat-up',
  row: 'i-ph-arrow-fat-down',
  carry: 'i-ph-person-simple-walk',
  isolation: 'i-ph-activity',
  cardio: 'i-ph-person-simple-run',
}

/** Tailwind classes for each movement pattern's avatar background and icon color. */
export const movementColors: Record<MovementPattern, { bg: string; text: string }> = {
  squat: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  hinge: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  press: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  row: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
  carry: { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  isolation: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  cardio: { bg: 'bg-green-500/20', text: 'text-green-400' },
}

/** Resolve the icon to display for an exercise. Falls back to movement default. */
export function resolveExerciseIcon(
  icon: string | null | undefined,
  movement: MovementPattern,
): string {
  return icon ?? movementIcon[movement] ?? 'i-ph-barbell'
}
