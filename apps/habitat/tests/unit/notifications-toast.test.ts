/**
 * Tests for toast notification fallback in useNotifications.
 *
 * When the browser Notification API is absent (e.g. desktop without HTTPS or
 * a non-standard browser), sendTestNotification() and the timers scheduled by
 * scheduleAll() should call useToast().add() instead.
 *
 * Strategy: in happy-dom, properties assigned to globalThis are accessible as
 * bare identifiers — the same mechanism Nuxt's transform uses to inject
 * auto-imported composables at runtime.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}))

import { useNotifications } from '~/composables/useNotifications'

// ── Shared stubs ─────────────────────────────────────────────────────────────

const mockToastAdd = vi.fn()
const dbStub = {
  isAvailable: true,
  getHabits: vi.fn().mockResolvedValue([]),
  getAllReminders: vi.fn().mockResolvedValue([]),
  getAllCheckinReminders: vi.fn().mockResolvedValue([]),
  getCheckinTemplates: vi.fn().mockResolvedValue([]),
}

beforeAll(() => {
  // Provide Nuxt auto-imported composables that useNotifications() calls.
  const g = globalThis as Record<string, unknown>
  g['useNuxtApp'] = () => ({ $config: { app: { baseURL: '/' } } })
  g['useToast'] = () => ({ add: mockToastAdd })
  g['useDatabase'] = () => dbStub
  g['useRouter'] = () => ({ push: vi.fn() })
})

beforeEach(() => {
  mockToastAdd.mockClear()
  dbStub.getHabits.mockResolvedValue([])
  dbStub.getAllReminders.mockResolvedValue([])
  dbStub.getAllCheckinReminders.mockResolvedValue([])
  dbStub.getCheckinTemplates.mockResolvedValue([])
})

afterEach(() => {
  // Remove any Notification stub added during the test.
  delete (globalThis as Record<string, unknown>)['Notification']
  vi.useRealTimers()
})

// ── sendTestNotification ──────────────────────────────────────────────────────

describe('sendTestNotification', () => {
  it('fires a toast when the Notification API is absent', async () => {
    // happy-dom does not implement the Notification API — this is the default
    // environment, so no setup needed; just call the function.
    const { sendTestNotification } = useNotifications()
    await sendTestNotification()

    expect(mockToastAdd).toHaveBeenCalledOnce()
    expect(mockToastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Habitat',
        description: expect.stringMatching(/^Test at /),
        icon: 'i-heroicons-bell',
        color: 'primary',
      }),
    )
  })

  it('does not fire a toast when Notification is present but permission is denied', async () => {
    ;(globalThis as Record<string, unknown>)['Notification'] = {
      permission: 'denied' as NotificationPermission,
    }

    const { sendTestNotification } = useNotifications()
    await sendTestNotification()

    expect(mockToastAdd).not.toHaveBeenCalled()
  })

  it('does not fire a toast when Notification is present but permission is default', async () => {
    ;(globalThis as Record<string, unknown>)['Notification'] = {
      permission: 'default' as NotificationPermission,
    }

    const { sendTestNotification } = useNotifications()
    await sendTestNotification()

    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})

// ── scheduleAll — web toast path ──────────────────────────────────────────────
// Fake timers are used so we can advance time without actually waiting.
// Jan 15 2024 is a Monday (getDay() = 1); fake "now" is 10:00 AM local time.

describe('scheduleAll — web toast path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0))
  })

  it('fires a toast via deferred timer for a habit reminder when Notification API is absent', async () => {
    dbStub.getHabits.mockResolvedValue([{ id: 'h1', name: 'Morning Run' }])
    dbStub.getAllReminders.mockResolvedValue([
      { id: 'r1', habit_id: 'h1', trigger_time: '10:01', days_active: null },
    ])

    const { scheduleAll } = useNotifications()
    await scheduleAll()

    // Timer registered but not yet fired
    expect(mockToastAdd).not.toHaveBeenCalled()

    // Advance past 10:01 (60 s = 60 000 ms, +1 ms margin)
    vi.advanceTimersByTime(60_001)

    expect(mockToastAdd).toHaveBeenCalledOnce()
    expect(mockToastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Morning Run',
        description: 'Time for your habit!',
        icon: 'i-heroicons-bell',
        color: 'primary',
      }),
    )
  })

  it('fires a toast via deferred timer for a check-in reminder when Notification API is absent', async () => {
    dbStub.getCheckinTemplates.mockResolvedValue([{ id: 't1', title: 'Morning Check-in' }])
    dbStub.getAllCheckinReminders.mockResolvedValue([
      { id: 'cr1', template_id: 't1', trigger_time: '10:02', days_active: null },
    ])

    const { scheduleAll } = useNotifications()
    await scheduleAll()

    expect(mockToastAdd).not.toHaveBeenCalled()

    // Advance past 10:02 (2 min = 120 000 ms)
    vi.advanceTimersByTime(120_001)

    expect(mockToastAdd).toHaveBeenCalledOnce()
    expect(mockToastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Morning Check-in',
        description: 'Time for your check-in!',
        icon: 'i-heroicons-bell',
        color: 'primary',
      }),
    )
  })

  it('does not schedule timers when Notification API is present but permission is not granted', async () => {
    ;(globalThis as Record<string, unknown>)['Notification'] = {
      permission: 'default' as NotificationPermission,
    }
    dbStub.getAllReminders.mockResolvedValue([
      { id: 'r1', habit_id: 'h1', trigger_time: '10:01', days_active: null },
    ])

    const { scheduleAll } = useNotifications()
    await scheduleAll()

    vi.advanceTimersByTime(120_000)

    expect(mockToastAdd).not.toHaveBeenCalled()
  })

  it('skips reminders whose days_active excludes today', async () => {
    // Jan 15 2024 is Monday (getDay() = 1); days_active: [3] means Wednesday only
    dbStub.getHabits.mockResolvedValue([{ id: 'h1', name: 'Morning Run' }])
    dbStub.getAllReminders.mockResolvedValue([
      { id: 'r1', habit_id: 'h1', trigger_time: '10:01', days_active: [3] },
    ])

    const { scheduleAll } = useNotifications()
    await scheduleAll()

    vi.advanceTimersByTime(60_001)

    expect(mockToastAdd).not.toHaveBeenCalled()
  })

  it('skips reminders whose trigger_time has already passed', async () => {
    dbStub.getHabits.mockResolvedValue([{ id: 'h1', name: 'Morning Run' }])
    // 09:59 is before fake-now 10:00, so it should be skipped
    dbStub.getAllReminders.mockResolvedValue([
      { id: 'r1', habit_id: 'h1', trigger_time: '09:59', days_active: null },
    ])

    const { scheduleAll } = useNotifications()
    await scheduleAll()

    vi.advanceTimersByTime(120_000)

    expect(mockToastAdd).not.toHaveBeenCalled()
  })
})
