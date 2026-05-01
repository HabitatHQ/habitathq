<script setup lang="ts">
import { autoMapCategories } from '~/lib/import/category-mapper'
import { autoMapColumns, type HearthField } from '~/lib/import/column-mapper'
import { parseCSV } from '~/lib/import/csv-parser'
import { findDuplicates } from '~/lib/import/dedup'
import { type ImportPreset, MINT_PRESET, YNAB_PRESET } from '~/lib/import/presets'
import type { Transaction } from '~/types/database'

const db = useDatabase()
const router = useRouter()
const toast = useToast()

// ── Wizard state ──────────────────────────────────────────────────────────
type Step = 'upload' | 'columns' | 'categories' | 'preview'
const step = ref<Step>('upload')
const preset = ref<ImportPreset | null>(null)

// Step 1: File data
const rawText = ref('')
const parsedHeaders = ref<string[]>([])
const parsedRows = ref<string[][]>([])

// Step 2: Column mapping
const columnMap = ref<Map<string, HearthField>>(new Map())
const fieldOptions: HearthField[] = [
  'date',
  'amount',
  'merchant',
  'category',
  'description',
  'account',
  'type',
  'skip',
]

// Step 3: Category mapping
const categoryMap = ref<Map<string, { hearthId: string | null; action: 'mapped' | 'create' }>>(
  new Map(),
)
const hearthCategories = ref<Array<{ id: string; name: string }>>([])

// Step 4: Preview
const importReady = ref<Array<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>>([])
const duplicateIndices = ref<Set<number>>(new Set())
const errorRows = ref<Array<{ index: number; reason: string }>>([])
const importing = ref(false)
const importProgress = ref(0)

// ── Reference data ─────────────────────────────────────────────────────
const accounts = ref<Array<{ id: string; name: string }>>([])
const currentUserId = ref('')

onMounted(async () => {
  const [accts, cats, user] = await Promise.all([
    db.getAccounts(),
    db.getCategories(),
    db.getCurrentUser(),
  ])
  accounts.value = accts.map((a) => ({ id: a.id, name: a.name }))
  hearthCategories.value = cats.map((c) => ({ id: c.id, name: c.name }))
  currentUserId.value = user?.id ?? ''
})

// ── Step 1: File upload ──────────────────────────────────────────────────
function handleFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    rawText.value = reader.result as string
    const parsed = parseCSV(rawText.value)
    parsedHeaders.value = parsed.headers
    parsedRows.value = parsed.rows

    if (preset.value) {
      // Apply preset column mapping
      columnMap.value = new Map(Object.entries(preset.value.columnMap))
      step.value = 'categories'
      prepareCategories()
    } else {
      // Auto-suggest column mapping
      columnMap.value = autoMapColumns(parsedHeaders.value)
      step.value = 'columns'
    }
  }
  reader.readAsText(file)
}

function selectPreset(p: ImportPreset | null) {
  preset.value = p
}

// ── Step 2: Column mapping ───────────────────────────────────────────────
function setColumnMapping(header: string, field: HearthField) {
  columnMap.value.set(header, field)
}

function goToCategories() {
  prepareCategories()
  step.value = 'categories'
}

// ── Step 3: Category mapping ─────────────────────────────────────────────
function prepareCategories() {
  const catColumnHeader = [...columnMap.value.entries()].find(([, f]) => f === 'category')?.[0]
  if (!catColumnHeader) {
    // No category column → skip to preview
    step.value = 'preview'
    preparePreview()
    return
  }

  const catIdx = parsedHeaders.value.indexOf(catColumnHeader)
  if (catIdx === -1) {
    step.value = 'preview'
    preparePreview()
    return
  }

  const uniqueCategories = [
    ...new Set(parsedRows.value.map((r) => r[catIdx] ?? '').filter(Boolean)),
  ]
  categoryMap.value = autoMapCategories(uniqueCategories, hearthCategories.value) as Map<
    string,
    { hearthId: string | null; action: 'mapped' | 'create' }
  >
  step.value = 'categories'
}

function setCategoryMapping(imported: string, hearthId: string | null) {
  categoryMap.value.set(imported, { hearthId, action: hearthId ? 'mapped' : 'create' })
}

// ── Step 4: Preview ──────────────────────────────────────────────────────
async function preparePreview() {
  step.value = 'preview'

  const dateCol = [...columnMap.value.entries()].find(([, f]) => f === 'date')?.[0]
  const amountCol = [...columnMap.value.entries()].find(([, f]) => f === 'amount')?.[0]
  const merchantCol = [...columnMap.value.entries()].find(([, f]) => f === 'merchant')?.[0]
  const catCol = [...columnMap.value.entries()].find(([, f]) => f === 'category')?.[0]
  const descCol = [...columnMap.value.entries()].find(([, f]) => f === 'description')?.[0]

  const dateIdx = dateCol ? parsedHeaders.value.indexOf(dateCol) : -1
  const amountIdx = amountCol ? parsedHeaders.value.indexOf(amountCol) : -1
  const merchantIdx = merchantCol ? parsedHeaders.value.indexOf(merchantCol) : -1
  const catIdx = catCol ? parsedHeaders.value.indexOf(catCol) : -1
  const descIdx = descCol ? parsedHeaders.value.indexOf(descCol) : -1

  const txns: Array<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>> = []
  const errors: Array<{ index: number; reason: string }> = []

  for (let i = 0; i < parsedRows.value.length; i++) {
    const row = parsedRows.value[i]!

    // Parse date
    const rawDate = dateIdx >= 0 ? (row[dateIdx]?.trim() ?? '') : ''
    const date = parseImportDate(rawDate)
    if (!date) {
      errors.push({ index: i, reason: `Invalid date: "${rawDate}"` })
      continue
    }

    // Parse amount
    const rawAmount = amountIdx >= 0 ? (row[amountIdx]?.trim() ?? '') : ''
    const amount = parseImportAmount(rawAmount)
    if (amount == null) {
      errors.push({ index: i, reason: `Invalid amount: "${rawAmount}"` })
      continue
    }

    const merchant = merchantIdx >= 0 ? (row[merchantIdx]?.trim() ?? '') : ''
    const description = descIdx >= 0 ? (row[descIdx]?.trim() ?? '') : ''
    const rawCategory = catIdx >= 0 ? (row[catIdx]?.trim() ?? '') : ''

    // Map category
    let categoryId: string | null = null
    if (rawCategory) {
      const mapping = categoryMap.value.get(rawCategory)
      if (mapping?.hearthId) categoryId = mapping.hearthId
    }

    const type = amount < 0 ? 'expense' : 'income'

    txns.push({
      date,
      amount,
      currency: 'USD',
      account_id: accounts.value[0]?.id ?? '',
      user_id: currentUserId.value,
      type: type as 'expense' | 'income',
      category_id: categoryId,
      description,
      merchant,
      is_private: 0,
      is_recurring: 0,
      transfer_to_account_id: null,
      split_id: null,
      source: 'import',
    })
  }

  importReady.value = txns
  errorRows.value = errors

  // Duplicate detection
  const existingTxns = await db.getTransactions(10000)
  const incoming = txns.map((t) => ({ date: t.date, amount: t.amount, merchant: t.merchant }))
  const existing = existingTxns.map((t) => ({
    date: t.date,
    amount: t.amount,
    merchant: t.merchant,
  }))
  duplicateIndices.value = findDuplicates(incoming, existing)
}

// ── Date/Amount parsing helpers ──────────────────────────────────────────
function parseImportDate(raw: string): string | null {
  // Try ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // Try M/D/YYYY
  const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1]!.padStart(2, '0')}-${mdyMatch[2]!.padStart(2, '0')}`
  }
  // Try M/D/YY
  const mdyShort = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdyShort) {
    const year = Number(mdyShort[3]) > 50 ? `19${mdyShort[3]}` : `20${mdyShort[3]}`
    return `${year}-${mdyShort[1]!.padStart(2, '0')}-${mdyShort[2]!.padStart(2, '0')}`
  }
  return null
}

function parseImportAmount(raw: string): number | null {
  // Strip currency symbols, commas, spaces
  const cleaned = raw.replace(/[$,\s]/g, '')
  const num = Number.parseFloat(cleaned)
  if (Number.isNaN(num)) return null
  return num
}

// ── Import execution ─────────────────────────────────────────────────────
async function executeImport() {
  const toImport = importReady.value.filter((_, i) => !duplicateIndices.value.has(i))
  if (!toImport.length) return

  importing.value = true
  importProgress.value = 0

  try {
    // Batch in chunks of 50
    const batchSize = 50
    let imported = 0
    for (let i = 0; i < toImport.length; i += batchSize) {
      const batch = toImport.slice(i, i + batchSize)
      const result = await db.importTransactions(batch)
      imported += result.imported
      importProgress.value = Math.round((imported / toImport.length) * 100)
    }

    toast.add({
      title: `Imported ${imported} transaction(s)`,
      color: 'success' as const,
    })
    router.push('/transactions')
  } catch (e) {
    toast.add({
      title: 'Import failed',
      description: e instanceof Error ? e.message : 'Unknown error',
      color: 'error' as const,
    })
  } finally {
    importing.value = false
  }
}

// ── Computed stats ───────────────────────────────────────────────────────
const importableCount = computed(() => importReady.value.length - duplicateIndices.value.size)
const expenseCount = computed(
  () =>
    importReady.value.filter((t, i) => t.type === 'expense' && !duplicateIndices.value.has(i))
      .length,
)
const incomeCount = computed(
  () =>
    importReady.value.filter((t, i) => t.type === 'income' && !duplicateIndices.value.has(i))
      .length,
)
const totalExpenses = computed(() =>
  importReady.value
    .filter((t, i) => t.type === 'expense' && !duplicateIndices.value.has(i))
    .reduce((s, t) => s + Math.abs(t.amount), 0),
)
const totalIncome = computed(() =>
  importReady.value
    .filter((t, i) => t.type === 'income' && !duplicateIndices.value.has(i))
    .reduce((s, t) => s + t.amount, 0),
)
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl mx-auto">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-(--ui-border)">
      <button
        class="flex items-center justify-center w-10 h-10 rounded-xl text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
        aria-label="Back"
        @click="step === 'upload' ? router.back() : (step = step === 'preview' ? 'categories' : step === 'categories' ? 'columns' : 'upload')"
      >
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
      </button>
      <h1 class="text-sm font-semibold text-(--ui-text)">Import Transactions</h1>
      <span class="text-xs text-(--ui-text-muted) w-10 text-right">
        {{ step === 'upload' ? '1/4' : step === 'columns' ? '2/4' : step === 'categories' ? '3/4' : '4/4' }}
      </span>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- ── Step 1: Upload ────────────────────────────────────────────────── -->
      <template v-if="step === 'upload'">
        <HelpTip id="csv-import" :dismissable="false">
          <template #label>How does CSV import work?</template>
          <p>Export a CSV file from your bank or budgeting app, then upload it here. Hearth will walk you through mapping columns, matching categories, and detecting duplicates before importing.</p>
          <p>If you're coming from <strong class="text-(--ui-text)">YNAB</strong> or <strong class="text-(--ui-text)">Mint</strong>, pick the matching preset below for automatic column mapping.</p>
        </HelpTip>
        <label
          class="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-(--ui-border) hover:border-primary-500/50 cursor-pointer transition-colors"
        >
          <UIcon name="i-heroicons-document-arrow-up" class="w-12 h-12 text-(--ui-text-dimmed)" />
          <p class="text-sm text-(--ui-text-muted)">Drop CSV file here or tap to browse</p>
          <input type="file" accept=".csv,.tsv" class="hidden" @change="handleFile" />
        </label>

        <div class="space-y-2">
          <p class="text-xs text-(--ui-text-muted) font-medium uppercase tracking-widest">Quick import from:</p>
          <div class="flex gap-2">
            <button
              v-for="p in [{ label: 'YNAB', value: YNAB_PRESET }, { label: 'Mint', value: MINT_PRESET }, { label: 'Generic CSV', value: null }]"
              :key="p.label"
              class="flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-all"
              :class="preset?.name === p.value?.name
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
                : 'text-(--ui-text-muted) bg-(--ui-bg-muted) border border-transparent hover:border-(--ui-border)'"
              @click="selectPreset(p.value)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 2: Column mapping ────────────────────────────────────────── -->
      <template v-if="step === 'columns'">
        <p class="text-sm text-(--ui-text-muted)">
          We detected {{ parsedHeaders.length }} columns. Map each to a Hearth field:
        </p>
        <div class="space-y-2">
          <div
            v-for="header in parsedHeaders"
            :key="header"
            class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3"
          >
            <span class="text-sm text-(--ui-text) flex-1 truncate font-mono">"{{ header }}"</span>
            <span class="text-(--ui-text-dimmed)">→</span>
            <select
              :value="columnMap.get(header) ?? 'skip'"
              class="text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg px-2 py-1.5 text-(--ui-text) outline-none min-h-[36px]"
              @change="(e: Event) => setColumnMapping(header, (e.target as HTMLSelectElement).value as HearthField)"
            >
              <option v-for="f in fieldOptions" :key="f" :value="f">{{ f }}</option>
            </select>
          </div>
        </div>

        <!-- Preview first 3 rows -->
        <div v-if="parsedRows.length" class="rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 overflow-x-auto">
          <p class="text-xs text-(--ui-text-muted) mb-2">Preview (first 3 rows):</p>
          <table class="text-xs font-mono">
            <tr v-for="(row, i) in parsedRows.slice(0, 3)" :key="i">
              <td v-for="(cell, j) in row" :key="j" class="px-2 py-0.5 text-(--ui-text-muted)">{{ cell }}</td>
            </tr>
          </table>
        </div>

        <button
          class="w-full min-h-[44px] rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
          @click="goToCategories"
        >
          Next →
        </button>
      </template>

      <!-- ── Step 3: Category mapping ──────────────────────────────────────── -->
      <template v-if="step === 'categories'">
        <p class="text-sm text-(--ui-text-muted)">
          {{ categoryMap.size }} categories found. Review the mappings:
        </p>
        <div class="space-y-2">
          <div
            v-for="[imported, mapping] in categoryMap"
            :key="imported"
            class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3"
          >
            <span class="text-xs" :class="mapping.hearthId ? 'text-green-400' : 'text-amber-400'">
              {{ mapping.hearthId ? '✅' : '⚠️' }}
            </span>
            <span class="text-sm text-(--ui-text) flex-1 truncate">"{{ imported }}"</span>
            <span class="text-(--ui-text-dimmed)">→</span>
            <select
              :value="mapping.hearthId ?? ''"
              class="text-xs bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg px-2 py-1.5 text-(--ui-text) outline-none min-h-[32px] max-w-[140px]"
              @change="(e: Event) => setCategoryMapping(imported, (e.target as HTMLSelectElement).value || null)"
            >
              <option value="">Create new</option>
              <option v-for="cat in hearthCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
        </div>

        <button
          class="w-full min-h-[44px] rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
          @click="preparePreview"
        >
          Next →
        </button>
      </template>

      <!-- ── Step 4: Preview + Confirm ─────────────────────────────────────── -->
      <template v-if="step === 'preview'">
        <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-3">
          <p class="text-sm font-semibold text-(--ui-text)">
            Ready to import {{ importableCount }} transactions
          </p>
          <ul class="text-xs text-(--ui-text-muted) space-y-1">
            <li>{{ expenseCount }} expenses ({{ formatAmount(totalExpenses) }} total)</li>
            <li>{{ incomeCount }} income ({{ formatAmount(totalIncome) }} total)</li>
            <li v-if="duplicateIndices.size">{{ duplicateIndices.size }} duplicates detected (will skip)</li>
            <li v-if="errorRows.length">{{ errorRows.length }} rows with errors (will skip)</li>
          </ul>
        </div>

        <UAlert
          v-if="errorRows.length"
          title="Rows with errors"
          :description="`${errorRows.length} row(s) will be skipped: ${errorRows.slice(0, 3).map((e) => e.reason).join(', ')}${errorRows.length > 3 ? '...' : ''}`"
          color="warning"
          variant="soft"
        />

        <div v-if="importing" class="space-y-2">
          <div class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
            <div class="h-full rounded-full bg-primary-500 transition-all" :style="{ width: `${importProgress}%` }" />
          </div>
          <p class="text-xs text-(--ui-text-muted) text-center">Importing... {{ importProgress }}%</p>
        </div>

        <button
          v-if="!importing"
          class="w-full min-h-[44px] rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors disabled:opacity-50"
          :disabled="importableCount === 0"
          @click="executeImport"
        >
          Import {{ importableCount }} →
        </button>
      </template>
    </div>
  </div>
</template>
