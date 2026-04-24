<script setup lang="ts">
import type { DashboardSummary } from '~/types/database'
import { currentPeriod, formatDateRelative, offsetPeriod, splitCurrencyParts } from '~/utils/format'

const db = useDatabase()

const period = ref(currentPeriod())
const summary = ref<DashboardSummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    summary.value = await db.getDashboardSummary(period.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load dashboard'
  } finally {
    loading.value = false
  }
}

watch(period, load)
onMounted(load)

function prevPeriod() {
  period.value = offsetPeriod(period.value, -1)
}
function nextPeriod() {
  period.value = offsetPeriod(period.value, 1)
}

const isCurrentPeriod = computed(() => period.value === currentPeriod())

const budgetBarPercent = computed(() => {
  if (!summary.value || summary.value.budget_total === 0) return 0
  return Math.min((summary.value.spent_this_month / summary.value.budget_total) * 100, 100)
})

// Split large amounts into whole + decimal for typographic treatment
const spentParts = computed(() => splitCurrencyParts(summary.value?.spent_this_month ?? 0))
const remainingParts = computed(() => splitCurrencyParts(summary.value?.budget_remaining ?? 0))

// Group transactions by date label
const groupedTransactions = computed(() => {
  if (!summary.value?.recent_transactions) return []
  const groups = new Map<string, typeof summary.value.recent_transactions>()
  for (const tx of summary.value.recent_transactions) {
    const label = formatDateRelative(tx.date)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)?.push(tx)
  }
  return Array.from(groups.entries())
})

const router = useRouter()
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">

    <!-- ── Period navigator ────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between">
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
        aria-label="Previous month"
        @click="prevPeriod"
      >
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </button>
      <h1 class="text-base font-semibold text-(--ui-text-muted) tracking-wide uppercase text-xs">
        {{ formatPeriod(period) }}
      </h1>
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors"
        :class="isCurrentPeriod
          ? 'text-(--ui-text-dimmed) cursor-default'
          : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
        :disabled="isCurrentPeriod"
        aria-label="Next month"
        @click="nextPeriod"
      >
        <UIcon name="i-heroicons-chevron-right" class="w-5 h-5" />
      </button>
    </div>

    <!-- ── Hero: Spending summary ──────────────────────────────────────────── -->
    <section
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-5 space-y-4"
      aria-label="Monthly spending summary"
    >
      <div v-if="loading" class="space-y-3 animate-pulse">
        <div class="h-10 bg-(--ui-bg-elevated) rounded-lg w-40" />
        <div class="h-3 bg-(--ui-bg-elevated) rounded-full w-full" />
        <div class="h-4 bg-(--ui-bg-elevated) rounded w-48" />
      </div>
      <template v-else-if="summary">
        <!-- Spent amount — typographic split: dollars big, cents small -->
        <div class="space-y-0.5">
          <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Spent this month</p>
          <div class="flex items-end gap-0.5 amount-display" aria-label="Amount spent: {{ formatAmount(summary.spent_this_month) }}">
            <span class="text-4xl font-bold font-mono text-(--ui-text) leading-none">
              {{ spentParts.whole }}
            </span>
            <span class="text-xl font-bold font-mono text-(--ui-text-muted) leading-none mb-0.5">
              {{ spentParts.decimal }}
            </span>
          </div>
        </div>

        <!-- Budget progress bar -->
        <div class="space-y-2">
          <div
            class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
            role="progressbar"
            :aria-valuenow="Math.round(budgetBarPercent)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${Math.round(budgetBarPercent)}% of monthly budget used`"
          >
            <div
              class="h-full rounded-full envelope-bar transition-all"
              :class="budgetBarPercent >= 100 ? 'bg-rose-500' : budgetBarPercent >= 70 ? 'bg-amber-500' : 'bg-primary-500'"
              :style="{ width: `${Math.min(budgetBarPercent, 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-(--ui-text-muted)">
              <span class="font-mono font-medium text-(--ui-text)">{{ formatAmount(summary.budget_remaining) }}</span>
              remaining of {{ formatAmount(summary.budget_total) }}
            </span>
            <span
              class="font-mono text-xs font-medium"
              :class="summary.budget_remaining < 0 ? 'text-rose-400' : 'text-(--ui-text-muted)'"
            >
              {{ Math.round(budgetBarPercent) }}%
            </span>
          </div>
        </div>

        <!-- Income chip -->
        <div class="flex items-center gap-1.5 text-sm">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs font-medium">
            <UIcon name="i-heroicons-arrow-down-tray" class="w-3 h-3" />
            {{ formatAmount(summary.income_this_month) }} income
          </span>
        </div>
      </template>
    </section>

    <!-- ── IOU / Household widget (→ /household) ──────────────────────────── -->
    <NuxtLink
      v-if="summary?.iou_balances?.length"
      to="/household"
      class="block rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 hover:bg-(--ui-bg-elevated) transition-colors"
      aria-label="Household balances — view details"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Household</span>
        <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" />
      </div>
      <div class="space-y-1.5">
        <div
          v-for="bal in summary.iou_balances"
          :key="`${bal.from_user_id}-${bal.to_user_id}`"
          class="flex items-center gap-2 text-sm"
        >
          <span class="text-base">{{ bal.net_amount > 0 ? bal.to_user_avatar : bal.from_user_avatar }}</span>
          <span class="text-(--ui-text-muted)">
            <span class="font-medium text-(--ui-text)">{{ bal.net_amount > 0 ? bal.to_user_name : bal.from_user_name }}</span>
            owes
            <span class="font-medium text-(--ui-text)">{{ bal.net_amount > 0 ? bal.from_user_name : bal.to_user_name }}</span>
          </span>
          <span class="ml-auto font-mono font-medium text-amber-400">{{ formatAmount(Math.abs(bal.net_amount)) }}</span>
        </div>
      </div>
    </NuxtLink>

    <!-- ── Envelopes + Recent Transactions ─────────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

      <!-- Envelopes -->
      <section aria-label="Budget envelopes">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Envelopes</h2>
          <NuxtLink to="/envelopes" class="text-xs text-primary-400 hover:text-primary-300 transition-colors min-h-[44px] flex items-center px-1">
            See all
          </NuxtLink>
        </div>
        <div class="space-y-3">
          <div
            v-if="loading"
            v-for="n in 4"
            :key="n"
            class="h-12 bg-(--ui-bg-muted) rounded-xl animate-pulse"
          />
          <ul v-else-if="summary">
            <li
              v-for="env in summary.envelopes.slice(0, 5)"
              :key="env.id"
              class="space-y-1.5"
            >
              <div class="flex items-center justify-between text-sm">
                <span class="flex items-center gap-1.5">
                  <span class="text-base leading-none" aria-hidden="true">{{ env.icon }}</span>
                  <span class="font-medium text-(--ui-text)">{{ env.name }}</span>
                  <span
                    v-if="env.is_overspent"
                    class="text-[10px] font-bold uppercase tracking-wide text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded"
                  >
                    Over
                  </span>
                </span>
                <span
                  class="font-mono text-xs"
                  :class="envelopeColorClass(env.percent_used, env.is_overspent).text"
                >
                  {{ formatAmount(env.spent) }} / {{ formatAmount(env.budget_amount) }}
                </span>
              </div>
              <div
                class="h-1.5 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
                role="progressbar"
                :aria-valuenow="Math.min(Math.round(env.percent_used), 100)"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="`${env.name}: ${Math.round(env.percent_used)}% used`"
              >
                <div
                  class="h-full rounded-full envelope-bar"
                  :class="envelopeColorClass(env.percent_used, env.is_overspent).bar"
                  :style="{ width: `${Math.min(env.percent_used, 100)}%`, animationDelay: `${summary.envelopes.indexOf(env) * 80}ms` }"
                />
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Recent Transactions -->
      <section aria-label="Recent transactions">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">Recent</h2>
          <NuxtLink to="/transactions" class="text-xs text-primary-400 hover:text-primary-300 transition-colors min-h-[44px] flex items-center px-1">
            See all
          </NuxtLink>
        </div>
        <div class="space-y-0.5">
          <div
            v-if="loading"
            v-for="n in 6"
            :key="n"
            class="h-10 bg-(--ui-bg-muted) rounded-lg animate-pulse mb-1"
          />
          <ol v-else-if="summary">
            <li v-for="[dateLabel, txns] in groupedTransactions" :key="dateLabel">
              <p class="text-[11px] uppercase tracking-wider text-(--ui-text-dimmed) font-medium pt-2 pb-1 first:pt-0">
                {{ dateLabel }}
              </p>
              <ul>
                <li v-for="tx in txns" :key="tx.id">
                  <NuxtLink
                    :to="`/transactions/${tx.id}`"
                    class="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-(--ui-bg-muted) transition-colors min-h-[44px]"
                    :class="transactionStripeClass(tx.type)"
                  >
                    <span class="text-sm" aria-hidden="true">{{ tx.category_icon ?? '💳' }}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-(--ui-text) truncate">{{ tx.merchant || tx.description || 'Transaction' }}</p>
                      <p class="text-xs text-(--ui-text-muted) truncate">{{ tx.category_name ?? 'Uncategorized' }}</p>
                    </div>
                    <span
                      class="text-sm shrink-0"
                      :class="transactionAmountClass(tx.type)"
                    >
                      {{ transactionAmountPrefix(tx.type) }}{{ formatAmount(tx.amount) }}
                    </span>
                  </NuxtLink>
                </li>
              </ul>
            </li>
          </ol>
        </div>
      </section>
    </div>

    <!-- ── Savings Goals ────────────────────────────────────────────────────── -->
    <section v-if="summary?.savings_goals?.length" aria-label="Savings goals">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-3">Savings Goals</h2>
      <ul class="space-y-3">
        <li
          v-for="goal in summary.savings_goals"
          :key="goal.id"
          class="rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-2"
        >
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-sm font-medium">
              <span class="text-lg" aria-hidden="true">{{ goal.icon }}</span>
              {{ goal.name }}
            </span>
            <span class="text-sm font-mono text-(--ui-text-muted)">
              {{ formatAmount(goal.current_amount) }} /
              <span class="text-(--ui-text)">{{ formatAmount(goal.target_amount) }}</span>
            </span>
          </div>
          <div
            class="h-2 rounded-full bg-(--ui-bg-elevated) overflow-hidden"
            role="progressbar"
            :aria-valuenow="Math.round((goal.current_amount / goal.target_amount) * 100)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${goal.name}: ${Math.round((goal.current_amount / goal.target_amount) * 100)}% funded`"
          >
            <div
              class="h-full rounded-full bg-primary-500 envelope-bar"
              :style="{ width: `${Math.min((goal.current_amount / goal.target_amount) * 100, 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-xs text-(--ui-text-muted)">
            <span>{{ Math.round((goal.current_amount / goal.target_amount) * 100) }}% funded</span>
            <span v-if="goal.target_date">
              Target: {{ new Date(goal.target_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Error state ─────────────────────────────────────────────────────── -->
    <UAlert
      v-if="error"
      :description="error"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
    />

    <!-- ── FAB: Add transaction ────────────────────────────────────────────── -->
    <div
      class="fixed bottom-0 right-0 z-20 p-5"
      :style="{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }"
    >
      <NuxtLink
        to="/transactions/add"
        class="flex items-center gap-2 bg-primary-500 hover:bg-primary-400 text-white font-semibold rounded-2xl px-5 py-3.5 shadow-lg shadow-primary-500/30 transition-all active:scale-95 min-h-[44px]"
        aria-label="Add transaction"
      >
        <UIcon name="i-heroicons-plus" class="w-5 h-5" />
        <span class="text-sm">Add</span>
      </NuxtLink>
    </div>

  </div>
</template>
