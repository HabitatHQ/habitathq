<script setup lang="ts">
import type { ExportSelection, HabitatExport } from '~/types/database'
import { buildJotsExportZip } from '~/utils/jots-export'

const db = useDatabase()
const toast = useToast()
const isDev = import.meta.dev
const seeding = ref(false)

async function seedDemoData() {
  seeding.value = true
  try {
    const result = await useSeedDemo().seedDemoData()
    toast.add({
      title: 'Demo data loaded',
      description: `${result.habits} habits, ${result.todos} tasks, and ${result.notes} dated notes are ready to explore.`,
      color: 'success',
      duration: 6000,
    })
  } catch (err) {
    logError('[seedDemoData]', err)
    toast.add({ title: 'Could not load demo data', color: 'error', duration: 4000 })
  } finally {
    seeding.value = false
  }
}

// ─── JSON export ───────────────────────────────────────────────────────────────

type ExportKey = keyof ExportSelection

interface ExportGroup {
  label: string
  items: Array<{ key: ExportKey; label: string; parent?: ExportKey }>
}

const EXPORT_GROUPS: ExportGroup[] = [
  {
    label: 'Habits',
    items: [
      { key: 'habits', label: 'Habits' },
      { key: 'completions', label: 'Completions', parent: 'habits' },
      { key: 'habit_logs', label: 'Habit logs', parent: 'habits' },
      { key: 'habit_schedules', label: 'Habit schedules', parent: 'habits' },
      { key: 'reminders', label: 'Habit reminders', parent: 'habits' },
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
      { key: 'scribbles', label: 'Scribbles' },
      { key: 'checkin_entries', label: 'Journal entries' },
    ],
  },
  {
    label: 'TODOs & Bored',
    items: [
      { key: 'todos', label: 'TODOs' },
      { key: 'focus_sessions', label: 'Focus sessions', parent: 'todos' },
      { key: 'bored_categories', label: 'Bored categories' },
      { key: 'bored_activities', label: 'Bored activities', parent: 'bored_categories' },
    ],
  },
]

function defaultExportSelection(): ExportSelection {
  return {
    habits: true,
    completions: true,
    habit_logs: true,
    habit_schedules: true,
    reminders: true,
    checkin_templates: true,
    checkin_questions: true,
    checkin_responses: true,
    checkin_reminders: true,
    scribbles: true,
    checkin_entries: true,
    todos: true,
    focus_sessions: true,
    bored_categories: true,
    bored_activities: true,
  }
}

const showExportModal = ref(false)
const exporting = ref(false)
const exportSel = reactive<ExportSelection>(defaultExportSelection())
const exportErrors = ref<string[]>([])

const exportAllKeys = Object.keys(defaultExportSelection()) as ExportKey[]
const exportAllSelected = computed(() => exportAllKeys.every((k) => exportSel[k]))
const exportNoneSelected = computed(() => exportAllKeys.every((k) => !exportSel[k]))

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
    ['completions', 'habits', 'Completions', 'Habits'],
    ['habit_logs', 'habits', 'Habit logs', 'Habits'],
    ['habit_schedules', 'habits', 'Habit schedules', 'Habits'],
    ['reminders', 'habits', 'Habit reminders', 'Habits'],
    ['checkin_questions', 'checkin_templates', 'Questions', 'Check-in templates'],
    ['checkin_responses', 'checkin_questions', 'Responses', 'Check-in questions'],
    ['checkin_reminders', 'checkin_templates', 'Check-in reminders', 'Check-in templates'],
    ['bored_activities', 'bored_categories', 'Bored activities', 'Bored categories'],
  ]
  return rules
    .filter(([child, parent]) => exportSel[child] && !exportSel[parent])
    .map(([, , childLabel, parentLabel]) => `${childLabel} require ${parentLabel}`)
}

async function downloadJson() {
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

// ─── SQLite export ─────────────────────────────────────────────────────────────

const exportingDb = ref(false)

async function exportSqlite() {
  exportingDb.value = true
  try {
    const bytes = await db.exportDb()
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' }),
    )
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

// ─── JSON import ───────────────────────────────────────────────────────────────

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

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

function isHabitatExport(obj: unknown): obj is HabitatExport {
  return isRecord(obj) && obj['version'] === 1
}

async function onImportFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ;(e.target as HTMLInputElement).value = ''
  try {
    const raw = JSON.parse(await file.text()) as unknown
    if (!isRecord(raw)) {
      importError.value = 'Invalid file.'
      showImportModal.value = true
      return
    }
    const ver = raw['version']
    if (typeof ver !== 'number') {
      importError.value = 'Missing version field — not a Habitat export.'
      showImportModal.value = true
      return
    }
    if (ver !== 1) {
      importError.value = `Unsupported version ${ver}. This app supports version 1.`
      showImportModal.value = true
      return
    }
    if (!isHabitatExport(raw)) {
      importError.value = 'Data validation failed.'
      showImportModal.value = true
      return
    }
    importPreview.value = raw
    showImportModal.value = true
  } catch {
    importError.value = 'Could not parse file as JSON.'
    showImportModal.value = true
  }
}

function reloadPage() {
  window.location.reload()
}

async function confirmImport() {
  if (!importPreview.value) return
  importing.value = true
  try {
    await db.importJson(toRaw(importPreview.value))
    importDone.value = true
    importPreview.value = null
  } finally {
    importing.value = false
  }
}

// ─── Jots ZIP export ───────────────────────────────────────────────────────────

const showJotsExportModal = ref(false)
const exportingJots = ref(false)
const jotsExportSel = reactive({ text: true, voice: true, images: true })

async function exportJotsZip() {
  // Dynamic import avoids IDBBlobAdapter init-order crash in SSR (see e64a6cf)
  const { getBlobAdapter } = await import('~/composables/useJotsStore')
  const blobAdapter = getBlobAdapter()
  exportingJots.value = true
  try {
    const zipped = await buildJotsExportZip({
      ...(jotsExportSel.text && { textJots: await db.getScribbles() }),
      ...(jotsExportSel.voice && { voiceNotes: await db.getVoiceNotes() }),
      ...(jotsExportSel.images && { imageNotes: await db.getImageNotes() }),
      getBlob: (id) => blobAdapter.get(id),
    })
    if (!zipped) return

    const url = URL.createObjectURL(
      new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
    )
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `habitat-jots-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      URL.revokeObjectURL(url)
    }
    showJotsExportModal.value = false
  } finally {
    exportingJots.value = false
  }
}

// ─── Clear app data ────────────────────────────────────────────────────────────

function clearLocalStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('checkin-')) localStorage.removeItem(key)
  }
}

function clearIdb(): Promise<void> {
  return Promise.all([
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('habitat-blobs')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    }),
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('habitat')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    }),
  ]).then(() => {})
}

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
  {
    key: 'habits',
    label: 'Habits & completions',
    description: 'All habits, logs, and completion history',
  },
  {
    key: 'checkinEntries',
    label: 'Check-in entries',
    description: 'Daily check-in answers stored in the DB',
  },
  {
    key: 'checkins',
    label: 'Check-in templates & responses',
    description: 'All templates, questions, and recorded answers',
  },
  { key: 'scribbles', label: 'Scribbles', description: 'All free-form notes' },
  { key: 'voiceNotes', label: 'Voice recordings', description: 'IndexedDB audio data' },
  { key: 'todos', label: 'TODOs', description: 'All tasks and their history' },
  {
    key: 'boredData',
    label: 'Bored activities',
    description: 'All custom activities (system categories preserved)',
  },
  {
    key: 'appliedDefaults',
    label: 'Applied defaults',
    description: 'Re-enables seeding of default check-in templates',
  },
] as const

const nothingSelected = computed(
  () =>
    !(
      clearSelection.habits ||
      clearSelection.checkinEntries ||
      clearSelection.checkins ||
      clearSelection.scribbles ||
      clearSelection.voiceNotes ||
      clearSelection.todos ||
      clearSelection.boredData ||
      clearSelection.appliedDefaults
    ),
)

async function clearAppData() {
  if (nothingSelected.value) return
  clearing.value = true
  try {
    const ops: Promise<unknown>[] = []
    if (clearSelection.habits) ops.push(db.deleteAllHabits())
    if (clearSelection.checkinEntries) ops.push(db.deleteAllCheckinEntries())
    if (clearSelection.checkins) ops.push(db.deleteAllCheckinData())
    if (clearSelection.scribbles) ops.push(db.deleteAllScribbles())
    if (clearSelection.todos) ops.push(db.deleteAllTodos())
    if (clearSelection.boredData) ops.push(db.deleteAllBoredData())
    if (clearSelection.appliedDefaults) ops.push(db.clearAppliedDefaults())
    await Promise.all(ops)
    if (clearSelection.checkinEntries) clearLocalStorage()
    if (clearSelection.voiceNotes) {
      await clearIdb()
      await db.deleteAllMediaNotes()
    }
    if (clearSelection.habits) localStorage.removeItem('habitat-has-data')
    showClearModal.value = false
  } catch (err) {
    logError('[clearAppData]', err)
    toast.add({ title: 'Failed to clear data', color: 'error', duration: 4000 })
  } finally {
    clearing.value = false
  }
}

// ─── Nuke OPFS ─────────────────────────────────────────────────────────────────

const showNukeModal = ref(false)
const nuking = ref(false)
const wiped = ref(false)

watch(wiped, async (isWiped) => {
  if (!isWiped) return
  await nextTick()
  document.getElementById('nuke-wiped-close')?.focus()
})

async function fullWipe(reload: boolean): Promise<void> {
  localStorage.removeItem('habitat-has-data')
  await db.nukeOpfs()
  await clearIdb()
  clearLocalStorage()
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('journal-')) localStorage.removeItem(key)
  }
  if (reload) {
    window.location.reload()
  } else {
    wiped.value = true
  }
}

async function nukeOpfs(reload: boolean) {
  nuking.value = true
  try {
    await fullWipe(reload)
  } catch (err) {
    logError('[nukeOpfs]', err)
    toast.add({
      title: 'Failed to wipe data',
      description: 'Try reloading and trying again.',
      color: 'error',
      duration: 5000,
    })
  } finally {
    nuking.value = false
  }
}

// ─── Dev: seed insights data (dev builds only) ──────────────────────────────────

async function seedDevData() {
  seeding.value = true
  try {
    const { seedInsightsData } = useSeedDev()
    const r = await seedInsightsData()
    toast.add({
      title: 'Seeded sample data',
      description: `${r.habits} habits, ${r.completions} completions, ${r.habit_logs} logs, ${r.checkin_responses} check-in responses. Open Insights to view.`,
      color: 'success',
      duration: 6000,
    })
  } catch (err) {
    logError('[seedDevData]', err)
    toast.add({
      title: 'Failed to seed data',
      description: 'Check the console for details.',
      color: 'error',
      duration: 5000,
    })
  } finally {
    seeding.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <BackNav to="/settings" label="Data" title class="mb-4" />

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Export & Import</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export data</p>
            <p class="text-xs text-(--ui-text-dimmed)">Download selected data as a versioned JSON file.</p>
          </div>
          <UButton
            :icon="resolveIcon('arrow-down-tray')"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="openExportModal"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Import data</p>
            <p class="text-xs text-(--ui-text-dimmed)">Merge from a Habitat JSON export. Existing records are kept.</p>
          </div>
          <input ref="importInput" type="file" accept=".json" class="hidden" @change="onImportFileSelected" />
          <UButton
            :icon="resolveIcon('arrow-up-tray')"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="openImport"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export SQLite</p>
            <p class="text-xs text-(--ui-text-dimmed)">Download the raw <span class="font-mono">.sqlite3</span> database file.</p>
          </div>
          <UButton
            :icon="resolveIcon('circle-stack')"
            variant="ghost"
            color="neutral"
            size="sm"
            :loading="exportingDb"
            @click="exportSqlite"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Export Jots</p>
            <p class="text-xs text-(--ui-text-dimmed)">Download text notes, voice recordings, and images as a <span class="font-mono">.zip</span>.</p>
          </div>
          <UButton
            :icon="resolveIcon('document-text')"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="showJotsExportModal = true"
          />
        </div>

      </UCard>
    </section>

    <section v-if="isDev" class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Development</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
        <div class="flex items-center justify-between gap-4 px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Load demo data</p>
            <p class="text-xs text-(--ui-text-dimmed)">Add habits, planner tasks, calendar notes, focus time, and check-ins. Safe to run more than once.</p>
          </div>
          <UButton :icon="resolveIcon('sparkles')" variant="ghost" color="primary" size="sm" :loading="seeding" @click="seedDemoData" />
        </div>
        <div class="flex items-center justify-between gap-4 px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Seed insights data</p>
            <p class="text-xs text-(--ui-text-dimmed)">Generate six months of sample habits, completions, and check-in responses for the Insights page.</p>
          </div>
          <UButton :icon="resolveIcon('sparkles')" variant="ghost" color="primary" size="sm" :loading="seeding" @click="seedDevData" />
        </div>
      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-red-900/70 px-1">Danger zone</p>
      <UCard :ui="{ root: 'rounded-2xl ring-1 ring-red-900/30', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-red-400">Clear app data</p>
            <p class="text-xs text-(--ui-text-dimmed)">Selectively delete habits, check-ins, scribbles, or voice notes.</p>
          </div>
          <span class="shrink-0">
            <UButton
              :icon="resolveIcon('trash')"
              variant="ghost" color="error" size="sm"
              @click="showClearModal = true"
            />
          </span>
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-red-400">Clear OPFS storage</p>
            <p class="text-xs text-(--ui-text-dimmed)">Wipe all on-device file system storage including the database.</p>
          </div>
          <span class="shrink-0">
            <UButton
              :icon="resolveIcon('fire')"
              variant="ghost" color="error" size="sm"
              @click="showNukeModal = true"
            />
          </span>
        </div>

      </UCard>
    </section>

    <!-- Export JSON modal -->
    <AppBottomSheet v-model="showExportModal" variant="centered" content-padding="none" :closeable="false">
        <div class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-(--ui-text)">Export data</h3>
            <UButton :icon="resolveIcon('x-mark')" variant="ghost" color="neutral" size="sm" @click="showExportModal = false" />
          </div>

          <label class="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              class="accent-primary-500"
              :checked="exportAllSelected"
              :indeterminate="!exportAllSelected && !exportNoneSelected"
              @change="toggleExportAll"
            />
            <span class="text-sm text-(--ui-text-toned) font-medium">Select all</span>
          </label>

          <div class="space-y-3">
            <div v-for="group in EXPORT_GROUPS" :key="group.label" class="space-y-1.5">
              <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">{{ group.label }}</p>
              <div class="border border-(--ui-border) rounded-xl divide-y divide-(--ui-border) overflow-hidden">
                <label
                  v-for="item in group.items"
                  :key="item.key"
                  class="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-(--ui-bg-elevated)/40 transition-colors"
                >
                  <input v-model="exportSel[item.key]" type="checkbox" class="accent-primary-500 shrink-0" />
                  <span class="text-sm text-(--ui-text-toned)">{{ item.label }}</span>
                </label>
              </div>
            </div>
          </div>

          <ul v-if="exportErrors.length > 0" class="space-y-1">
            <li
              v-for="err in exportErrors"
              :key="err"
              class="text-xs text-red-400 flex items-center gap-1.5"
            >
              <AppIcon name="exclamation-circle" class="w-4 h-4 shrink-0" />
              {{ err }}
            </li>
          </ul>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" size="sm" @click="showExportModal = false">Cancel</UButton>
            <UButton
              size="sm"
              :icon="resolveIcon('arrow-down-tray')"
              :loading="exporting"
              :disabled="exportNoneSelected"
              @click="downloadJson"
            >
              Download
            </UButton>
          </div>
        </div>
    </AppBottomSheet>

    <!-- Jots export modal -->
    <AppBottomSheet v-model="showJotsExportModal" variant="centered" content-padding="none" :closeable="false">
        <div class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-(--ui-text)">Export Jots</h3>
            <UButton :icon="resolveIcon('x-mark')" variant="ghost" color="neutral" size="sm" @click="showJotsExportModal = false" />
          </div>

          <p class="text-sm text-(--ui-text-muted)">Choose which types to include. All selected types are bundled into a single <span class="font-mono">.zip</span>.</p>

          <div class="space-y-3">
            <label class="flex items-start gap-3 cursor-pointer">
              <input v-model="jotsExportSel.text" type="checkbox" class="mt-0.5 accent-primary-500" />
              <div>
                <p class="text-sm font-medium text-(--ui-text)">Text notes</p>
                <p class="text-xs text-(--ui-text-dimmed)">One <span class="font-mono">.txt</span> per note in <span class="font-mono">text/</span> + <span class="font-mono">jots.json</span></p>
              </div>
            </label>
            <label class="flex items-start gap-3 cursor-pointer">
              <input v-model="jotsExportSel.voice" type="checkbox" class="mt-0.5 accent-primary-500" />
              <div>
                <p class="text-sm font-medium text-(--ui-text)">Voice recordings</p>
                <p class="text-xs text-(--ui-text-dimmed)">Audio files in a <span class="font-mono">voice/</span> folder</p>
              </div>
            </label>
            <label class="flex items-start gap-3 cursor-pointer">
              <input v-model="jotsExportSel.images" type="checkbox" class="mt-0.5 accent-primary-500" />
              <div>
                <p class="text-sm font-medium text-(--ui-text)">Images</p>
                <p class="text-xs text-(--ui-text-dimmed)">Photos in an <span class="font-mono">images/</span> folder</p>
              </div>
            </label>
          </div>

          <div class="flex gap-2 pt-1">
            <UButton
              class="flex-1"
              :icon="resolveIcon('arrow-down-tray')"
              :loading="exportingJots"
              :disabled="!jotsExportSel.text && !jotsExportSel.voice && !jotsExportSel.images"
              @click="exportJotsZip"
            >
              Download .zip
            </UButton>
            <UButton variant="outline" color="neutral" @click="showJotsExportModal = false">Cancel</UButton>
          </div>
        </div>
    </AppBottomSheet>

    <!-- Import JSON modal -->
    <AppBottomSheet v-model="showImportModal" variant="centered" content-padding="none" :closeable="false">
        <div v-if="importError" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="exclamation-circle" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Cannot import</p>
              <p class="text-sm text-(--ui-text-muted)">{{ importError }}</p>
            </div>
          </div>
          <div class="flex justify-end">
            <UButton variant="ghost" color="neutral" @click="showImportModal = false">Close</UButton>
          </div>
        </div>

        <div v-else-if="importDone" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="check-circle" class="w-5 h-5 text-green-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Import complete</p>
              <p class="text-sm text-(--ui-text-muted)">Records merged. Reload to see all updates.</p>
            </div>
          </div>
          <div class="flex justify-end">
            <UButton @click="() => { showImportModal = false; reloadPage() }">Reload</UButton>
          </div>
        </div>

        <div v-else-if="importPreview" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="arrow-up-tray" class="w-5 h-5 text-primary-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Import data?</p>
              <p class="text-sm text-(--ui-text-muted)">New records will be added; existing IDs are skipped.</p>
            </div>
          </div>

          <div class="border border-(--ui-border) rounded-xl p-3 space-y-1">
            <p class="text-xs text-(--ui-text-dimmed) mb-2">
              Version {{ importPreview.version }} export from {{ new Date(importPreview.exported_at).toLocaleDateString() }}
            </p>
            <template v-for="group in EXPORT_GROUPS" :key="group.label">
              <template v-for="item in group.items" :key="item.key">
                <div
                  v-if="(importPreview[item.key] ?? []).length > 0"
                  class="flex items-center justify-between text-xs"
                >
                  <span class="text-(--ui-text-muted)">{{ item.label }}</span>
                  <span class="font-mono text-(--ui-text-toned)">{{ (importPreview[item.key] ?? []).length }}</span>
                </div>
              </template>
            </template>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showImportModal = false">Cancel</UButton>
            <UButton :loading="importing" @click="confirmImport">Import</UButton>
          </div>
        </div>
    </AppBottomSheet>

    <!-- Confirm clear app data -->
    <AppBottomSheet v-model="showClearModal" variant="centered" content-padding="none" :closeable="false">
        <div class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="exclamation-triangle" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Clear app data?</p>
              <p class="text-sm text-(--ui-text-muted)">Select what to delete. This cannot be undone.</p>
            </div>
          </div>

          <div class="space-y-1 border border-(--ui-border) rounded-xl divide-y divide-(--ui-border) overflow-hidden">
            <label
              v-for="item in clearItems"
              :key="item.key"
              class="flex items-start gap-3 px-3.5 py-3 cursor-pointer hover:bg-(--ui-bg-elevated)/40 transition-colors"
            >
              <input
                v-model="clearSelection[item.key]"
                type="checkbox"
                class="mt-0.5 accent-red-500 shrink-0"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-(--ui-text) leading-snug">{{ item.label }}</p>
                <p class="text-xs text-(--ui-text-dimmed) leading-snug">{{ item.description }}</p>
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
    </AppBottomSheet>

    <!-- Confirm nuke OPFS -->
    <AppBottomSheet v-model="showNukeModal" variant="centered" content-padding="none" :closeable="false">
        <div v-if="wiped" class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="check-circle" class="w-5 h-5 text-green-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">All data wiped</p>
              <p class="text-sm text-(--ui-text-muted)">Storage has been cleared. You can safely close this tab.</p>
            </div>
          </div>
          <div class="flex justify-end pt-1">
            <UButton id="nuke-wiped-close" variant="ghost" color="neutral" @click="showNukeModal = false">
              Close
            </UButton>
          </div>
        </div>

        <div v-else class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="fire" class="w-5 h-5 text-red-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Wipe OPFS storage?</p>
              <p class="text-sm text-(--ui-text-muted)">
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
    </AppBottomSheet>
  </div>
</template>
