import {
  addCalendarDays,
  formatCalendarDate,
  formatInstant,
  formatRelativeTime,
  formatTime as formatSharedTime,
  localCalendarDate,
} from '@habitathq/utils'

const { locale: localLocale, timeZone: localTimeZone } = Intl.DateTimeFormat().resolvedOptions()

/** Format an ISO timestamp with Habitat's Today/Yesterday labels and compact date. */
export function fmtDate(iso: string, use24h: boolean): string {
  const date = new Date(iso)
  const dateKey = localCalendarDate(date)
  const today = localCalendarDate()
  const time = formatSharedTime(date, {
    locale: localLocale,
    timeZone: localTimeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  })
  if (dateKey === today) return `Today, ${time}`
  if (dateKey === addCalendarDays(today, -1)) return `Yesterday, ${time}`
  return `${formatInstant(date, { locale: localLocale, timeZone: localTimeZone, month: 'short', day: 'numeric' })}, ${time}`
}

/** Format an ISO timestamp as the existing English habit-log date label. */
export function fmtLogDate(iso: string): string {
  return formatInstant(iso, {
    locale: 'en-US',
    timeZone: localTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Format an ISO timestamp as the existing English habit-log time label. */
export function fmtLogTime(iso: string): string {
  return formatSharedTime(iso, {
    locale: 'en-US',
    timeZone: localTimeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Format an ISO timestamp as the existing English archive/history date label. */
export function fmtArchived(iso: string): string {
  return formatInstant(iso, {
    locale: 'en-US',
    timeZone: localTimeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "Today" for the current date, otherwise the abbreviated English weekday. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  return formatCalendarDate(date, { weekday: 'short' })
}

/** Short English calendar date, e.g. "Mar 2". */
export function dayNum(date: string): string {
  return formatCalendarDate(date, { month: 'short', day: 'numeric' })
}

/** Format a duration in whole seconds using Habitat's compact stopwatch style. */
export function fmtDuration(secs: number): string {
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Human-readable relative time using Habitat's compact labels. */
export function timeAgo(iso: string): string {
  const value = formatRelativeTime(iso)
  if (value === 'just now') return value
  const relative = /^(\d+) min ago$/.exec(value)
  if (relative) return `${relative[1]}m ago`
  const hours = /^(\d+) h ago$/.exec(value)
  if (hours) return `${hours[1]}h ago`
  const days = /^(\d+) days? ago$/.exec(value)
  if (days && Number(days[1]) < 7) return `${days[1]}d ago`
  return formatInstant(iso, {
    locale: 'en-US',
    timeZone: localTimeZone,
    month: 'short',
    day: 'numeric',
  })
}
