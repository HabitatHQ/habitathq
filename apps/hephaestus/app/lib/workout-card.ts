import { formatCalendarDate, isCalendarDate } from '@habitathq/utils'

export interface WorkoutCardSummary {
  date: string
  sessionType: string
  durationMinutes: number
  exerciseCount: number
  workingSets: number
  volumeKg: number | null
  distanceMeters: number | null
}

export interface WorkoutCard {
  textAlternative: string
  svg: string
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    }
    return entities[character] ?? character
  })
}

export function buildWorkoutCard(summary: WorkoutCardSummary): WorkoutCard {
  if (!isCalendarDate(summary.date)) {
    throw new Error('A saved workout card requires a valid date.')
  }
  if (!Number.isFinite(summary.durationMinutes) || summary.durationMinutes < 0) {
    throw new Error('A saved workout card requires a completed workout duration.')
  }
  if (!Number.isInteger(summary.exerciseCount) || summary.exerciseCount < 0) {
    throw new Error('Workout exercise count is invalid.')
  }
  if (!Number.isInteger(summary.workingSets) || summary.workingSets < 0) {
    throw new Error('Workout set count is invalid.')
  }
  const dateLabel = formatCalendarDate(summary.date, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const lines = [
    `${summary.sessionType} workout — ${dateLabel}`,
    `${Math.round(summary.durationMinutes)} minutes`,
    `${summary.exerciseCount} exercises · ${summary.workingSets} working sets`,
  ]
  if (summary.volumeKg !== null) lines.push(`${Math.round(summary.volumeKg)} kg total volume`)
  if (summary.distanceMeters !== null)
    lines.push(`${(summary.distanceMeters / 1000).toFixed(2)} km`)
  const textAlternative = lines.join('. ')
  const content = lines
    .map(
      (line, index) =>
        `<text x="44" y="${112 + index * 48}" fill="#f5f5f4" font-size="${index === 0 ? 30 : 22}" font-family="system-ui, sans-serif">${escapeXml(line)}</text>`,
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="540" viewBox="0 0 1080 540"><rect width="1080" height="540" rx="36" fill="#171717"/><rect x="0" y="0" width="18" height="540" rx="9" fill="#f97316"/><text x="44" y="66" fill="#fb923c" font-size="18" font-family="system-ui, sans-serif" letter-spacing="4">HEPHAESTUS · WORKOUT SUMMARY</text>${content}<text x="44" y="490" fill="#a8a29e" font-size="17" font-family="system-ui, sans-serif">Private by default · no notes or account identifiers</text></svg>`
  return { textAlternative, svg }
}
