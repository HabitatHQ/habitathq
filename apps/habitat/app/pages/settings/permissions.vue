<script setup lang="ts">
import { Capacitor } from '@capacitor/core'

const isNativeApp = Capacitor.isNativePlatform()
const isAndroid = Capacitor.getPlatform() === 'android'
const isIos = isNativeApp && !isAndroid

const { isInstalled, canInstall, isIosSafari, isChromiumNoPrompt, installing, install } =
  useInstall()
const showInstallModal = ref(false)

function handleInstall() {
  if (canInstall.value) {
    install()
  } else {
    showInstallModal.value = true
  }
}

const {
  permission: notifPermission,
  exactAlarm,
  batteryOptim,
  persistentStorage,
  openExactAlarmSetting,
  requestBatteryExemption,
  checkExactAlarm,
  checkBatteryOptim,
  checkPersistentStorage,
  requestPersistentStorage,
} = useNotifications()

const micPermission = ref<PermissionState | null>(null)
const cameraPermission = ref<PermissionState | null>(null)
const photoLibraryPermission = ref<PermissionState | null>(null)

async function checkMediaPermissions() {
  if (!navigator.permissions) return
  for (const [name, target] of [
    ['microphone', micPermission],
    ['camera', cameraPermission],
  ] as const) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName })
      target.value = status.state
      status.onchange = () => {
        target.value = status.state
      }
    } catch {
      // Not supported in this browser
    }
  }
  if (isIos) {
    try {
      const status = await navigator.permissions.query({ name: 'photos' as PermissionName })
      photoLibraryPermission.value = status.state
    } catch {
      // Expected: shown as Unknown
    }
  }
}

onMounted(async () => {
  if (isNativeApp) {
    await checkExactAlarm()
    await checkBatteryOptim()
  } else {
    await checkPersistentStorage()
  }
  await checkMediaPermissions()
})
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center gap-2 mb-4">
      <NuxtLink to="/settings" class="sm:hidden p-1 -ml-1 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </NuxtLink>
      <h2 class="text-xl font-bold">Permissions</h2>
    </header>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">App</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Install -->
        <div v-if="isInstalled" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-arrow-down-tray" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Habitat is installed</p>
            </div>
            <p class="text-xs text-green-400">{{ isNativeApp ? 'Running as a native app' : 'Running as a standalone app' }}</p>
          </div>
          <div class="w-2 h-2 rounded-full bg-green-400 mx-2 shrink-0" />
        </div>
        <div v-else class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-arrow-down-tray" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Install Habitat</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Add to your home screen for offline access and notifications</p>
          </div>
          <UButton
            size="sm"
            variant="soft"
            color="primary"
            icon="i-heroicons-arrow-down-tray"
            :loading="installing"
            class="shrink-0"
            @click="handleInstall"
          >
            Install
          </UButton>
        </div>

        <!-- Notifications permission summary -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-bell" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Notifications</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Deliver reminders for habits and check-ins.</p>
          </div>
          <div class="shrink-0">
            <UBadge
              v-if="notifPermission === 'granted'"
              label="Granted" variant="subtle" color="success" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="notifPermission === 'denied'"
              label="Blocked" variant="subtle" color="error" size="xs" class="rounded-full"
            />
            <UBadge
              v-else
              label="Not set" variant="subtle" color="neutral" size="xs" class="rounded-full"
            />
          </div>
        </div>

        <!-- Exact Alarms (Android native only) -->
        <div v-if="isNativeApp" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-clock" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Exact alarms</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Fire reminders at the exact time you scheduled them.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge
              v-if="exactAlarm === 'granted'"
              label="Granted" variant="subtle" color="success" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="exactAlarm === 'denied'"
              label="Denied" variant="subtle" color="error" size="xs" class="rounded-full"
            />
            <UBadge
              v-else
              label="Unknown" variant="subtle" color="neutral" size="xs" class="rounded-full"
            />
            <UButton
              v-if="exactAlarm === 'denied'"
              size="xs" variant="soft" color="warning"
              @click="openExactAlarmSetting"
            >
              Fix
            </UButton>
          </div>
        </div>

        <!-- Battery Optimization (Android native only) -->
        <div v-if="isNativeApp" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-battery-100" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Battery optimization</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Exempt the app so reminders fire even when closed.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge
              v-if="batteryOptim === 'exempt'"
              label="Exempt" variant="subtle" color="success" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="batteryOptim === 'optimized'"
              label="Optimized" variant="subtle" color="error" size="xs" class="rounded-full"
            />
            <UBadge
              v-else
              label="Unknown" variant="subtle" color="neutral" size="xs" class="rounded-full"
            />
            <UButton
              v-if="batteryOptim === 'optimized'"
              size="xs" variant="soft" color="warning"
              @click="requestBatteryExemption"
            >
              Fix
            </UButton>
          </div>
        </div>

        <!-- Persistent Storage (web PWA only) -->
        <div v-if="!isNativeApp" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon
                :name="persistentStorage === 'granted' ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
                class="w-4 h-4 shrink-0"
                :class="persistentStorage === 'granted' ? 'text-green-400' : 'text-(--ui-text-muted)'"
              />
              <p class="text-sm font-medium">Persistent storage</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Prevent the browser from evicting your offline data.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge
              v-if="persistentStorage === 'granted'"
              label="Granted" variant="subtle" color="success" size="xs" class="rounded-full"
            />
            <UBadge
              v-else-if="persistentStorage === 'denied'"
              label="Not persisted" variant="subtle" color="warning" size="xs" class="rounded-full"
            />
            <UBadge
              v-else
              label="Unknown" variant="subtle" color="neutral" size="xs" class="rounded-full"
            />
            <UButton
              v-if="persistentStorage === 'denied'"
              size="xs" variant="soft" color="primary"
              @click="() => { requestPersistentStorage() }"
            >
              Request
            </UButton>
          </div>
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Media</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Microphone -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-microphone" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Microphone</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Required for voice recordings in Jots.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge v-if="micPermission === 'granted'" label="Granted" variant="subtle" color="success" size="xs" class="rounded-full" />
            <UBadge v-else-if="micPermission === 'denied'" label="Blocked" variant="subtle" color="error" size="xs" class="rounded-full" />
            <UBadge v-else-if="micPermission === 'prompt'" label="Not yet asked" variant="subtle" color="neutral" size="xs" class="rounded-full" />
            <UBadge v-else label="Unknown" variant="subtle" color="neutral" size="xs" class="rounded-full" />
          </div>
        </div>

        <!-- Camera -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-camera" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Camera</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Required to capture photos in Jots.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge v-if="cameraPermission === 'granted'" label="Granted" variant="subtle" color="success" size="xs" class="rounded-full" />
            <UBadge v-else-if="cameraPermission === 'denied'" label="Blocked" variant="subtle" color="error" size="xs" class="rounded-full" />
            <UBadge v-else-if="cameraPermission === 'prompt'" label="Not yet asked" variant="subtle" color="neutral" size="xs" class="rounded-full" />
            <UBadge v-else label="Unknown" variant="subtle" color="neutral" size="xs" class="rounded-full" />
          </div>
        </div>

        <!-- Photo Library (iOS native only) -->
        <div v-if="isIos" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-photo" class="w-4 h-4 text-(--ui-text-muted) shrink-0" />
              <p class="text-sm font-medium">Photo library</p>
            </div>
            <p class="text-xs text-(--ui-text-dimmed)">Required to pick existing photos for Jots.</p>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <UBadge v-if="photoLibraryPermission === 'granted'" label="Granted" variant="subtle" color="success" size="xs" class="rounded-full" />
            <UBadge v-else-if="photoLibraryPermission === 'denied'" label="Blocked" variant="subtle" color="error" size="xs" class="rounded-full" />
            <UBadge v-else-if="photoLibraryPermission === 'prompt'" label="Not yet asked" variant="subtle" color="neutral" size="xs" class="rounded-full" />
            <UBadge v-else label="Managed in Settings" variant="subtle" color="neutral" size="xs" class="rounded-full" />
          </div>
        </div>

      </UCard>
    </section>

    <!-- Install instructions modal -->
    <UModal v-model:open="showInstallModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-(--ui-text)">Install Habitat</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showInstallModal = false" />
          </div>

          <template v-if="isIosSafari">
            <ol class="space-y-3 text-sm text-(--ui-text-toned)">
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">1.</span>
                <span>Tap the <strong class="text-(--ui-text)">Share</strong> button
                  <UIcon name="i-heroicons-arrow-up-on-square" class="inline w-4 h-4 align-text-bottom text-(--ui-text)" />
                  in the Safari toolbar</span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">2.</span>
                <span>Scroll down and tap <strong class="text-(--ui-text)">Add to Home Screen</strong></span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">3.</span>
                <span>Tap <strong class="text-(--ui-text)">Add</strong> to confirm</span>
              </li>
            </ol>
          </template>

          <template v-else-if="isChromiumNoPrompt">
            <p class="text-sm text-(--ui-text-muted)">Chrome hasn't offered an install prompt yet — use the browser menu instead:</p>
            <ol class="space-y-3 text-sm text-(--ui-text-toned)">
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">1.</span>
                <span>Tap the <strong class="text-(--ui-text)">⋮ menu</strong> in the top-right corner of Chrome</span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">2.</span>
                <span>Choose <strong class="text-(--ui-text)">Install app</strong> or <strong class="text-(--ui-text)">Add to Home Screen</strong></span>
              </li>
            </ol>
          </template>

          <template v-else>
            <p class="text-sm text-(--ui-text-muted)">
              Your current browser doesn't support PWA installation.
              Open Habitat in <strong class="text-(--ui-text)">Chrome</strong>, <strong class="text-(--ui-text)">Edge</strong>,
              <strong class="text-(--ui-text)">Brave</strong>, or <strong class="text-(--ui-text)">Opera</strong>
              to install it as a standalone app.
            </p>
            <p class="text-xs text-(--ui-text-dimmed)">
              These browsers also provide OPFS storage and background notifications.
            </p>
          </template>

          <div class="flex justify-end">
            <UButton variant="ghost" color="neutral" @click="showInstallModal = false">Close</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
