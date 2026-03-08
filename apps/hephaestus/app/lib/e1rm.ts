/**
 * Calculate estimated 1-rep max using the Epley formula.
 * e1RM = weight × (1 + reps / 30)
 *
 * Returns 0 for invalid inputs (weight ≤ 0, reps ≤ 0).
 */
export function calculateE1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}
