<script setup lang="ts">
import type { AppTheme, ColorMode, NlpTier } from '~/composables/useAppSettings'
import type { Account, HearthExport } from '~/types/database'

const { settings, set, reset } = useAppSettings()
const db = useDatabase()

const dbInfo = ref<{
  transaction_count: number
  user_count: number
  account_count: number
  envelope_count: number
} | null>(null)
const importFileRef = ref<HTMLInputElement | null>(null)
const accounts = ref<Account[]>([])

const NLP_TIERS: { id: NlpTier; label: string; desc: string }[] = [
  { id: 'regex', label: 'Lite', desc: 'Instant, pattern matching' },
  { id: 'embeddings', label: 'Standard', desc: '~15 MB model download' },
  { id: 'llm', label: 'Enhanced', desc: 'Coming soon' },
]

const nlp = useNlpParser()

onMounted(async () => {
  try {
    const [info, accts] = await Promise.all([db.getDbInfo(), db.getAccounts()])
    dbInfo.value = info
    accounts.value = accts
  } catch {
    // ignore
  }
})

async function exportJson() {
  try {
    const data = await db.exportJson()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hearth-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert(`Export failed: ${String(e)}`)
  }
}

async function onImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text) as HearthExport
    await db.importJson(data)
    alert('Import successful! Reloading…')
    location.reload()
  } catch (e) {
    alert(`Import failed: ${String(e)}`)
  }
  if (importFileRef.value) importFileRef.value.value = ''
}

async function resetDatabase() {
  if (!confirm('Reset all data? This cannot be undone.')) return
  await db.nukeOpfs()
  location.reload()
}

const THEMES: { id: AppTheme; name: string }[] = [
  { id: 'hearth', name: 'Hearth (Amber)' },
  { id: 'forest', name: 'Forest (Green)' },
  { id: 'ocean', name: 'Ocean (Indigo)' },
]

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
]
</script>

<template>
  <div class="p-4 space-y-6 max-w-2xl mx-auto">
    <h1 class="text-xl font-bold">Settings</h1>

    <!-- ── Appearance ─────────────────────────────────────────────────────── -->
    <section aria-label="Appearance settings">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Appearance</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">

        <!-- Theme -->
        <div class="p-4">
          <p class="text-sm font-medium text-(--ui-text) mb-3">Theme</p>
          <div class="flex gap-2" role="group" aria-label="Select theme">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="flex-1 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px]"
              :class="settings.theme === t.id
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
                : 'text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-transparent hover:text-(--ui-text)'"
              :aria-pressed="settings.theme === t.id"
              @click="set('theme', t.id)"
            >
              {{ t.name }}
            </button>
          </div>
        </div>

        <!-- Color mode -->
        <div class="p-4">
          <p class="text-sm font-medium text-(--ui-text) mb-3">Color Mode</p>
          <div class="flex gap-2" role="group" aria-label="Select color mode">
            <button
              v-for="mode in COLOR_MODES"
              :key="mode.id"
              class="flex-1 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px]"
              :class="settings.colorMode === mode.id
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
                : 'text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-transparent hover:text-(--ui-text)'"
              :aria-pressed="settings.colorMode === mode.id"
              @click="set('colorMode', mode.id)"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>

        <!-- Reduce motion -->
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <UIcon name="i-heroicons-sparkles" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Reduce motion</p>
            <p class="text-xs text-(--ui-text-muted)">Disable animations</p>
          </div>
          <button
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            :class="settings.reduceMotion ? 'bg-primary-500' : 'bg-(--ui-bg-elevated)'"
            role="switch"
            :aria-checked="settings.reduceMotion"
            @click="set('reduceMotion', !settings.reduceMotion)"
          >
            <span class="inline-block h-4 w-4 rounded-full bg-white transition-transform" :class="settings.reduceMotion ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- ── Display ────────────────────────────────────────────────────────── -->
    <section aria-label="Display settings">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Display</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <UIcon name="i-heroicons-device-phone-mobile" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Sticky bottom nav</p>
            <p class="text-xs text-(--ui-text-muted)">Fix nav bar to bottom</p>
          </div>
          <button
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            :class="settings.stickyNav ? 'bg-primary-500' : 'bg-(--ui-bg-elevated)'"
            role="switch"
            :aria-checked="settings.stickyNav"
            @click="set('stickyNav', !settings.stickyNav)"
          >
            <span class="inline-block h-4 w-4 rounded-full bg-white transition-transform" :class="settings.stickyNav ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- ── Quick Add ──────────────────────────────────────────────────────── -->
    <section aria-label="Quick Add settings">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Quick Add</h2>
      <HelpTip id="quick-add-settings" class="mb-3">
        <template #label>What is Quick Add?</template>
        <p>Quick Add lets you type or speak transactions in plain language, like "coffee $6 at Blue Bottle" or "transfer $500 to savings." Hearth parses the text and fills in the form for you.</p>
        <p><strong class="text-(--ui-text)">Parsing quality</strong> controls how the text is understood. Lite is instant and uses pattern matching. Standard downloads a small AI model for better accuracy.</p>
      </HelpTip>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">

        <!-- NLP Tier -->
        <div class="p-4">
          <p class="text-sm font-medium text-(--ui-text) mb-3">Parsing quality</p>
          <div class="flex gap-2" role="group" aria-label="Select NLP tier">
            <button
              v-for="t in NLP_TIERS"
              :key="t.id"
              class="flex-1 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px] flex flex-col items-center gap-0.5"
              :class="settings.nlpTier === t.id
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
                : 'text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-transparent hover:text-(--ui-text)'"
              :aria-pressed="settings.nlpTier === t.id"
              @click="set('nlpTier', t.id)"
            >
              <span>{{ t.label }}</span>
              <span class="text-[10px] opacity-60">{{ t.desc }}</span>
            </button>
          </div>
          <!-- Model download progress -->
          <div v-if="nlp.status.value === 'loading'" class="mt-3 space-y-1">
            <div class="h-1.5 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
              <div class="h-full rounded-full bg-primary-500 transition-all" :style="{ width: `${nlp.modelProgress.value}%` }" />
            </div>
            <p class="text-[10px] text-(--ui-text-muted)">Downloading model... {{ nlp.modelProgress.value }}%</p>
          </div>
        </div>

        <!-- Voice auto-submit timeout -->
        <div class="p-4">
          <p class="text-sm font-medium text-(--ui-text) mb-2">Voice auto-submit</p>
          <p class="text-xs text-(--ui-text-muted) mb-3">Auto-send voice input after a pause</p>
          <div class="flex gap-2" role="group" aria-label="Voice auto-submit timeout">
            <button
              v-for="opt in [{ v: 0, label: 'Off' }, { v: 1, label: '1s' }, { v: 2, label: '2s' }, { v: 3, label: '3s' }]"
              :key="opt.v"
              class="flex-1 py-2 rounded-xl text-xs font-medium transition-all min-h-[44px]"
              :class="settings.voiceAutoSubmitTimeout === opt.v
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
                : 'text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-transparent hover:text-(--ui-text)'"
              :aria-pressed="settings.voiceAutoSubmitTimeout === opt.v"
              @click="set('voiceAutoSubmitTimeout', opt.v as 0 | 1 | 2 | 3)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Default expense account -->
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <UIcon name="i-heroicons-credit-card" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Default expense account</p>
            <p class="text-xs text-(--ui-text-muted)">Used when no account is specified</p>
          </div>
          <select
            class="text-sm bg-(--ui-bg-elevated) rounded-lg px-2 py-1.5 border border-(--ui-border) text-(--ui-text) min-h-[36px]"
            :value="settings.defaultExpenseAccount ?? ''"
            @change="set('defaultExpenseAccount', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">Auto</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>

        <!-- Default income account -->
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <UIcon name="i-heroicons-banknotes" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Default income account</p>
            <p class="text-xs text-(--ui-text-muted)">Used for salary, payments, etc.</p>
          </div>
          <select
            class="text-sm bg-(--ui-bg-elevated) rounded-lg px-2 py-1.5 border border-(--ui-border) text-(--ui-text) min-h-[36px]"
            :value="settings.defaultIncomeAccount ?? ''"
            @change="set('defaultIncomeAccount', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">Auto</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>
    </section>

    <!-- ── Data ───────────────────────────────────────────────────────────── -->
    <section aria-label="Data management">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Data</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <!-- DB stats -->
        <dl v-if="dbInfo" class="p-4 grid grid-cols-2 gap-2">
          <div class="text-center py-2">
            <dd class="text-lg font-bold font-mono text-(--ui-text)">{{ dbInfo.transaction_count }}</dd>
            <dt class="text-xs text-(--ui-text-muted)">Transactions</dt>
          </div>
          <div class="text-center py-2">
            <dd class="text-lg font-bold font-mono text-(--ui-text)">{{ dbInfo.envelope_count }}</dd>
            <dt class="text-xs text-(--ui-text-muted)">Envelopes</dt>
          </div>
        </dl>

        <!-- Export -->
        <button
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px]"
          aria-label="Export data as JSON"
          @click="exportJson"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Export data</p>
            <p class="text-xs text-(--ui-text-muted)">Download JSON backup</p>
          </div>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </button>

        <!-- Import -->
        <input
          ref="importFileRef"
          type="file"
          accept=".json"
          class="sr-only"
          aria-hidden="true"
          @change="onImportFile"
        />
        <button
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px]"
          aria-label="Import data from JSON"
          @click="importFileRef?.click()"
        >
          <UIcon name="i-heroicons-arrow-up-tray" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Import data</p>
            <p class="text-xs text-(--ui-text-muted)">Restore from JSON backup</p>
          </div>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </button>

        <!-- Import CSV -->
        <NuxtLink
          to="/import"
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px]"
          aria-label="Import transactions from CSV"
        >
          <UIcon name="i-heroicons-table-cells" class="w-5 h-5 text-primary-400 shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Import from CSV</p>
            <p class="text-xs text-(--ui-text-muted)">Import transactions from YNAB, Mint, or any CSV</p>
          </div>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </NuxtLink>

        <!-- Reset -->
        <button
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-rose-500/5 transition-colors min-h-[60px]"
          aria-label="Reset database"
          @click="resetDatabase"
        >
          <UIcon name="i-heroicons-trash" class="w-5 h-5 text-rose-400 shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-rose-400">Reset database</p>
            <p class="text-xs text-(--ui-text-muted)">Permanently deletes all transactions, accounts, envelopes, and settings. Export first if you want a backup.</p>
          </div>
        </button>
      </div>
    </section>

    <!-- ── About ──────────────────────────────────────────────────────────── -->
    <section aria-label="About">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">About</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center space-y-1">
        <p class="text-2xl">🔥</p>
        <p class="font-semibold text-(--ui-text)">Hearth</p>
        <p class="text-xs text-(--ui-text-muted)">Family finance, local-first</p>
        <p class="text-xs text-(--ui-text-dimmed)">v0.1.0</p>
      </div>
    </section>
  </div>
</template>
