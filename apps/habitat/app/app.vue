<script setup lang="ts">
import { Capacitor } from '@capacitor/core'

const db = useDatabase()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { scheduleAll } = useNotifications()

onMounted(async () => {
  // OPFS check only applies to the web path — native uses Capacitor SQLite instead
  if (!Capacitor.isNativePlatform() && typeof navigator.storage?.getDirectory !== 'function') {
    opfsUnsupported.value = true
    return
  }

  if (!db.isAvailable) return

  // ── 1. Request persistent storage once (tracked in applied_defaults) ─────
  // Upgrades the origin's storage bucket from best-effort to persistent so
  // the browser won't evict OPFS without explicit user action.
  const persistKey = 'storage:persist_requested'
  if (!(await db.isDefaultApplied(persistKey))) {
    await navigator.storage.persist()
    await db.markDefaultApplied(persistKey)
  }

  // ── 2. Sentinel: detect potential OPFS eviction ──────────────────────────
  // localStorage survives OPFS eviction. If 'habitat-has-data' is set but
  // the DB is empty, data was likely cleared by the browser.
  const hadData = localStorage.getItem('habitat-has-data') === '1'
  const habits = await db.getHabits()
  if (habits.length > 0) {
    localStorage.setItem('habitat-has-data', '1')
  } else if (hadData) {
    evictionDetected.value = true
    localStorage.removeItem('habitat-has-data') // reset so the banner doesn't persist across sessions
  }

  // ── 3. Schedule today's habit reminders ───────────────────────────────────
  // Re-schedules whenever the tab becomes visible so timers that expired while
  // the tab was in the background are re-evaluated for the current time.
  scheduleAll().catch(console.error)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleAll().catch(console.error)
  })
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
