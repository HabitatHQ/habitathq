import { ref, readonly } from 'vue'
import { Capacitor } from '@capacitor/core'

// ─── Module-level singletons ──────────────────────────────────────────────────
// Persists across composable calls so permission state stays in sync and timers
// aren't duplicated when the composable is used from multiple components.

const _permission = ref<NotificationPermission>(
  typeof Notification !== 'undefined' ? Notification.permission : 'default',
)

// Web-only: setTimeout handles for foreground notifications
const _timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  for (const t of _timers) clearTimeout(t)
  _timers.length = 0
}

// Deterministic hash of a UUID string → positive 32-bit int (LocalNotifications needs numeric IDs)
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return Math.abs(h) || 1 // never 0
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useNotifications() {
  const baseURL = useNuxtApp().$config.app.baseURL
  const iconURL = `${baseURL}icons/icon-192.png`
  const isNative = Capacitor.isNativePlatform()

  async function requestPermission(): Promise<NotificationPermission> {
    if (isNative) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.requestPermissions()
      const mapped: NotificationPermission =
        display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
      _permission.value = mapped
      return mapped
    }
    if (typeof Notification === 'undefined') return 'denied'
    const result = await Notification.requestPermission()
    _permission.value = result
    return result
  }

  /**
   * Clears existing timers and schedules notifications for every reminder that:
   *  - applies today (days_active is null or includes today's day-of-week), and
   *  - hasn't already fired (trigger_time > current HH:MM).
   *
   * On native: uses @capacitor/local-notifications (fires even when app is closed).
   * On web: setTimeout for foreground + SW postMessage + Periodic Background Sync.
   */
  async function scheduleAll(): Promise<void> {
    if (isNative) {
      await _scheduleAllNative()
    } else {
      await _scheduleAllWeb()
    }
  }

  // ── Native path ─────────────────────────────────────────────────────────────

  async function _scheduleAllNative(): Promise<void> {
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const { display } = await LocalNotifications.checkPermissions()
    const mapped: NotificationPermission =
      display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
    _permission.value = mapped
    if (mapped !== 'granted') return

    // Cancel previously scheduled so we don't double-fire
    const { notifications: pending } = await LocalNotifications.getPending()
    if (pending.length > 0) await LocalNotifications.cancel({ notifications: pending })

    const db = useDatabase()
    if (!db.isAvailable) return

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    if (reminders.length === 0 && checkinReminders.length === 0) return

    const now = new Date()
    const todayDow = now.getDay()
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const habitMap = new Map(habits.map(h => [h.id, h.name]))
    const templateMap = new Map(templates.map(t => [t.id, t.title]))

    const toSchedule: { id: number; title: string; body: string; schedule: { at: Date } }[] = []

    for (const reminder of reminders) {
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      if (reminder.trigger_time <= currentHHMM) continue
      const parts = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
      toSchedule.push({
        id: hashId(reminder.id),
        title: habitMap.get(reminder.habit_id) ?? 'Habit reminder',
        body: 'Time for your habit!',
        schedule: { at },
      })
    }

    for (const reminder of checkinReminders) {
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      if (reminder.trigger_time <= currentHHMM) continue
      const parts = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
      toSchedule.push({
        id: hashId(reminder.id),
        title: templateMap.get(reminder.template_id) ?? 'Check-in',
        body: 'Time for your check-in!',
        schedule: { at },
      })
    }

    if (toSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: toSchedule })
    }
  }

  // ── Web path ─────────────────────────────────────────────────────────────────

  async function _scheduleAllWeb(): Promise<void> {
    clearTimers()
    if (typeof Notification === 'undefined') return
    _permission.value = Notification.permission
    if (_permission.value !== 'granted') return

    const db = useDatabase()
    if (!db.isAvailable) return

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    if (reminders.length === 0 && checkinReminders.length === 0) return

    // Chrome requires showNotification() via SW when a SW is registered.
    // Resolve once up-front; 3 s timeout falls back to direct Notification.
    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) { console.warn('[useNotifications] SW unavailable:', err) }
    }

    function showNotif(title: string, body: string) {
      if (Notification.permission !== 'granted') return
      const opts: NotificationOptions = { body, icon: iconURL }
      if (swReg) {
        swReg.showNotification(title, opts).catch(() => new Notification(title, opts))
      } else {
        new Notification(title, opts)
      }
    }

    const now = new Date()
    const todayDow = now.getDay()
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const habitMap = new Map(habits.map(h => [h.id, h.name]))
    const templateMap = new Map(templates.map(t => [t.id, t.title]))

    // Scheduled entries forwarded to the SW for background firing
    interface SwReminder { id: string; title: string; body: string; at: string; icon: string }
    const swSchedule: SwReminder[] = []

    for (const reminder of reminders) {
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      if (reminder.trigger_time <= currentHHMM) continue
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) continue
      const title = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      _timers.push(setTimeout(() => showNotif(title, 'Time for your habit!'), delay))
      swSchedule.push({ id: reminder.id, title, body: 'Time for your habit!', at: at.toISOString(), icon: iconURL })
    }

    for (const reminder of checkinReminders) {
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      if (reminder.trigger_time <= currentHHMM) continue
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) continue
      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      _timers.push(setTimeout(() => showNotif(title, 'Time for your check-in!'), delay))
      swSchedule.push({ id: reminder.id, title, body: 'Time for your check-in!', at: at.toISOString(), icon: iconURL })
    }

    // Pass schedule to SW so it can fire notifications if the page is backgrounded.
    // Periodic Background Sync (Chrome Android only) wakes the SW on a schedule;
    // the SW checks stored reminders and shows any that are due.
    if (swReg?.active) {
      swReg.active.postMessage({ type: 'SCHEDULE_REMINDERS', reminders: swSchedule })
      if ('periodicSync' in swReg) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (swReg as any).periodicSync.register('check-reminders', { minInterval: 55_000 })
        } catch { /* unavailable or permission denied */ }
      }
    }
  }

  // ── Test notification ────────────────────────────────────────────────────────

  async function sendTestNotification(): Promise<void> {
    if (isNative) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.checkPermissions()
      if (display !== 'granted') return
      await LocalNotifications.schedule({
        notifications: [{ id: 999_999, title: 'Habitat', body: 'Notifications are working!', schedule: { at: new Date(Date.now() + 500) } }],
      })
      return
    }

    if (typeof Notification === 'undefined') return
    _permission.value = Notification.permission
    if (_permission.value !== 'granted') return

    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) { console.warn('[useNotifications] SW unavailable for test notification:', err) }
    }

    const title = 'Habitat'
    const opts: NotificationOptions = { body: 'Notifications are working!', icon: iconURL }
    if (swReg) {
      swReg.showNotification(title, opts).catch(() => new Notification(title, opts))
    } else {
      new Notification(title, opts)
    }
  }

  return {
    permission: readonly(_permission),
    requestPermission,
    scheduleAll,
    sendTestNotification,
  }
}
