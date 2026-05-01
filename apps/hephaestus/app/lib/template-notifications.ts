export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export interface WorkoutReminder {
  templateId: string
  templateName: string
  time: string // HH:MM
  days: number[] // 0=Sun..6=Sat
}

export function buildWorkoutReminder(
  templateId: string,
  templateName: string,
  time: string,
  days: number[],
): WorkoutReminder {
  return { templateId, templateName, time, days }
}

/**
 * Schedule a workout reminder using setTimeout.
 * Returns a cleanup function.
 * MVP: uses setTimeout for same-day notifications only.
 */
export function scheduleWorkoutReminder(reminder: WorkoutReminder): () => void {
  const timeouts: ReturnType<typeof setTimeout>[] = []

  const [hoursStr, minutesStr] = reminder.time.split(':')
  const hours = Number.parseInt(hoursStr ?? '8', 10)
  const minutes = Number.parseInt(minutesStr ?? '0', 10)

  const now = new Date()
  const today = now.getDay()

  if (!reminder.days.includes(today)) {
    return () => {}
  }

  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)

  const msUntil = target.getTime() - now.getTime()
  if (msUntil < 0) return () => {}

  const timeout = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification(`🏋️ Time to train: ${reminder.templateName}`, {
        body: "Your workout is scheduled for today. Let's go!",
        tag: `workout-${reminder.templateId}`,
      })
    }
  }, msUntil)

  timeouts.push(timeout)

  return () => {
    for (const t of timeouts) clearTimeout(t)
  }
}
