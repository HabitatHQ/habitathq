<script setup lang="ts">
import { zipSync } from 'fflate'
import type { ExportSelection, HabitatExport } from '~/types/database'

const db = useDatabase()
const toast = useToast()

// ─── DEV SEED DATA (temporary — remove before merge) ────────────────────────────
// Creates demo habits with back-dated completions/logs to exercise every sprout
// stage and streak state (active / at-risk / broken / recovery / partial).
const seeding = ref(false)

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function rangeDays(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}

async function seedDemoData() {
  if (seeding.value) return
  seeding.value = true
  try {
    // days entries: number = boolean completion N days ago; [n, value] = numeric log
    const makeHabit = async (
      name: string,
      icon: string,
      color: string,
      days: Array<number | [number, number]>,
      opts: { type?: 'BOOLEAN' | 'NUMERIC'; target?: number; why?: string } = {},
    ) => {
      const h = await db.createHabit({
        name,
        description: '',
        why: opts.why ?? 'Demo habit for testing the sprout experience.',
        color,
        icon,
        frequency: 'daily',
        tags: [],
        annotations: {},
        type: opts.type ?? 'BOOLEAN',
        target_value: opts.target ?? 1,
        paused_until: null,
      })
      const maxN = days.reduce<number>((m, d) => Math.max(m, Array.isArray(d) ? d[0] : d), 0)
      if (h.schedule)
        await db.updateHabitSchedule({ id: h.schedule.id, start_date: daysAgo(maxN + 1) })
      await Promise.all(
        days.map((d) =>
          Array.isArray(d)
            ? db.logHabitValue(h.id, daysAgo(d[0]), d[1])
            : db.toggleCompletion(h.id, daysAgo(d)),
        ),
      )
    }

    await Promise.all([
      // ── Growth stages (consecutive days ending today) ──
      makeHabit('🌱 Seed (1d)', 'sparkles', '#34d399', rangeDays(0, 0)),
      makeHabit('🌿 Sprout (3d)', 'leaf', '#22c55e', rangeDays(0, 2)),
      makeHabit('🪴 Sapling (7d)', 'tree', '#16a34a', rangeDays(0, 6)),
      makeHabit('🍃 Leafy (14d)', 'book-open', '#0ea5e9', rangeDays(0, 13)),
      makeHabit('🌾 Budding (21d)', 'star', '#8b5cf6', rangeDays(0, 20)),
      makeHabit('🌼 Bloom (30d)', 'flower-lotus', '#ec4899', rangeDays(0, 29)),
      // ── Streak states (forgiving model) ──
      // Frozen: 10-day streak then a miss → freezes, plant regresses one notch.
      makeHabit('❄️ Frozen (10)', 'fire', '#38bdf8', rangeDays(2, 11)),
      // Thawing: froze at 8, then 2 of 3 thaw completions → "2/3".
      makeHabit('💧 Thawing (8 · 2/3)', 'water-drop', '#06b6d4', [...rangeDays(4, 11), 2, 1]),
      // Frozen + heavily regressed: streak frozen at 8 but plant faded to a seed.
      makeHabit('🥀 Frozen · faded', 'leaf', '#94a3b8', rangeDays(20, 27)),
      // Daisies: a long run banks daisies at 30 / 60.
      makeHabit('🌼 Daisies (60)', 'flower-lotus', '#ec4899', rangeDays(0, 59)),
      // Struggling: <30% over the last 2 weeks → why+pause nudge on the detail page.
      makeHabit('😟 Struggling (why set)', 'fire', '#a855f7', [12, 5]),
      makeHabit('😶 Struggling (no why)', 'moon', '#64748b', [11, 4], { why: '' }),
      // Primed for the grow animation: one short of a threshold, today still open.
      // Complete today on the detail page to watch the stage advance + pop.
      makeHabit('✨ Grow me → leafy (13d)', 'leaf', '#10b981', rangeDays(1, 13)),
      makeHabit('✨ Grow me → bloom (29d)', 'sun', '#f59e0b', rangeDays(1, 29)),
      // Numeric with partial days (target 8) — also seeds LogSheet last-value.
      makeHabit(
        '💧 Water (numeric)',
        'water-drop',
        '#3b82f6',
        [
          [6, 8],
          [5, 8],
          [4, 3],
          [3, 8],
          [2, 5],
          [1, 8],
          [0, 8],
        ],
        { type: 'NUMERIC', target: 8 },
      ),
    ])

    // ── Check-in templates (create a demo set if the user has none) ──
    // Without templates + questions there's nothing for responses to attach to,
    // so the Insights → Check-ins tab would stay empty.
    let tpls = await db.getCheckinTemplates()
    if (tpls.length === 0) {
      const makeTemplate = async (
        title: string,
        questions: Array<{ prompt: string; type: 'SCALE' | 'BOOLEAN' | 'TEXT'; desired?: number }>,
      ) => {
        const t = await db.createCheckinTemplate({
          title,
          schedule_type: 'DAILY',
          days_active: null,
        })
        await Promise.all(
          questions.map((q, i) =>
            db.createCheckinQuestion({
              template_id: t.id,
              prompt: q.prompt,
              response_type: q.type,
              display_order: i,
              desired_answer: q.desired ?? 1,
            }),
          ),
        )
      }
      await makeTemplate('🌅 Morning Check-in', [
        { prompt: 'How is your mood?', type: 'SCALE' },
        { prompt: 'Energy level?', type: 'SCALE' },
        { prompt: 'Slept well?', type: 'BOOLEAN', desired: 1 },
        { prompt: 'One thing you’re grateful for', type: 'TEXT' },
      ])
      await makeTemplate('🌙 Evening Reflection', [
        { prompt: 'Stress level?', type: 'SCALE' },
        { prompt: 'Was today productive?', type: 'BOOLEAN', desired: 1 },
      ])
      tpls = await db.getCheckinTemplates()
    }

    // ── Check-in responses (so the Insights → Check-ins tab has trends) ──
    for (const t of tpls) {
      const qs = await db.getCheckinQuestions(t.id)
      for (let n = 0; n < 30; n++) {
        if (Math.random() < 0.22) continue // ~22% skipped days → realistic consistency
        const date = daysAgo(n)
        await Promise.all(
          qs.map((q) => {
            if (q.response_type === 'SCALE') {
              // gentle upward trend + noise, clamped 1–10
              const v = Math.min(
                10,
                Math.max(1, Math.round(6 + (29 - n) * 0.05 + (Math.random() * 2 - 1))),
              )
              return db.upsertCheckinResponse(q.id, date, v, null)
            }
            if (q.response_type === 'BOOLEAN') {
              const desired = q.desired_answer ?? 1
              const v = Math.random() < 0.72 ? desired : 1 - desired
              return db.upsertCheckinResponse(q.id, date, v, null)
            }
            return db.upsertCheckinResponse(q.id, date, null, 'A quick demo reflection.')
          }),
        )
      }
    }

    toast.add({
      title: 'Seeded demo habits + check-ins',
      description: 'Habits → sprouts; Insights → Check-ins tab for trends.',
      color: 'success',
      duration: 5000,
    })
  } catch (err) {
    logError('[seedDemoData]', err)
    toast.add({ title: 'Seeding failed', color: 'error', duration: 4000 })
  } finally {
    seeding.value = false
  }
}
// ─── /DEV SEED DATA ─────────────────────────────────────────────────────────────

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential export pipeline
async function exportJotsZip() {
  // Dynamic import avoids IDBBlobAdapter init-order crash in SSR (see e64a6cf)
  const { getBlobAdapter } = await import('~/composables/useJotsStore')
  const blobAdapter = getBlobAdapter()
  exportingJots.value = true
  try {
    const files: Record<string, Uint8Array> = {}

    if (jotsExportSel.text) {
      const textJots = await db.getScribbles()
      const json = JSON.stringify(
        { version: 1, exported_at: new Date().toISOString(), text: textJots },
        null,
        2,
      )
      files['jots.json'] = new TextEncoder().encode(json)
      for (const jot of textJots) {
        const body = jot.title ? `${jot.title}\n\n${jot.content}` : jot.content
        const ts = jot.updated_at.slice(0, 19).replace(/[:.]/g, '-')
        files[`text/${ts}.txt`] = new TextEncoder().encode(body)
      }
    }

    if (jotsExportSel.voice) {
      const rows = await db.getVoiceNotes()
      for (const row of rows) {
        const bytes = await blobAdapter.get(row.id)
        if (!bytes) continue
        const ext = row.mime_type.split('/')[1]?.split(';')[0] ?? 'audio'
        const ts = row.created_at.slice(0, 19).replace(/[:.]/g, '-')
        files[`voice/${ts}.${ext}`] = bytes
      }
    }

    if (jotsExportSel.images) {
      const rows = await db.getImageNotes()
      for (const row of rows) {
        const bytes = await blobAdapter.get(row.id)
        if (!bytes) continue
        const ext = row.mime_type.split('/')[1] ?? 'jpg'
        const ts = row.created_at.slice(0, 19).replace(/[:.]/g, '-')
        files[`images/${ts}.${ext}`] = bytes
      }
    }

    if (Object.keys(files).length === 0) return

    const zipped = zipSync(files)
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
</script>

<template>
  <div class="space-y-6">
    <BackNav to="/settings" label="Data" title class="mb-4" />

    <!-- DEV SEED DATA — TEMPORARY, remove before merge -->
    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-amber-500 px-1">Dev tools</p>
      <UCard :ui="{ root: 'rounded-2xl border border-dashed border-amber-500/40', body: 'p-0 sm:p-0' }">
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Seed demo habits</p>
            <p class="text-xs text-(--ui-text-dimmed)">Adds 10 habits with back-dated history to test sprout stages &amp; streak states.</p>
          </div>
          <UButton
            :icon="resolveIcon('sparkles')"
            color="warning"
            variant="soft"
            size="sm"
            :loading="seeding"
            @click="seedDemoData"
          >
            Seed
          </UButton>
        </div>
      </UCard>
    </section>
    <!-- /DEV SEED DATA -->

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
    <UModal v-model:open="showExportModal">
      <template #content>
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
      </template>
    </UModal>

    <!-- Jots export modal -->
    <UModal v-model:open="showJotsExportModal">
      <template #content>
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
      </template>
    </UModal>

    <!-- Import JSON modal -->
    <UModal v-model:open="showImportModal">
      <template #content>
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
      </template>
    </UModal>

    <!-- Confirm clear app data -->
    <UModal v-model:open="showClearModal">
      <template #content>
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
      </template>
    </UModal>

    <!-- Confirm nuke OPFS -->
    <UModal v-model:open="showNukeModal">
      <template #content>
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
      </template>
    </UModal>
  </div>
</template>
