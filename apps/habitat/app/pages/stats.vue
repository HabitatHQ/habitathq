<script setup lang="ts">
import type { HabitWithSchedule, HabitLog, Completion } from '~/types/database'

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
  if (!db.isAvailable) { loading.value = false; return }
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
    map.get(c.date)!.add(c.habit_id)
  }
  return map
})

// date → habit_id → total logged value that day
const logsByDate = computed(() => {
  const map = new Map<string, Map<string, number>>()
  for (const l of habitLogs.value) {
    if (!map.has(l.date)) map.set(l.date, new Map())
    const dm = map.get(l.date)!
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
  return hasLog && sum < habit.target_value // LIMIT: logged and stayed under
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

function habitCurrentStreak(h: HabitWithSchedule): number {
  let streak = 0
  for (const date of allDateStrings) {
    if (!isHabitDone(h, date)) break
    streak++
  }
  return streak
}

const bestStreak = computed(() =>
  Math.max(0, ...habits.value.map(habitCurrentStreak)),
)

const avgCompletion = computed(() => {
  if (!habits.value.length) return 0
  let done = 0
  for (let i = 0; i < 30; i++) done += doneCountByDate.value.get(allDateStrings[i]!) ?? 0
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
    const rate = habits.value.length && days
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
    .map(h => {
      let count = 0
      for (const date of dates) {
        if (isHabitDone(h, date)) count++
      }
      return { habit: h, rate: Math.round((count / days) * 100) }
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6)
})

// ─── Heatmap ──────────────────────────────────────────────────────────────────

const HEATMAP_WEEKS = 17

interface HeatmapDay {
  date: string
  doneCount: number
  total: number
  rate: number
  isToday: boolean
  isFuture: boolean
}

function buildHeatmapWeek(start: Date, weekOffset: number, total: number): HeatmapDay[] {
  const week: HeatmapDay[] = []
  for (let dow = 0; dow < 7; dow++) {
    const d = new Date(start)
    d.setDate(start.getDate() + weekOffset * 7 + dow)
    const date = d.toISOString().slice(0, 10)
    const isFuture = date > today
    const doneCount = (!isFuture && total > 0) ? (doneCountByDate.value.get(date) ?? 0) : 0
    week.push({
      date,
      doneCount,
      total,
      rate: total && !isFuture ? Math.round((doneCount / total) * 100) : 0,
      isToday: date === today,
      isFuture,
    })
  }
  return week
}

const heatmapWeeks = computed((): HeatmapDay[][] => {
  const total = habits.value.length
  // Align start to the Sunday HEATMAP_WEEKS weeks before today
  const start = new Date(today)
  start.setDate(start.getDate() - (HEATMAP_WEEKS * 7 - 1) - start.getDay())
  return Array.from({ length: HEATMAP_WEEKS }, (_, wi) => buildHeatmapWeek(start, wi, total))
})

function weekMonthLabel(week: HeatmapDay[]): string {
  const day1 = week.find(d => d.date.slice(8) === '01')
  return day1 ? new Date(`${day1.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }) : ''
}

// 5-level color scale: empty → dim cyan → bright cyan
const HEAT_COLORS = ['#1e293b', '#083344', '#0e4d6c', '#0e7490', '#22d3ee']

function heatColor(day: HeatmapDay): string {
  if (day.isFuture || day.total === 0 || day.rate === 0) return HEAT_COLORS[0]!
  if (day.rate <= 33) return HEAT_COLORS[1]!
  if (day.rate <= 66) return HEAT_COLORS[2]!
  if (day.rate < 100) return HEAT_COLORS[3]!
  return HEAT_COLORS[4]!
}

const selectedDay = ref<HeatmapDay | null>(null)

function selectDay(day: HeatmapDay) {
  selectedDay.value = selectedDay.value?.date === day.date ? null : day
}

// Only show Mo, We, Fr labels to avoid crowding
const DOW_LABELS = ['', 'Mo', '', 'We', '', 'Fr', '']

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-slate-500">Overview</p>
      <h2 class="text-2xl font-bold">Analytics</h2>
    </header>

    <!-- ── Summary cards ────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-3 gap-2">
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-slate-500 uppercase tracking-wide">Habits</p>
        <p class="text-2xl font-bold text-slate-100">{{ totalHabits }}</p>
        <p class="text-[10px] text-slate-600">active</p>
      </UCard>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-slate-500 uppercase tracking-wide">Streak</p>
        <p class="text-2xl font-bold text-slate-100">{{ bestStreak }}</p>
        <p class="text-[10px] text-slate-600">days best</p>
      </UCard>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-3 sm:p-3 space-y-1 text-center' }">
        <p class="text-[10px] text-slate-500 uppercase tracking-wide">Avg</p>
        <p class="text-2xl font-bold text-slate-100">{{ avgCompletion }}%</p>
        <p class="text-[10px] text-slate-600">30 days</p>
      </UCard>
    </div>

    <!-- ── Heatmap ───────────────────────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-slate-400">Daily Completion</p>

      <div v-if="loading" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">Loading…</p>
      </div>
      <div v-else-if="!totalHabits" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">No habits yet</p>
      </div>
      <div v-else class="overflow-x-auto -mx-1 px-1">
        <div class="inline-flex flex-col gap-1">

          <!-- Month labels row -->
          <div class="flex gap-0.5 ml-5">
            <div
              v-for="(week, wi) in heatmapWeeks"
              :key="wi"
              class="w-3.5 flex-shrink-0 h-3 text-[9px] text-slate-500 leading-none"
            >{{ weekMonthLabel(week) }}</div>
          </div>

          <!-- Day labels + week columns -->
          <div class="flex gap-1">
            <!-- Day-of-week labels -->
            <div class="flex flex-col gap-0.5 w-4 flex-shrink-0">
              <div
                v-for="(label, i) in DOW_LABELS"
                :key="i"
                class="h-3.5 text-[9px] text-slate-600 flex items-center justify-end"
              >{{ label }}</div>
            </div>

            <!-- Week columns -->
            <div class="flex gap-0.5">
              <div
                v-for="(week, wi) in heatmapWeeks"
                :key="wi"
                class="flex flex-col gap-0.5"
              >
                <button
                  v-for="day in week"
                  :key="day.date"
                  class="w-3.5 h-3.5 rounded-[3px] flex-shrink-0 transition-transform active:scale-110"
                  :class="selectedDay?.date === day.date ? 'ring-1 ring-white/60 ring-offset-[1.5px] ring-offset-slate-900' : day.isToday ? 'ring-1 ring-cyan-400/80 ring-offset-[1.5px] ring-offset-slate-900' : ''"
                  :style="{ backgroundColor: heatColor(day) }"
                  @click="selectDay(day)"
                />
              </div>
            </div>
          </div>

          <!-- Tap detail row -->
          <div class="h-6 flex items-center ml-5">
            <transition name="fade">
              <p v-if="selectedDay" class="text-xs">
                <span class="text-slate-300 font-medium">{{ selectedDay.date }}</span>
                <span class="text-slate-500 mx-1">—</span>
                <span v-if="selectedDay.isFuture" class="text-slate-600">future</span>
                <span v-else class="text-slate-400">{{ selectedDay.doneCount }}/{{ selectedDay.total }} habits</span>
                <span v-if="!selectedDay.isFuture && selectedDay.doneCount === selectedDay.total && selectedDay.total > 0" class="text-cyan-400 ml-1">✓ Perfect day</span>
              </p>
              <p v-else class="text-[10px] text-slate-700">Tap any cell</p>
            </transition>
          </div>

          <!-- Legend -->
          <div class="flex items-center gap-1 ml-5">
            <span class="text-[10px] text-slate-600 mr-0.5">Less</span>
            <div
              v-for="col in HEAT_COLORS"
              :key="col"
              class="w-3.5 h-3.5 rounded-[3px]"
              :style="{ backgroundColor: col }"
            />
            <span class="text-[10px] text-slate-600 ml-0.5">More</span>
          </div>

        </div>
      </div>
    </UCard>

    <!-- ── Monthly completion rate ───────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <p class="text-xs font-semibold text-slate-400">Monthly Completion Rate</p>

      <div v-if="!totalHabits" class="flex items-center justify-center py-6">
        <p class="text-xs text-slate-600">No data yet</p>
      </div>
      <div v-else class="flex items-end gap-1.5 h-28">
        <div
          v-for="month in monthlyData"
          :key="month.label"
          class="flex-1 flex flex-col items-center gap-1"
        >
          <span
            class="text-[10px] font-medium tabular-nums"
            :class="month.rate >= 70 ? 'text-emerald-400' : month.rate >= 40 ? 'text-amber-400' : month.rate > 0 ? 'text-rose-400' : 'text-slate-700'"
          >{{ month.rate > 0 ? `${month.rate}%` : '—' }}</span>
          <div class="w-full flex-1 flex items-end">
            <div
              class="w-full rounded-t transition-all duration-700"
              :class="month.rate >= 70 ? 'bg-emerald-500' : month.rate >= 40 ? 'bg-amber-400' : month.rate > 0 ? 'bg-rose-500' : 'bg-slate-800'"
              :style="{ height: `${Math.max(month.rate > 0 ? 4 : 0, month.rate)}%` }"
            />
          </div>
          <span class="text-[10px] text-slate-600">{{ month.label }}</span>
        </div>
      </div>
    </UCard>

    <!-- ── Habit completion bars ─────────────────────────────────────────────── -->
    <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold text-slate-400">Habit Completion</p>
        <div class="flex gap-0.5">
          <button
            v-for="d in [7, 14, 30, 90]"
            :key="d"
            class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
            :class="completionDays === d ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-400'"
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
            <UIcon :name="item.habit.icon" class="w-3 h-3" :style="{ color: item.habit.color }" />
          </div>
          <p class="w-20 text-xs text-slate-400 truncate flex-shrink-0">{{ item.habit.name }}</p>
          <div class="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :style="{ width: `${item.rate}%`, backgroundColor: item.habit.color }"
            />
          </div>
          <span class="w-7 text-[11px] text-slate-500 text-right flex-shrink-0">{{ item.rate }}%</span>
        </div>
      </div>
    </UCard>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
