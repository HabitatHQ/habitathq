<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import type { DbInfo } from '~/types/database'

const db = useDatabase()
const runtimeConfig = useRuntimeConfig()
const { settings: appSettings, set: setAppSetting } = useAppSettings()

const isNativeApp = Capacitor.isNativePlatform()
const isAndroid = Capacitor.getPlatform() === 'android'

// ─── Collapsible sections ──────────────────────────────────────────────────────

const aboutOpen = ref(true)
const diagOpen = ref(false)
const dragonsOpen = ref(false)

// ─── Licenses ──────────────────────────────────────────────────────────────────

interface LicenseEntry {
  name: string
  version: string
  license: string | null
  homepage: string | null
}
const showLicensesModal = ref(false)
const licenses = ref<LicenseEntry[]>([])
const licensesLoading = ref(false)
const licensesError = ref(false)

async function openLicenses() {
  showLicensesModal.value = true
  if (licenses.value.length > 0) return
  licensesLoading.value = true
  licensesError.value = false
  try {
    const base = useRuntimeConfig().app.baseURL
    const data = await $fetch<LicenseEntry[]>(`${base}licenses.json`)
    licenses.value = data
  } catch {
    licensesError.value = true
  } finally {
    licensesLoading.value = false
  }
}

// ─── DB info ───────────────────────────────────────────────────────────────────

const dbInfoOpen = ref(false)
const dbInfo = ref<DbInfo | null>(null)
const dbInfoLoading = ref(false)
const expandedTable = ref<string | null>(null)

async function loadDbInfo() {
  if (!db.isAvailable) return
  dbInfoLoading.value = true
  try {
    dbInfo.value = await db.getDbInfo()
  } finally {
    dbInfoLoading.value = false
  }
}

function toggleDbInfo() {
  dbInfoOpen.value = !dbInfoOpen.value
  if (dbInfoOpen.value && !dbInfo.value) loadDbInfo()
}

// ─── Integrity check ───────────────────────────────────────────────────────────

const integrityResults = ref<string[] | null>(null)
const integrityLoading = ref(false)

async function runIntegrityCheck() {
  if (!db.isAvailable) return
  integrityLoading.value = true
  integrityResults.value = null
  try {
    integrityResults.value = await db.integrityCheck()
  } finally {
    integrityLoading.value = false
  }
}

const integrityOk = computed(
  () =>
    integrityResults.value !== null &&
    integrityResults.value.length === 1 &&
    integrityResults.value[0] === 'ok',
)

// ─── OPFS files ────────────────────────────────────────────────────────────────

type OpfsFile = { path: string; size: number }

const opfsOpen = ref(false)
const opfsFiles = ref<OpfsFile[]>([])
const opfsLoading = ref(false)

async function walkOpfs(dir: FileSystemDirectoryHandle, prefix = ''): Promise<OpfsFile[]> {
  const out: OpfsFile[] = []
  // @ts-expect-error — entries() not in TypeScript's FileSystemDirectoryHandle types
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if ((handle as FileSystemHandle).kind === 'directory') {
      out.push(...(await walkOpfs(handle as FileSystemDirectoryHandle, path)))
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      out.push({ path, size: file.size })
    }
  }
  return out
}

async function loadOpfsFiles() {
  opfsLoading.value = true
  try {
    const root = await navigator.storage.getDirectory()
    opfsFiles.value = await walkOpfs(root)
  } finally {
    opfsLoading.value = false
  }
}

function toggleOpfs() {
  opfsOpen.value = !opfsOpen.value
  if (opfsOpen.value) loadOpfsFiles()
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

// ─── Storage estimate ──────────────────────────────────────────────────────────

const storageEstimate = ref<StorageEstimate | null>(null)
const storagePersisted = ref<boolean | null>(null)

async function loadStorageEstimate() {
  if (!('storage' in navigator)) return
  if ('estimate' in navigator.storage) {
    storageEstimate.value = await navigator.storage.estimate()
  }
  if ('persisted' in navigator.storage) {
    storagePersisted.value = await navigator.storage.persisted()
  }
}

async function requestPersistStorage() {
  if (!('storage' in navigator && 'persist' in navigator.storage)) return
  storagePersisted.value = await navigator.storage.persist()
}

// ─── Notifications (for diagnostics) ──────────────────────────────────────────

const {
  permission: notifPermission,
  scheduled: scheduledNotifs,
  notifLog,
  sendTestNotification,
  testScheduleOn,
  listPending: loadPendingNotifs,
} = useNotifications()

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

watch(diagOpen, (open) => {
  if (open) {
    loadStorageEstimate()
    void refreshPendingNotifs()
  }
})

// ─── Strict CSP ────────────────────────────────────────────────────────────────

const strictCspSessionActive = useState<boolean>('strict-csp-session-active', () => false)

function enableStrictCspAndReload(value: boolean) {
  if (!value) return
  setAppSetting('strictCsp', true)
  window.location.reload()
}

function disableStrictCspAndReload() {
  setAppSetting('strictCsp', false)
  window.location.reload()
}

// ─── Force reload ──────────────────────────────────────────────────────────────

const forceReloading = ref(false)

async function forceReload() {
  forceReloading.value = true
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    window.location.reload()
  } catch {
    forceReloading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center gap-2 mb-4">
      <NuxtLink to="/settings" class="sm:hidden p-1 -ml-1 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </NuxtLink>
      <h2 class="text-xl font-bold">More</h2>
    </header>

    <!-- About -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="aboutOpen = !aboutOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">About</p>
        <UIcon :name="aboutOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-slate-600" />
      </button>
      <UCard v-if="aboutOpen" :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">App</p>
          <p class="text-sm font-medium">Habitat</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Version</p>
          <p class="text-sm font-mono font-medium">{{ runtimeConfig.public.appVersion || '—' }}</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Commit</p>
          <p class="text-sm font-mono text-(--ui-text-toned)">{{ runtimeConfig.public.commitSha || '—' }}</p>
        </div>
        <div v-if="runtimeConfig.public.gitTag.length > 0" class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Tag</p>
          <UBadge :label="runtimeConfig.public.gitTag" variant="subtle" color="primary" size="sm" class="rounded-full font-mono" />
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Build</p>
          <UBadge :label="runtimeConfig.public.buildTarget" variant="subtle" color="neutral" size="sm" class="rounded-full font-mono" />
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Built</p>
          <p class="text-sm font-mono text-(--ui-text-toned)">{{ runtimeConfig.public.buildTime ? new Date(runtimeConfig.public.buildTime).toLocaleString() : '—' }}</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Storage</p>
          <p class="text-sm font-medium">On-device (OPFS)</p>
        </div>
        <button class="w-full flex items-center justify-between px-4 py-3.5 text-left" @click="openLicenses">
          <p class="text-sm text-(--ui-text-muted)">Open source licenses</p>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
        </button>

        <!-- DB schema -->
        <div>
          <button class="w-full flex items-center justify-between px-4 py-3.5 text-left" @click="toggleDbInfo">
            <div class="space-y-0.5">
              <p class="text-sm text-(--ui-text-muted)">Database schema</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge v-if="dbInfo" :label="`v${dbInfo.userVersion}`" variant="subtle" color="neutral" size="sm" class="font-mono rounded-full" />
              <UIcon :name="dbInfoOpen ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-4 h-4 text-(--ui-text-dimmed)" />
            </div>
          </button>
          <div v-if="dbInfoOpen" class="border-t border-(--ui-border) px-4 py-3 space-y-2">
            <div v-if="dbInfoLoading" class="flex items-center gap-2 text-xs text-(--ui-text-dimmed)">
              <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
            <template v-else-if="dbInfo">
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs text-(--ui-text-dimmed)">Schema version:</span>
                <span class="font-mono text-xs text-(--ui-text)">{{ dbInfo.userVersion }}</span>
              </div>
              <div v-for="table in dbInfo.tables" :key="table.name" class="rounded-lg border border-(--ui-border) overflow-hidden">
                <button
                  class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-(--ui-bg-elevated)/40 transition-colors"
                  @click="expandedTable = expandedTable === table.name ? null : table.name"
                >
                  <span class="text-xs font-mono text-(--ui-text-toned)">{{ table.name }}</span>
                  <UIcon :name="expandedTable === table.name ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5 text-slate-600" />
                </button>
                <pre v-if="expandedTable === table.name" class="text-[10px] leading-relaxed font-mono text-(--ui-text-muted) bg-(--ui-bg) px-3 py-2 overflow-x-auto border-t border-(--ui-border)">{{ table.sql }}</pre>
              </div>
              <template v-if="dbInfo.indices.length > 0">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 pt-1">Indices</p>
                <div v-for="idx in dbInfo.indices" :key="idx.name" class="rounded-lg border border-(--ui-border) overflow-hidden">
                  <button
                    class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-(--ui-bg-elevated)/40 transition-colors"
                    @click="expandedTable = expandedTable === idx.name ? null : idx.name"
                  >
                    <div class="min-w-0 text-left">
                      <span class="text-xs font-mono text-(--ui-text-muted)">{{ idx.name }}</span>
                      <span class="text-[10px] text-slate-600 ml-2">on {{ idx.tbl_name }}</span>
                    </div>
                    <UIcon :name="expandedTable === idx.name ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  </button>
                  <pre v-if="expandedTable === idx.name" class="text-[10px] leading-relaxed font-mono text-(--ui-text-muted) bg-(--ui-bg) px-3 py-2 overflow-x-auto border-t border-(--ui-border)">{{ idx.sql }}</pre>
                </div>
              </template>
            </template>
          </div>
        </div>

      </UCard>
    </section>

    <!-- Diagnostics -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="diagOpen = !diagOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">Diagnostics</p>
        <UIcon :name="diagOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-slate-600" />
      </button>
      <UCard v-if="diagOpen" :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Integrity check -->
        <div class="flex items-start justify-between px-4 py-3.5 gap-3">
          <div class="space-y-0.5 min-w-0">
            <p class="text-sm font-medium">Integrity check</p>
            <p class="text-xs text-(--ui-text-dimmed)">Runs SQLite <span class="font-mono">PRAGMA integrity_check</span></p>
            <div v-if="integrityResults !== null" class="mt-1.5">
              <p v-if="integrityOk" class="text-xs text-green-400 flex items-center gap-1">
                <UIcon name="i-heroicons-check-circle" class="w-3.5 h-3.5 shrink-0" /> ok
              </p>
              <ul v-else class="space-y-0.5">
                <li v-for="(msg, i) in integrityResults" :key="i" class="text-xs text-red-400 font-mono break-all">{{ msg }}</li>
              </ul>
            </div>
          </div>
          <span
            class="shrink-0"
            :class="!db.isAvailable ? 'cursor-not-allowed' : ''"
            :title="!db.isAvailable ? 'Database not ready' : undefined"
          >
            <UButton
              size="sm" variant="ghost" color="neutral"
              :loading="integrityLoading" :disabled="!db.isAvailable"
              icon="i-heroicons-shield-check"
              @click="runIntegrityCheck"
            />
          </span>
        </div>

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

        <!-- Storage estimate + OPFS files -->
        <div>
          <div class="px-4 py-3.5 space-y-2">
            <div class="flex items-center justify-between">
              <div class="space-y-0.5">
                <p class="text-sm font-medium">Storage</p>
                <p class="text-xs text-(--ui-text-dimmed)">Browser quota and current usage.</p>
              </div>
              <UButton size="sm" variant="ghost" color="neutral" icon="i-heroicons-arrow-path" @click="loadStorageEstimate" />
            </div>
            <template v-if="storageEstimate">
              <div class="space-y-1">
                <div class="flex justify-between text-xs text-(--ui-text-muted)">
                  <span>{{ formatBytes(storageEstimate.usage ?? 0) }} used</span>
                  <span>{{ formatBytes(storageEstimate.quota ?? 0) }} quota</span>
                </div>
                <div class="h-1.5 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary-500 transition-all"
                    :style="{ width: `${Math.min(100, ((storageEstimate.usage ?? 0) / (storageEstimate.quota ?? 1)) * 100).toFixed(1)}%` }"
                  />
                </div>
              </div>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 text-xs">
                  <UIcon
                    :name="storagePersisted ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
                    class="w-3.5 h-3.5"
                    :class="storagePersisted ? 'text-green-400' : 'text-amber-400'"
                  />
                  <span :class="storagePersisted ? 'text-green-400' : 'text-amber-400'">
                    {{ storagePersisted === null ? 'Checking…' : storagePersisted ? 'Persistent storage' : 'Storage not persisted' }}
                  </span>
                </div>
                <UButton
                  v-if="storagePersisted === false"
                  size="xs" variant="soft" color="primary"
                  @click="requestPersistStorage"
                >
                  Request
                </UButton>
              </div>
            </template>
          </div>

          <!-- OPFS files -->
          <div class="border-t border-(--ui-border)/60">
            <button class="w-full flex items-center justify-between px-4 py-2.5 text-left" @click="toggleOpfs">
              <p class="text-xs text-(--ui-text-dimmed)">OPFS files</p>
              <div class="flex items-center gap-2 shrink-0">
                <span v-if="opfsFiles.length > 0" class="text-xs text-(--ui-text-dimmed)">{{ opfsFiles.length }} file{{ opfsFiles.length !== 1 ? 's' : '' }}</span>
                <UIcon :name="opfsOpen ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5 text-(--ui-text-dimmed)" />
              </div>
            </button>
            <div v-if="opfsOpen" class="px-4 pb-3">
              <div v-if="opfsLoading" class="flex items-center gap-2 text-xs text-(--ui-text-dimmed)">
                <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" /> Scanning…
              </div>
              <div v-else-if="opfsFiles.length === 0" class="text-xs text-(--ui-text-dimmed)">No files found.</div>
              <ul v-else class="space-y-1.5">
                <li v-for="f in opfsFiles" :key="f.path" class="flex items-center justify-between gap-4">
                  <span class="text-[11px] font-mono text-(--ui-text-toned) truncate">{{ f.path }}</span>
                  <span class="text-[11px] font-mono text-(--ui-text-dimmed) shrink-0">{{ formatBytes(f.size) }}</span>
                </li>
              </ul>
              <button class="mt-3 text-xs text-slate-600 hover:text-(--ui-text-muted) flex items-center gap-1 transition-colors" @click="loadOpfsFiles">
                <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" /> Refresh
              </button>
            </div>
          </div>
        </div>

        <!-- Remote debugging (Android APK) -->
        <div v-if="isAndroid" class="px-4 py-3.5 space-y-1">
          <p class="text-sm font-medium">Remote debugging (APK)</p>
          <ol class="text-xs text-(--ui-text-dimmed) list-decimal list-inside space-y-0.5">
            <li>Enable <span class="text-(--ui-text-toned)">Developer Options</span> and <span class="text-(--ui-text-toned)">USB Debugging</span> on your Android device.</li>
            <li>Connect via USB and open <span class="text-(--ui-text-toned) font-mono">chrome://inspect</span> in desktop Chrome.</li>
            <li>Find the Habitat WebView under <span class="text-(--ui-text-toned)">Remote Target</span> and click <span class="text-(--ui-text-toned)">inspect</span>.</li>
          </ol>
          <p class="text-[11px] text-slate-600 mt-1">Console logs from this page will appear in the DevTools console.</p>
        </div>

      </UCard>
    </section>

    <!-- Here be dragons -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="dragonsOpen = !dragonsOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-red-900/70">🐉 Here be dragons</p>
        <UIcon :name="dragonsOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-red-900/50" />
      </button>
      <UCard v-if="dragonsOpen" :ui="{ root: 'rounded-2xl ring-1 ring-red-900/30', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Strict network isolation -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 mr-4">
            <p class="text-sm font-medium">Strict network isolation</p>
            <p class="text-xs text-(--ui-text-dimmed)">
              Blocks all fetch and XHR. Allows cached assets and on-device SQLite.
              <template v-if="strictCspSessionActive">
                <span class="text-orange-400">Active this session — reload to change.</span>
              </template>
              <template v-else>
                Requires a reload to activate or deactivate.
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <template v-if="strictCspSessionActive">
              <UBadge color="warning" variant="subtle" size="xs" class="shrink-0">Active</UBadge>
              <UButton
                size="sm" variant="ghost" color="neutral"
                icon="i-heroicons-arrow-path"
                aria-label="Disable strict CSP and reload"
                @click="disableStrictCspAndReload"
              />
            </template>
            <USwitch
              v-else
              :model-value="appSettings.strictCsp"
              aria-label="Enable strict network isolation"
              @update:model-value="enableStrictCspAndReload"
            />
          </div>
        </div>

        <!-- Force reload — PWA only -->
        <div v-if="!isNativeApp" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Force reload</p>
            <p class="text-xs text-(--ui-text-dimmed)">Unregister service worker, clear JS/CSS caches, and reload. OPFS data is preserved.</p>
          </div>
          <UButton
            size="sm" variant="ghost" color="neutral"
            icon="i-heroicons-arrow-path" :loading="forceReloading" class="shrink-0"
            @click="forceReload"
          />
        </div>

      </UCard>
    </section>

    <!-- Licenses modal -->
    <UModal v-model:open="showLicensesModal">
      <template #content>
        <div class="p-5 space-y-4 flex flex-col max-h-[80vh]">
          <div class="flex items-center justify-between shrink-0">
            <h3 class="font-semibold text-(--ui-text)">Open source licenses</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showLicensesModal = false" />
          </div>
          <div v-if="licensesLoading" class="flex items-center justify-center py-8 text-(--ui-text-dimmed) text-sm">
            Loading…
          </div>
          <div v-else-if="licensesError" class="text-sm text-red-400 py-4">
            Could not load licenses. Only available in production builds.
          </div>
          <ul v-else class="overflow-y-auto divide-y divide-slate-800 -mx-5 px-5">
            <li v-for="pkg in licenses" :key="pkg.name" class="py-2.5 flex items-baseline justify-between gap-3">
              <div class="min-w-0">
                <a
                  v-if="pkg.homepage"
                  :href="pkg.homepage"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-(--ui-text) hover:text-primary-400 transition-colors truncate block"
                >{{ pkg.name }}</a>
                <span v-else class="text-sm text-(--ui-text) truncate block">{{ pkg.name }}</span>
                <span class="text-xs text-(--ui-text-dimmed) font-mono">v{{ pkg.version }}</span>
              </div>
              <UBadge
                :label="pkg.license ?? 'Unknown'"
                variant="subtle"
                :color="pkg.license === 'MIT' ? 'primary' : 'neutral'"
                size="xs"
                class="shrink-0 font-mono rounded-full"
              />
            </li>
          </ul>
        </div>
      </template>
    </UModal>
  </div>
</template>
