import type { WeightUnit } from '~/composables/useAppSettings'

const LBS_PER_KG = 2.20462

export function kgToLbs(kg: number): number {
  return kg * LBS_PER_KG
}

export function lbsToKg(lbs: number): number {
  return lbs / LBS_PER_KG
}

/**
 * Format a weight in kg for display in the given unit.
 * Strips trailing zeros from decimal (80.0 → "80", 82.5 → "82.5").
 */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const value = unit === 'lbs' ? kgToLbs(kg) : kg
  // Round to 1 decimal, then strip trailing zero
  const rounded = Math.round(value * 10) / 10
  const formatted = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)
  return `${formatted} ${unit}`
}

/**
 * Format a duration in seconds as a human-readable string.
 * < 60s  → "45s"
 * < 1h   → "1m 30s"
 * ≥ 1h   → "1h 5m"
 */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

/**
 * Format a countdown duration in MM:SS or M:SS format.
 * Used for rest timers where precision matters.
 * 120 → "2:00", 90 → "1:30", 45 → "0:45"
 */
export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Format a volume (total tonnage in kg) with k suffix for thousands.
 */
export function formatVolume(kg: number, unit: WeightUnit = 'kg'): string {
  const value = unit === 'lbs' ? kgToLbs(kg) : kg
  if (value >= 1000) {
    const k = Math.round(value / 100) / 10
    return `${k}k ${unit}`
  }
  return `${Math.round(value)} ${unit}`
}

/**
 * Format a local Date as a YYYY-MM-DD string using local time zone.
 * Use instead of `.toISOString().slice(0,10)` which returns UTC.
 */
export function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Get the ISO 8601 week string for a date: "2025-W11"
 */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // ISO week starts on Monday; shift to Thursday of the same week
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
