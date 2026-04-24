<script setup lang="ts">
import type { TransactionWithDetails } from '~/types/database'
import { currentPeriod } from '~/utils/format'

const db = useDatabase()

const period = ref(currentPeriod())
const transactions = ref<TransactionWithDetails[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    transactions.value = await db.getTransactionsForPeriod(period.value)
  } finally {
    loading.value = false
  }
}

watch(period, load)
onMounted(load)

const isCurrentPeriod = computed(() => period.value === currentPeriod())

// ── Aggregations ──────────────────────────────────────────────────────────

const expenses = computed(() => transactions.value.filter((t) => t.type === 'expense'))
const income = computed(() => transactions.value.filter((t) => t.type === 'income'))

const totalExpenses = computed(() => expenses.value.reduce((s, t) => s + Math.abs(t.amount), 0))
const totalIncome = computed(() => income.value.reduce((s, t) => s + t.amount, 0))
const netSavings = computed(() => totalIncome.value - totalExpenses.value)

// Spending by category
const byCategory = computed(() => {
  const map = new Map<
    string,
    { name: string; icon: string; color: string; total: number; count: number }
  >()
  for (const t of expenses.value) {
    const key = t.category_id ?? 'uncategorized'
    const name = t.category_name ?? 'Uncategorized'
    const icon = t.category_icon ?? '💳'
    const color = t.category_color ?? '#94a3b8'
    if (!map.has(key)) map.set(key, { name, icon, color, total: 0, count: 0 })
    const entry = map.get(key)!
    entry.total += Math.abs(t.amount)
    entry.count++
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
})

// Spending by person
const byPerson = computed(() => {
  const map = new Map<string, { name: string; avatar: string; total: number; count: number }>()
  for (const t of expenses.value) {
    const key = t.user_id
    if (!map.has(key))
      map.set(key, { name: t.user_name, avatar: t.user_avatar, total: 0, count: 0 })
    const entry = map.get(key)!
    entry.total += Math.abs(t.amount)
    entry.count++
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
})

// SVG donut chart data
const donutSegments = computed(() => {
  if (totalExpenses.value === 0) return []
  let offset = 0
  const COLORS = [
    '#f59e0b',
    '#6366f1',
    '#22c55e',
    '#ec4899',
    '#ef4444',
    '#a855f7',
    '#0ea5e9',
    '#fb923c',
  ]
  return byCategory.value.slice(0, 8).map((cat, i) => {
    const pct = (cat.total / totalExpenses.value) * 100
    const seg = { name: cat.name, icon: cat.icon, pct, offset, color: COLORS[i % COLORS.length] }
    offset += pct
    return seg
  })
})

// SVG circle math: circumference of r=40 circle = 251.3
const C = 2 * Math.PI * 40

type ViewMode = 'categories' | 'people'
const viewMode = ref<ViewMode>('categories')
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">

    <!-- ── Period navigator ────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between">
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
        aria-label="Previous month"
        @click="period = offsetPeriod(period, -1)"
      >
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </button>
      <h1 class="text-xs font-semibold text-(--ui-text-muted) tracking-wide uppercase">
        {{ formatPeriod(period) }}
      </h1>
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors"
        :class="isCurrentPeriod ? 'text-(--ui-text-dimmed) cursor-default' : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
        :disabled="isCurrentPeriod"
        aria-label="Next month"
        @click="period = offsetPeriod(period, 1)"
      >
        <UIcon name="i-heroicons-chevron-right" class="w-5 h-5" />
      </button>
    </div>

    <!-- ── Summary cards ───────────────────────────────────────────────────── -->
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Total expenses">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Spent</p>
        <p class="text-xl font-bold font-mono text-rose-400 amount-display">{{ formatAmount(totalExpenses) }}</p>
      </div>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Total income">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Income</p>
        <p class="text-xl font-bold font-mono text-green-400 amount-display">{{ formatAmount(totalIncome) }}</p>
      </div>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Net savings">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Saved</p>
        <p
          class="text-xl font-bold font-mono amount-display"
          :class="netSavings >= 0 ? 'text-primary-400' : 'text-rose-400'"
        >
          {{ formatAmount(Math.abs(netSavings)) }}
        </p>
      </div>
    </div>

    <!-- ── Donut chart ─────────────────────────────────────────────────────── -->
    <figure
      v-if="!loading && totalExpenses > 0"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Spending breakdown chart"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">Spending Breakdown</figcaption>
      <div class="flex items-center gap-6">
        <!-- SVG donut -->
        <svg
          viewBox="0 0 100 100"
          class="w-32 h-32 shrink-0 -rotate-90"
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--ui-bg-elevated)" stroke-width="12" />
          <circle
            v-for="seg in donutSegments"
            :key="seg.name"
            cx="50"
            cy="50"
            r="40"
            fill="none"
            :stroke="seg.color"
            stroke-width="12"
            :stroke-dasharray="`${(seg.pct / 100) * C} ${C}`"
            :stroke-dashoffset="`${(-seg.offset / 100) * C}`"
            stroke-linecap="butt"
          />
        </svg>
        <!-- Legend -->
        <ul class="flex-1 space-y-1.5 min-w-0">
          <li
            v-for="seg in donutSegments"
            :key="seg.name"
            class="flex items-center gap-2 text-sm"
          >
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ background: seg.color }"
              aria-hidden="true"
            />
            <span class="text-(--ui-text) truncate flex-1">{{ seg.icon }} {{ seg.name }}</span>
            <span class="font-mono text-xs text-(--ui-text-muted) shrink-0">{{ Math.round(seg.pct) }}%</span>
          </li>
        </ul>
      </div>
    </figure>

    <!-- ── View mode toggle ────────────────────────────────────────────────── -->
    <div class="flex gap-2" role="group" aria-label="View breakdown by">
      <button
        v-for="mode in (['categories', 'people'] as ViewMode[])"
        :key="mode"
        class="flex-1 py-2 rounded-xl text-sm font-medium transition-all min-h-[44px] capitalize"
        :class="viewMode === mode
          ? 'bg-primary-500/15 text-primary-400 border border-primary-500/30'
          : 'text-(--ui-text-muted) hover:text-(--ui-text) bg-(--ui-bg-muted) border border-transparent'"
        :aria-pressed="viewMode === mode"
        @click="viewMode = mode"
      >
        {{ mode }}
      </button>
    </div>

    <!-- ── Category breakdown ─────────────────────────────────────────────── -->
    <section v-if="viewMode === 'categories'" aria-label="Spending by category">
      <div v-if="loading" class="space-y-2">
        <div v-for="n in 6" :key="n" class="h-14 bg-(--ui-bg-muted) rounded-xl animate-pulse" />
      </div>
      <div v-else-if="!byCategory.length" class="text-center py-8 text-(--ui-text-muted)">
        No expenses this period
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="cat in byCategory"
          :key="cat.name"
          class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 min-h-[56px]"
        >
          <span class="text-xl w-8 text-center shrink-0" aria-hidden="true">{{ cat.icon }}</span>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium text-(--ui-text) truncate">{{ cat.name }}</span>
              <span class="font-mono text-sm font-semibold text-(--ui-text) shrink-0 ml-2">{{ formatAmount(cat.total) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
                <div
                  class="h-full rounded-full bg-primary-500 envelope-bar"
                  :style="{ width: `${totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0}%` }"
                />
              </div>
              <span class="text-xs text-(--ui-text-muted) shrink-0 font-mono">
                {{ totalExpenses > 0 ? Math.round((cat.total / totalExpenses) * 100) : 0 }}%
              </span>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Per-person breakdown ───────────────────────────────────────────── -->
    <section v-if="viewMode === 'people'" aria-label="Spending by person">
      <div v-if="loading" class="space-y-2">
        <div v-for="n in 3" :key="n" class="h-20 bg-(--ui-bg-muted) rounded-xl animate-pulse" />
      </div>
      <div v-else-if="!byPerson.length" class="text-center py-8 text-(--ui-text-muted)">
        No expenses this period
      </div>
      <ul v-else class="space-y-3">
        <li
          v-for="person in byPerson"
          :key="person.name"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-3"
        >
          <div class="flex items-center gap-3">
            <span class="text-2xl" aria-hidden="true">{{ person.avatar }}</span>
            <div class="flex-1">
              <p class="font-semibold text-(--ui-text)">{{ person.name }}</p>
              <p class="text-xs text-(--ui-text-muted)">{{ person.count }} transactions</p>
            </div>
            <p class="font-mono font-bold text-(--ui-text) text-lg amount-display">{{ formatAmount(person.total) }}</p>
          </div>
          <div
            class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
            role="progressbar"
            :aria-valuenow="totalExpenses > 0 ? Math.round((person.total / totalExpenses) * 100) : 0"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${person.name} spent ${formatAmount(person.total)}`"
          >
            <div
              class="h-full rounded-full bg-primary-500 envelope-bar"
              :style="{ width: `${totalExpenses > 0 ? (person.total / totalExpenses) * 100 : 0}%` }"
            />
          </div>
          <p class="text-xs text-(--ui-text-muted) text-right font-mono">
            {{ totalExpenses > 0 ? Math.round((person.total / totalExpenses) * 100) : 0 }}% of household spending
          </p>
        </li>
      </ul>
    </section>

  </div>
</template>
