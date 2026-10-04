const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 86_400_000

/** The numeric fields represented by a strict Gregorian YYYY-MM-DD key. */
export interface CalendarDateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** Inputs accepted by instant-formatting helpers. Strings must identify a valid instant. */
export type InstantInput = Date | number | string

export interface CalendarDateFormatOptions {
  readonly locale?: Intl.LocalesArgument
  readonly dateStyle?: Intl.DateTimeFormatOptions['dateStyle']
  readonly weekday?: Intl.DateTimeFormatOptions['weekday']
  readonly era?: Intl.DateTimeFormatOptions['era']
  readonly year?: Intl.DateTimeFormatOptions['year']
  readonly month?: Intl.DateTimeFormatOptions['month']
  readonly day?: Intl.DateTimeFormatOptions['day']
}

export type InstantFormatOptions = Intl.DateTimeFormatOptions & {
  readonly locale?: Intl.LocalesArgument
  readonly timeZone: string
}

export interface TimeFormatOptions {
  readonly locale?: Intl.LocalesArgument
  readonly timeZone: string
  readonly timeStyle?: Intl.DateTimeFormatOptions['timeStyle']
  readonly hour?: Intl.DateTimeFormatOptions['hour']
  readonly minute?: Intl.DateTimeFormatOptions['minute']
  readonly second?: Intl.DateTimeFormatOptions['second']
  readonly fractionalSecondDigits?: Intl.DateTimeFormatOptions['fractionalSecondDigits']
  readonly timeZoneName?: Intl.DateTimeFormatOptions['timeZoneName']
  readonly hour12?: boolean
  readonly hourCycle?: Intl.DateTimeFormatOptions['hourCycle']
}

export interface RelativeTimeOptions {
  readonly referenceTime: InstantInput
}

/** A duration whose numeric value cannot be mistaken for a different unit. */
export type DurationInput =
  | { readonly value: number; readonly unit: 'minutes' }
  | { readonly value: number; readonly unit: 'seconds' }

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function calendarDateParts(value: unknown): CalendarDateParts | null {
  if (typeof value !== 'string') return null
  const match = CALENDAR_DATE_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null
  }
  return { year, month, day }
}

/** Return whether a value is exactly YYYY-MM-DD and names a real Gregorian calendar date. */
export function isCalendarDate(value: unknown): value is string {
  return calendarDateParts(value) !== null
}

/**
 * Parse a strict Gregorian YYYY-MM-DD key without constructing a Date.
 *
 * Years 0000 through 9999 are preserved exactly. Invalid syntax and impossible
 * dates throw instead of being silently rolled into another month.
 */
export function parseCalendarDate(value: string): CalendarDateParts {
  const parts = calendarDateParts(value)
  if (!parts) throw new RangeError(`Invalid Gregorian calendar date: ${value}`)
  return parts
}

function calendarDateString(parts: CalendarDateParts): string {
  const { year, month, day } = parts
  if (
    !Number.isInteger(year) ||
    year < 0 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new RangeError('Calendar date fields must identify a Gregorian date from 0000 to 9999')
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function utcMidnightTimestamp(parts: CalendarDateParts): number {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime()
}

function instantTimestamp(input: InstantInput): number {
  const timestamp =
    input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input)
  if (!Number.isFinite(timestamp)) throw new RangeError('Invalid instant')
  return timestamp
}

/** Return a YYYY-MM-DD key from a Date's local calendar fields (no UTC conversion). */
export function localCalendarDate(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid Date')
  return calendarDateString({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  })
}


/**
 * Parse a strict YYYY-MM-DD key into local time without the Date constructor's
 * special remapping of years 0000 through 0099.
 */
export function parseDateString(dateStr: string): Date {
  const parts = parseCalendarDate(dateStr)
  const date = new Date(0)
  date.setFullYear(parts.year, parts.month - 1, parts.day)
  date.setHours(0, 0, 0, 0)
  return date
}

/** Add whole Gregorian calendar days without using local elapsed hours. */
export function addCalendarDays(dateStr: string, days: number): string {
  if (!Number.isSafeInteger(days))
    throw new RangeError('Calendar day offset must be a safe integer')
  const timestamp = utcMidnightTimestamp(parseCalendarDate(dateStr)) + days * MILLISECONDS_PER_DAY
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Calendar day result is out of range')
  return calendarDateString({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

/** Compare two strict calendar dates without interpreting either as an instant. */
export function compareCalendarDates(left: string, right: string): -1 | 0 | 1 {
  parseCalendarDate(left)
  parseCalendarDate(right)
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** Return dateStr - referenceDate in whole Gregorian calendar days. */
export function differenceInCalendarDays(dateStr: string, referenceDate: string): number {
  const date = utcMidnightTimestamp(parseCalendarDate(dateStr))
  const reference = utcMidnightTimestamp(parseCalendarDate(referenceDate))
  return (date - reference) / MILLISECONDS_PER_DAY
}

/**
 * Format a calendar date as a calendar value. UTC is fixed internally only to
 * prevent a host time zone from shifting the key; no instant conversion occurs.
 */
export function formatCalendarDate(
  dateStr: string,
  options: CalendarDateFormatOptions = {},
): string {
  const timestamp = utcMidnightTimestamp(parseCalendarDate(dateStr))
  const { locale = 'en-US', ...dateOptions } = options
  const hasDisplayOptions = Object.keys(dateOptions).length > 0
  return new Intl.DateTimeFormat(locale, {
    ...(hasDisplayOptions ? dateOptions : { year: 'numeric', month: 'long', day: 'numeric' }),
    calendar: 'gregory',
    timeZone: 'UTC',
  }).format(timestamp)
}

/** Format an instant in the caller-selected locale and time zone. */
export function formatInstant(instant: InstantInput, options: InstantFormatOptions): string {
  const { locale = 'en-US', ...dateTimeOptions } = options
  return new Intl.DateTimeFormat(locale, dateTimeOptions).format(instantTimestamp(instant))
}

/** Format the time-of-day of an instant in the caller-selected time zone and hour cycle. */
export function formatTime(instant: InstantInput, options: TimeFormatOptions): string {
  const { locale = 'en-US', ...timeOptions } = options
  const hasTimeFields =
    timeOptions.timeStyle !== undefined ||
    timeOptions.hour !== undefined ||
    timeOptions.minute !== undefined ||
    timeOptions.second !== undefined ||
    timeOptions.fractionalSecondDigits !== undefined
  return new Intl.DateTimeFormat(locale, {
    ...(hasTimeFields ? {} : { hour: 'numeric', minute: '2-digit' }),
    ...timeOptions,
  }).format(instantTimestamp(instant))
}

/** Format a YYYY-MM-DD (or null/undefined) as human-readable "March 15, 2024". */
export function formatDate(dateStr: string | null | undefined): string {
  return dateStr ? formatCalendarDate(dateStr) : ''
}

/**
 * Format a YYYY-MM-DD relative to an explicit reference calendar date:
 * - "Today" / "Yesterday" / "Tomorrow"
 * - "in Nd" / "Nd ago" for within 7 days
 * - Short date otherwise
 */
export function formatDateRelative(dateStr: string, today: string): string {
  const diffDays = differenceInCalendarDays(dateStr, today)

  if (diffDays === 0) return 'Today'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 0 && diffDays <= 7) return `in ${diffDays}d`
  if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)}d ago`

  return formatCalendarDate(dateStr, {
    locale: 'en-US',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format an ISO timestamp relative to a reference instant:
 * "just now", "X min ago", "X h ago", "X days ago".
 *
 * Omit options for legacy Date.now() behavior; pass referenceTime for
 * deterministic rendering.
 */
export function formatRelativeTime(isoTimestamp: string, options?: RelativeTimeOptions): string {
  const reference = options ? instantTimestamp(options.referenceTime) : Date.now()
  const diff = reference - instantTimestamp(isoTimestamp)
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / MILLISECONDS_PER_DAY)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} h ago`
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Format a duration in minutes as "45 min", "1 h", "1 h 30 min". */
export function formatDurationMinutes(minutes: number): string
export function formatDurationMinutes(minutes: number | null): string | null
export function formatDurationMinutes(minutes: number | null): string | null {
  if (minutes === null) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** Format a duration in seconds as "45s", "1m 30s", "1h 5m". */
export function formatDurationSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

/** Format a duration whose input unit is explicit at the call site. */
export function formatDuration(duration: DurationInput): string {
  if (!Number.isSafeInteger(duration.value) || duration.value < 0) {
    throw new RangeError('Duration value must be a non-negative safe integer')
  }
  return duration.unit === 'minutes'
    ? formatDurationMinutes(duration.value)
    : formatDurationSeconds(duration.value)
}
