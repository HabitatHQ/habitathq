import { describe, expect, it } from 'vitest'
import { normalizeAppSettings } from '../../app/composables/useAppSettings'

describe('normalizeAppSettings', () => {
  it('discards obsolete planner and TODO-calendar preferences', () => {
    const settings = normalizeAppSettings({
      enablePlanner: true,
      todoCalendarView: true,
      todoCalendarGrain: 'month',
      theme: 'forest',
    })

    expect(settings.theme).toBe('forest')
    expect(settings).not.toHaveProperty('enablePlanner')
    expect(settings).not.toHaveProperty('todoCalendarView')
    expect(settings).not.toHaveProperty('todoCalendarGrain')
  })

  it.each([2, 8, Number.NaN, Number.POSITIVE_INFINITY])(
    'resets out-of-range weekDays %s to the supported minimum',
    (weekDays) => {
      expect(normalizeAppSettings({ weekDays }).weekDays).toBe(3)
    },
  )

  it('preserves supported weekDays and infers onboarding for existing users only', () => {
    expect(normalizeAppSettings({ weekDays: 3 }, true).weekDays).toBe(3)
    expect(normalizeAppSettings({ weekDays: 7 }, true).weekDays).toBe(7)
    expect(normalizeAppSettings({}, true).hasCompletedOnboarding).toBe(true)
    expect(normalizeAppSettings({}).hasCompletedOnboarding).toBe(false)
  })

  it('does not share the default tabOrder array between normalized settings', () => {
    const first = normalizeAppSettings({})
    const second = normalizeAppSettings({})
    first.tabOrder.push('health')
    expect(second.tabOrder).toEqual([])
  })
})
