import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'

// Mock Vue auto-imports that Nuxt provides
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

import { usePeriod } from '~/composables/usePeriod'
import { currentPeriod, offsetPeriod } from '~/utils/format'

describe('usePeriod', () => {
  it('initializes with the current period', () => {
    const { period } = usePeriod()
    expect(period.value).toBe(currentPeriod())
  })

  it('isCurrentPeriod is true initially', () => {
    const { isCurrentPeriod } = usePeriod()
    expect(isCurrentPeriod.value).toBe(true)
  })

  it('prevPeriod decrements by one month', () => {
    const { period, prevPeriod } = usePeriod()
    const initial = period.value
    prevPeriod()
    expect(period.value).toBe(offsetPeriod(initial, -1))
  })

  it('nextPeriod increments by one month', () => {
    const { period, prevPeriod, nextPeriod } = usePeriod()
    // Go back first so we can go forward
    prevPeriod()
    const afterPrev = period.value
    nextPeriod()
    expect(period.value).toBe(offsetPeriod(afterPrev, 1))
  })

  it('isCurrentPeriod becomes false after prevPeriod', async () => {
    const { isCurrentPeriod, prevPeriod } = usePeriod()
    expect(isCurrentPeriod.value).toBe(true)
    prevPeriod()
    await nextTick()
    expect(isCurrentPeriod.value).toBe(false)
  })

  it('isCurrentPeriod becomes true after round-tripping', async () => {
    const { isCurrentPeriod, prevPeriod, nextPeriod } = usePeriod()
    prevPeriod()
    await nextTick()
    expect(isCurrentPeriod.value).toBe(false)
    nextPeriod()
    await nextTick()
    expect(isCurrentPeriod.value).toBe(true)
  })

  it('navigating back multiple months accumulates correctly', () => {
    const { period, prevPeriod } = usePeriod()
    const initial = period.value
    prevPeriod()
    prevPeriod()
    prevPeriod()
    expect(period.value).toBe(offsetPeriod(initial, -3))
  })

  it('handles year boundary: going back from January', () => {
    const { period, prevPeriod } = usePeriod()
    // Set to January of current year
    const year = new Date().getFullYear()
    period.value = `${year}-01`
    prevPeriod()
    expect(period.value).toBe(`${year - 1}-12`)
  })

  it('handles year boundary: going forward from December', () => {
    const { period, nextPeriod } = usePeriod()
    const year = new Date().getFullYear()
    period.value = `${year}-12`
    nextPeriod()
    expect(period.value).toBe(`${year + 1}-01`)
  })

  it('multiple instances are independent', () => {
    const a = usePeriod()
    const b = usePeriod()
    a.prevPeriod()
    expect(a.period.value).not.toBe(b.period.value)
    expect(b.period.value).toBe(currentPeriod())
  })

  it('period format is always YYYY-MM with zero-padded month', () => {
    const { period, prevPeriod } = usePeriod()
    for (let i = 0; i < 14; i++) {
      expect(period.value).toMatch(/^\d{4}-\d{2}$/)
      prevPeriod()
    }
  })
})
