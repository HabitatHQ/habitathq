const KM_TO_MI = 1.60934

/**
 * Calculate pace in seconds per kilometre.
 * Returns 0 for invalid inputs (zero/negative distance or duration).
 */
export function secondsToMinKm(totalSeconds: number, distanceM: number): number {
  if (totalSeconds <= 0 || distanceM <= 0) return 0
  return (totalSeconds / distanceM) * 1000
}

/**
 * Format a pace in sec/km as a human-readable string.
 * e.g. 330 → "5:30/km", or with unit='mi' → "8:53/mi"
 * Returns "--" for zero or invalid pace.
 */
export function formatPace(secPerKm: number, unit: 'km' | 'mi'): string {
  if (secPerKm <= 0) return '--'

  const secPerUnit = unit === 'mi' ? secPerKm * KM_TO_MI : secPerKm
  const mins = Math.floor(secPerUnit / 60)
  const secs = Math.round(secPerUnit % 60)
  const paddedSecs = secs.toString().padStart(2, '0')
  return `${mins}:${paddedSecs}/${unit}`
}

/**
 * Convert pace (sec/km) to speed in km/h.
 * Returns 0 for zero pace.
 */
export function paceToSpeed(secPerKm: number): number {
  if (secPerKm <= 0) return 0
  return 3600 / secPerKm
}
