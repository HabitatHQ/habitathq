<script setup lang="ts">
import { Capacitor } from '@capacitor/core'

const db = useDatabase()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { scheduleAll, registerNativeListeners } = useNotifications()

onMounted(async () => {
  // ── 1. Notifications — runs independently of DB readiness ───────────────
  // scheduleAll() has its own internal DB check with retry, so it's safe to
  // call immediately. Re-schedule on every visibility change too.
  scheduleAll().catch(console.error)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleAll().catch(console.error)
  })
  registerNativeListeners().catch(console.error)

  // ── 2. OPFS check (web only) ───────────────────────────────────────────
  if (!Capacitor.isNativePlatform() && typeof navigator.storage?.getDirectory !== 'function') {
    opfsUnsupported.value = true
    return
  }

  if (!db.isAvailable) return

  // ── 3. Request persistent storage once (tracked in applied_defaults) ────
  const persistKey = 'storage:persist_requested'
  if (!(await db.isDefaultApplied(persistKey))) {
    await navigator.storage.persist()
    await db.markDefaultApplied(persistKey)
  }

  // ── 4. Sentinel: detect potential OPFS eviction ─────────────────────────
  const hadData = localStorage.getItem('habitat-has-data') === '1'
  const habits = await db.getHabits()
  if (habits.length > 0) {
    localStorage.setItem('habitat-has-data', '1')
  } else if (hadData) {
    evictionDetected.value = true
    localStorage.removeItem('habitat-has-data')
  }
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
