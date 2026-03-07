<script setup lang="ts">
import { Capacitor } from '@capacitor/core'

const isNativeApp = Capacitor.isNativePlatform()
const isIosSafari = useInstall().isIosSafari

const {
  permission: notifPermission,
  notifLog,
  requestPermission,
  sendTestNotification,
  testScheduleOn,
  scheduled: scheduledNotifs,
  listPending: loadPendingNotifs,
} = useNotifications()

async function enableNotifications() {
  await requestPermission()
}

const showNotifLog = ref(false)
const pendingNotifsLoading = ref(false)

async function refreshPendingNotifs() {
  pendingNotifsLoading.value = true
  try {
    await loadPendingNotifs()
  } finally {
    pendingNotifsLoading.value = false
  }
}

onMounted(() => {
  void refreshPendingNotifs()
})
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center gap-2 mb-4">
      <NuxtLink to="/settings" class="sm:hidden p-1 -ml-1 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </NuxtLink>
      <h2 class="text-xl font-bold">Notifications</h2>
    </header>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Permission</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-bell" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Notifications</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Deliver reminders for habits and check-ins.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge
              v-if="notifPermission === 'granted'"
              label="Granted" variant="subtle" color="success" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="notifPermission === 'denied'"
              label="Blocked" variant="subtle" color="error" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="isIosSafari"
              label="Unavailable" variant="subtle" color="warning" size="xs" class="rounded-full"
            />
            <UBadge
              v-else
              label="Required" variant="subtle" color="warning" size="xs" class="rounded-full"
            />
            <UButton
              v-if="notifPermission === 'default' && !isIosSafari"
              size="xs" variant="soft" color="primary"
              @click="enableNotifications"
            >
              Enable
            </UButton>
          </div>
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Testing</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Test notification -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Test notification (instant)</p>
            <p class="text-xs text-(--ui-text-dimmed)">Fire via schedule.at — confirms the plugin works.</p>
          </div>
          <span
            class="shrink-0"
            :class="notifPermission !== 'granted' ? 'cursor-not-allowed' : ''"
            :title="notifPermission !== 'granted' ? 'Notifications not granted' : undefined"
          >
            <UButton
              size="sm" variant="ghost" color="neutral"
              icon="i-heroicons-bell"
              :disabled="notifPermission !== 'granted'"
              @click="sendTestNotification"
            />
          </span>
        </div>

        <!-- Test schedule.on -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Test schedule.on (≈2 min)</p>
            <p class="text-xs text-(--ui-text-dimmed)">Schedules a repeating alarm for 2 min from now. Same API as real reminders.</p>
          </div>
          <span
            class="shrink-0"
            :class="notifPermission !== 'granted' || !isNativeApp ? 'cursor-not-allowed' : ''"
            :title="!isNativeApp ? 'Native only' : notifPermission !== 'granted' ? 'Notifications not granted' : undefined"
          >
            <UButton
              size="sm" variant="ghost" color="neutral"
              icon="i-heroicons-clock"
              :disabled="notifPermission !== 'granted' || !isNativeApp"
              @click="testScheduleOn"
            />
          </span>
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Log</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Notification log -->
        <div>
          <div class="flex items-center justify-between px-4 py-3.5">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">Notification log</p>
              <p class="text-xs text-(--ui-text-dimmed)">Recent notification events (scheduled, received, tapped).</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge v-if="showNotifLog && notifLog.length > 0" :label="String(notifLog.length)" variant="subtle" color="neutral" size="xs" class="rounded-full font-mono" />
              <USwitch :model-value="showNotifLog" @update:model-value="showNotifLog = $event" />
            </div>
          </div>
          <div v-if="showNotifLog" class="border-t border-(--ui-border) px-4 pb-4 pt-3">
            <div v-if="notifLog.length > 0" class="max-h-48 overflow-y-auto rounded-lg bg-(--ui-bg) border border-(--ui-border) p-2 space-y-1 text-[11px] font-mono leading-snug">
              <div v-for="(entry, i) in notifLog" :key="i" class="break-all">
                <span class="text-slate-600 shrink-0">{{ entry.ts.slice(11, 19) }}</span>
                <span class="text-primary-400 ml-2">{{ entry.event }}</span>
                <span v-if="entry.msg" class="text-(--ui-text-muted) ml-1"> {{ entry.msg }}</span>
                <template v-for="(val, key) in entry.fields" :key="key">
                  <span class="text-amber-400/70 ml-1">{{ key }}=</span><span class="text-(--ui-text-muted)">{{ val }}</span>
                </template>
              </div>
            </div>
            <p v-else class="text-xs text-slate-600 italic">No events yet. Schedule or test a notification to see activity here.</p>
          </div>
        </div>

        <!-- Scheduled notifications -->
        <div>
          <div class="flex items-center justify-between px-4 py-3.5">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">Scheduled notifications</p>
              <p class="text-xs text-(--ui-text-dimmed)">
                {{ scheduledNotifs.length > 0 ? `${scheduledNotifs.length} active` : 'None scheduled for today' }}
              </p>
            </div>
            <UButton
              size="sm" variant="ghost" color="neutral"
              icon="i-heroicons-arrow-path"
              :loading="pendingNotifsLoading"
              aria-label="Refresh scheduled notifications"
              @click="refreshPendingNotifs"
            />
          </div>
          <ul v-if="scheduledNotifs.length > 0" class="border-t border-(--ui-border) divide-y divide-(--ui-border)/50 px-4 pb-3">
            <li
              v-for="(n, i) in scheduledNotifs"
              :key="i"
              class="flex items-center gap-3 py-2"
            >
              <UIcon name="i-heroicons-bell" class="w-3.5 h-3.5 shrink-0 text-(--ui-text-dimmed)" />
              <span class="text-xs text-(--ui-text) min-w-0 truncate grow">{{ n.title }}</span>
              <span class="text-xs font-mono text-(--ui-text-muted) shrink-0">{{ n.when }}</span>
            </li>
          </ul>
        </div>

      </UCard>
    </section>
  </div>
</template>
