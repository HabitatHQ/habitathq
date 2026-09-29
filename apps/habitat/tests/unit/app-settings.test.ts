import { describe, expect, it } from 'vitest'
import { normalizeAppSettings } from '~/composables/useAppSettings'

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
})
