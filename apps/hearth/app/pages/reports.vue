<script setup lang="ts">
import VChart from 'vue-echarts'
import { getHearthTheme } from '~/lib/echarts-theme'
import type { EnvelopeWithSpending, MonthlyTotal, TransactionWithDetails } from '~/types/database'
import { formatCompact } from '~/utils/format'

const db = useDatabase()
const router = useRouter()
const { settings } = useAppSettings()
const homeCurrency = computed(() => settings.value.currency)
const { ensureLoaded, loaded: chartsLoaded } = useCharts()
const { period, isCurrentPeriod, prevPeriod, nextPeriod } = usePeriod()

const transactions = ref<TransactionWithDetails[]>([])
const monthlyTotals = ref<MonthlyTotal[]>([])
const envelopes = ref<EnvelopeWithSpending[]>([])
const loading = ref(true)
const chartsReady = ref(false)

// ── Theme ─────────────────────────────────────────────────────────────────
const chartTheme = ref<Record<string, unknown>>({})

function refreshTheme() {
  if (import.meta.client) chartTheme.value = getHearthTheme()
}

// ── Data loading ──────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const [txns, totals, envs] = await Promise.all([
      db.getTransactionsForPeriod(period.value),
      db.getMonthlyTotals(6),
      db.getEnvelopesWithSpending(period.value),
    ])
    transactions.value = txns
    monthlyTotals.value = totals
    envelopes.value = envs
  } finally {
    loading.value = false
  }
}

watch(period, load)
onMounted(async () => {
  await Promise.all([load(), ensureLoaded()])
  refreshTheme()
  chartsReady.value = true
})

// Re-theme on settings change
watch(() => settings.value.theme, refreshTheme)
watch(
  () => settings.value.colorMode,
  () => nextTick(refreshTheme),
)

// ── Aggregations ──────────────────────────────────────────────────────────
const expenseTxns = computed(() => transactions.value.filter((t) => t.type === 'expense'))
const incomeTxns = computed(() => transactions.value.filter((t) => t.type === 'income'))

const totalExpenses = computed(() => expenseTxns.value.reduce((s, t) => s + Math.abs(t.amount), 0))
const totalIncome = computed(() => incomeTxns.value.reduce((s, t) => s + t.amount, 0))
const netSavings = computed(() => totalIncome.value - totalExpenses.value)

// ── By category ──────────────────────────────────────────────────────────
const byCategory = computed(() => {
  const map = new Map<
    string,
    { id: string; name: string; icon: string; color: string; total: number; count: number }
  >()
  for (const t of expenseTxns.value) {
    const key = t.category_id ?? 'uncategorized'
    if (!map.has(key))
      map.set(key, {
        id: key,
        name: t.category_name ?? 'Uncategorized',
        icon: t.category_icon ?? '💳',
        color: t.category_color ?? '#94a3b8',
        total: 0,
        count: 0,
      })
    const entry = map.get(key)!
    entry.total += Math.abs(t.amount)
    entry.count++
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
})

// ── By person ────────────────────────────────────────────────────────────
const byPerson = computed(() => {
  const map = new Map<
    string,
    { id: string; name: string; avatar: string; total: number; count: number }
  >()
  for (const t of expenseTxns.value) {
    if (!map.has(t.user_id))
      map.set(t.user_id, {
        id: t.user_id,
        name: t.user_name,
        avatar: t.user_avatar,
        total: 0,
        count: 0,
      })
    const entry = map.get(t.user_id)!
    entry.total += Math.abs(t.amount)
    entry.count++
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
})

// ── View mode toggle ─────────────────────────────────────────────────────
type ViewMode = 'categories' | 'people'
const viewMode = ref<ViewMode>('categories')

// ── Donut colors ─────────────────────────────────────────────────────────
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

// ── Chart 1: Spending by Category (Donut) ─────────────────────────────────
const categoryDonutOptions = computed(() => {
  const top8 = byCategory.value.slice(0, 8)
  const rest = byCategory.value.slice(8)
  const data = top8.map((c, i) => ({
    value: Math.round(c.total * 100) / 100,
    name: `${c.icon} ${c.name}`,
    categoryId: c.id,
    itemStyle: { color: c.color || COLORS[i % COLORS.length] },
  }))
  if (rest.length) {
    const otherTotal = rest.reduce((s, c) => s + c.total, 0)
    data.push({
      value: Math.round(otherTotal * 100) / 100,
      name: '📦 Other',
      categoryId: 'other',
      itemStyle: { color: '#64748b' },
    })
  }
  return {
    ...chartTheme.value,
    tooltip: { trigger: 'item', formatter: '{b}: ${c} ({d}%)' },
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '50%'],
        data,
        label: {
          show: true,
          position: 'center',
          formatter: `{total|${formatAmount(totalExpenses.value, homeCurrency.value)}}\n{label|Total Spent}`,
          rich: {
            total: {
              fontSize: 18,
              fontWeight: 'bold',
              color: (chartTheme.value?.textStyle as Record<string, unknown>)?.color || '#e2e8f0',
              lineHeight: 28,
            },
            label: { fontSize: 11, color: '#94a3b8', lineHeight: 18 },
          },
        },
        emphasis: {
          label: {
            show: true,
            formatter: (p: { name: string; percent: number }) =>
              `{total|${p.name}}\n{label|${p.percent}%}`,
          },
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' },
        },
        animationDuration: settings.value.reduceMotion ? 0 : 600,
      },
    ],
  }
})

// ── Chart 6: Per-Person Donut ─────────────────────────────────────────────
const personDonutOptions = computed(() => {
  const data = byPerson.value.map((p, i) => ({
    value: Math.round(p.total * 100) / 100,
    name: `${p.avatar} ${p.name}`,
    userId: p.id,
    itemStyle: { color: COLORS[i % COLORS.length] },
  }))
  return {
    ...chartTheme.value,
    tooltip: { trigger: 'item', formatter: '{b}: ${c} ({d}%)' },
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '50%'],
        data,
        label: {
          show: true,
          position: 'center',
          formatter: `{total|${formatAmount(totalExpenses.value, homeCurrency.value)}}\n{label|Household}`,
          rich: {
            total: {
              fontSize: 18,
              fontWeight: 'bold',
              color: (chartTheme.value?.textStyle as Record<string, unknown>)?.color || '#e2e8f0',
              lineHeight: 28,
            },
            label: { fontSize: 11, color: '#94a3b8', lineHeight: 18 },
          },
        },
        emphasis: {
          label: {
            show: true,
            formatter: (p: { name: string; percent: number }) =>
              `{total|${p.name}}\n{label|${p.percent}%}`,
          },
        },
        animationDuration: settings.value.reduceMotion ? 0 : 600,
      },
    ],
  }
})

// ── Chart 2: Monthly Spending Trend (Line) ──────────────────────────────
const monthLabels = computed(() =>
  monthlyTotals.value.map((m) => {
    const [, month] = m.period.split('-')
    const MONTHS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    return MONTHS[Number.parseInt(month!) - 1]
  }),
)

const trendOptions = computed(() => ({
  ...chartTheme.value,
  tooltip: { trigger: 'axis' },
  grid: { left: 50, right: 16, top: 16, bottom: 32 },
  xAxis: { type: 'category', data: monthLabels.value, boundaryGap: false },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: (v: number) => formatCompact(v, homeCurrency.value) },
    splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
  },
  series: [
    {
      name: 'Expenses',
      type: 'line',
      data: monthlyTotals.value.map((m) => m.expenses),
      smooth: true,
      lineStyle: { color: '#f43f5e', width: 2 },
      itemStyle: { color: '#f43f5e' },
      areaStyle: { color: 'rgba(244,63,94,0.1)' },
      animationDuration: settings.value.reduceMotion ? 0 : 800,
    },
    {
      name: 'Income',
      type: 'line',
      data: monthlyTotals.value.map((m) => m.income),
      smooth: true,
      lineStyle: { color: '#22c55e', width: 2 },
      itemStyle: { color: '#22c55e' },
      areaStyle: { color: 'rgba(34,197,94,0.1)' },
      animationDuration: settings.value.reduceMotion ? 0 : 800,
    },
  ],
}))

// ── Chart 3: Budget vs Actual (Horizontal Bar) ──────────────────────────
const sortedEnvelopes = computed(() =>
  [...envelopes.value].sort((a, b) => b.percent_used - a.percent_used),
)

const budgetOptions = computed(() => ({
  ...chartTheme.value,
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 120, right: 30, top: 8, bottom: 24 },
  xAxis: {
    type: 'value',
    axisLabel: { formatter: (v: number) => formatCompact(v, homeCurrency.value) },
    splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
  },
  yAxis: {
    type: 'category',
    data: sortedEnvelopes.value.map((e) => `${e.icon} ${e.name}`),
    inverse: true,
    axisLabel: { width: 100, overflow: 'truncate' },
  },
  series: [
    {
      name: 'Budget',
      type: 'bar',
      data: sortedEnvelopes.value.map((e) => e.budget_amount),
      itemStyle: { color: 'rgba(148,163,184,0.3)', borderRadius: [0, 4, 4, 0] },
      barGap: '-100%',
      barWidth: '60%',
      animationDuration: settings.value.reduceMotion ? 0 : 600,
    },
    {
      name: 'Spent',
      type: 'bar',
      data: sortedEnvelopes.value.map((e) => e.spent),
      itemStyle: {
        color: (p: { dataIndex: number }) => {
          const env = sortedEnvelopes.value[p.dataIndex]
          if (!env) return '#22c55e'
          if (env.is_overspent) return '#f43f5e'
          if (env.percent_used >= 70) return '#f59e0b'
          return '#22c55e'
        },
        borderRadius: [0, 4, 4, 0],
      },
      barWidth: '60%',
      animationDuration: settings.value.reduceMotion ? 0 : 600,
    },
  ],
}))

// ── Chart 4: Income vs Expenses (Stacked Bar) ───────────────────────────
const incomeVsExpenseOptions = computed(() => ({
  ...chartTheme.value,
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 50, right: 16, top: 16, bottom: 32 },
  xAxis: { type: 'category', data: monthLabels.value },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: (v: number) => formatCompact(v, homeCurrency.value) },
    splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
  },
  series: [
    {
      name: 'Income',
      type: 'bar',
      stack: 'total',
      data: monthlyTotals.value.map((m) => m.income),
      itemStyle: { color: '#22c55e', borderRadius: [4, 4, 0, 0] },
      animationDuration: settings.value.reduceMotion ? 0 : 600,
    },
    {
      name: 'Expenses',
      type: 'bar',
      stack: 'total',
      data: monthlyTotals.value.map((m) => -m.expenses),
      itemStyle: { color: '#f43f5e', borderRadius: [0, 0, 4, 4] },
      animationDuration: settings.value.reduceMotion ? 0 : 600,
    },
  ],
}))

// ── Chart 5: Net Savings (Area) ─────────────────────────────────────────
const netSavingsData = computed(() => monthlyTotals.value.map((m) => m.income - m.expenses))
const avgSavings = computed(() => {
  if (!netSavingsData.value.length) return 0
  return netSavingsData.value.reduce((s, v) => s + v, 0) / netSavingsData.value.length
})

const savingsOptions = computed(() => ({
  ...chartTheme.value,
  tooltip: { trigger: 'axis' },
  grid: { left: 50, right: 16, top: 16, bottom: 32 },
  xAxis: { type: 'category', data: monthLabels.value, boundaryGap: false },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: (v: number) => formatCompact(v, homeCurrency.value) },
    splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
  },
  series: [
    {
      name: 'Net Savings',
      type: 'line',
      data: netSavingsData.value,
      smooth: true,
      lineStyle: { color: '#f59e0b', width: 2 },
      itemStyle: {
        color: (p: { value: number }) => (p.value >= 0 ? '#f59e0b' : '#f43f5e'),
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(245,158,11,0.2)' },
            { offset: 1, color: 'rgba(245,158,11,0)' },
          ],
        },
      },
      markLine: {
        silent: true,
        data: [{ yAxis: avgSavings.value, name: 'Average' }],
        lineStyle: { color: '#94a3b8', type: 'dashed' },
        label: {
          formatter: `Avg: ${formatCompact(avgSavings.value, homeCurrency.value)}`,
          color: '#94a3b8',
          fontSize: 10,
        },
      },
      animationDuration: settings.value.reduceMotion ? 0 : 800,
    },
  ],
}))

// ── Chart drill-down ─────────────────────────────────────────────────────
// biome-ignore lint/suspicious/noExplicitAny: ECharts event params have dynamic shape
function onDonutClick(params: any) {
  const categoryId = params?.data?.categoryId
  if (categoryId && categoryId !== 'other') {
    router.push(`/transactions?category=${categoryId}&period=${period.value}`)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: ECharts event params have dynamic shape
function onPersonDonutClick(params: any) {
  const userId = params?.data?.userId
  if (userId) {
    router.push(`/transactions?user=${userId}&period=${period.value}`)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: ECharts event params have dynamic shape
function onTrendClick(params: any) {
  if (params?.dataIndex != null && monthlyTotals.value[params.dataIndex]) {
    period.value = monthlyTotals.value[params.dataIndex]!.period
  }
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">
    <!-- ── Period navigator ────────────────────────────────────────────────── -->
    <PeriodNavigator
      :period="period"
      :is-current-period="isCurrentPeriod"
      @prev="prevPeriod"
      @next="nextPeriod"
    />

    <HelpTip id="reports-overview">
      <template #label>About these reports</template>
      <dl class="space-y-1">
        <div>
          <dt class="inline font-medium text-(--ui-text)">Spent</dt>
          <dd class="inline"> — counts only expenses, not transfers between your accounts.</dd>
        </div>
        <div>
          <dt class="inline font-medium text-(--ui-text)">Saved</dt>
          <dd class="inline"> — income minus expenses for the month.</dd>
        </div>
      </dl>
      <p>Tap any chart segment to drill into the transactions behind it. Use the arrows above to view different months.</p>
    </HelpTip>

    <!-- ── Summary cards ───────────────────────────────────────────────────── -->
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Total expenses">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Spent</p>
        <p class="text-xl font-bold font-mono text-rose-400 amount-display">{{ formatAmount(totalExpenses, homeCurrency) }}</p>
      </div>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Total income">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Income</p>
        <p class="text-xl font-bold font-mono text-green-400 amount-display">{{ formatAmount(totalIncome, homeCurrency) }}</p>
      </div>
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center" aria-label="Net savings">
        <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Saved</p>
        <p
          class="text-xl font-bold font-mono amount-display"
          :class="netSavings >= 0 ? 'text-primary-400' : 'text-rose-400'"
        >
          {{ formatAmount(Math.abs(netSavings), homeCurrency) }}
        </p>
      </div>
    </div>

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

    <!-- ── Chart 1: Category Donut ──────────────────────────────────────── -->
    <figure
      v-if="viewMode === 'categories'"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      :aria-label="`Donut chart showing spending by category. Largest: ${byCategory[0]?.name ?? 'none'} at ${totalExpenses > 0 && byCategory[0] ? Math.round((byCategory[0].total / totalExpenses) * 100) : 0}%`"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Spending by Category
      </figcaption>
      <div v-if="!chartsReady || loading" class="h-[200px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <div v-else-if="totalExpenses === 0" class="h-[200px] flex items-center justify-center text-(--ui-text-muted)">
        No expenses this period
      </div>
      <VChart
        v-else
        :option="categoryDonutOptions"
        :style="{ height: '200px' }"
        autoresize
        @click="onDonutClick"
      />
    </figure>

    <!-- ── Chart 6: Person Donut ───────────────────────────────────────── -->
    <figure
      v-if="viewMode === 'people'"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Donut chart showing spending by person"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Spending by Person
      </figcaption>
      <div v-if="!chartsReady || loading" class="h-[200px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <div v-else-if="totalExpenses === 0" class="h-[200px] flex items-center justify-center text-(--ui-text-muted)">
        No expenses this period
      </div>
      <VChart
        v-else
        :option="personDonutOptions"
        :style="{ height: '200px' }"
        autoresize
        @click="onPersonDonutClick"
      />
    </figure>

    <!-- ── Category / Person list (accessible text representation) ──────── -->
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
              <span class="font-mono text-sm font-semibold text-(--ui-text) shrink-0 ml-2">{{ formatAmount(cat.total, homeCurrency) }}</span>
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
            <p class="font-mono font-bold text-(--ui-text) text-lg amount-display">{{ formatAmount(person.total, homeCurrency) }}</p>
          </div>
          <div
            class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
            role="progressbar"
            :aria-valuenow="totalExpenses > 0 ? Math.round((person.total / totalExpenses) * 100) : 0"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${person.name} spent ${formatAmount(person.total, homeCurrency)}`"
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

    <!-- ── Chart 2: Monthly Spending Trend ────────────────────────────── -->
    <figure
      v-if="monthlyTotals.length > 1"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Line chart showing monthly spending and income trends"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Monthly Trend
      </figcaption>
      <div v-if="!chartsReady" class="h-[250px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <VChart
        v-else
        :option="trendOptions"
        :style="{ height: '250px' }"
        autoresize
        @click="onTrendClick"
      />
    </figure>

    <!-- ── Chart 3: Budget vs Actual ──────────────────────────────────── -->
    <figure
      v-if="envelopes.length"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Horizontal bar chart comparing budget vs actual spending per envelope"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Budget vs Actual
      </figcaption>
      <div v-if="!chartsReady" class="h-[250px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <VChart
        v-else
        :option="budgetOptions"
        :style="{ height: `${Math.max(180, envelopes.length * 50)}px` }"
        autoresize
      />
    </figure>

    <!-- ── Chart 4: Income vs Expenses ────────────────────────────────── -->
    <figure
      v-if="monthlyTotals.length > 1"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Bar chart comparing income vs expenses per month"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Income vs Expenses
      </figcaption>
      <div v-if="!chartsReady" class="h-[250px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <VChart
        v-else
        :option="incomeVsExpenseOptions"
        :style="{ height: '250px' }"
        autoresize
        @click="onTrendClick"
      />
    </figure>

    <!-- ── Chart 5: Net Savings ───────────────────────────────────────── -->
    <figure
      v-if="monthlyTotals.length > 1"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5"
      aria-label="Area chart showing net savings over time"
    >
      <figcaption class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-4">
        Net Savings
      </figcaption>
      <div v-if="!chartsReady" class="h-[250px] rounded-xl bg-(--ui-bg-elevated) animate-pulse" />
      <VChart
        v-else
        :option="savingsOptions"
        :style="{ height: '250px' }"
        autoresize
        @click="onTrendClick"
      />
    </figure>
  </div>
</template>
