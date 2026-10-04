import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  compareCalendarDates,
  differenceInCalendarDays,
  formatCalendarDate,
  formatDateRelative,
  formatDuration,
  formatInstant,
  formatRelativeTime,
  formatTime,
  isCalendarDate,
  localCalendarDate,
  parseCalendarDate,
  parseDateString,
} from './index.js'

describe('Gregorian calendar dates', () => {
  it('accepts leap days only in Gregorian leap years', () => {
    expect(isCalendarDate('2000-02-29')).toBe(true)
    expect(isCalendarDate('1900-02-29')).toBe(false)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2023-02-29')).toBe(false)
  })

  it.each(['2024-2-01', '2024-02-1', '2024-00-01', '2024-13-01', '2024-04-31', '0000-01-00'])(
    'rejects malformed or impossible key %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false)
      expect(() => parseCalendarDate(value)).toThrow(RangeError)
    },
  )

  it('preserves years 0000 through 0099 without Date constructor remapping', () => {
    expect(parseCalendarDate('0000-02-29')).toEqual({ year: 0, month: 2, day: 29 })
    expect(localCalendarDate(parseDateString('0001-01-02'))).toBe('0001-01-02')
    expect(localCalendarDate(parseDateString('0099-12-31'))).toBe('0099-12-31')
  })

  it('adds and compares civil days independently of elapsed local hours', () => {
    expect(addCalendarDays('2024-03-09', 2)).toBe('2024-03-11')
    expect(addCalendarDays('2024-11-03', 1)).toBe('2024-11-04')
    expect(addCalendarDays('2000-02-28', 1)).toBe('2000-02-29')
    expect(differenceInCalendarDays('2024-03-11', '2024-03-09')).toBe(2)
    expect(differenceInCalendarDays('2024-03-09', '2024-03-11')).toBe(-2)
    expect(compareCalendarDates('0009-12-31', '0010-01-01')).toBe(-1)
  })

  it('rejects fractional day offsets and results outside the supported key range', () => {
    expect(() => addCalendarDays('2024-01-01', 0.5)).toThrow(RangeError)
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow(RangeError)
  })
})

describe('explicit date and time formatting', () => {
  it('formats a calendar date without treating it as a timezone-shifted instant', () => {
    expect(formatCalendarDate('2024-03-15', { locale: 'en-US' })).toMatch(/March 15,? 2024/)
    expect(formatCalendarDate('0007-03-15', { locale: 'en-US' })).toContain('7')
  })

  it('shows one instant in the requested time zones', () => {
    const instant = '2024-01-01T00:30:00.000Z'
    const losAngeles = formatInstant(instant, {
      locale: 'en-US',
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const tokyo = formatInstant(instant, {
      locale: 'en-US',
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    expect(losAngeles).not.toBe(tokyo)
    expect(
      formatTime(instant, {
        locale: 'en-US',
        timeZone: 'UTC',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    ).toContain('0:30')
  })
})

describe('relative labels and unit-labelled durations', () => {
  it('uses calendar-day distance for legacy relative date labels', () => {
    expect(formatDateRelative('2024-03-10', '2024-03-11')).toBe('Yesterday')
    expect(formatDateRelative('2024-03-18', '2024-03-11')).toBe('in 7d')
    expect(formatDateRelative('2024-03-19', '2024-03-11')).toBe('Mar 19, 2024')
  })

  it('uses an explicit reference instant for deterministic relative time', () => {
    expect(
      formatRelativeTime('2024-01-01T00:00:00.000Z', {
        referenceTime: '2024-01-01T01:01:00.000Z',
      }),
    ).toBe('1 h ago')
  })

  it('requires a duration unit in its canonical formatter', () => {
    expect(formatDuration({ value: 90, unit: 'minutes' })).toBe('1 h 30 min')
    expect(formatDuration({ value: 90, unit: 'seconds' })).toBe('1m 30s')
    expect(() => formatDuration({ value: -1, unit: 'seconds' })).toThrow(RangeError)
  })
})
