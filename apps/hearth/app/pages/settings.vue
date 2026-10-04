<script setup lang="ts">
import { formatInstant, localCalendarDate } from '@habitathq/utils'
import type { AppTheme, ColorMode, NlpTier } from '~/composables/useAppSettings'
import { SUPPORTED_CURRENCIES } from '~/lib/currency/convert'
import { parseHearthExport } from '~/lib/hearth-export'
import type { Account } from '~/types/database'
import { formatCurrency } from '~/utils/format'

const currencies = SUPPORTED_CURRENCIES

const { settings, set, reset } = useAppSettings()
const db = useDatabase()
const runtimeConfig = useRuntimeConfig()
const { isNative: isNativeApp } = usePlatform()

const dbInfo = ref<{
  transaction_count: number
  user_count: number
  account_count: number
  envelope_count: number
} | null>(null)
const importFileRef = ref<HTMLInputElement | null>(null)
const accounts = ref<Account[]>([])
const reconcileAccount = ref<Account | null>(null)
const reconcileBalance = ref('')
const reconcileError = ref('')
const reconciling = ref(false)

const reconcileDifference = computed(() => {
  const rawAmount = String(reconcileBalance.value)
  const amount = Number(rawAmount)
  return rawAmount.trim() !== '' && Number.isFinite(amount) && reconcileAccount.value
    ? amount - reconcileAccount.value.balance
    : null
})

function openReconcile(account: Account) {
  reconcileAccount.value = account
  reconcileBalance.value = account.balance.toFixed(2)
  reconcileError.value = ''
}

async function saveReconciliation() {
  const account = reconcileAccount.value
  const rawAmount = String(reconcileBalance.value)
  const actual = Number(rawAmount)
  if (!account || rawAmount.trim() === '' || !Number.isFinite(actual)) {
    reconcileError.value = 'Enter a valid balance.'
    return
  }
  reconciling.value = true
  reconcileError.value = ''
  try {
    await db.reconcileAccount(account.id, actual)
    accounts.value = await db.getAccountsWithBalances()
    reconcileAccount.value = null
  } catch (error) {
    reconcileError.value = error instanceof Error ? error.message : 'Could not reconcile account.'
  } finally {
    reconciling.value = false
  }
}

const reconciledAccount = computed(
  () => accounts.value.find((account) => account.id === reconcileAccount.value?.id) ?? null,
)

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
const exportOperation = useAsyncOperation({
  action: async () => {
    const data = await db.exportJson()
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `hearth-export-${localCalendarDate()}.json`,
    )
  },
})
const importOperation = useAsyncOperation({
  action: async (file: File) => {
    const parsed: unknown = JSON.parse(await file.text())
    const data = parseHearthExport(parsed)
    await db.importJson(data)
  },
  onSuccess: () => {
    setTimeout(() => window.location.reload(), 1000)
  },
})
const sqliteExportOperation = useAsyncOperation({
  action: async () => {
    const bytes = await db.exportDb()
    downloadBlob(
      new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' }),
      `hearth-${localCalendarDate()}.sqlite3`,
    )
  },
})
const sqliteExportBusy = sqliteExportOperation.busy
const sqliteExportError = sqliteExportOperation.error
const sqliteExportSuccess = sqliteExportOperation.success
const resetOperation = useAsyncOperation({
  action: () => db.resetDatabase(),
  onSuccess: () => window.location.reload(),
})
const refreshOperation = useAsyncOperation({
  action: async () => {
    await refreshAppAssets({
      scope: new URL(runtimeConfig.app.baseURL, location.origin).href,
      cachePrefix: 'hearth-',
    })
  },
})
const exportBusy = exportOperation.busy
const exportError = exportOperation.error
const exportSuccess = exportOperation.success
const importBusy = importOperation.busy
const importError = importOperation.error
const importSuccess = importOperation.success
const resetSuccess = resetOperation.success
const resetBusy = resetOperation.busy
const resetError = resetOperation.error
const refreshBusy = refreshOperation.busy
const refreshError = refreshOperation.error
const resetConfirmation = useDestructiveConfirmation<[]>()
const resetConfirmPending = resetConfirmation.pending
const dataOperationBusy = computed(
  () =>
    sqliteExportOperation.busy.value ||
    exportOperation.busy.value ||
    importOperation.busy.value ||
    resetOperation.busy.value ||
    refreshOperation.busy.value,
)

async function exportSqlite() {
  try {
    await sqliteExportOperation.run()
  } catch {
    // Failure remains available through the shared feedback component.
  }
}
async function exportJson() {
  try {
    await exportOperation.run()
  } catch {
    // Failure remains available through the shared feedback component.
  }
}

async function onImportFile(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    await importOperation.run(file)
  } catch {
    // Failure remains available through the shared feedback component.
  }
}

function resetSettings() {
  reset()
  window.location.reload()
}

function requestResetDatabase() {
  resetConfirmation.request()
}

async function confirmResetDatabase() {
  if (!resetConfirmation.confirm()) return
  try {
    await resetOperation.run()
  } catch {
    // Failure remains available through the shared feedback component.
  }
}

// ─── Here be dragons ─────────────────────────────────────────────────────────
const dragonsOpen = ref(false)

async function forceReload() {
  try {
    await refreshOperation.run()
  } catch {
    // Failure remains available through the shared feedback component.
  }
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
          <AppFeatureToggle
            class="flex-1 text-sm font-medium text-(--ui-text)"
            :model-value="settings.reduceMotion"
            label="Reduce motion"
            description="Disable animations"
            @update:model-value="set('reduceMotion', $event)"
          />
        </div>
      </div>
    </section>

    <!-- ── Display ────────────────────────────────────────────────────────── -->
    <section aria-label="Display settings">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Display</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <AppIcon name="device-phone-mobile" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <AppFeatureToggle
            class="flex-1 text-sm font-medium text-(--ui-text)"
            :model-value="settings.stickyNav"
            label="Sticky bottom nav"
            description="Fix nav bar to bottom"
            @update:model-value="set('stickyNav', $event)"
          />
        </div>
      </div>
    </section>

    <!-- ── Currency ──────────────────────────────────────────────────────── -->
    <section aria-label="Currency settings">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Currency</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <AppIcon name="currency-dollar" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Home currency</p>
            <p class="text-xs text-(--ui-text-muted)">All totals and budgets shown in this currency</p>
          </div>
          <select
            class="text-sm bg-(--ui-bg-elevated) rounded-lg px-2 py-1.5 border border-(--ui-border) text-(--ui-text) min-h-[44px]"
            :value="settings.currency"
            aria-label="Home currency"
            @change="set('currency', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="c in currencies" :key="c.code" :value="c.code">
              {{ c.symbol }} {{ c.code }} — {{ c.name }}
            </option>
          </select>
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
          <AppIcon name="credit-card" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Default expense account</p>
            <p class="text-xs text-(--ui-text-muted)">Used when no account is specified</p>
          </div>
          <select
            class="text-sm bg-(--ui-bg-elevated) rounded-lg px-2 py-1.5 border border-(--ui-border) text-(--ui-text) min-h-[44px]"
            :value="settings.defaultExpenseAccount ?? ''"
            aria-label="Default expense account"
            @change="set('defaultExpenseAccount', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">Auto</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>

        <!-- Default income account -->
        <div class="flex items-center gap-3 p-4 min-h-[60px]">
          <AppIcon name="banknote" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Default income account</p>
            <p class="text-xs text-(--ui-text-muted)">Used for salary, payments, etc.</p>
          </div>
          <select
            class="text-sm bg-(--ui-bg-elevated) rounded-lg px-2 py-1.5 border border-(--ui-border) text-(--ui-text) min-h-[44px]"
            :value="settings.defaultIncomeAccount ?? ''"
            aria-label="Default income account"
            @change="set('defaultIncomeAccount', ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">Auto</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>
    </section>

    <section aria-label="Account balances">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Account balances</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <div v-for="account in accounts" :key="account.id" class="flex items-center gap-3 p-4 min-h-[60px]">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-(--ui-text)">{{ account.name }}</p>
            <p class="text-xs text-(--ui-text-muted)">{{ account.type }} · {{ account.currency }}</p>
          </div>
          <span class="font-mono text-sm text-(--ui-text)">{{ formatCurrency(account.balance, account.currency) }}</span>
          <button
            type="button"
            class="min-h-[44px] px-3 rounded-lg text-sm font-medium text-primary-400 hover:bg-(--ui-bg-elevated)"
            :aria-label="`Reconcile ${account.name}`"
            @click="openReconcile(account)"
          >
            Reconcile
          </button>
        </div>
      </div>
    </section>

    <div
      v-if="reconcileAccount"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      @click.self="reconcileAccount = null"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconcile-title"
        class="w-full max-w-md rounded-2xl bg-(--ui-bg) border border-(--ui-border) p-5 space-y-4"
      >
        <div>
          <h2 id="reconcile-title" class="text-lg font-semibold">Reconcile {{ reconciledAccount?.name }}</h2>
          <p class="text-sm text-(--ui-text-muted) mt-1">
            Computed balance: {{ formatCurrency(reconciledAccount?.balance ?? 0, reconciledAccount?.currency ?? 'USD') }}
          </p>
        </div>
        <label class="block space-y-1 text-sm" for="reconcile-balance">
          <span>Actual balance ({{ reconciledAccount?.currency }})</span>
          <input
            id="reconcile-balance"
            v-model="reconcileBalance"
            type="number"
            inputmode="decimal"
            step="0.01"
            class="w-full min-h-[44px] rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 font-mono"
          />
        </label>
        <p v-if="reconcileDifference !== null" class="text-sm">
          Difference:
          <span class="font-mono" :class="reconcileDifference < 0 ? 'text-rose-400' : 'text-green-400'">
            {{ reconcileDifference >= 0 ? '+' : '' }}{{ formatCurrency(reconcileDifference, reconciledAccount?.currency ?? 'USD') }}
          </span>
          <span class="block text-xs text-(--ui-text-muted)">This changes the opening balance only; no transaction is added.</span>
        </p>
        <p v-if="reconcileError" role="alert" class="text-sm text-rose-400">{{ reconcileError }}</p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="min-h-[44px] px-4 rounded-lg text-sm"
            :disabled="reconciling"
            @click="reconcileAccount = null"
          >
            Cancel
          </button>
          <button
            type="button"
            class="min-h-[44px] px-4 rounded-lg bg-primary-500 text-white text-sm font-semibold disabled:opacity-50"
            :disabled="reconciling || reconcileDifference === null"
            @click="saveReconciliation"
          >
            {{ reconciling ? 'Saving…' : 'Reconcile' }}
          </button>
        </div>
      </section>
    </div>
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
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px] disabled:opacity-50"
          aria-label="Export data as JSON"
          :disabled="dataOperationBusy"
          @click="exportJson"
        >
          <AppIcon name="arrow-down-tray" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Export data</p>
            <p class="text-xs text-(--ui-text-muted)">Download JSON backup</p>
          </div>
          <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </button>
        <button
          v-if="!isNativeApp"
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px] disabled:opacity-50"
          aria-label="Export database as SQLite"
          :disabled="dataOperationBusy"
          @click="exportSqlite"
        >
          <AppIcon name="circle-stack" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Export SQLite database</p>
            <p class="text-xs text-(--ui-text-muted)">Download the raw database file</p>
          </div>
          <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
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
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px] disabled:opacity-50"
          aria-label="Import data from JSON"
          :disabled="dataOperationBusy"
          @click="importFileRef?.click()"
        >
          <AppIcon name="arrow-up-tray" class="w-5 h-5 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Import data</p>
            <p class="text-xs text-(--ui-text-muted)">Restore from JSON backup</p>
          </div>
          <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </button>

        <!-- Import CSV -->
        <NuxtLink
          to="/import"
          class="flex items-center gap-3 w-full p-4 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[60px]"
          aria-label="Import transactions from CSV"
        >
          <AppIcon name="table-cells" class="w-5 h-5 text-primary-400 shrink-0" aria-hidden="true" />
          <div class="flex-1">
            <p class="text-sm font-medium text-(--ui-text)">Import from CSV</p>
            <p class="text-xs text-(--ui-text-muted)">Import transactions from YNAB, Mint, or any CSV</p>
          </div>
          <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        </NuxtLink>

      </div>
    </section>
    <div class="space-y-2" aria-label="Data operation status">
      <AppOperationFeedback
        :busy="exportBusy"
        :error="exportError"
        :success="exportSuccess"
        busy-label="Preparing JSON backup…"
        success-label="JSON backup downloaded."
        error-label="Export failed"
      />
      <AppOperationFeedback
        :busy="sqliteExportBusy"
        :error="sqliteExportError"
        :success="sqliteExportSuccess"
        busy-label="Preparing SQLite database…"
        success-label="SQLite database downloaded."
        error-label="SQLite export failed"
      />
      <AppOperationFeedback
        :busy="importBusy"
        :error="importError"
        :success="importSuccess"
        busy-label="Restoring JSON backup…"
        success-label="Import complete. Reloading Hearth…"
        error-label="Import failed"
      />
      <AppOperationFeedback
        :busy="resetBusy"
        :error="resetError"
        :success="resetSuccess"
        busy-label="Resetting Hearth database…"
        error-label="Database reset failed"
      />
      <AppOperationFeedback
        :busy="refreshBusy"
        :error="refreshError"
        busy-label="Refreshing Hearth assets…"
        error-label="Asset refresh failed"
      />
    </div>

    <!-- ── About ──────────────────────────────────────────────────────────── -->
    <section aria-label="About">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">About</h2>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
        <div class="p-4 text-center space-y-1">
          <p class="text-2xl">🔥</p>
          <p class="font-semibold text-(--ui-text)">Hearth</p>
          <p class="text-xs text-(--ui-text-muted)">Family finance, local-first</p>
          <p class="text-xs text-(--ui-text-dimmed)">v0.1.0</p>
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Build</p>
          <UBadge :label="runtimeConfig.public.buildTarget" variant="subtle" color="neutral" size="sm" class="rounded-full font-mono" />
        </div>
        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm text-(--ui-text-muted)">Built</p>
          <p class="text-sm font-mono text-(--ui-text-toned)">{{ runtimeConfig.public.buildTime ? formatInstant(runtimeConfig.public.buildTime as string, { locale: Intl.DateTimeFormat().resolvedOptions().locale, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : '—' }}</p>
        </div>
      </div>
    </section>

    <!-- ── Here be dragons ────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between px-1 py-0.5" @click="dragonsOpen = !dragonsOpen">
        <p class="text-xs font-semibold uppercase tracking-wider text-rose-400/70">🐉 Here be dragons</p>
        <AppIcon :name="dragonsOpen ? 'chevron-up' : 'chevron-down'" class="w-4 h-4 text-rose-400/50" />
      </button>
      <div v-if="dragonsOpen" class="rounded-2xl bg-(--ui-bg-muted) border border-rose-500/20 divide-y divide-(--ui-border) overflow-hidden">

        <!-- Force reload — PWA only -->
        <div v-if="!isNativeApp" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5 mr-4">
            <p class="text-sm font-medium text-(--ui-text)">Refresh app assets</p>
            <p class="text-xs text-(--ui-text-dimmed)">Refresh Hearth's app-scoped service worker and cached assets.</p>
          </div>
          <AppIconButton icon="arrow-path" :loading="refreshBusy" :disabled="dataOperationBusy" label="Refresh app assets" class="shrink-0" @click="forceReload" />
        </div>

        <!-- Reset settings -->
        <button
          class="flex items-center gap-3 w-full px-4 py-3.5 text-left hover:bg-(--ui-bg-elevated) transition-colors min-h-[44px]"
          @click="resetSettings"
        >
          <AppIcon name="cog-6-tooth" class="w-5 h-5 text-(--ui-text-muted) shrink-0" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-(--ui-text)">Reset settings</p>
            <p class="text-xs text-(--ui-text-dimmed)">Restore all preferences to defaults. Data is not affected.</p>
          </div>
        </button>

        <!-- Reset database -->
        <button
          class="flex items-center gap-3 w-full px-4 py-3.5 text-left hover:bg-rose-500/5 transition-colors min-h-[44px] disabled:opacity-50"
          :disabled="dataOperationBusy"
          @click="requestResetDatabase"
        >
          <AppIcon name="trash" class="w-5 h-5 text-rose-400 shrink-0" />
          <div class="space-y-0.5">
            <p class="text-sm font-medium text-rose-400">Reset database</p>
            <p class="text-xs text-(--ui-text-dimmed)">Permanently deletes all data. Cannot be undone.</p>
          </div>
        </button>
      </div>
    </section>

    <AppDestructiveConfirm
      :model-value="resetConfirmPending"
      title="Reset all data?"
      message="This will permanently delete all Hearth database data. This cannot be undone."
      confirm-label="Reset Everything"
      cancel-label="Keep my data"
      :busy="resetBusy"
      @confirm="confirmResetDatabase"
      @cancel="resetConfirmation.cancel"
    />
  </div>
</template>
