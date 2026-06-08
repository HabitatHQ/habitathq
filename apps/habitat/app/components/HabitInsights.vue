<script setup lang="ts">
/**
 * HabitInsights — the "Habits" tab of the Insights page. Self-loads habit
 * completions/logs and renders summary stats, the garden, a daily-completion
 * heatmap, monthly rate, and per-habit completion bars. Mirrors CheckinInsights.
 */
import { computeStreak, growthStage, type StreakInput } from '~/lib/streak-engine'
import type { Completion, HabitLog, HabitWithSchedule } from '~/types/database'

const db = useDatabase()

const habits = ref<HabitWithSchedule[]>([])
const completions = ref<Completion[]>([])
const habitLogs = ref<HabitLog[]>([])
const loading = ref(true)

const today = new Date().toISOString().slice(0, 10)

// Six months covers both the monthly chart and the heatmap
const sixMonthsAgo = (() => {
  const d = new Date()
  d.setMonth(d.getMonth() - 6)
  return d.toISOString().slice(0, 10)
})()

async function load() {
  const [h, c, l] = await Promise.all([
    db.getHabits(),
    db.getCompletionsForDateRange(sixMonthsAgo, today),
    db.getHabitLogsForDateRange(sixMonthsAgo, today),
  ])
  habits.value = h
  completions.value = c
  habitLogs.value = l
  loading.value = false
}

// ─── Lookup maps ──────────────────────────────────────────────────────────────

const completionsByDate = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const c of completions.value) {
    if (!map.has(c.date)) map.set(c.date, new Set())
    map.get(c.date)?.add(c.habit_id)
  }
  return map
})

// date → habit_id → total logged value that day
const logsByDate = computed(() => {
  const map = new Map<string, Map<string, number>>()
  for (const l of habitLogs.value) {
    let dm = map.get(l.date)
    if (!dm) {
      dm = new Map()
      map.set(l.date, dm)
    }
    dm.set(l.habit_id, (dm.get(l.habit_id) ?? 0) + l.value)
  }
  return map
})

function isHabitDone(habit: HabitWithSchedule, date: string): boolean {
  if (habit.type === 'BOOLEAN') return completionsByDate.value.get(date)?.has(habit.id) ?? false
  const dm = logsByDate.value.get(date)
  const hasLog = dm?.has(habit.id) ?? false
  const sum = dm?.get(habit.id) ?? 0
  if (habit.type === 'NUMERIC') return sum >= habit.target_value
  return hasLog && sum <= habit.target_value // LIMIT: logged and at or under
}

// ─── Precomputed date strings (descending: today → sixMonthsAgo) ─────────────

const allDateStrings = (() => {
  const dates: string[] = []
  const d = new Date(today)
  const start = new Date(sixMonthsAgo)
  while (d >= start) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() - 1)
  }
  return dates
})()

// date → total habits done that day; used by aggregate charts (heatmap, monthly, avg)
const doneCountByDate = computed(() => {
  const map = new Map<string, number>()
  for (const date of allDateStrings) {
    let count = 0
    for (const h of habits.value) {
      if (isHabitDone(h, date)) count++
    }
    if (count > 0) map.set(date, count)
  }
  return map
})

// ─── Summary stats ─────────────────────────────────────────────────────────────

const totalHabits = computed(() => habits.value.length)

function streakInputFor(h: HabitWithSchedule): StreakInput {
  const sched = h.schedule
  const schedule = {
    type: sched?.schedule_type ?? 'DAILY',
    daysOfWeek: sched?.days_of_week ?? null,
    frequencyCount: sched?.frequency_count ?? null,
    startDate: sched?.start_date ?? null,
  }
  if (h.type === 'BOOLEAN') {
    return {
      type: 'BOOLEAN',
      target: h.target_value,
      schedule,
      completions: new Set(completions.value.filter((c) => c.habit_id === h.id).map((c) => c.date)),
      today,
    }
  }
  const sums = new Map<string, number>()
  for (const l of habitLogs.value) {
    if (l.habit_id === h.id) sums.set(l.date, (sums.get(l.date) ?? 0) + l.value)
  }
  return { type: h.type, target: h.target_value, schedule, sums, today }
}

const streaks = computed(() => habits.value.map((h) => computeStreak(streakInputFor(h))))
const bestStreak = computed(() => Math.max(0, ...streaks.value.map((s) => s.longest)))
const recoveryTotal = computed(() => streaks.value.reduce((sum, s) => sum + s.thawed, 0))
const daisyTotal = computed(() => streaks.value.reduce((sum, s) => sum + s.daisies, 0))

// ─── Garden ─────────────────────────────────────────────────────────────────────

const gardenPlants = computed(() =>
  habits.value.map((h, i) => ({
    id: h.id,
    name: h.name,
    color: h.color,
    streak: streaks.value[i]?.current ?? 0,
    level: streaks.value[i]?.plantLevel ?? 0,
    status: streaks.value[i]?.status ?? ('active' as const),
  })),
)

const gardenMeta = computed(() => {
  const blooming = gardenPlants.value.filter((p) => growthStage(p.level) === 6).length
  const frozen = gardenPlants.value.filter((p) => p.status !== 'active').length
  const parts = [`${totalHabits.value} habit${totalHabits.value === 1 ? '' : 's'}`]
  if (blooming) parts.push(`${blooming} blooming`)
  if (frozen) parts.push(`${frozen} need nurturing`)
  return parts.join(' · ')
})

const avgCompletion = computed(() => {
  if (!habits.value.length) return 0
  let done = 0
  for (let i = 0; i < 30; i++) done += doneCountByDate.value.get(allDateStrings[i] ?? '') ?? 0
  return Math.round((done / (habits.value.length * 30)) * 100)
})

// ─── Monthly chart ────────────────────────────────────────────────────────────

function countDoneInMonth(prefix: string, days: number): number {
  let done = 0
  for (let day = 1; day <= days; day++) {
    done += doneCountByDate.value.get(`${prefix}-${String(day).padStart(2, '0')}`) ?? 0
  }
  return done
}

const monthlyData = computed(() => {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const days = i === 5 ? now.getDate() : daysInMonth
    const done = countDoneInMonth(prefix, days)
    const rate =
      habits.value.length && days
        ? Math.min(100, Math.round((done / (habits.value.length * days)) * 100))
        : 0
    return { label: d.toLocaleDateString('en-US', { month: 'short' }), rate }
  })
})

// ─── Per-habit bars ────────────────────────────────────────────────────────────

const completionDays = ref(30)

const habitRates = computed(() => {
  const days = completionDays.value
  const dates = allDateStrings.slice(0, days)
  return habits.value
    .map((h) => {
      let count = 0
      for (const date of dates) {
        if (isHabitDone(h, date)) count++
      }
      return { habit: h, rate: Math.round((count / days) * 100) }
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6)
})

onMounted(load)
</script>

<template>
  <div class="space-y-5">

    <!-- ── Summary cards ────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-3 gap-2">
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-(--ui-text-dimmed) uppercase tracking-wide">Habits</p>
        <p class="text-2xl font-bold text-(--ui-text)">{{ totalHabits }}</p>
        <p class="text-[10px] text-slate-600">active</p>
      </UCard>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-(--ui-text-dimmed) uppercase tracking-wide">Streak</p>
        <p class="text-2xl font-bold text-(--ui-text)">{{ bestStreak }}</p>
        <p class="text-[10px] text-slate-600">days best</p>
      </UCard>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-(--ui-text-dimmed) uppercase tracking-wide">Avg</p>
        <p class="text-2xl font-bold text-(--ui-text)">{{ avgCompletion }}%</p>
        <p class="text-[10px] text-slate-600">30 days</p>
      </UCard>
    </div>

    <!-- ── Recovery (never miss twice) ──────────────────────────────────────── -->
    <p v-if="recoveryTotal > 0" class="text-center text-xs text-emerald-400 font-medium">
      <AppIcon name="activity" class="w-3.5 h-3.5 inline-block -mt-0.5" />
      Thawed {{ recoveryTotal }}× — brought back to life
    </p>

    <!-- ── Garden ────────────────────────────────────────────────────────────── -->
    <UCard
      v-if="totalHabits > 0"
      :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-1' }"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold text-(--ui-text)">Your garden</p>
        <span v-if="daisyTotal > 0" class="text-xs font-medium text-(--ui-text-dimmed)">🌼 {{ daisyTotal }}</span>
      </div>
      <p class="text-xs text-(--ui-text-dimmed)">{{ gardenMeta }}</p>
      <HabitGarden :plants="gardenPlants" />
    </UCard>

    <!-- ── Heatmap ───────────────────────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-(--ui-text-muted)">Daily Completion</p>

      <div v-if="loading" class="py-4">
        <AppSkeleton variant="chart" height="120px" />
      </div>
      <div v-else-if="!totalHabits" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">No habits yet</p>
      </div>
      <CompletionHeatmap
        v-else
        :counts="doneCountByDate"
        :total="totalHabits"
        :today="today"
        unit="habits"
      />
    </UCard>

    <!-- ── Monthly completion rate ───────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-(--ui-text-muted)">Monthly Completion Rate</p>

      <div v-if="!totalHabits" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">No data yet</p>
      </div>
      <MonthlyCompletionBars v-else :data="monthlyData" />
    </UCard>

    <!-- ── Habit completion bars ─────────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold text-(--ui-text-muted)">Habit Completion</p>
        <div class="flex gap-0.5">
          <button
            v-for="d in [7, 14, 30, 90]"
            :key="d"
            class="px-2 py-0.5 min-h-[44px] rounded text-[10px] font-medium transition-colors"
            :class="completionDays === d ? 'bg-(--ui-bg-accented) text-(--ui-text)' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-muted)'"
            @click="completionDays = d"
          >{{ d }}d</button>
        </div>
      </div>

      <div v-if="!habitRates.length" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">No data yet</p>
      </div>
      <div v-else class="space-y-3">
        <div v-for="item in habitRates" :key="item.habit.id" class="flex items-center gap-2">
          <div
            class="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
            :style="{ backgroundColor: item.habit.color + '33' }"
          >
            <AppIcon :name="item.habit.icon" :color="item.habit.color" class="w-3 h-3" />
          </div>
          <p class="w-20 text-xs text-(--ui-text-muted) truncate flex-shrink-0">{{ item.habit.name }}</p>
          <div class="flex-1 h-1.5 bg-(--ui-bg-elevated) rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :style="{ width: `${item.rate}%`, backgroundColor: item.habit.color }"
            />
          </div>
          <span class="w-7 text-[11px] text-(--ui-text-dimmed) text-right flex-shrink-0">{{ item.rate }}%</span>
        </div>
      </div>
    </UCard>

  </div>
</template>
