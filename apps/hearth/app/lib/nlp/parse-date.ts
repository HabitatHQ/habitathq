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

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toDate(iso: string): Date {
  const parts = iso.split('-').map(Number)
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!)
}

function findLastDayOfWeek(dayIndex: number, from: Date): Date {
  const d = new Date(from)
  d.setDate(d.getDate() - 1) // start from yesterday
  while (d.getDay() !== dayIndex) {
    d.setDate(d.getDate() - 1)
  }
  return d
}

function findNextDayOfWeek(dayIndex: number, from: Date): Date {
  const d = new Date(from)
  if (d.getDay() === dayIndex) return d
  d.setDate(d.getDate() + 1)
  while (d.getDay() !== dayIndex) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

export function parseDate(text: string, today: string): DateResult | null {
  const todayDate = toDate(today)

  // 1. Relative: today, yesterday, day before yesterday
  const relMatch = RELATIVE_RE.exec(text)
  if (relMatch?.[1]) {
    const word = relMatch[1].toLowerCase()
    const d = new Date(todayDate)
    if (word === 'yesterday') d.setDate(d.getDate() - 1)
    else if (word === 'day before yesterday') d.setDate(d.getDate() - 2)
    return { date: fmt(d), confidence: 'high', matchedText: relMatch[0] }
  }

  // 2. "last friday"
  const lastDayMatch = LAST_DAY_RE.exec(text)
  if (lastDayMatch?.[1]) {
    const dayIdx = DAY_NAMES.indexOf(lastDayMatch[1].toLowerCase())
    const d = findLastDayOfWeek(dayIdx, todayDate)
    return { date: fmt(d), confidence: 'high', matchedText: lastDayMatch[0] }
  }

  // 3. "this friday"
  const thisDayMatch = THIS_DAY_RE.exec(text)
  if (thisDayMatch?.[1]) {
    const dayIdx = DAY_NAMES.indexOf(thisDayMatch[1].toLowerCase())
    const d = findNextDayOfWeek(dayIdx, todayDate)
    return { date: fmt(d), confidence: 'high', matchedText: thisDayMatch[0] }
  }

  // 4. "march 3", "mar 3rd"
  const monthDayMatch = MONTH_DAY_RE.exec(text)
  if (monthDayMatch?.[1] && monthDayMatch[2]) {
    const monthKey = monthDayMatch[1].toLowerCase().slice(0, 3)
    const month = MONTH_MAP[monthKey]
    const day = parseInt(monthDayMatch[2], 10)
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(todayDate.getFullYear(), month, day)
      // If the date is in the future, use previous year
      if (d > todayDate) d.setFullYear(d.getFullYear() - 1)
      return { date: fmt(d), confidence: 'high', matchedText: monthDayMatch[0] }
    }
  }

  // 5. "3/15", "3-15" (M/D format)
  const numericMatch = NUMERIC_DATE_RE.exec(text)
  if (numericMatch?.[1] && numericMatch[2]) {
    const month = parseInt(numericMatch[1], 10) - 1
    const day = parseInt(numericMatch[2], 10)
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(todayDate.getFullYear(), month, day)
      if (d > todayDate) d.setFullYear(d.getFullYear() - 1)
      return { date: fmt(d), confidence: 'medium', matchedText: numericMatch[0] }
    }
  }

  return null
}
