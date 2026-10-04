import {
  addCalendarDays,
  compareCalendarDates,
  isCalendarDate,
  localCalendarDate,
  parseCalendarDate,
  parseDateString,
} from '@habitathq/utils'

import type { Confidence } from './types'

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const RELATIVE_RE = /\b(today|yesterday|day before yesterday)\b/i
const LAST_DAY_RE = /\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const THIS_DAY_RE = /\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const MONTH_DAY_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
const NUMERIC_DATE_RE = /\b(\d{1,2})[/-](\d{1,2})\b/

export interface DateResult {
  date: string // YYYY-MM-DD
  confidence: Confidence
  matchedText: string
}

function resolveYearlessDate(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const year = parseCalendarDate(today).year
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isCalendarDate(candidate)) return null
  const date =
    compareCalendarDates(candidate, today) > 0
      ? `${String(year - 1).padStart(4, '0')}-${candidate.slice(5)}`
      : candidate
  return isCalendarDate(date) ? date : null
}

function findLastDayOfWeek(dayIndex: number, from: Date): Date {
  let date = addCalendarDays(localCalendarDate(from), -1)
  while (parseDateString(date).getDay() !== dayIndex) date = addCalendarDays(date, -1)
  return parseDateString(date)
}

function findNextDayOfWeek(dayIndex: number, from: Date): Date {
  let date = localCalendarDate(from)
  if (parseDateString(date).getDay() === dayIndex) return parseDateString(date)
  date = addCalendarDays(date, 1)
  while (parseDateString(date).getDay() !== dayIndex) date = addCalendarDays(date, 1)
  return parseDateString(date)
}

export function parseDate(text: string, today: string): DateResult | null {
  const todayDate = parseDateString(today)

  // 1. Relative: today, yesterday, day before yesterday
  const relMatch = RELATIVE_RE.exec(text)
  if (relMatch?.[1]) {
    const word = relMatch[1].toLowerCase()
    const date = addCalendarDays(
      today,
      word === 'yesterday' ? -1 : word === 'day before yesterday' ? -2 : 0,
    )
    return { date, confidence: 'high', matchedText: relMatch[0] }
  }

  // 2. "last friday"
  const lastDayMatch = LAST_DAY_RE.exec(text)
  if (lastDayMatch?.[1]) {
    const dayIdx = DAY_NAMES.indexOf(lastDayMatch[1].toLowerCase())
    const d = findLastDayOfWeek(dayIdx, todayDate)
    return { date: localCalendarDate(d), confidence: 'high', matchedText: lastDayMatch[0] }
  }

  // 3. "this friday"
  const thisDayMatch = THIS_DAY_RE.exec(text)
  if (thisDayMatch?.[1]) {
    const dayIdx = DAY_NAMES.indexOf(thisDayMatch[1].toLowerCase())
    const d = findNextDayOfWeek(dayIdx, todayDate)
    return { date: localCalendarDate(d), confidence: 'high', matchedText: thisDayMatch[0] }
  }

  // 4. "march 3", "mar 3rd"
  const monthDayMatch = MONTH_DAY_RE.exec(text)
  if (monthDayMatch?.[1] && monthDayMatch[2]) {
    const monthKey = monthDayMatch[1].toLowerCase().slice(0, 3)
    const month = MONTH_MAP[monthKey]
    const day = Number.parseInt(monthDayMatch[2], 10)
    if (month !== undefined) {
      const date = resolveYearlessDate(month + 1, day, today)
      if (date) return { date, confidence: 'high', matchedText: monthDayMatch[0] }
    }
  }

  // 5. "3/15", "3-15" (M/D format)
  const numericMatch = NUMERIC_DATE_RE.exec(text)
  if (numericMatch?.[1] && numericMatch[2]) {
    const month = Number.parseInt(numericMatch[1], 10) - 1
    const day = Number.parseInt(numericMatch[2], 10)
    const date = resolveYearlessDate(month + 1, day, today)
    if (date) return { date, confidence: 'medium', matchedText: numericMatch[0] }
  }

  return null
}
