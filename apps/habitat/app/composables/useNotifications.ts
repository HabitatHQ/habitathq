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
      console.debug('[Notif] requestPermission: native path')
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.requestPermissions()
      console.debug('[Notif] requestPermission: native display =', display)
      const mapped: NotificationPermission =
        display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
      _permission.value = mapped
      return mapped
    }
    if (typeof Notification === 'undefined') {
      console.debug('[Notif] requestPermission: Notification API unavailable')
      return 'denied'
    }
    const result = await Notification.requestPermission()
    console.debug('[Notif] requestPermission: web result =', result)
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
    console.debug('[Notif] scheduleAll: platform =', isNative ? 'native' : 'web')
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
    console.debug('[Notif] _scheduleAllNative: permission =', mapped)
    if (mapped !== 'granted') return

    const { notifications: pending } = await LocalNotifications.getPending()
    console.debug('[Notif] _scheduleAllNative: cancelling', pending.length, 'pending notifications')
    if (pending.length > 0) await LocalNotifications.cancel({ notifications: pending })

    const db = useDatabase()
    if (!db.isAvailable) {
      console.debug('[Notif] _scheduleAllNative: DB not available, aborting')
      return
    }

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    console.debug('[Notif] _scheduleAllNative: found', reminders.length, 'habit reminders,', checkinReminders.length, 'checkin reminders')
    if (reminders.length === 0 && checkinReminders.length === 0) return

    const now = new Date()
    const todayDow = now.getDay()
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const habitMap = new Map(habits.map(h => [h.id, h.name]))
    const templateMap = new Map(templates.map(t => [t.id, t.title]))

    const toSchedule: { id: number; title: string; body: string; schedule: { at: Date } }[] = []

    for (const reminder of reminders) {
      const title = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        console.debug('[Notif] _scheduleAllNative: SKIP', title, '— days_active', reminder.days_active, 'does not include today (', todayDow, ')')
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        console.debug('[Notif] _scheduleAllNative: SKIP', title, '— trigger_time', reminder.trigger_time, '<= current', currentHHMM)
        continue
      }
      const parts = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
      toSchedule.push({
        id: hashId(reminder.id),
        title,
        body: 'Time for your habit!',
        schedule: { at },
      })
    }

    for (const reminder of checkinReminders) {
      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        console.debug('[Notif] _scheduleAllNative: SKIP', title, '— days_active', reminder.days_active, 'does not include today (', todayDow, ')')
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        console.debug('[Notif] _scheduleAllNative: SKIP', title, '— trigger_time', reminder.trigger_time, '<= current', currentHHMM)
        continue
      }
      const parts = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
      toSchedule.push({
        id: hashId(reminder.id),
        title,
        body: 'Time for your check-in!',
        schedule: { at },
      })
    }

    console.debug('[Notif] _scheduleAllNative: scheduling', toSchedule.length, 'notifications', toSchedule.map(n => ({ id: n.id, title: n.title, at: n.schedule.at.toISOString() })))
    if (toSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: toSchedule })
      console.debug('[Notif] _scheduleAllNative: schedule() call completed')
    }
  }

  // ── Web path ─────────────────────────────────────────────────────────────────

  async function _scheduleAllWeb(): Promise<void> {
    clearTimers()
    if (typeof Notification === 'undefined') {
      console.debug('[Notif] _scheduleAllWeb: Notification API unavailable')
      return
    }
    _permission.value = Notification.permission
    console.debug('[Notif] _scheduleAllWeb: permission =', _permission.value)
    if (_permission.value !== 'granted') return

    const db = useDatabase()
    if (!db.isAvailable) {
      console.debug('[Notif] _scheduleAllWeb: DB not available, aborting')
      return
    }

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    console.debug('[Notif] _scheduleAllWeb: found', reminders.length, 'habit reminders,', checkinReminders.length, 'checkin reminders')
    if (reminders.length === 0 && checkinReminders.length === 0) return

    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) { console.warn('[Notif] SW unavailable:', err) }
    }
    console.debug('[Notif] _scheduleAllWeb: SW registration =', swReg ? 'available' : 'null', ', active =', !!swReg?.active)

    function showNotif(title: string, body: string) {
      console.debug('[Notif] showNotif: firing', title, body, '| swReg =', !!swReg)
      if (Notification.permission !== 'granted') return
      const opts: NotificationOptions = { body, icon: iconURL, requireInteraction: true }
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

    interface SwReminder { id: string; title: string; body: string; at: string; icon: string }
    const swSchedule: SwReminder[] = []

    for (const reminder of reminders) {
      const title = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— days_active', reminder.days_active, 'does not include today (', todayDow, ')')
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— trigger_time', reminder.trigger_time, '<= current', currentHHMM)
        continue
      }
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— computed delay', delay, 'ms <= 0')
        continue
      }
      console.debug('[Notif] _scheduleAllWeb: timer for', title, 'at', reminder.trigger_time, '(delay', delay, 'ms)')
      _timers.push(setTimeout(() => showNotif(title, 'Time for your habit!'), delay))
      swSchedule.push({ id: reminder.id, title, body: 'Time for your habit!', at: at.toISOString(), icon: iconURL })
    }

    for (const reminder of checkinReminders) {
      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— days_active', reminder.days_active, 'does not include today (', todayDow, ')')
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— trigger_time', reminder.trigger_time, '<= current', currentHHMM)
        continue
      }
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) {
        console.debug('[Notif] _scheduleAllWeb: SKIP', title, '— computed delay', delay, 'ms <= 0')
        continue
      }
      console.debug('[Notif] _scheduleAllWeb: timer for', title, 'at', reminder.trigger_time, '(delay', delay, 'ms)')
      _timers.push(setTimeout(() => showNotif(title, 'Time for your check-in!'), delay))
      swSchedule.push({ id: reminder.id, title, body: 'Time for your check-in!', at: at.toISOString(), icon: iconURL })
    }

    console.debug('[Notif] _scheduleAllWeb: scheduled', _timers.length, 'foreground timers,', swSchedule.length, 'SW reminders')

    if (swReg?.active) {
      swReg.active.postMessage({ type: 'SCHEDULE_REMINDERS', reminders: swSchedule })
      console.debug('[Notif] _scheduleAllWeb: posted SCHEDULE_REMINDERS to SW')
      if ('periodicSync' in swReg) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (swReg as any).periodicSync.register('check-reminders', { minInterval: 55_000 })
          console.debug('[Notif] _scheduleAllWeb: periodicSync registered')
        } catch (err) { console.debug('[Notif] _scheduleAllWeb: periodicSync unavailable:', err) }
      }
    }
  }

  // ── Test notification ────────────────────────────────────────────────────────

  async function sendTestNotification(): Promise<void> {
    console.debug('[Notif] sendTestNotification: platform =', isNative ? 'native' : 'web')
    if (isNative) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.checkPermissions()
      console.debug('[Notif] sendTestNotification: native permission =', display)
      if (display !== 'granted') return
      const at = new Date(Date.now() + 500)
      console.debug('[Notif] sendTestNotification: scheduling native test at', at.toISOString())
      await LocalNotifications.schedule({
        notifications: [{ id: 999_999, title: 'Habitat', body: 'Notifications are working!', schedule: { at } }],
      })
      console.debug('[Notif] sendTestNotification: native schedule() completed')
      return
    }

    if (typeof Notification === 'undefined') {
      console.debug('[Notif] sendTestNotification: Notification API unavailable')
      return
    }
    _permission.value = Notification.permission
    console.debug('[Notif] sendTestNotification: web permission =', _permission.value)
    if (_permission.value !== 'granted') return

    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) { console.warn('[Notif] SW unavailable for test notification:', err) }
    }

    const title = 'Habitat'
    const body = `Test at ${new Date().toLocaleTimeString()}`
    const opts: NotificationOptions = { body, icon: iconURL, requireInteraction: true, tag: `test-${Date.now()}` }

    if (swReg) {
      console.debug('[Notif] sendTestNotification: SW state —', {
        installing: swReg.installing?.state,
        waiting: swReg.waiting?.state,
        active: swReg.active?.state,
        scope: swReg.scope,
      })
      try {
        await swReg.showNotification(title, opts)
        console.debug('[Notif] sendTestNotification: SW showNotification resolved OK')
      } catch (err) {
        console.warn('[Notif] sendTestNotification: SW showNotification failed:', err)
      }
    }

    try {
      const n = new Notification(title, { ...opts, tag: `test-direct-${Date.now()}` })
      console.debug('[Notif] sendTestNotification: direct Notification created, permission =', Notification.permission)
      n.onshow = () => console.debug('[Notif] sendTestNotification: direct Notification onshow fired')
      n.onerror = (e) => console.warn('[Notif] sendTestNotification: direct Notification onerror:', e)
    } catch (err) {
      console.warn('[Notif] sendTestNotification: direct Notification constructor threw:', err)
    }
  }

  return {
    permission: readonly(_permission),
    requestPermission,
    scheduleAll,
    sendTestNotification,
  }
}
