<script setup lang="ts">
import type { RecurringPatternRow, RecurringStatus } from '~/types/database'

const db = useDatabase()
const router = useRouter()
const toast = useToast()

const patterns = ref<RecurringPatternRow[]>([])
const loading = ref(true)
const detecting = ref(false)
const showDismissed = ref(false)

async function load() {
  loading.value = true
  try {
    patterns.value = await db.getRecurringPatterns(undefined, showDismissed.value)
  } finally {
    loading.value = false
  }
}

async function runDetection() {
  detecting.value = true
  try {
    const detected = await db.detectRecurring()
    if (detected.length) {
      toast.add({
        title: `Found ${detected.length} recurring pattern(s)`,
        color: 'success' as const,
      })
    } else {
      toast.add({ title: 'No new patterns detected', color: 'neutral' as const })
    }
    await load()
  } finally {
    detecting.value = false
  }
}

async function updateStatus(id: string, status: RecurringStatus) {
  await db.updateRecurringPattern(id, status)
  await load()
}

async function confirmAll() {
  const result = await db.confirmAllRecurring(0.8)
  toast.add({ title: `Confirmed ${result.updated} pattern(s)`, color: 'success' as const })
  await load()
}

onMounted(async () => {
  await load()
  // Auto-detect on first visit if no patterns exist
  if (!patterns.value.length) {
    await runDetection()
  }
})

watch(showDismissed, load)

// ── Computed views ────────────────────────────────────────────────────────
const detectedPatterns = computed(() => patterns.value.filter((p) => p.status === 'detected'))

const confirmedPatterns = computed(() => patterns.value.filter((p) => p.status === 'confirmed'))

const dismissedPatterns = computed(() => patterns.value.filter((p) => p.status === 'dismissed'))

// Upcoming: confirmed patterns with next_expected within 7 days
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

const upcomingThisWeek = computed(() =>
  confirmedPatterns.value.filter((p) => {
    const next = p.next_expected
    const diff = (new Date(next).getTime() - new Date(todayStr).getTime()) / 86400000
    return diff >= 0 && diff <= 7
  }),
)

const upcomingThisMonth = computed(() =>
  confirmedPatterns.value.filter((p) => {
    const next = p.next_expected
    const diff = (new Date(next).getTime() - new Date(todayStr).getTime()) / 86400000
    return diff > 7 && diff <= 31
  }),
)

const monthlyProjection = computed(() =>
  confirmedPatterns.value.reduce((sum, p) => {
    if (p.interval === 'weekly') return sum + p.average_amount * 4.33
    if (p.interval === 'biweekly') return sum + p.average_amount * 2.17
    if (p.interval === 'monthly') return sum + p.average_amount
    if (p.interval === 'quarterly') return sum + p.average_amount / 3
    if (p.interval === 'annual') return sum + p.average_amount / 12
    return sum
  }, 0),
)

function confidenceDots(confidence: number): number {
  return Math.max(1, Math.min(5, Math.ceil(confidence * 5)))
}

function intervalLabel(interval: string): string {
  const labels: Record<string, string> = {
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annual: 'Annual',
  }
  return labels[interval] ?? interval
}
</script>

<template>
  <div class="p-4 space-y-5 max-w-2xl mx-auto">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between">
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
        aria-label="Back"
        @click="router.back()"
      >
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
      </button>
      <h1 class="text-sm font-semibold text-(--ui-text)">Recurring</h1>
      <button
        class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-primary-400 hover:bg-primary-500/10 transition-colors"
        :disabled="detecting"
        aria-label="Run detection"
        @click="runDetection"
      >
        <UIcon
          name="i-heroicons-arrow-path"
          class="w-5 h-5"
          :class="detecting ? 'animate-spin' : ''"
        />
      </button>
    </div>

    <HelpTip id="recurring-patterns">
      <template #label>How do recurring patterns work?</template>
      <p><strong class="text-(--ui-text)">Detected</strong> — Hearth noticed a repeating transaction (e.g. same merchant, similar amount). Review it to confirm or dismiss.</p>
      <p><strong class="text-(--ui-text)">Confirmed</strong> — You verified this is recurring. It will appear in your upcoming view and monthly projection.</p>
      <p><strong class="text-(--ui-text)">Dismissed</strong> — You decided this is not recurring. It won't show up unless you choose to see dismissed patterns.</p>
    </HelpTip>

    <!-- ── Batch review (detected patterns) ────────────────────────────────── -->
    <section v-if="detectedPatterns.length" aria-label="Review detected patterns">
      <div class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-(--ui-text)">Review Detected Patterns</h2>
            <p class="text-xs text-(--ui-text-muted)">We found {{ detectedPatterns.length }} recurring transaction(s)</p>
          </div>
          <button
            v-if="detectedPatterns.some((p) => p.confidence >= 0.8)"
            class="text-xs px-3 min-h-[44px] rounded-lg font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
            @click="confirmAll"
          >
            Confirm All
          </button>
        </div>

        <div
          v-for="p in detectedPatterns"
          :key="p.id"
          class="rounded-xl bg-(--ui-bg) border border-(--ui-border) p-3 space-y-2"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-(--ui-text)">{{ p.merchant }}</p>
              <p class="text-xs text-(--ui-text-muted)">{{ intervalLabel(p.interval) }}</p>
            </div>
            <p class="font-mono text-sm font-semibold text-(--ui-text)">~{{ formatAmount(p.average_amount) }}</p>
          </div>

          <div class="flex items-center justify-between text-xs text-(--ui-text-muted)">
            <span>Next: {{ formatDateRelative(p.next_expected) }}</span>
            <span class="flex items-center gap-0.5">
              Confidence:
              <span v-for="n in 5" :key="n" class="inline-block w-1.5 h-1.5 rounded-full" :class="n <= confidenceDots(p.confidence) ? 'bg-primary-400' : 'bg-(--ui-bg-elevated)'" />
            </span>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="flex-1 min-h-[44px] rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 transition-colors"
              @click="updateStatus(p.id, 'confirmed')"
            >
              Confirm
            </button>
            <button
              class="flex-1 min-h-[44px] rounded-lg text-xs font-medium text-(--ui-text-muted) bg-(--ui-bg-muted) hover:bg-(--ui-bg-elevated) transition-colors"
              @click="updateStatus(p.id, 'dismissed')"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Upcoming this week ──────────────────────────────────────────────── -->
    <section v-if="upcomingThisWeek.length" aria-label="Upcoming this week">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-2">Upcoming This Week</h2>
      <ul class="space-y-2">
        <li
          v-for="p in upcomingThisWeek"
          :key="p.id"
          class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 min-h-[56px]"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text) truncate">{{ p.merchant }}</p>
            <p class="text-xs text-(--ui-text-muted)">{{ formatDateRelative(p.next_expected) }}</p>
          </div>
          <p class="font-mono text-sm font-semibold text-(--ui-text) shrink-0">{{ formatAmount(p.average_amount) }}</p>
        </li>
      </ul>
    </section>

    <!-- ── Upcoming this month ─────────────────────────────────────────────── -->
    <section v-if="upcomingThisMonth.length" aria-label="Upcoming this month">
      <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-2">Later This Month</h2>
      <ul class="space-y-2">
        <li
          v-for="p in upcomingThisMonth"
          :key="p.id"
          class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 min-h-[56px]"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text) truncate">{{ p.merchant }}</p>
            <p class="text-xs text-(--ui-text-muted)">{{ formatDateRelative(p.next_expected) }}</p>
          </div>
          <p class="font-mono text-sm font-semibold text-(--ui-text) shrink-0">{{ formatAmount(p.average_amount) }}</p>
        </li>
      </ul>
    </section>

    <!-- ── All recurring (management) ──────────────────────────────────────── -->
    <section aria-label="All recurring patterns">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium">All Recurring</h2>
        <button
          class="text-xs text-(--ui-text-muted) hover:text-(--ui-text) min-h-[44px] px-2"
          @click="showDismissed = !showDismissed"
        >
          {{ showDismissed ? 'Hide dismissed' : 'Show dismissed' }}
        </button>
      </div>

      <div v-if="loading" class="space-y-2">
        <div v-for="n in 4" :key="n" class="h-14 bg-(--ui-bg-muted) rounded-xl animate-pulse" />
      </div>

      <div v-else-if="!confirmedPatterns.length && !dismissedPatterns.length" class="text-center py-12">
        <UIcon name="i-heroicons-arrow-path" class="w-12 h-12 text-(--ui-text-dimmed) mb-4 mx-auto" />
        <p class="text-(--ui-text-muted) font-medium">No recurring patterns yet</p>
        <p class="text-sm text-(--ui-text-dimmed) mt-1">Patterns are detected from your transaction history</p>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="p in [...confirmedPatterns, ...(showDismissed ? dismissedPatterns : [])]"
          :key="p.id"
          class="flex items-center gap-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) p-3 min-h-[56px]"
          :class="p.status === 'dismissed' ? 'opacity-50' : ''"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="text-sm font-medium text-(--ui-text) truncate">{{ p.merchant }}</p>
              <span v-if="p.status === 'dismissed'" class="text-[10px] uppercase text-(--ui-text-dimmed) bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">dismissed</span>
            </div>
            <p class="text-xs text-(--ui-text-muted)">
              {{ intervalLabel(p.interval) }} · Next: {{ formatDateRelative(p.next_expected) }}
            </p>
          </div>
          <p class="font-mono text-sm font-semibold text-(--ui-text) shrink-0">{{ formatAmount(p.average_amount) }}</p>
          <button
            v-if="p.status === 'confirmed'"
            class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-dimmed) hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            aria-label="Delete pattern"
            @click="updateStatus(p.id, 'dismissed')"
          >
            <UIcon name="i-heroicons-trash" class="w-4 h-4" />
          </button>
          <button
            v-if="p.status === 'dismissed'"
            class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-dimmed) hover:text-green-400 hover:bg-green-500/10 transition-colors"
            aria-label="Restore pattern"
            @click="updateStatus(p.id, 'confirmed')"
          >
            <UIcon name="i-heroicons-arrow-uturn-left" class="w-4 h-4" />
          </button>
        </li>
      </ul>
    </section>

    <!-- ── Monthly projection ──────────────────────────────────────────────── -->
    <div
      v-if="confirmedPatterns.length"
      class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) p-4 text-center"
    >
      <p class="text-xs uppercase tracking-widest text-(--ui-text-muted) font-medium mb-1">Monthly Recurring Total</p>
      <p class="text-2xl font-bold font-mono text-primary-400 amount-display">{{ formatAmount(monthlyProjection) }}</p>
    </div>
  </div>
</template>
