import { describe, expect, it } from 'vitest'
import {
  applyAppSetting,
  applyAppSettingsPatch,
  normalizeAppSettings,
} from '../../app/composables/useAppSettings'

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

  it('normalizes an empty stored duration to its safe default', () => {
    expect(normalizeAppSettings({ pomodoroWorkMinutes: '' }).pomodoroWorkMinutes).toBe(25)
  })

  it.each([
    ['pomodoroWorkMinutes', 0],
    ['pomodoroWorkMinutes', 91],
    ['pomodoroShortBreakMinutes', 61],
    ['pomodoroLongBreakMinutes', 0],
    ['pomodoroCyclesBeforeLong', 0],
    ['pomodoroCyclesBeforeLong', 11],
    ['pomodoroWorkMinutes', 1.5],
    ['pomodoroWorkMinutes', Number.NaN],
    ['pomodoroWorkMinutes', '1'],
  ] as const)('normalizes invalid persisted %s=%s to its safe default', (key, value) => {
    expect(normalizeAppSettings({ [key]: value })[key]).toBe(
      key === 'pomodoroWorkMinutes'
        ? 25
        : key === 'pomodoroShortBreakMinutes'
          ? 5
          : key === 'pomodoroLongBreakMinutes'
            ? 15
            : 4,
    )
  })

  it.each([
    ['pomodoroWorkMinutes', 0],
    ['pomodoroWorkMinutes', 91],
    ['pomodoroShortBreakMinutes', 61],
    ['pomodoroLongBreakMinutes', 0],
    ['pomodoroCyclesBeforeLong', 0],
    ['pomodoroCyclesBeforeLong', 11],
    ['pomodoroWorkMinutes', 1.5],
    ['pomodoroWorkMinutes', Number.POSITIVE_INFINITY],
  ] as const)('rejects raw invalid setting updates for %s=%s', (key, value) => {
    const current = normalizeAppSettings({})
    const updated = applyAppSetting(current, key, value)

    expect(updated[key]).toBe(current[key])
    expect(applyAppSettingsPatch(current, { [key]: value })[key]).toBe(current[key])
  })

  it.each([
    ['pomodoroWorkMinutes', 1],
    ['pomodoroWorkMinutes', 90],
    ['pomodoroShortBreakMinutes', 60],
    ['pomodoroLongBreakMinutes', 60],
    ['pomodoroCyclesBeforeLong', 10],
  ] as const)('accepts supported boundary update %s=%s', (key, value) => {
    const updated = applyAppSetting(normalizeAppSettings({}), key, value)
    expect(updated[key]).toBe(value)
  })

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
