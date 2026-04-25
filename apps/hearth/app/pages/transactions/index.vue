<script setup lang="ts">
import type { TransactionWithDetails } from '~/types/database'
import { formatAmount, formatDateRelative } from '~/utils/format'

const db = useDatabase()
const { settings } = useAppSettings()
const homeCurrency = computed(() => settings.value.currency)

const transactions = ref<TransactionWithDetails[]>([])
const loading = ref(true)
const searchQuery = ref('')
const filterType = ref<'all' | 'expense' | 'income' | 'transfer'>('all')
const page = ref(0)
const PAGE_SIZE = 50
const hasMore = ref(true)

async function loadMore(reset = false) {
  if (reset) {
    page.value = 0
    transactions.value = []
    hasMore.value = true
  }
  if (!hasMore.value) return
  loading.value = true
  try {
    const batch = await db.getTransactions(PAGE_SIZE, page.value * PAGE_SIZE)
    if (batch.length < PAGE_SIZE) hasMore.value = false
    transactions.value = reset ? batch : [...transactions.value, ...batch]
    page.value++
  } finally {
    loading.value = false
  }
}

onMounted(() => loadMore(true))

const filtered = computed(() => {
  let txns = transactions.value
  if (filterType.value !== 'all') txns = txns.filter((t) => t.type === filterType.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    txns = txns.filter(
      (t) =>
        t.merchant.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.category_name ?? '').toLowerCase().includes(q),
    )
  }
  return txns
})

// Group by date
const grouped = computed(() => {
  const groups = new Map<string, TransactionWithDetails[]>()
  for (const tx of filtered.value) {
    const label = formatDateRelative(tx.date)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)?.push(tx)
  }
  return Array.from(groups.entries())
})

async function deleteTransaction(id: string) {
  await db.deleteTransaction(id)
  transactions.value = transactions.value.filter((t) => t.id !== id)
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
] as const
</script>

<template>
  <div class="flex flex-col h-full">

    <!-- ── Search + Filter ────────────────────────────────────────────────── -->
    <div class="sticky top-0 z-10 bg-(--ui-bg) border-b border-(--ui-border) px-4 pt-3 pb-2 space-y-2">
      <div class="relative">
        <UIcon name="i-heroicons-magnifying-glass" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search transactions…"
          class="w-full bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl pl-9 pr-4 py-2.5 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]"
          aria-label="Search transactions"
        />
      </div>
      <!-- Filter chips -->
      <div class="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by type">
        <button
          v-for="opt in FILTER_OPTIONS"
          :key="opt.value"
          class="shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors min-h-[32px]"
          :class="filterType === opt.value
            ? 'bg-primary-500/15 border-primary-500 text-primary-400 font-medium'
            : 'border-(--ui-border) text-(--ui-text-muted) hover:border-(--ui-border-accented) hover:text-(--ui-text)'"
          :aria-pressed="filterType === opt.value"
          @click="filterType = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- ── Transaction list ───────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto px-4 py-2">

      <!-- Loading skeleton -->
      <div v-if="loading && !transactions.length" class="space-y-1 pt-2">
        <div v-for="n in 10" :key="n" class="h-14 bg-(--ui-bg-muted) rounded-xl animate-pulse" />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!filtered.length"
        class="flex flex-col items-center justify-center py-16 text-center"
      >
        <UIcon name="i-heroicons-banknotes" class="w-12 h-12 text-(--ui-text-dimmed) mb-4" aria-hidden="true" />
        <p class="text-(--ui-text-muted) font-medium">No transactions found</p>
        <p class="text-sm text-(--ui-text-dimmed) mt-1">
          {{ searchQuery ? 'Try a different search term' : 'Add your first transaction' }}
        </p>
      </div>

      <!-- Grouped list -->
      <template v-else>
        <ol>
        <li v-for="[dateLabel, txns] in grouped" :key="dateLabel">
          <p class="text-[11px] uppercase tracking-wider text-(--ui-text-dimmed) font-medium pt-4 pb-2 first:pt-2">
            {{ dateLabel }}
          </p>
          <ul class="space-y-0.5">
            <li v-for="tx in txns" :key="tx.id">
            <NuxtLink
              :to="`/transactions/${tx.id}`"
              data-testid="transaction-row"
              class="group flex items-center gap-3 py-3 px-3 rounded-xl hover:bg-(--ui-bg-muted) transition-colors min-h-[56px]"
              :class="transactionStripeClass(tx.type)"
            >
              <!-- Category icon -->
              <span class="text-xl shrink-0 w-8 text-center" aria-hidden="true">
                {{ tx.category_icon ?? '💳' }}
              </span>

              <!-- Details -->
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-(--ui-text) truncate">
                  {{ tx.merchant || tx.description || 'Transaction' }}
                </p>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span class="text-xs text-(--ui-text-muted) truncate">{{ tx.category_name ?? 'Uncategorized' }}</span>
                  <span class="text-(--ui-text-dimmed) text-xs" aria-hidden="true">·</span>
                  <span class="text-xs text-(--ui-text-dimmed) shrink-0">{{ tx.user_avatar }} {{ tx.user_name }}</span>
                </div>
              </div>

              <!-- Amount -->
              <div class="text-right shrink-0">
                <p
                  class="text-sm font-semibold"
                  :class="transactionAmountClass(tx.type)"
                >
                  {{ transactionAmountPrefix(tx.type) }}{{ formatAmount(tx.amount, tx.currency) }}
                </p>
                <p
                  v-if="tx.currency !== homeCurrency && tx.home_amount != null"
                  class="text-[11px] text-(--ui-text-dimmed) mt-0.5"
                >
                  ≈ {{ formatAmount(tx.home_amount, homeCurrency) }}
                </p>
                <p v-else class="text-xs text-(--ui-text-dimmed) mt-0.5">{{ tx.account_name }}</p>
              </div>

              <!-- Delete (visible on hover) -->
              <button
                class="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded-lg text-(--ui-text-dimmed) hover:text-rose-400 hover:bg-rose-500/10 min-h-[32px] min-w-[32px] flex items-center justify-center"
                :aria-label="`Delete transaction: ${tx.merchant || tx.description}`"
                @click.prevent.stop="deleteTransaction(tx.id)"
              >
                <UIcon name="i-heroicons-trash" class="w-4 h-4" />
              </button>
            </NuxtLink>
            </li>
          </ul>
        </li>
        </ol>

        <!-- Load more -->
        <div v-if="hasMore" class="py-4 flex justify-center">
          <button
            class="text-sm text-primary-400 hover:text-primary-300 transition-colors px-4 py-2 rounded-lg hover:bg-primary-500/10 min-h-[44px]"
            :disabled="loading"
            @click="loadMore()"
          >
            {{ loading ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </template>
    </div>

    <!-- ── FAB ────────────────────────────────────────────────────────────── -->
    <div
      class="fixed bottom-0 right-0 z-20 p-5"
      :style="{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }"
    >
      <NuxtLink
        to="/transactions/quick"
        class="flex items-center justify-center w-14 h-14 bg-primary-500 hover:bg-primary-400 text-white rounded-2xl shadow-lg shadow-primary-500/30 transition-all active:scale-95"
        aria-label="Add transaction"
      >
        <UIcon name="i-heroicons-plus" class="w-6 h-6" />
      </NuxtLink>
    </div>

  </div>
</template>
