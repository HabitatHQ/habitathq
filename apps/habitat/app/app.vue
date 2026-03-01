<script setup lang="ts">
import { Capacitor } from '@capacitor/core'

const db = useDatabase()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { scheduleAll, registerNativeListeners, requestAllPermissions, refreshAllStatuses } = useNotifications()

const isNative = Capacitor.isNativePlatform()
const ONBOARDED_KEY = 'habitat-permissions-onboarded'
const showPermissionModal = ref(false)
const permissionSetupRunning = ref(false)

onMounted(async () => {
  // ── 1. Notifications — runs independently of DB readiness ───────────────
  scheduleAll().catch(console.error)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAllStatuses().catch(console.error)
      scheduleAll().catch(console.error)
    }
  })
  registerNativeListeners().catch(console.error)

  // ── 1b. First-launch permission prompt (native only) ────────────────────
  if (isNative && !localStorage.getItem(ONBOARDED_KEY)) {
    showPermissionModal.value = true
  }

  // ── 2. OPFS check (web only) ───────────────────────────────────────────
  if (!isNative && typeof navigator.storage?.getDirectory !== 'function') {
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

async function handleSetupPermissions() {
  permissionSetupRunning.value = true
  try {
    await requestAllPermissions()
  } finally {
    permissionSetupRunning.value = false
    dismissPermissionModal()
  }
}

function dismissPermissionModal() {
  localStorage.setItem(ONBOARDED_KEY, '1')
  showPermissionModal.value = false
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- First-launch permission onboarding (native only) -->
    <UModal v-model:open="showPermissionModal">
      <template #content>
        <div class="p-6 space-y-5">
          <div class="space-y-1.5">
            <h3 class="text-lg font-bold">Set up permissions</h3>
            <p class="text-sm text-slate-400">
              Habitat needs a few permissions to deliver habit reminders reliably, even when the app is closed.
            </p>
          </div>

          <div class="space-y-3">
            <div class="flex gap-3 items-start">
              <UIcon name="i-heroicons-bell" class="w-5 h-5 text-primary-400 mt-0.5 shrink-0" />
              <div>
                <p class="text-sm font-medium">Notifications</p>
                <p class="text-xs text-slate-500">Show reminders for your habits and check-ins.</p>
              </div>
            </div>
            <div class="flex gap-3 items-start">
              <UIcon name="i-heroicons-clock" class="w-5 h-5 text-primary-400 mt-0.5 shrink-0" />
              <div>
                <p class="text-sm font-medium">Exact alarms</p>
                <p class="text-xs text-slate-500">Fire reminders at the exact time you scheduled them.</p>
              </div>
            </div>
            <div class="flex gap-3 items-start">
              <UIcon name="i-heroicons-battery-100" class="w-5 h-5 text-primary-400 mt-0.5 shrink-0" />
              <div>
                <p class="text-sm font-medium">Battery optimization exemption</p>
                <p class="text-xs text-slate-500">Keep reminders working when the app is in the background.</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="dismissPermissionModal">
              Later
            </UButton>
            <UButton color="primary" :loading="permissionSetupRunning" @click="handleSetupPermissions">
              Set up permissions
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </UApp>
</template>
