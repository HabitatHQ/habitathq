<script setup lang="ts">
/**
 * CheckinInsights — the "Check-ins" tab of the Insights page. Soft, wellbeing-
 * styled trends grouped by check-in: SCALE avg + area trend, BOOLEAN % desired
 * ring, TEXT reflection counts, plus reflection consistency + a gentle streak.
 */

import type { CheckinHistoryRow, CheckinTemplate } from '~/types/database'
import {
  computeCheckinInsights,
  type QuestionInsight,
  type TemplateInsight,
  type TextInsight,
} from '~/utils/checkin-insights'

const db = useDatabase()

const PERIODS = [7, 30, 90] as const
const windowDays = ref(30)
const today = new Date().toISOString().slice(0, 10)

const templates = ref<CheckinTemplate[]>([])
const rows = ref<CheckinHistoryRow[]>([])
const loading = ref(true)

async function load() {
  const from = (() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 179) // covers up to 2× the 90-day window
    return d.toISOString().slice(0, 10)
  })()
  const [tpls, hist] = await Promise.all([
    db.getCheckinTemplates(),
    db.getCheckinHistory(from, today),
  ])
  templates.value = tpls
  rows.value = hist
  loading.value = false
}
onMounted(load)

const insights = computed(() =>
  computeCheckinInsights({
    rows: rows.value,
    templates: templates.value,
    today,
    windowDays: windowDays.value,
  }),
)

// ─── Aggregate activity (heatmap + monthly), independent of the period above ──
const totalTemplates = computed(() => templates.value.length)
const hasData = computed(() => rows.value.length > 0)

// date → distinct templates reflected that day (mirrors habit "done count")
const checkinCounts = computed(() => {
  const byDate = new Map<string, Set<string>>()
  for (const r of rows.value) {
    let s = byDate.get(r.logged_date)
    if (!s) {
      s = new Set()
      byDate.set(r.logged_date, s)
    }
    s.add(r.template_id)
  }
  const out = new Map<string, number>()
  for (const [date, set] of byDate) out.set(date, set.size)
  return out
})

const monthlyData = computed(() => {
  const now = new Date()
  const total = totalTemplates.value
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const days = i === 5 ? now.getDate() : daysInMonth
    let done = 0
    for (let day = 1; day <= days; day++) {
      done += checkinCounts.value.get(`${prefix}-${String(day).padStart(2, '0')}`) ?? 0
    }
    const rate = total && days ? Math.min(100, Math.round((done / (total * days)) * 100)) : 0
    return { label: d.toLocaleDateString('en-US', { month: 'short' }), rate }
  })
})

function nonNull(series: { value: number | null }[]): number[] {
  return series.map((s) => s.value).filter((v): v is number => v != null)
}
// SCALE + BOOLEAN render inline; TEXT is grouped into a "Written reflections" block.
function metricQuestions(t: TemplateInsight): Exclude<QuestionInsight, TextInsight>[] {
  return t.questions.filter((q): q is Exclude<QuestionInsight, TextInsight> => q.kind !== 'text')
}
function textQuestions(t: TemplateInsight): TextInsight[] {
  return t.questions.filter((q): q is TextInsight => q.kind === 'text')
}
function magnitude(avg: number | null): string {
  if (avg == null) return ''
  if (avg <= 3) return 'Low'
  if (avg <= 6) return 'Moderate'
  if (avg <= 8) return 'High'
  return 'Very high'
}
function arrow(delta: number): string {
  if (delta > 0) return '▲'
  if (delta < 0) return '▼'
  return ''
}
</script>

<template>
  <div class="space-y-4">
    <!-- Period selector -->
    <div class="flex gap-2">
      <button
        v-for="p in PERIODS"
        :key="p"
        type="button"
        class="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
        :class="windowDays === p
          ? 'bg-(--ui-bg-elevated) border-(--ui-border-accented) text-(--ui-text)'
          : 'bg-(--ui-bg-muted) border-(--ui-border) text-(--ui-text-dimmed)'"
        @click="windowDays = p"
      >
        {{ p }}d
      </button>
    </div>

    <div v-if="loading" class="py-10 text-center text-sm text-(--ui-text-dimmed)">Loading…</div>

    <div
      v-else-if="insights.length === 0 && !hasData"
      class="py-12 text-center text-sm text-(--ui-text-dimmed) space-y-1"
    >
      <p>No check-in trends yet.</p>
      <p class="text-xs">Reflect a few days and your insights will grow here.</p>
    </div>

    <!-- One card per check-in template -->
    <UCard
      v-for="t in insights"
      :key="t.templateId"
      :ui="{ root: 'rounded-3xl', body: 'p-5 sm:p-5' }"
    >
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-base font-bold text-(--ui-text)">{{ t.title }}</h3>
        <p class="text-xs text-(--ui-text-dimmed)">
          reflected <b class="text-teal-300 font-semibold">{{ t.consistencyDays }}/{{ t.windowDays }}</b> days<span
            v-if="t.streak > 0"
          >
            · {{ t.streak }}-day streak</span
          >
        </p>
      </div>

      <template v-for="q in metricQuestions(t)" :key="q.questionId">
        <!-- SCALE: big avg + word + soft area trend -->
        <div v-if="q.kind === 'scale'" class="pt-3 first:pt-2">
          <div class="flex items-baseline gap-3">
            <p class="text-sm text-(--ui-text-toned) flex-1 min-w-0">{{ q.prompt }}</p>
            <div class="text-right">
              <p class="text-2xl font-extrabold text-(--ui-text) tabular-nums leading-none">
                {{ q.avg ?? '—' }}
                <span class="text-xs font-normal text-(--ui-text-dimmed)">{{ arrow(q.delta) }}</span>
              </p>
              <p class="text-xs text-teal-300/90 font-medium">{{ magnitude(q.avg) }}</p>
            </div>
          </div>
          <InsightArea :values="nonNull(q.series)" class="mt-1.5" />
        </div>

        <!-- BOOLEAN: ring + % desired -->
        <div v-else-if="q.kind === 'boolean'" class="flex items-center gap-4 pt-3">
          <InsightRing :pct="q.pctDesired ?? 0" :center="`${q.pctDesired ?? 0}%`" />
          <div class="flex-1 min-w-0">
            <p class="text-sm text-(--ui-text-toned)">{{ q.prompt }}</p>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
              {{ q.pctDesired ?? 0 }}% of days
              <span class="text-(--ui-text-muted)">{{ arrow(q.delta) }}</span>
            </p>
          </div>
        </div>
      </template>

      <!-- TEXT: grouped under one subsection -->
      <div v-if="textQuestions(t).length" class="pt-4 mt-3 border-t border-(--ui-border)">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-2">
          Written reflections
        </p>
        <div class="space-y-2">
          <div
            v-for="q in textQuestions(t)"
            :key="q.questionId"
            class="flex items-center gap-4"
          >
            <p class="text-sm text-(--ui-text-toned) flex-1 min-w-0">{{ q.prompt }}</p>
            <div class="text-right shrink-0">
              <span class="text-lg font-bold text-(--ui-text) tabular-nums leading-none">{{ q.count }}</span>
              <span class="text-xs text-(--ui-text-dimmed) ml-1">written</span>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- ── Daily reflection grid ──────────────────────────────────────────────── -->
    <UCard v-if="!loading && hasData" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-(--ui-text-muted)">Daily Completion</p>
      <CompletionHeatmap
        :counts="checkinCounts"
        :total="totalTemplates"
        :today="today"
        unit="check-ins"
      />
    </UCard>

    <!-- ── Monthly reflection rate ────────────────────────────────────────────── -->
    <UCard v-if="!loading && hasData" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-(--ui-text-muted)">Monthly Completion Rate</p>
      <MonthlyCompletionBars :data="monthlyData" />
    </UCard>
  </div>
</template>
