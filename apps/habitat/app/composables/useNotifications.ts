import { Capacitor } from '@capacitor/core'
import { reactive, readonly, ref } from 'vue'

// ─── Module-level singletons ──────────────────────────────────────────────────
// Persists across composable calls so permission state stays in sync and timers
// aren't duplicated when the composable is used from multiple components.

const _permission = ref<NotificationPermission>(
  Capacitor.isNativePlatform()
    ? 'default'
    : typeof Notification !== 'undefined'
      ? Notification.permission
      : 'default',
)

// Android 12+ exact alarm permission state ('granted' | 'denied' | 'unknown')
const _exactAlarm = ref<'granted' | 'denied' | 'unknown'>('unknown')

// Android battery optimization exemption state
const _batteryOptim = ref<'exempt' | 'optimized' | 'unknown'>('unknown')

// Web persistent storage state
const _persistentStorage = ref<'granted' | 'denied' | 'unknown'>('unknown')

// In-app notification event log (visible in the diagnostics section)
export interface NotifLogEntry {
  ts: string // ISO-8601 timestamp
  event: string
  msg: string // free-form message (may be empty)
  fields: Record<string, string | number | boolean>
}
const MAX_LOG_ENTRIES = 50
const _notifLog = reactive<NotifLogEntry[]>([])

function notifLog(event: string, msg = '', fields: Record<string, string | number | boolean> = {}) {
  const ts = new Date().toISOString()
  _notifLog.unshift({ ts, event, msg, fields })
  if (_notifLog.length > MAX_LOG_ENTRIES) _notifLog.length = MAX_LOG_ENTRIES
  const parts = [`ts=${ts}`, `event=${event}`]
  if (msg) parts.push(msg.includes(' ') ? `msg="${msg}"` : `msg=${msg}`)
  for (const [k, v] of Object.entries(fields)) {
    const s = String(v)
    parts.push(s.includes(' ') || s.includes('=') ? `${k}="${s}"` : `${k}=${s}`)
  }
}

// Eagerly resolve native permission so the UI shows the correct state immediately
if (Capacitor.isNativePlatform()) {
  import('@capacitor/local-notifications')
    .then(({ LocalNotifications }) =>
      LocalNotifications.checkPermissions().then(({ display }) => {
        _permission.value =
          display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
        notifLog('init', 'native permission checked', { permission: _permission.value })
      }),
    )
    .catch(() => {})
}

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
  const toast = useToast()

  async function requestPermission(): Promise<NotificationPermission> {
    if (isNative) {
      notifLog('permission', 'requesting native permission')
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.requestPermissions()
      notifLog('permission', 'native result', { result: display, platform: 'native' })
      const mapped: NotificationPermission =
        display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
      _permission.value = mapped

      // Check exact alarm status (Android 12+) — UI will show a "Fix" button if denied
      await _checkExactAlarm(LocalNotifications)

      return mapped
    }
    if (typeof Notification === 'undefined') {
      notifLog('permission', 'Notification API unavailable')
      return 'denied'
    }
    const result = await Notification.requestPermission()
    notifLog('permission', 'web result', { result, platform: 'web' })
    _permission.value = result
    return result
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function _checkExactAlarm(LocalNotifications: any): Promise<void> {
    try {
      const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting()
      _exactAlarm.value = exact_alarm === 'granted' ? 'granted' : 'denied'
      notifLog('exactAlarm', 'status checked', { status: exact_alarm })
    } catch {
      notifLog('exactAlarm', 'checkExactNotificationSetting not available (pre-Android 12)')
      _exactAlarm.value = 'granted'
    }
  }

  async function openExactAlarmSetting(): Promise<void> {
    if (!isNative) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    try {
      notifLog('exactAlarm', 'opening system settings')
      await LocalNotifications.changeExactNotificationSetting()
      await _checkExactAlarm(LocalNotifications)
    } catch (err) {
      notifLog('exactAlarm', `changeExactNotificationSetting failed: ${err}`)
    }
  }

  async function _checkBatteryOptim(): Promise<void> {
    if (!isNative) return
    try {
      const { registerPlugin } = await import('@capacitor/core')
      const BatteryOptim = registerPlugin('BatteryOptim')
      const result = (await BatteryOptim.isIgnoringOptimizations()) as { ignoring: boolean }
      _batteryOptim.value = result.ignoring ? 'exempt' : 'optimized'
      notifLog('battery', 'optimization checked', { status: _batteryOptim.value })
    } catch (err) {
      notifLog('battery', `check failed: ${err}`)
    }
  }

  async function requestBatteryExemption(): Promise<void> {
    if (!isNative) return
    try {
      const { registerPlugin } = await import('@capacitor/core')
      const BatteryOptim = registerPlugin('BatteryOptim')
      notifLog('battery', 'requesting exemption')
      await BatteryOptim.requestIgnore()
      await _checkBatteryOptim()
    } catch (err) {
      notifLog('battery', `request failed: ${err}`)
    }
  }

  async function checkExactAlarm(): Promise<void> {
    if (!isNative) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await _checkExactAlarm(LocalNotifications)
  }

  async function checkBatteryOptim(): Promise<void> {
    await _checkBatteryOptim()
  }

  async function checkPersistentStorage(): Promise<void> {
    if (isNative || typeof navigator.storage?.persisted !== 'function') return
    try {
      const persisted = await navigator.storage.persisted()
      _persistentStorage.value = persisted ? 'granted' : 'denied'
    } catch {
      _persistentStorage.value = 'unknown'
    }
  }

  async function requestPersistentStorage(): Promise<boolean> {
    if (isNative || typeof navigator.storage?.persist !== 'function') return false
    const granted = await navigator.storage.persist()
    _persistentStorage.value = granted ? 'granted' : 'denied'
    return granted
  }

  async function requestAllPermissions(): Promise<void> {
    const result = await requestPermission()
    if (result !== 'granted') return
    if (isNative) {
      await openExactAlarmSetting()
      await requestBatteryExemption()
    }
  }

  /**
   * Re-check every permission status without prompting the user.
   * Called on visibility change so statuses stay in sync if the user
   * modifies permissions via Android/browser settings externally.
   */
  async function refreshAllStatuses(): Promise<void> {
    if (isNative) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.checkPermissions()
      _permission.value =
        display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
      await _checkExactAlarm(LocalNotifications)
      await _checkBatteryOptim()
    } else {
      if (typeof Notification !== 'undefined') {
        _permission.value = Notification.permission
      }
      await checkPersistentStorage()
    }
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
    notifLog('scheduleAll', '', { platform: isNative ? 'native' : 'web' })
    if (isNative) {
      await _scheduleAllNative()
    } else {
      await _scheduleAllWeb()
    }
  }

  // ── Native path ─────────────────────────────────────────────────────────────
  // Uses schedule.on (cron-style repeating alarms) instead of schedule.at (one-time).
  // The OS fires these automatically on the specified weekday/hour/minute forever,
  // so the user never needs to open the app to reschedule.
  //
  // Capacitor Weekday enum: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
  // JS Date.getDay():       0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  // Conversion: capacitorWeekday = jsDay + 1

  const NOTIF_CHANNEL_ID = 'habitat-reminders'

  function jsToCapacitorWeekday(jsDay: number): number {
    return jsDay + 1
  }

  async function _ensureChannel(): Promise<void> {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    try {
      await LocalNotifications.createChannel({
        id: NOTIF_CHANNEL_ID,
        name: 'Habit Reminders',
        description: 'Notifications for scheduled habit and check-in reminders',
        importance: 5,
        visibility: 1,
        vibration: true,
        sound: 'default',
      })
      notifLog('channel', `ensured channel "${NOTIF_CHANNEL_ID}" (importance=5)`)
    } catch (err) {
      notifLog('channel', `createChannel error: ${err}`)
    }
  }

  async function _scheduleAllNative(): Promise<void> {
    const { LocalNotifications } = await import('@capacitor/local-notifications')

    const { display } = await LocalNotifications.checkPermissions()
    const mapped: NotificationPermission =
      display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'
    _permission.value = mapped
    notifLog('schedule', `permission = ${mapped}`)
    if (mapped !== 'granted') return

    // Check exact alarm setting (Android 12+) — UI shows "Fix" button if denied
    await _checkExactAlarm(LocalNotifications)

    // Check battery optimization — UI shows warning if optimized
    await _checkBatteryOptim()

    // Ensure notification channel exists with high importance
    await _ensureChannel()

    const { notifications: pending } = await LocalNotifications.getPending()
    notifLog('schedule', 'cancelling pending', { count: pending.length })
    if (pending.length > 0) await LocalNotifications.cancel({ notifications: pending })

    const db = useDatabase()

    let retries = 0
    while (!db.isAvailable && retries < 10) {
      notifLog('schedule', `DB not ready, retry ${retries + 1}`)
      await new Promise((r) => setTimeout(r, 500))
      retries++
    }
    if (!db.isAvailable) {
      notifLog('schedule', 'DB not available after retries — aborting')
      return
    }

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    notifLog('schedule', 'found reminders', {
      habits: reminders.length,
      checkins: checkinReminders.length,
    })
    if (reminders.length === 0 && checkinReminders.length === 0) return

    const habitMap = new Map(habits.map((h) => [h.id, h.name]))
    const templateMap = new Map(templates.map((t) => [t.id, t.title]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toSchedule: any[] = []

    for (const reminder of reminders) {
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const hour = Number(hhStr)
      const minute = Number(mmStr)
      const title = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      const extra = { type: 'habit', habitId: reminder.habit_id }

      if (reminder.days_active === null) {
        toSchedule.push({
          id: hashId(`${reminder.id}:daily`),
          title,
          body: 'Time for your habit!',
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          channelId: NOTIF_CHANNEL_ID,
          extra,
        })
      } else {
        for (const jsDay of reminder.days_active) {
          toSchedule.push({
            id: hashId(`${reminder.id}:wd${jsDay}`),
            title,
            body: 'Time for your habit!',
            schedule: {
              on: { weekday: jsToCapacitorWeekday(jsDay), hour, minute },
              allowWhileIdle: true,
            },
            channelId: NOTIF_CHANNEL_ID,
            extra,
          })
        }
      }
    }

    for (const reminder of checkinReminders) {
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const hour = Number(hhStr)
      const minute = Number(mmStr)
      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      const extra = { type: 'checkin', templateId: reminder.template_id }

      if (reminder.days_active === null) {
        toSchedule.push({
          id: hashId(`${reminder.id}:daily`),
          title,
          body: 'Time for your check-in!',
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          channelId: NOTIF_CHANNEL_ID,
          extra,
        })
      } else {
        for (const jsDay of reminder.days_active) {
          toSchedule.push({
            id: hashId(`${reminder.id}:wd${jsDay}`),
            title,
            body: 'Time for your check-in!',
            schedule: {
              on: { weekday: jsToCapacitorWeekday(jsDay), hour, minute },
              allowWhileIdle: true,
            },
            channelId: NOTIF_CHANNEL_ID,
            extra,
          })
        }
      }
    }

    notifLog('schedule', 'scheduling alarms', { count: toSchedule.length })

    if (toSchedule.length > 0) {
      try {
        await LocalNotifications.schedule({ notifications: toSchedule })
        notifLog('schedule', 'schedule() OK', { registered: toSchedule.length })
      } catch (err) {
        notifLog('schedule', `schedule() FAILED: ${err}`)
      }

      // Verify alarms are actually pending in the OS
      const { notifications: afterPending } = await LocalNotifications.getPending()
      notifLog('verify', 'getPending() after scheduling', { pending: afterPending.length })
    }
  }

  // ── Web path ─────────────────────────────────────────────────────────────────

  async function _scheduleAllWeb(): Promise<void> {
    clearTimers()
    const toastOnly = typeof Notification === 'undefined'
    if (toastOnly) {
      notifLog('webSchedule', 'Notification API unavailable — will use toast fallback')
    } else {
      _permission.value = Notification.permission
      notifLog('webSchedule', `permission = ${_permission.value}`)
      if (_permission.value !== 'granted') return
    }

    const db = useDatabase()
    let retries = 0
    while (!db.isAvailable && retries < 10) {
      notifLog('webSchedule', `DB not ready, retry ${retries + 1}`)
      await new Promise((r) => setTimeout(r, 500))
      retries++
    }
    if (!db.isAvailable) {
      notifLog('webSchedule', 'DB not available after retries — aborting')
      return
    }

    const [habits, reminders, checkinReminders, templates] = await Promise.all([
      db.getHabits(),
      db.getAllReminders(),
      db.getAllCheckinReminders(),
      db.getCheckinTemplates(),
    ])

    notifLog('webSchedule', 'found reminders', {
      habits: reminders.length,
      checkins: checkinReminders.length,
    })
    if (reminders.length === 0 && checkinReminders.length === 0) return

    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) {
        console.warn('[Notif] SW unavailable:', err)
      }
    }
    notifLog('webSchedule', `SW = ${swReg ? 'available' : 'null'}, active = ${!!swReg?.active}`)

    function showNotif(title: string, body: string) {
      notifLog('fire', `${title}: ${body}`)
      if (toastOnly) {
        toast.add({ title, description: body, icon: 'i-heroicons-bell', color: 'primary' })
        return
      }
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
    const habitMap = new Map(habits.map((h) => [h.id, h.name]))
    const templateMap = new Map(templates.map((t) => [t.id, t.title]))

    interface SwReminder {
      id: string
      title: string
      body: string
      at: string
      icon: string
    }
    const swSchedule: SwReminder[] = []

    for (const reminder of reminders) {
      const title = habitMap.get(reminder.habit_id) ?? 'Habit reminder'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        notifLog(
          'webSchedule',
          `SKIP ${title} — days_active ${JSON.stringify(reminder.days_active)} excludes ${todayDow}`,
        )
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        notifLog('webSchedule', `SKIP ${title} — ${reminder.trigger_time} <= ${currentHHMM}`)
        continue
      }
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) continue
      notifLog('webSchedule', `timer: ${title} at ${reminder.trigger_time} (${delay}ms)`)
      _timers.push(setTimeout(() => showNotif(title, 'Time for your habit!'), delay))
      swSchedule.push({
        id: reminder.id,
        title,
        body: 'Time for your habit!',
        at: at.toISOString(),
        icon: iconURL,
      })
    }

    for (const reminder of checkinReminders) {
      const title = templateMap.get(reminder.template_id) ?? 'Check-in'
      if (reminder.days_active !== null && !reminder.days_active.includes(todayDow)) {
        notifLog(
          'webSchedule',
          `SKIP ${title} — days_active ${JSON.stringify(reminder.days_active)} excludes ${todayDow}`,
        )
        continue
      }
      if (reminder.trigger_time <= currentHHMM) {
        notifLog('webSchedule', `SKIP ${title} — ${reminder.trigger_time} <= ${currentHHMM}`)
        continue
      }
      const [hhStr, mmStr] = reminder.trigger_time.split(':')
      const at = new Date(now)
      at.setHours(Number(hhStr), Number(mmStr), 0, 0)
      const delay = at.getTime() - now.getTime()
      if (delay <= 0) continue
      notifLog('webSchedule', `timer: ${title} at ${reminder.trigger_time} (${delay}ms)`)
      _timers.push(setTimeout(() => showNotif(title, 'Time for your check-in!'), delay))
      swSchedule.push({
        id: reminder.id,
        title,
        body: 'Time for your check-in!',
        at: at.toISOString(),
        icon: iconURL,
      })
    }

    notifLog('webSchedule', 'scheduled', { timers: _timers.length, sw: swSchedule.length })

    if (swReg?.active) {
      swReg.active.postMessage({ type: 'SCHEDULE_REMINDERS', reminders: swSchedule })
      notifLog('webSchedule', 'posted SCHEDULE_REMINDERS to SW')
      if ('periodicSync' in swReg) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (swReg as any).periodicSync.register('check-reminders', { minInterval: 55_000 })
          notifLog('webSchedule', 'periodicSync registered')
        } catch (err) {
          notifLog('webSchedule', `periodicSync unavailable: ${err}`)
        }
      }
    }
  }

  // ── Test notification ────────────────────────────────────────────────────────

  async function sendTestNotification(): Promise<void> {
    notifLog('test', `platform = ${isNative ? 'native' : 'web'}`)
    if (isNative) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const { display } = await LocalNotifications.checkPermissions()
      notifLog('test', `native permission = ${display}`)
      if (display !== 'granted') return
      const at = new Date(Date.now() + 500)
      notifLog('test', `scheduling native test at ${at.toISOString()}`)
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 999_999,
            title: 'Habitat',
            body: 'Notifications are working!',
            schedule: { at, allowWhileIdle: true },
          },
        ],
      })
      notifLog('test', 'native schedule() completed')
      return
    }

    const title = 'Habitat'
    const body = `Test at ${new Date().toLocaleTimeString()}`

    if (typeof Notification === 'undefined') {
      notifLog('test', 'Notification API unavailable — using toast fallback')
      toast.add({ title, description: body, icon: 'i-heroicons-bell', color: 'primary' })
      return
    }
    _permission.value = Notification.permission
    notifLog('test', `web permission = ${_permission.value}`)
    if (_permission.value !== 'granted') return

    let swReg: ServiceWorkerRegistration | null = null
    if ('serviceWorker' in navigator) {
      try {
        swReg = await Promise.race<ServiceWorkerRegistration | null>([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
      } catch (err) {
        console.warn('[Notif] SW unavailable for test notification:', err)
      }
    }

    const opts: NotificationOptions = {
      body,
      icon: iconURL,
      requireInteraction: true,
      tag: `test-${Date.now()}`,
    }

    if (swReg) {
      notifLog('test', `SW state: active=${swReg.active?.state}, scope=${swReg.scope}`)
      try {
        await swReg.showNotification(title, opts)
        notifLog('test', 'SW showNotification OK')
      } catch (err) {
        notifLog('test', `SW showNotification failed: ${err}`)
      }
    }

    try {
      const n = new Notification(title, { ...opts, tag: `test-direct-${Date.now()}` })
      notifLog('test', 'direct Notification created')
      n.onshow = () => notifLog('test', 'direct Notification onshow')
      n.onerror = (e) => notifLog('test', `direct Notification onerror: ${e}`)
    } catch (err) {
      notifLog('test', `direct Notification constructor threw: ${err}`)
    }
  }

  /**
   * Test the schedule.on mechanism specifically. Schedules a repeating alarm
   * for 2 minutes from now using the same API as real reminders. If this
   * fires but real reminders don't, the issue is in the reminder data.
   * If this doesn't fire either, the schedule.on API itself is broken on
   * this device.
   */
  async function testScheduleOn(): Promise<void> {
    if (!isNative) {
      notifLog('testOn', 'only works on native')
      return
    }
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const { display } = await LocalNotifications.checkPermissions()
    notifLog('testOn', `permission = ${display}`)
    if (display !== 'granted') return

    await _ensureChannel()

    const now = new Date()
    const futureMin = now.getMinutes() + 2
    const hour = futureMin >= 60 ? (now.getHours() + 1) % 24 : now.getHours()
    const minute = futureMin % 60

    const notification = {
      id: 999_998,
      title: 'Habitat (schedule.on test)',
      body: `Repeating alarm test — was scheduled for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      schedule: { on: { hour, minute }, allowWhileIdle: true },
      channelId: NOTIF_CHANNEL_ID,
    }

    notifLog(
      'testOn',
      `scheduling schedule.on for ${hour}:${String(minute).padStart(2, '0')} (≈2 min from now)`,
    )
    try {
      await LocalNotifications.schedule({ notifications: [notification] })
      notifLog('testOn', 'schedule() OK')
      const { notifications: pending } = await LocalNotifications.getPending()
      notifLog(
        'testOn',
        `getPending: ${pending.length} pending — IDs: ${pending.map((n) => n.id).join(', ')}`,
      )
    } catch (err) {
      notifLog('testOn', `FAILED: ${err}`)
    }
  }

  /**
   * Register listeners for notification delivery + taps on native.
   * - localNotificationReceived: logs delivery confirmation
   * - localNotificationActionPerformed: navigates to the relevant page
   * Call once from app.vue on mount; no-op on web.
   */
  async function registerNativeListeners(): Promise<void> {
    if (!isNative) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const router = useRouter()

    await LocalNotifications.addListener('localNotificationReceived', (notification) => {
      notifLog('received', notification.title ?? '', { id: notification.id })
    })

    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const extra = event.notification.extra as Record<string, string> | undefined
      notifLog('tapped', '', { id: event.notification.id, type: extra?.type ?? 'unknown' })
      if (!extra) return
      if (extra.type === 'habit' && extra.habitId) {
        router.push(`/habits/${extra.habitId}`)
      } else if (extra.type === 'checkin' && extra.templateId) {
        router.push(`/checkin/${extra.templateId}`)
      }
    })
    notifLog('init', 'native listeners registered (received + tap)')
  }

  return {
    permission: readonly(_permission),
    exactAlarm: readonly(_exactAlarm),
    batteryOptim: readonly(_batteryOptim),
    persistentStorage: readonly(_persistentStorage),
    notifLog: readonly(_notifLog),
    requestPermission,
    openExactAlarmSetting,
    requestBatteryExemption,
    checkExactAlarm,
    checkBatteryOptim,
    checkPersistentStorage,
    requestPersistentStorage,
    requestAllPermissions,
    refreshAllStatuses,
    scheduleAll,
    sendTestNotification,
    testScheduleOn,
    registerNativeListeners,
  }
}
