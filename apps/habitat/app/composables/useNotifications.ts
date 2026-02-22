import { ref, readonly } from 'vue'

// ─── Module-level singletons ──────────────────────────────────────────────────
// Persists across composable calls so permission state stays in sync and timers
// aren't duplicated when the composable is used from multiple components.

const _permission = ref<NotificationPermission>(
  typeof Notification !== 'undefined' ? Notification.permission : 'default',
)

const _timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  for (const t of _timers) clearTimeout(t)
  _timers.length = 0
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useNotifications() {
  const baseURL = useNuxtApp().$config.app.baseURL
  const iconURL = `${baseURL}icons/icon-192.png`

  async function requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'denied'
    const result = await Notification.requestPermission()
    _permission.value = result
    return result
  }

  /**
   * Clears existing timers and schedules a setTimeout for every reminder that:
   *  - applies today (days_active is null or includes today's day-of-week), and
   *  - hasn't already fired (trigger_time > current HH:MM).
   * Must be called on mount and whenever the tab regains visibility.
   */
  async function scheduleAll(): Promise<void> {
    clearTimers()
    if (typeof Notification === 'undefined') return
    // Sync permission (user may have changed it in browser settings)
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

    // Chrome (and Chrome-based browsers) silently ignores new Notification() from
    // the main thread when a service worker is registered — it requires
    // ServiceWorkerRegistration.showNotification() instead. Resolve the SW
    // registration once up front so the timers can use it. The 3 s race timeout
    // means environments without a SW (native builds, dev without SW) fall back
    // to the direct Notification constructor.
    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) { console.warn('[useNotifications] SW registration unavailable, falling back to direct Notification:', err) }
    }

    function showNotif(title: string, body: string) {
      if (Notification.permission !== 'granted') return
      const opts: NotificationOptions = { body, icon: iconURL }
      if (swReg) {
        swReg.showNotification(title, opts).catch(() => {
          // SW showNotification failed; fall back to main-thread notification
          new Notification(title, opts)
        })
      } else {
        new Notification(title, opts)
      }
    }

    const now = new Date()
    const todayDow = now.getDay()  // 0=Sun … 6=Sat
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const habitMap = new Map(habits.map(h => [h.id, h.name]))
    const templateMap = new Map(templates.map(t => [t.id, t.title]))

    for (const reminder of reminders) {
      // Skip if reminder doesn't apply today
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      // Skip if the time has already passed
      if (reminder.trigger_time <= currentHHMM) continue

      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const target = new Date(now)
      target.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = target.getTime() - now.getTime()
      if (delay <= 0) continue

      const habitName = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      _timers.push(setTimeout(() => showNotif(habitName, 'Time for your habit!'), delay))
    }

    for (const reminder of checkinReminders) {
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) continue
      if (reminder.trigger_time <= currentHHMM) continue

      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const target = new Date(now)
      target.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = target.getTime() - now.getTime()
      if (delay <= 0) continue

      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      _timers.push(setTimeout(() => showNotif(title, 'Time for your check-in!'), delay))
    }
  }

  async function sendTestNotification(): Promise<void> {
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
      swReg.showNotification(title, opts).catch(() => { new Notification(title, opts) })
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
