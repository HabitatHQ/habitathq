<script setup lang="ts">
const db = useDatabase()
const runtimeConfig = useRuntimeConfig()
const { settings: appSettings, set: setAppSetting } = useAppSettings()

// ─── JSON export ──────────────────────────────────────────────────────────────

type ExportKey = keyof ExportSelection

interface ExportGroup {
  label: string
  items: Array<{ key: ExportKey; label: string; parent?: ExportKey }>
}

const EXPORT_GROUPS: ExportGroup[] = [
  {
    label: 'Habits',
    items: [
      { key: 'habits',         label: 'Habits' },
      { key: 'completions',    label: 'Completions',    parent: 'habits' },
      { key: 'habit_logs',     label: 'Habit logs',     parent: 'habits' },
      { key: 'habit_schedules',label: 'Habit schedules',parent: 'habits' },
      { key: 'reminders',      label: 'Habit reminders',parent: 'habits' },
    ],
  },
  {
    label: 'Check-ins',
    items: [
      { key: 'checkin_templates', label: 'Templates' },
      { key: 'checkin_questions', label: 'Questions', parent: 'checkin_templates' },
      { key: 'checkin_responses', label: 'Responses', parent: 'checkin_questions' },
      { key: 'checkin_reminders', label: 'Reminders', parent: 'checkin_templates' },
    ],
  },
  {
    label: 'Other',
    items: [
      { key: 'scribbles',     label: 'Scribbles' },
      { key: 'checkin_entries',label: 'Journal entries' },
    ],
  },
  {
    label: 'TODOs & Bored',
    items: [
      { key: 'todos',            label: 'TODOs' },
      { key: 'bored_categories', label: 'Bored categories' },
      { key: 'bored_activities', label: 'Bored activities', parent: 'bored_categories' },
    ],
  },
]

function defaultExportSelection(): ExportSelection {
  return {
    habits: true, completions: true, habit_logs: true, habit_schedules: true, reminders: true,
    checkin_templates: true, checkin_questions: true, checkin_responses: true, checkin_reminders: true,
    scribbles: true, checkin_entries: true,
    todos: true, bored_categories: true, bored_activities: true,
  }
}

const showExportModal = ref(false)
const exporting = ref(false)
const exportSel = reactive<ExportSelection>(defaultExportSelection())
const exportErrors = ref<string[]>([])

const exportAllKeys = Object.keys(defaultExportSelection()) as ExportKey[]
const exportAllSelected = computed(() => exportAllKeys.every(k => exportSel[k]))
const exportNoneSelected = computed(() => exportAllKeys.every(k => !exportSel[k]))

function toggleExportAll() {
  const next = !exportAllSelected.value
  for (const k of exportAllKeys) exportSel[k] = next
}

function openExportModal() {
  Object.assign(exportSel, defaultExportSelection())
  exportErrors.value = []
  showExportModal.value = true
}

function validateExportFk(): string[] {
  type Rule = [child: ExportKey, parent: ExportKey, childLabel: string, parentLabel: string]
  const rules: Rule[] = [
    ['completions',    'habits',            'Completions',    'Habits'],
    ['habit_logs',     'habits',            'Habit logs',     'Habits'],
    ['habit_schedules','habits',            'Habit schedules','Habits'],
    ['reminders',      'habits',            'Habit reminders','Habits'],
    ['checkin_questions','checkin_templates','Questions',      'Check-in templates'],
    ['checkin_responses','checkin_questions','Responses',      'Check-in questions'],
    ['checkin_reminders','checkin_templates','Check-in reminders','Check-in templates'],
    ['bored_activities','bored_categories','Bored activities','Bored categories'],
  ]
  return rules
    .filter(([child, parent]) => exportSel[child] && !exportSel[parent])
    .map(([,,childLabel, parentLabel]) => `${childLabel} require ${parentLabel}`)
}

async function downloadJson() {
  if (!db.isAvailable) return
  exportErrors.value = validateExportFk()
  if (exportErrors.value.length > 0) return
  exporting.value = true
  try {
    const data = await db.exportJsonData({ ...exportSel })
    const payload = JSON.stringify(data, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `habitat-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      URL.revokeObjectURL(url)
    }
    showExportModal.value = false
  } finally {
    exporting.value = false
  }
}

// ─── SQLite export ────────────────────────────────────────────────────────────

const exportingDb = ref(false)

async function exportSqlite() {
  if (!db.isAvailable) return
  exportingDb.value = true
  try {
    const bytes = await db.exportDb()
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-sqlite3' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `habitat-${new Date().toISOString().slice(0, 10)}.sqlite3`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      URL.revokeObjectURL(url)
    }
  } finally {
    exportingDb.value = false
  }
}

// ─── JSON import ──────────────────────────────────────────────────────────────

const importInput = ref<HTMLInputElement | null>(null)
const showImportModal = ref(false)
const importing = ref(false)
const importPreview = ref<HabitatExport | null>(null)
const importError = ref<string | null>(null)
const importDone = ref(false)

function openImport() {
  importPreview.value = null
  importError.value = null
  importDone.value = false
  importInput.value?.click()
}

async function onImportFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''
  try {
    const raw = JSON.parse(await file.text()) as unknown
    if (typeof raw !== 'object' || raw === null) { importError.value = 'Invalid file.'; showImportModal.value = true; return }
    const ver = (raw as Record<string, unknown>)['version']
    if (typeof ver !== 'number') { importError.value = 'Missing version field — not a Habitat export.'; showImportModal.value = true; return }
    if (ver !== 1) { importError.value = `Unsupported version ${ver}. This app supports version 1.`; showImportModal.value = true; return }
    importPreview.value = raw as HabitatExport
    showImportModal.value = true
  } catch {
    importError.value = 'Could not parse file as JSON.'
    showImportModal.value = true
  }
}

function reloadPage() { window.location.reload() }

async function confirmImport() {
  if (!importPreview.value || !db.isAvailable) return
  importing.value = true
  try {
    await db.importJson(importPreview.value)
    importDone.value = true
    importPreview.value = null
  } finally {
    importing.value = false
  }
}

// ─── Voice notes ZIP ──────────────────────────────────────────────────────────

interface VoiceNoteRaw { id: string; blob: Blob; mimeType: string; created_at: string }

function openVoiceIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('habitat', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('voice_notes', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGetAllNotes(idb: IDBDatabase): Promise<VoiceNoteRaw[]> {
  return new Promise((resolve, reject) => {
    const req = idb.transaction('voice_notes', 'readonly').objectStore('voice_notes').getAll()
    req.onsuccess = () => resolve(req.result as VoiceNoteRaw[])
    req.onerror = () => reject(req.error)
  })
}

const exportingVoiceZip = ref(false)

async function exportVoiceNotesZip() {
  exportingVoiceZip.value = true
  try {
    const idb = await openVoiceIdb()
    const notes = await idbGetAllNotes(idb)
    if (notes.length === 0) return
    const files: Record<string, Uint8Array> = {}
    for (const note of notes) {
      const ext = note.mimeType.split('/')[1]?.split(';')[0] ?? 'audio'
      const ts = note.created_at.slice(0, 19).replace(/[:.]/g, '-')
      files[`${ts}.${ext}`] = new Uint8Array(await note.blob.arrayBuffer())
    }
    const zipped = zipSync(files)
    const url = URL.createObjectURL(new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }))
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `habitat-voice-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      URL.revokeObjectURL(url)
    }
  } finally {
    exportingVoiceZip.value = false
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Delete the entire IndexedDB 'habitat' database (voice notes). */
function clearIdb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('habitat')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()   // best-effort
    req.onblocked = () => resolve()
  })
}

function clearLocalStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('checkin-')) localStorage.removeItem(key)
  }
}

// ─── Shared wipe logic ───────────────────────────────────────────────────────

/** True after a successful wipe-without-reload; both modals show a done state. */
const wiped = ref(false)

/**
 * Full wipe: closes the SQLite DB, removes all OPFS files, clears IDB and
 * localStorage. If reload=true the page reloads; otherwise sets wiped=true so
 * the modal can show a "done — close this tab" state.
 */
async function fullWipe(reload: boolean): Promise<void> {
  localStorage.removeItem('habitat-has-data')
  await db.nukeOpfs()   // worker closes DB + removes every OPFS entry
  await clearIdb()
  clearLocalStorage()
  // journal entries live in localStorage under journal-YYYY-MM-DD keys
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('journal-')) localStorage.removeItem(key)
  }
  if (reload) {
    window.location.reload()
  } else {
    wiped.value = true
  }
}

// ─── Health setup ─────────────────────────────────────────────────────────────

const showHealthSetup = ref(false)
const creatingHealth = ref(false)

const healthSetup = reactive({
  enableSteps: true,
  stepGoal: 10000,
  enableMeals: true,
  meals: [
    { name: 'Breakfast', calories: 600 },
    { name: 'Lunch', calories: 600 },
    { name: 'Dinner', calories: 600 },
  ] as { name: string; calories: number }[],
})

function addMeal() { healthSetup.meals.push({ name: '', calories: 600 }) }
function removeMeal(i: number) { healthSetup.meals.splice(i, 1) }

async function onHealthToggle(value: boolean) {
  setAppSetting('enableHealth', value)
  if (value && db.isAvailable) {
    const allHabits = await db.getHabits()
    if (!allHabits.some(h => h.tags.includes('habitat-health'))) {
      showHealthSetup.value = true
    }
  }
}

async function confirmHealthSetup() {
  if (!db.isAvailable) return
  creatingHealth.value = true
  try {
    const base = { description: '', frequency: 'daily', annotations: {}, paused_until: null }
    if (healthSetup.enableSteps) {
      await db.createHabit({
        ...base,
        name: 'Steps',
        type: 'NUMERIC',
        target_value: healthSetup.stepGoal,
        color: '#ef4444',
        icon: 'i-heroicons-fire',
        tags: ['habitat-health', 'habitat-steps'],
      })
    }
    if (healthSetup.enableMeals) {
      for (const meal of healthSetup.meals) {
        if (!meal.name.trim()) continue
        await db.createHabit({
          ...base,
          name: meal.name.trim(),
          type: 'LIMIT',
          target_value: meal.calories,
          color: '#f59e0b',
          icon: 'i-heroicons-sparkles',
          tags: ['habitat-health', 'habitat-meals'],
        })
      }
    }
    showHealthSetup.value = false
  } finally {
    creatingHealth.value = false
  }
}

// ─── Variant 1: clear app data (selective, no OPFS wipe) ─────────────────────

const showClearModal = ref(false)
const clearing = ref(false)

const clearSelection = reactive({
  habits: true,
  checkinEntries: true,
  checkins: true,
  scribbles: true,
  voiceNotes: true,
  todos: false,
  boredData: false,
  appliedDefaults: false,
})

const clearItems = [
  { key: 'habits',         label: 'Habits & completions',           description: 'All habits, logs, and completion history' },
  { key: 'checkinEntries', label: 'Check-in entries',               description: 'Daily check-in answers stored in the DB' },
  { key: 'checkins',       label: 'Check-in templates & responses', description: 'All templates, questions, and recorded answers' },
  { key: 'scribbles',      label: 'Scribbles',                      description: 'All free-form notes' },
  { key: 'voiceNotes',     label: 'Voice recordings',               description: 'IndexedDB audio data' },
  { key: 'todos',          label: 'TODOs',                          description: 'All tasks and their history' },
  { key: 'boredData',      label: 'Bored activities',               description: 'All custom activities (system categories preserved)' },
  { key: 'appliedDefaults', label: 'Applied defaults',              description: 'Re-enables seeding of default check-in templates' },
] as const

const nothingSelected = computed(() =>
  !(clearSelection.habits || clearSelection.checkinEntries || clearSelection.checkins ||
    clearSelection.scribbles || clearSelection.voiceNotes || clearSelection.todos ||
    clearSelection.boredData || clearSelection.appliedDefaults),
)

async function clearAppData() {
  if (!db.isAvailable || nothingSelected.value) return
  clearing.value = true
  try {
    const ops: Promise<unknown>[] = []
    if (clearSelection.habits)         ops.push(db.deleteAllHabits())
    if (clearSelection.checkinEntries) ops.push(db.deleteAllCheckinEntries())
    if (clearSelection.checkins)       ops.push(db.deleteAllCheckinData())
    if (clearSelection.scribbles)      ops.push(db.deleteAllScribbles())
    if (clearSelection.todos)          ops.push(db.deleteAllTodos())
    if (clearSelection.boredData)      ops.push(db.deleteAllBoredData())
    if (clearSelection.appliedDefaults) ops.push(db.clearAppliedDefaults())
    await Promise.all(ops)
    if (clearSelection.checkinEntries) clearLocalStorage()
    if (clearSelection.voiceNotes) await clearIdb()
    if (clearSelection.habits)     localStorage.removeItem('habitat-has-data')
    showClearModal.value = false
  } finally {
    clearing.value = false
  }
}

// ─── Variant 2: wipe all OPFS files (nuclear) ────────────────────────────────

const showNukeModal = ref(false)
const nuking = ref(false)

async function nukeOpfs(reload: boolean) {
  if (!db.isAvailable) return
  nuking.value = true
  try {
    await fullWipe(reload)
  } catch {
    showNukeModal.value = false
  } finally {
    nuking.value = false
  }
}

// ─── Advanced: integrity check ────────────────────────────────────────────────

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

const integrityOk = computed(() =>
  integrityResults.value !== null &&
  integrityResults.value.length === 1 &&
  integrityResults.value[0] === 'ok',
)

// ─── Advanced: DB info ────────────────────────────────────────────────────────

import { zipSync } from 'fflate'
import { Capacitor } from '@capacitor/core'
import type { DbInfo, HabitatExport, ExportSelection } from '~/types/database'

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

// ─── Advanced: OPFS files ─────────────────────────────────────────────────────

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
      out.push(...await walkOpfs(handle as FileSystemDirectoryHandle, path))
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

// ─── Advanced: force reload ───────────────────────────────────────────────────

const forceReloading = ref(false)

async function forceReload() {
  forceReloading.value = true
  try {
    // Unregister every SW for this origin so the browser installs a fresh one
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(r => r.unregister()))
    }
    // Clear all Cache API caches (SW asset caches) — OPFS is unaffected
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    window.location.reload()
  } catch {
    forceReloading.value = false
  }
}

// ─── Install ──────────────────────────────────────────────────────────────────

const { isInstalled, canInstall, isIosSafari, isChromiumNoPrompt, installing, install } = useInstall()
const isNativeApp = Capacitor.isNativePlatform()
const showInstallModal = ref(false)

function handleInstall() {
  if (canInstall.value) {
    install()
  } else {
    showInstallModal.value = true
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

const { permission: notifPermission, requestPermission, sendTestNotification } = useNotifications()

async function enableNotifications() {
  await requestPermission()
}

// ─── Licenses ─────────────────────────────────────────────────────────────────

interface LicenseEntry { name: string; version: string; license: string | null; homepage: string | null }
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

// ─── Advanced: storage estimate ───────────────────────────────────────────────

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

// ─── Collapsible section state ────────────────────────────────────────────────

const aboutOpen = ref(false)
const diagOpen = ref(false)
const dragonsOpen = ref(false)

watch(diagOpen, (open) => { if (open) loadStorageEstimate() })
</script>

<template>
  <div class="space-y-6">
    <header>
      <p class="text-sm text-slate-500">Preferences</p>
      <h2 class="text-2xl font-bold">Settings</h2>
    </header>

    <!-- ── Display ───────────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">Display</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">24-hour time</p>
            <p class="text-xs text-slate-500">Show times as 17:34 instead of 5:34 PM.</p>
          </div>
          <USwitch
            :model-value="appSettings.use24HourTime"
            @update:model-value="setAppSetting('use24HourTime', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Sticky bottom bar</p>
            <p class="text-xs text-slate-500">Keep the nav bar fixed at the bottom when scrolling.</p>
          </div>
          <USwitch
            :model-value="appSettings.stickyNav"
            @update:model-value="setAppSetting('stickyNav', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Extra bottom padding</p>
            <p class="text-xs text-slate-500">Add space below the nav for Android gesture buttons.</p>
          </div>
          <USwitch
            :model-value="appSettings.navExtraPadding"
            @update:model-value="setAppSetting('navExtraPadding', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Extra top padding</p>
            <p class="text-xs text-slate-500">Add space above the header for the status bar.</p>
          </div>
          <USwitch
            :model-value="appSettings.headerExtraPadding"
            @update:model-value="setAppSetting('headerExtraPadding', $event)"
          />
        </div>

        <div class="px-4 pt-3 pb-1">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Navigation</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Today tab</p>
            <p class="text-xs text-slate-500">Show daily progress and log habits for today.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableToday"
            @update:model-value="setAppSetting('enableToday', $event)"
          />
        </div>
        <div>
          <div class="flex items-center justify-between px-4 py-3">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">Week view</p>
              <p class="text-xs text-slate-500">Quick-fill view for logging multiple days at once.</p>
            </div>
            <USwitch
              :model-value="appSettings.enableWeek"
              @update:model-value="setAppSetting('enableWeek', $event)"
            />
          </div>
          <div v-if="appSettings.enableWeek" class="flex items-center justify-between px-4 pb-3">
            <p class="text-sm text-slate-400">Days to show</p>
            <div class="flex items-center gap-2">
              <button
                class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                @click="setAppSetting('weekDays', Math.max(3, (appSettings.weekDays || 3) - 1))"
              >−</button>
              <span class="w-4 text-center text-sm font-medium tabular-nums">{{ appSettings.weekDays || 3 }}</span>
              <button
                class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                @click="setAppSetting('weekDays', Math.min(7, (appSettings.weekDays || 3) + 1))"
              >+</button>
            </div>
          </div>
        </div>

        <div class="px-4 pt-3 pb-1">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Habits page</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show tags</p>
            <p class="text-xs text-slate-500">Display habit tags in the habits list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showTagsOnHabits"
            @update:model-value="setAppSetting('showTagsOnHabits', $event)"
          />
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show annotations</p>
            <p class="text-xs text-slate-500">Display key:value metadata in the habits list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showAnnotationsOnHabits"
            @update:model-value="setAppSetting('showAnnotationsOnHabits', $event)"
          />
        </div>

        <div class="px-4 pt-3 pb-1">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Today page</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show tags</p>
            <p class="text-xs text-slate-500">Display habit tags in today's list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showTagsOnToday"
            @update:model-value="setAppSetting('showTagsOnToday', $event)"
          />
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show annotations</p>
            <p class="text-xs text-slate-500">Display key:value metadata in today's list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showAnnotationsOnToday"
            @update:model-value="setAppSetting('showAnnotationsOnToday', $event)"
          />
        </div>

        <div class="px-4 pt-3 pb-1">
          <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Log entries</p>
        </div>
        <div class="px-4 py-3 pb-4 space-y-2">
          <p class="text-sm font-medium">Input mode</p>
          <p class="text-xs text-slate-500 mb-2">How numeric values are applied when logging a habit.</p>
          <div class="flex gap-2">
            <button
              class="flex-1 py-2 px-3 rounded-xl text-xs font-medium border transition-colors"
              :class="appSettings.logInputMode === 'increment'
                ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'"
              @click="setAppSetting('logInputMode', 'increment')"
            >
              Add to total
            </button>
            <button
              class="flex-1 py-2 px-3 rounded-xl text-xs font-medium border transition-colors"
              :class="appSettings.logInputMode === 'absolute'
                ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'"
              @click="setAppSetting('logInputMode', 'absolute')"
            >
              Set total
            </button>
          </div>
        </div>

      </UCard>
    </section>

    <!-- ── Features ──────────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">Features</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable Journalling</p>
            <p class="text-xs text-slate-500">Show Check-in, Scribbles, and Voice in the navigation.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableJournalling"
            @update:model-value="setAppSetting('enableJournalling', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable Health</p>
            <p class="text-xs text-slate-500">Track daily steps and meal calories.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableHealth"
            @update:model-value="onHealthToggle"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable TODOs</p>
            <p class="text-xs text-slate-500">Standalone task tracker with due dates, priorities, and recurring tasks.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableTodos"
            @update:model-value="setAppSetting('enableTodos', $event)"
          />
        </div>

        <div v-if="appSettings.enableTodos" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable "I'm Bored" Mode</p>
            <p class="text-xs text-slate-500">Magic 8-ball oracle that suggests activities from curated categories.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableBored"
            @update:model-value="setAppSetting('enableBored', $event)"
          />
        </div>

        <div v-if="appSettings.enableJournalling" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Save transcriptions</p>
            <p class="text-xs text-slate-500">After recording, offer to save the speech-to-text transcript as a Scribble tagged <code class="text-slate-400">habitat-transcribed</code>.</p>
          </div>
          <USwitch
            :model-value="appSettings.saveTranscribedNotes"
            @update:model-value="setAppSetting('saveTranscribedNotes', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Notifications</p>
            <p class="text-xs">
              <template v-if="isIosSafari">
                <span class="text-amber-400">Install the app first — iOS only allows notifications in installed PWAs</span>
              </template>
              <template v-else>
                <span v-if="notifPermission === 'granted'" class="text-green-400">Enabled — add reminders on individual habit pages</span>
                <span v-else-if="notifPermission === 'denied'" class="text-red-400">Blocked — allow in browser/OS settings to enable</span>
                <span v-else class="text-slate-500">Not enabled — grant permission to receive reminders</span>
              </template>
            </p>
          </div>
          <div class="shrink-0">
            <UButton
              v-if="notifPermission === 'default' && !isIosSafari"
              size="sm"
              variant="soft"
              color="neutral"
              icon="i-heroicons-bell"
              @click="enableNotifications"
            >
              Enable
            </UButton>
            <div v-else-if="notifPermission === 'granted'" class="w-2 h-2 rounded-full bg-green-400 mx-2" />
            <UIcon v-else-if="notifPermission === 'denied'" name="i-heroicons-bell-slash" class="w-5 h-5 text-red-400 mx-1" />
            <UIcon v-else-if="isIosSafari" name="i-heroicons-bell-slash" class="w-5 h-5 text-amber-400 mx-1" />
          </div>
        </div>

        <!-- Install -->
        <div v-if="isInstalled" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Habitat is installed</p>
            <p class="text-xs text-green-400">{{ isNativeApp ? 'Running as a native app' : 'Running as a standalone app' }}</p>
          </div>
          <div class="w-2 h-2 rounded-full bg-green-400 mx-2 shrink-0" />
        </div>
        <div v-else class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Install Habitat</p>
            <p class="text-xs text-slate-500">Add to your home screen for offline access and notifications</p>
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

      </UCard>
    </section>

    <!-- ── Data ──────────────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">Data</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export data</p>
            <p class="text-xs text-slate-500">Download selected data as a versioned JSON file.</p>
          </div>
          <UButton
            icon="i-heroicons-arrow-down-tray"
            variant="ghost"
            color="neutral"
            size="sm"
            :disabled="!db.isAvailable"
            @click="openExportModal"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Import data</p>
            <p class="text-xs text-slate-500">Merge from a Habitat JSON export. Existing records are kept.</p>
          </div>
          <input ref="importInput" type="file" accept=".json" class="hidden" @change="onImportFileSelected" />
          <UButton
            icon="i-heroicons-arrow-up-tray"
            variant="ghost"
            color="neutral"
            size="sm"
            :disabled="!db.isAvailable"
            @click="openImport"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export SQLite</p>
            <p class="text-xs text-slate-500">Download the raw <span class="font-mono">.sqlite3</span> database file.</p>
          </div>
          <UButton
            icon="i-heroicons-circle-stack"
            variant="ghost"
            color="neutral"
            size="sm"
            :loading="exportingDb"
            :disabled="!db.isAvailable"
            @click="exportSqlite"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export voice notes</p>
            <p class="text-xs text-slate-500">Download all voice recordings as a <span class="font-mono">.zip</span> archive.</p>
          </div>
          <UButton
            icon="i-heroicons-musical-note"
            variant="ghost"
            color="neutral"
            size="sm"
            :loading="exportingVoiceZip"
            @click="exportVoiceNotesZip"
          />
        </div>

      </UCard>
    </section>

    <!-- ── About (collapsible) ───────────────────────────────────────────────── -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="aboutOpen = !aboutOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">About</p>
        <UIcon :name="aboutOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-slate-600" />
      </button>
      <UCard v-if="aboutOpen" :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">App</p>
          <p class="text-sm font-medium">Habitat</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Version</p>
          <p class="text-sm font-mono font-medium">{{ runtimeConfig.public.appVersion || '—' }}</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Commit</p>
          <p class="text-sm font-mono text-slate-300">{{ runtimeConfig.public.commitSha || '—' }}</p>
        </div>
        <div v-if="runtimeConfig.public.gitTag.length > 0" class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Tag</p>
          <UBadge :label="runtimeConfig.public.gitTag" variant="subtle" color="primary" size="sm" class="rounded-full font-mono" />
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Build</p>
          <UBadge :label="runtimeConfig.public.buildTarget" variant="subtle" color="neutral" size="sm" class="rounded-full font-mono" />
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Built</p>
          <p class="text-sm font-mono text-slate-300">{{ runtimeConfig.public.buildTime ? new Date(runtimeConfig.public.buildTime).toLocaleString() : '—' }}</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-slate-400">Storage</p>
          <p class="text-sm font-medium">On-device (OPFS)</p>
        </div>
        <button class="w-full flex items-center justify-between px-4 py-3.5 text-left" @click="openLicenses">
          <p class="text-sm text-slate-400">Open source licenses</p>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-500 shrink-0" />
        </button>

        <!-- DB schema -->
        <div>
          <button class="w-full flex items-center justify-between px-4 py-3.5 text-left" @click="toggleDbInfo">
            <div class="space-y-0.5">
              <p class="text-sm text-slate-400">Database schema</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge v-if="dbInfo" :label="`v${dbInfo.userVersion}`" variant="subtle" color="neutral" size="sm" class="font-mono rounded-full" />
              <UIcon :name="dbInfoOpen ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-4 h-4 text-slate-500" />
            </div>
          </button>
          <div v-if="dbInfoOpen" class="border-t border-slate-800 px-4 py-3 space-y-2">
            <div v-if="dbInfoLoading" class="flex items-center gap-2 text-xs text-slate-500">
              <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
            <template v-else-if="dbInfo">
              <div class="flex items-center gap-2 mb-3">
                <span class="text-xs text-slate-500">Schema version:</span>
                <span class="font-mono text-xs text-slate-200">{{ dbInfo.userVersion }}</span>
              </div>
              <div v-for="table in dbInfo.tables" :key="table.name" class="rounded-lg border border-slate-800 overflow-hidden">
                <button
                  class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/40 transition-colors"
                  @click="expandedTable = expandedTable === table.name ? null : table.name"
                >
                  <span class="text-xs font-mono text-slate-300">{{ table.name }}</span>
                  <UIcon :name="expandedTable === table.name ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5 text-slate-600" />
                </button>
                <pre v-if="expandedTable === table.name" class="text-[10px] leading-relaxed font-mono text-slate-400 bg-slate-950 px-3 py-2 overflow-x-auto border-t border-slate-800">{{ table.sql }}</pre>
              </div>
              <template v-if="dbInfo.indices.length > 0">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-slate-600 pt-1">Indices</p>
                <div v-for="idx in dbInfo.indices" :key="idx.name" class="rounded-lg border border-slate-800 overflow-hidden">
                  <button
                    class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/40 transition-colors"
                    @click="expandedTable = expandedTable === idx.name ? null : idx.name"
                  >
                    <div class="min-w-0 text-left">
                      <span class="text-xs font-mono text-slate-400">{{ idx.name }}</span>
                      <span class="text-[10px] text-slate-600 ml-2">on {{ idx.tbl_name }}</span>
                    </div>
                    <UIcon :name="expandedTable === idx.name ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  </button>
                  <pre v-if="expandedTable === idx.name" class="text-[10px] leading-relaxed font-mono text-slate-400 bg-slate-950 px-3 py-2 overflow-x-auto border-t border-slate-800">{{ idx.sql }}</pre>
                </div>
              </template>
            </template>
          </div>
        </div>

      </UCard>
    </section>

    <!-- ── Diagnostics (collapsible) ─────────────────────────────────────────── -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="diagOpen = !diagOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Diagnostics</p>
        <UIcon :name="diagOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-slate-600" />
      </button>
      <UCard v-if="diagOpen" :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Integrity check -->
        <div class="flex items-start justify-between px-4 py-3.5 gap-3">
          <div class="space-y-0.5 min-w-0">
            <p class="text-sm font-medium">Integrity check</p>
            <p class="text-xs text-slate-500">Runs SQLite <span class="font-mono">PRAGMA integrity_check</span></p>
            <div v-if="integrityResults !== null" class="mt-1.5">
              <p v-if="integrityOk" class="text-xs text-green-400 flex items-center gap-1">
                <UIcon name="i-heroicons-check-circle" class="w-3.5 h-3.5 shrink-0" /> ok
              </p>
              <ul v-else class="space-y-0.5">
                <li v-for="(msg, i) in integrityResults" :key="i" class="text-xs text-red-400 font-mono break-all">{{ msg }}</li>
              </ul>
            </div>
          </div>
          <UButton
            size="sm" variant="ghost" color="neutral"
            :loading="integrityLoading" :disabled="!db.isAvailable"
            icon="i-heroicons-shield-check" class="shrink-0"
            @click="runIntegrityCheck"
          />
        </div>

        <!-- OPFS files -->
        <div>
          <button class="w-full flex items-center justify-between px-4 py-3.5 text-left" @click="toggleOpfs">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">OPFS files</p>
              <p class="text-xs text-slate-500">All files in the origin private file system</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span v-if="opfsFiles.length > 0" class="text-xs text-slate-500">{{ opfsFiles.length }} file{{ opfsFiles.length !== 1 ? 's' : '' }}</span>
              <UIcon :name="opfsOpen ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-4 h-4 text-slate-500" />
            </div>
          </button>
          <div v-if="opfsOpen" class="border-t border-slate-800 px-4 py-3">
            <div v-if="opfsLoading" class="flex items-center gap-2 text-xs text-slate-500">
              <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" /> Scanning…
            </div>
            <div v-else-if="opfsFiles.length === 0" class="text-xs text-slate-500">No files found.</div>
            <ul v-else class="space-y-1.5">
              <li v-for="f in opfsFiles" :key="f.path" class="flex items-center justify-between gap-4">
                <span class="text-[11px] font-mono text-slate-300 truncate">{{ f.path }}</span>
                <span class="text-[11px] font-mono text-slate-500 shrink-0">{{ formatBytes(f.size) }}</span>
              </li>
            </ul>
            <button class="mt-3 text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors" @click="loadOpfsFiles">
              <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" /> Refresh
            </button>
          </div>
        </div>

        <!-- Test notification -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Test notification</p>
            <p class="text-xs text-slate-500">Fire a sample notification to verify delivery.</p>
          </div>
          <UButton
            size="sm" variant="ghost" color="neutral"
            icon="i-heroicons-bell"
            :disabled="notifPermission !== 'granted'"
            @click="sendTestNotification"
          />
        </div>

        <!-- Storage estimate -->
        <div class="px-4 py-3.5 space-y-2">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">Storage</p>
              <p class="text-xs text-slate-500">Browser quota and current usage.</p>
            </div>
            <UButton size="sm" variant="ghost" color="neutral" icon="i-heroicons-arrow-path" @click="loadStorageEstimate" />
          </div>
          <template v-if="storageEstimate">
            <div class="space-y-1">
              <div class="flex justify-between text-xs text-slate-400">
                <span>{{ formatBytes(storageEstimate.usage ?? 0) }} used</span>
                <span>{{ formatBytes(storageEstimate.quota ?? 0) }} quota</span>
              </div>
              <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden">
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

      </UCard>
    </section>

    <!-- ── Here be dragons (collapsible) ─────────────────────────────────────── -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="dragonsOpen = !dragonsOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-red-900/70">🐉 Here be dragons</p>
        <UIcon :name="dragonsOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-3.5 h-3.5 text-red-900/50" />
      </button>
      <UCard v-if="dragonsOpen" :ui="{ root: 'rounded-2xl ring-1 ring-red-900/30', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Force reload</p>
            <p class="text-xs text-slate-500">Unregister service worker, clear JS/CSS caches, and reload. OPFS data is preserved.</p>
          </div>
          <UButton
            size="sm" variant="ghost" color="neutral"
            icon="i-heroicons-arrow-path" :loading="forceReloading" class="shrink-0"
            @click="forceReload"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-red-400">Clear app data</p>
            <p class="text-xs text-slate-500">Selectively delete habits, check-ins, scribbles, or voice notes.</p>
          </div>
          <UButton
            icon="i-heroicons-trash"
            variant="ghost" color="error" size="sm"
            :disabled="!db.isAvailable"
            @click="showClearModal = true"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-red-400">Clear OPFS storage</p>
            <p class="text-xs text-slate-500">Wipe all on-device file system storage including the database.</p>
          </div>
          <UButton
            icon="i-heroicons-fire"
            variant="ghost" color="error" size="sm"
            :disabled="!db.isAvailable"
            @click="showNukeModal = true"
          />
        </div>

      </UCard>
    </section>

    <!-- ── Open source licenses modal ───────────────────────────────────────── -->
    <UModal v-model:open="showLicensesModal">
      <template #content>
        <div class="p-5 space-y-4 flex flex-col max-h-[80vh]">
          <div class="flex items-center justify-between shrink-0">
            <h3 class="font-semibold text-slate-100">Open source licenses</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showLicensesModal = false" />
          </div>
          <div v-if="licensesLoading" class="flex items-center justify-center py-8 text-slate-500 text-sm">
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
                  class="text-sm text-slate-200 hover:text-primary-400 transition-colors truncate block"
                >{{ pkg.name }}</a>
                <span v-else class="text-sm text-slate-200 truncate block">{{ pkg.name }}</span>
                <span class="text-xs text-slate-500 font-mono">v{{ pkg.version }}</span>
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

    <!-- ── Install instructions modal ───────────────────────────────────────── -->
    <UModal v-model:open="showInstallModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-slate-100">Install Habitat</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showInstallModal = false" />
          </div>

          <!-- iOS Safari -->
          <template v-if="isIosSafari">
            <ol class="space-y-3 text-sm text-slate-300">
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">1.</span>
                <span>Tap the <strong class="text-slate-100">Share</strong> button
                  <UIcon name="i-heroicons-arrow-up-on-square" class="inline w-4 h-4 align-text-bottom text-slate-100" />
                  in the Safari toolbar</span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">2.</span>
                <span>Scroll down and tap <strong class="text-slate-100">Add to Home Screen</strong></span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">3.</span>
                <span>Tap <strong class="text-slate-100">Add</strong> to confirm</span>
              </li>
            </ol>
          </template>

          <!-- Chromium but no deferred prompt (not yet offered, or previously dismissed) -->
          <template v-else-if="isChromiumNoPrompt">
            <p class="text-sm text-slate-400">Chrome hasn't offered an install prompt yet — use the browser menu instead:</p>
            <ol class="space-y-3 text-sm text-slate-300">
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">1.</span>
                <span>Tap the <strong class="text-slate-100">⋮ menu</strong> in the top-right corner of Chrome</span>
              </li>
              <li class="flex items-start gap-3">
                <span class="text-primary-400 font-semibold shrink-0">2.</span>
                <span>Choose <strong class="text-slate-100">Install app</strong> or <strong class="text-slate-100">Add to Home Screen</strong></span>
              </li>
            </ol>
          </template>

          <!-- Unsupported browser -->
          <template v-else>
            <p class="text-sm text-slate-400">
              Your current browser doesn't support PWA installation.
              Open Habitat in <strong class="text-slate-100">Chrome</strong>, <strong class="text-slate-100">Edge</strong>,
              <strong class="text-slate-100">Brave</strong>, or <strong class="text-slate-100">Opera</strong>
              to install it as a standalone app.
            </p>
            <p class="text-xs text-slate-500">
              These browsers also provide OPFS storage and background notifications.
            </p>
          </template>

          <div class="flex justify-end">
            <UButton variant="ghost" color="neutral" @click="showInstallModal = false">Close</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Export JSON modal ─────────────────────────────────────────────────── -->
    <UModal v-model:open="showExportModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-slate-100">Export data</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showExportModal = false" />
          </div>

          <!-- Select all toggle -->
          <label class="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              class="accent-primary-500"
              :checked="exportAllSelected"
              :indeterminate="!exportAllSelected && !exportNoneSelected"
              @change="toggleExportAll"
            />
            <span class="text-sm text-slate-300 font-medium">Select all</span>
          </label>

          <!-- Groups -->
          <div class="space-y-3">
            <div v-for="group in EXPORT_GROUPS" :key="group.label" class="space-y-1.5">
              <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">{{ group.label }}</p>
              <div class="border border-slate-800 rounded-xl divide-y divide-slate-800 overflow-hidden">
                <label
                  v-for="item in group.items"
                  :key="item.key"
                  class="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-800/40 transition-colors"
                >
                  <input v-model="exportSel[item.key]" type="checkbox" class="accent-primary-500 shrink-0" />
                  <span class="text-sm text-slate-300">{{ item.label }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- FK errors -->
          <ul v-if="exportErrors.length > 0" class="space-y-1">
            <li
              v-for="err in exportErrors"
              :key="err"
              class="text-xs text-red-400 flex items-center gap-1.5"
            >
              <UIcon name="i-heroicons-exclamation-circle" class="w-3.5 h-3.5 shrink-0" />
              {{ err }}
            </li>
          </ul>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" size="sm" @click="showExportModal = false">Cancel</UButton>
            <UButton
              size="sm"
              icon="i-heroicons-arrow-down-tray"
              :loading="exporting"
              :disabled="exportNoneSelected"
              @click="downloadJson"
            >
              Download
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Import JSON modal ──────────────────────────────────────────────────── -->
    <UModal v-model:open="showImportModal">
      <template #content>
        <!-- Error state -->
        <div v-if="importError" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-exclamation-circle" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Cannot import</p>
              <p class="text-sm text-slate-400">{{ importError }}</p>
            </div>
          </div>
          <div class="flex justify-end">
            <UButton variant="ghost" color="neutral" @click="showImportModal = false">Close</UButton>
          </div>
        </div>

        <!-- Success state -->
        <div v-else-if="importDone" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-check-circle" class="w-5 h-5 text-green-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Import complete</p>
              <p class="text-sm text-slate-400">Records merged. Reload to see all updates.</p>
            </div>
          </div>
          <div class="flex justify-end">
            <UButton @click="() => { showImportModal = false; reloadPage() }">Reload</UButton>
          </div>
        </div>

        <!-- Preview / confirm state -->
        <div v-else-if="importPreview" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-arrow-up-tray" class="w-5 h-5 text-primary-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Import data?</p>
              <p class="text-sm text-slate-400">New records will be added; existing IDs are skipped.</p>
            </div>
          </div>

          <!-- Summary -->
          <div class="border border-slate-800 rounded-xl p-3 space-y-1">
            <p class="text-xs text-slate-500 mb-2">
              Version {{ importPreview.version }} export from {{ new Date(importPreview.exported_at).toLocaleDateString() }}
            </p>
            <template v-for="group in EXPORT_GROUPS" :key="group.label">
              <template v-for="item in group.items" :key="item.key">
                <div
                  v-if="(importPreview[item.key] ?? []).length > 0"
                  class="flex items-center justify-between text-xs"
                >
                  <span class="text-slate-400">{{ item.label }}</span>
                  <span class="font-mono text-slate-300">{{ (importPreview[item.key] ?? []).length }}</span>
                </div>
              </template>
            </template>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showImportModal = false">Cancel</UButton>
            <UButton :loading="importing" @click="confirmImport">Import</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Confirm clear app data ────────────────────────────────────────────── -->
    <UModal v-model:open="showClearModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Clear app data?</p>
              <p class="text-sm text-slate-400">Select what to delete. This cannot be undone.</p>
            </div>
          </div>

          <!-- Checkboxes -->
          <div class="space-y-1 border border-slate-800 rounded-xl divide-y divide-slate-800 overflow-hidden">
            <label
              v-for="item in clearItems"
              :key="item.key"
              class="flex items-start gap-3 px-3.5 py-3 cursor-pointer hover:bg-slate-800/40 transition-colors"
            >
              <input
                v-model="clearSelection[item.key]"
                type="checkbox"
                class="mt-0.5 accent-red-500 shrink-0"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-200 leading-snug">{{ item.label }}</p>
                <p class="text-xs text-slate-500 leading-snug">{{ item.description }}</p>
              </div>
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showClearModal = false">Cancel</UButton>
            <UButton
              color="error"
              :loading="clearing"
              :disabled="nothingSelected"
              @click="clearAppData"
            >
              Delete selected
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Confirm nuke OPFS ───────────────────────────────────────────────────── -->
    <UModal v-model:open="showNukeModal">
      <template #content>
        <!-- Done state (wipe-only path) -->
        <div v-if="wiped" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-check-circle" class="w-5 h-5 text-green-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">All data wiped</p>
              <p class="text-sm text-slate-400">Storage has been cleared. You can safely close this tab.</p>
            </div>
          </div>
        </div>

        <!-- Confirm state -->
        <div v-else class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-fire" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Wipe OPFS storage?</p>
              <p class="text-sm text-slate-400">
                Removes every file in the browser's origin private file system —
                including the SQLite database. Voice recordings and check-in entries
                will also be cleared.
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showNukeModal = false">Cancel</UButton>
            <UButton color="error" variant="ghost" :loading="nuking" @click="nukeOpfs(false)">Wipe only</UButton>
            <UButton color="error" :loading="nuking" @click="nukeOpfs(true)">Wipe &amp; reload</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Health setup modal ───────────────────────────────────────────────── -->
    <UModal v-model:open="showHealthSetup">
      <template #content>
        <div class="p-5 space-y-5">
          <div>
            <h3 class="text-lg font-semibold">Set up Health Tracking</h3>
            <p class="text-sm text-slate-400 mt-0.5">Choose what you'd like to track. Habits are created in your habit list.</p>
          </div>

          <!-- Steps -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableSteps" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Steps</p>
                <p class="text-xs text-slate-500">Creates a daily NUMERIC habit with your step goal.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableSteps" class="ml-7">
              <UFormField label="Daily step goal">
                <UInput
                  v-model.number="healthSetup.stepGoal"
                  type="number"
                  min="1000"
                  step="500"
                  class="w-40"
                />
              </UFormField>
            </div>
          </div>

          <!-- Meals -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableMeals" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Meals</p>
                <p class="text-xs text-slate-500">Creates LIMIT habits for calorie tracking per meal.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableMeals" class="ml-7 space-y-2">
              <div v-for="(meal, i) in healthSetup.meals" :key="i" class="flex items-center gap-2">
                <UInput v-model="meal.name" placeholder="Meal name" class="flex-1" />
                <UInput
                  v-model.number="meal.calories"
                  type="number"
                  min="0"
                  step="50"
                  class="w-24"
                />
                <span class="text-xs text-slate-500 shrink-0">kcal</span>
                <button class="text-slate-700 hover:text-red-400 transition-colors shrink-0" @click="removeMeal(i)">
                  <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
                </button>
              </div>
              <button class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1 mt-1" @click="addMeal">
                <UIcon name="i-heroicons-plus" class="w-3 h-3" /> Add meal
              </button>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showHealthSetup = false">Skip</UButton>
            <UButton
              color="primary"
              :disabled="!healthSetup.enableSteps && !healthSetup.enableMeals"
              :loading="creatingHealth"
              @click="confirmHealthSetup"
            >
              Create Habits
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

  </div>
</template>
