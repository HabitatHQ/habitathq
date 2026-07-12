<script setup lang="ts">
import { isStruggling, type StreakInput } from '~/lib/streak-engine'
import type {
  BoredOracleResult,
  CheckinDaySummary,
  Completion,
  HabitLog,
  HabitWithSchedule,
  Scribble,
  Todo,
} from '~/types/database'

const db = useDatabase()
const { impact } = useHaptics()
const { settings } = useAppSettings()
const toast = useToast()
const { anyActive, activeContexts, matchesContext } = useContextFilter()

watchEffect(() => {
  if (!settings.value.enableToday) void navigateTo('/habits')
})

const _now = new Date()
const today = _now.toISOString().slice(0, 10)
const todayDayOfWeek = _now.getDay()
const dayName = _now.toLocaleDateString('en-US', { weekday: 'long' })
const dateStr = _now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

// Get current week start (Sunday)
const weekStart = (() => {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
})()

// 15-day window for the struggling-habit detector (needs ~2 weeks of history).
const histStart = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 15)
  return d.toISOString().slice(0, 10)
})()

const habits = ref<HabitWithSchedule[]>([])
const completions = ref<Completion[]>([])
const logs = ref<HabitLog[]>([])
const weekCompletions = ref<Completion[]>([])
const weekLogs = ref<HabitLog[]>([])
const histCompletions = ref<Completion[]>([])
const histLogs = ref<HabitLog[]>([])
const pausingId = ref<string | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const toggling = reactive(new Set<string>())
const flashing = reactive(new Set<string>())
const logging = reactive(new Set<string>())

// Per-habit log sheet state (NUMERIC/LIMIT type)
const logSheetHabit = ref<HabitWithSchedule | null>(null)
const logSheetValue = ref(0)
const logSheetOpen = computed(() => logSheetHabit.value !== null)

// ─── TODOs ────────────────────────────────────────────────────────────────────

const todos = ref<Todo[]>([])
const todoToggledIds = reactive(new Set<string>())
const todoToggling = reactive(new Set<string>())

const todayTodos = computed(() => {
  const base = todos.value.filter((t) => !t.is_done && !t.archived_at && t.due_date === today)
  const filtered = anyActive.value ? base.filter((t) => matchesContext(t.tags)) : base
  return filtered.slice(0, 5)
})

// All today's todos (done + not done) for the progress bar — not capped at 5
const allTodayTodos = computed(() => {
  const base = todos.value.filter((t) => !t.archived_at && t.due_date === today)
  return anyActive.value ? base.filter((t) => matchesContext(t.tags)) : base
})
const todoTotal = computed(() => allTodayTodos.value.length)
const todoDoneCount = computed(
  () => allTodayTodos.value.filter((t) => t.is_done || todoToggledIds.has(t.id)).length,
)
const todoAllDone = computed(() => todoTotal.value > 0 && todoDoneCount.value >= todoTotal.value)

async function toggleTodoLocal(todo: Todo) {
  if (todoToggling.has(todo.id)) return
  todoToggling.add(todo.id)
  try {
    await db.toggleTodo(todo.id)
    todoToggledIds.add(todo.id)
    await impact('light')
    toast.add({
      title: `"${todo.title}" done`,
      color: 'success',
      duration: 4000,
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            await db.toggleTodo(todo.id)
            todoToggledIds.delete(todo.id)
          },
        },
      ],
    })
  } finally {
    todoToggling.delete(todo.id)
  }
}

// ─── Bored suggestion ─────────────────────────────────────────────────────────

const boredDismissed = ref(false)
const boredOracleResult = ref<BoredOracleResult | null>(null)
const boredContextMatch = ref(true)
const boredRolling = ref(false)
const boredMarking = ref(false)
const boredShaking = ref(false)

const boredSectionVisible = computed(
  () =>
    !boredDismissed.value &&
    allHabitsDone.value &&
    settings.value.enableBored &&
    settings.value.autoShowBored,
)

const boredTitle = computed(() => {
  if (!boredOracleResult.value) return ''
  return boredOracleResult.value.source === 'activity'
    ? boredOracleResult.value.activity.title
    : boredOracleResult.value.todo.title
})

const boredCategory = computed(() => {
  if (!boredOracleResult.value) return null
  return boredOracleResult.value.category
})

const boredEstimate = computed(() => {
  if (!boredOracleResult.value) return null
  const mins =
    boredOracleResult.value.source === 'activity'
      ? boredOracleResult.value.activity.estimated_minutes
      : boredOracleResult.value.todo.estimated_minutes
  if (!mins) return null
  return mins < 60 ? `${mins}m` : `${Math.round((mins / 60) * 10) / 10}h`
})

const ORACLE_COPY_TODAY: Record<string, { rolling: string; idle: string }> = {
  forest: { rolling: 'The stone awakens…', idle: 'Tap to read the runes' },
  ocean: { rolling: 'The depths stir…', idle: 'Tap to consult the deep' },
  habitat: { rolling: 'Consulting the oracle…', idle: 'Tap to get a suggestion' },
}

const boredIdleHint = computed(
  () => ORACLE_COPY_TODAY[settings.value.theme]?.idle ?? 'Tap to get a suggestion',
)
const boredRollingHint = computed(
  () => ORACLE_COPY_TODAY[settings.value.theme]?.rolling ?? 'Consulting the oracle…',
)

const miniOracleClass = computed(() => {
  if (settings.value.theme === 'forest') return 'mini-stone'
  if (settings.value.theme === 'ocean') return 'mini-jellyfish'
  return 'mini-ball'
})

function isMotionReduced(): boolean {
  if (!import.meta.client) return true
  if (settings.value.reduceMotion) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates animation + API + state
async function rollBored() {
  if (boredRolling.value) return
  boredRolling.value = true
  void impact('medium')
  if (!isMotionReduced()) {
    boredShaking.value = true
    await new Promise((r) => setTimeout(r, 500))
    boredShaking.value = false
  }

  // Try to find a context-matching result (up to 5 silent re-rolls)
  let result = await db.getBoredOracle([], null)
  let matched = true
  if (result && anyActive.value) {
    const firstTags = result.source === 'activity' ? result.activity.tags : result.todo.tags
    if (!matchesContext(firstTags)) {
      matched = false
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await db.getBoredOracle([], null)
        if (!r) continue
        const t = r.source === 'activity' ? r.activity.tags : r.todo.tags
        if (matchesContext(t)) {
          result = r
          matched = true
          break
        }
        result = r
      }
    }
  }

  boredOracleResult.value = result
  boredContextMatch.value = matched
  boredRolling.value = false
}

async function markBoredDone() {
  if (!boredOracleResult.value || boredMarking.value) return
  boredMarking.value = true
  try {
    if (boredOracleResult.value.source === 'activity') {
      await db.markBoredActivityDone(boredOracleResult.value.activity.id)
    } else {
      await db.toggleTodo(boredOracleResult.value.todo.id)
    }
    boredOracleResult.value = null
    await impact('light')
  } finally {
    boredMarking.value = false
  }
}

// ─── Today's activity summaries ───────────────────────────────────────────────

const todayCheckins = ref<CheckinDaySummary[]>([])
const todayScribbles = ref<Scribble[]>([])
const todayVoiceCount = ref(0)
const hasTodayActivity = computed(
  () =>
    todayCheckins.value.length > 0 || todayScribbles.value.length > 0 || todayVoiceCount.value > 0,
)

async function loadVoiceCount() {
  try {
    const rows = await db.getVoiceNotes()
    todayVoiceCount.value = rows.filter((n) => n.created_at.slice(0, 10) === today).length
  } catch {
    todayVoiceCount.value = 0
  }
}

async function load() {
  try {
    const [h, c, l, wc, wl, hc, hl, ci, sc, td] = await Promise.all([
      db.getHabits(),
      db.getCompletionsForDate(today),
      db.getHabitLogsForDate(today),
      db.getCompletionsForDateRange(weekStart, today),
      db.getHabitLogsForDateRange(weekStart, today),
      db.getCompletionsForDateRange(histStart, today),
      db.getHabitLogsForDateRange(histStart, today),
      db.getCheckinSummaryForDate(today),
      db.getScribblesForDate(today),
      db.getTodos(),
    ])
    habits.value = h
    completions.value = c
    logs.value = l
    weekCompletions.value = wc
    weekLogs.value = wl
    histCompletions.value = hc
    histLogs.value = hl
    todayCheckins.value = ci.filter((s) => s.response_count > 0 || s.is_completed)
    todayScribbles.value = sc
    todos.value = td
    loadError.value = null
    void loadVoiceCount()
  } catch (e) {
    loadError.value = logError('[today/load]', e)
  } finally {
    loading.value = false
  }
}

// ─── Struggling habits (needs-attention section) ────────────────────────────────

function struggleInput(h: HabitWithSchedule): StreakInput {
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
      completions: new Set(
        histCompletions.value.filter((c) => c.habit_id === h.id).map((c) => c.date),
      ),
      today,
    }
  }
  const sums = new Map<string, number>()
  for (const log of histLogs.value) {
    if (log.habit_id === h.id) sums.set(log.date, (sums.get(log.date) ?? 0) + log.value)
  }
  return { type: h.type, target: h.target_value, schedule, sums, today }
}

// Already done/logged today → don't nag, even if the rolling rate is still low.
function activeTodayHabit(h: HabitWithSchedule): boolean {
  if (h.type === 'BOOLEAN') return completions.value.some((c) => c.habit_id === h.id)
  return getTodayLogSum(h.id) > 0
}

const strugglingHabits = computed(() =>
  habits.value.filter(
    (h) =>
      !(h.paused_until && h.paused_until >= today) &&
      !activeTodayHabit(h) &&
      isStruggling(struggleInput(h)),
  ),
)

async function pauseStrugglingToday(h: HabitWithSchedule) {
  if (pausingId.value) return
  pausingId.value = h.id
  try {
    const until = new Date()
    until.setDate(until.getDate() + 7)
    await db.pauseHabit(h.id, until.toISOString().slice(0, 10))
    await load()
    toast.add({ title: `"${h.name}" paused for a week`, color: 'success', duration: 3000 })
  } catch (e) {
    logError('[today/pauseStruggling]', e)
  } finally {
    pausingId.value = null
  }
}

function editStruggling(h: HabitWithSchedule) {
  void navigateTo(`/habits/${h.id}`)
}

// ─── Filtering ────────────────────────────────────────────────────────────────

const visibleHabits = computed(() =>
  habits.value.filter((h) => {
    if (h.paused_until && h.paused_until >= today) return false
    const sched = h.schedule
    if (!sched) return true
    if (sched.schedule_type === 'SPECIFIC_DAYS') {
      return sched.days_of_week?.includes(todayDayOfWeek) ?? false
    }
    return true
  }),
)

// Context-aware habit split: matching first, non-matching ("Others") last
const contextHabits = computed(() => {
  if (!anyActive.value) return visibleHabits.value
  return visibleHabits.value.filter((h) => matchesContext(h.tags))
})
const otherHabits = computed(() => {
  if (!anyActive.value) return []
  return visibleHabits.value.filter((h) => !matchesContext(h.tags))
})
const sortedHabits = computed(() => [...contextHabits.value, ...otherHabits.value])

// ─── Type-aware helpers ───────────────────────────────────────────────────────

function getTodayLogSum(habitId: string): number {
  return logs.value.filter((l) => l.habit_id === habitId).reduce((s, l) => s + l.value, 0)
}

function isHabitDone(habit: HabitWithSchedule): boolean {
  if (habit.type === 'BOOLEAN') {
    return completions.value.some((c) => c.habit_id === habit.id)
  }
  if (habit.type === 'NUMERIC') {
    return getTodayLogSum(habit.id) >= habit.target_value
  }
  // LIMIT: "done" = tracked at least once AND at or under the limit
  const sum = getTodayLogSum(habit.id)
  return sum > 0 && sum <= habit.target_value
}

function isOverLimit(habit: HabitWithSchedule): boolean {
  return getTodayLogSum(habit.id) > habit.target_value
}

function weeklyInfo(habit: HabitWithSchedule): { done: number; target: number } | null {
  if (habit.schedule?.schedule_type !== 'WEEKLY_FLEX') return null
  const target = habit.schedule.frequency_count ?? 7
  if (habit.type === 'BOOLEAN') {
    return { done: weekCompletions.value.filter((c) => c.habit_id === habit.id).length, target }
  }
  const days = new Set(weekLogs.value.filter((l) => l.habit_id === habit.id).map((l) => l.date))
  return { done: days.size, target }
}

// ─── Progress ring ────────────────────────────────────────────────────────────

const doneCount = computed(() => visibleHabits.value.filter((h) => isHabitDone(h)).length)
const total = computed(() => visibleHabits.value.length)
const allHabitsDone = computed(() => doneCount.value === total.value && total.value > 0)
const pct = computed(() => (total.value > 0 ? doneCount.value / total.value : 0))

const R = 42
const CIRC = 2 * Math.PI * R
const dashOffset = computed(() => CIRC * (1 - pct.value))
const ringGlowing = computed(() => allHabitsDone.value && !isMotionReduced())

// ─── BOOLEAN toggle ───────────────────────────────────────────────────────────

async function toggle(habit: HabitWithSchedule) {
  if (toggling.has(habit.id)) return
  toggling.add(habit.id)
  const wasCompleted = isHabitDone(habit)
  try {
    await db.toggleCompletion(habit.id, today)
    completions.value = await db.getCompletionsForDate(today)
    weekCompletions.value = await db.getCompletionsForDateRange(weekStart, today)
    await impact(wasCompleted ? 'light' : 'medium')
    if (!wasCompleted && !isMotionReduced()) {
      flashing.add(habit.id)
      setTimeout(() => flashing.delete(habit.id), 400)
    }
    if (!wasCompleted) {
      toast.add({
        title: `"${habit.name}" completed`,
        color: 'success',
        duration: 4000,
        actions: [
          {
            label: 'Undo',
            onClick: async () => {
              await db.toggleCompletion(habit.id, today)
              completions.value = await db.getCompletionsForDate(today)
              weekCompletions.value = await db.getCompletionsForDateRange(weekStart, today)
            },
          },
        ],
      })
    }
  } catch (e) {
    logError('[today/toggle]', e)
    toast.add({ title: "Couldn't save — try again", color: 'error', duration: 3000 })
  } finally {
    toggling.delete(habit.id)
  }
}

// ─── NUMERIC log ─────────────────────────────────────────────────────────────

function openLogSheet(habit: HabitWithSchedule) {
  logSheetValue.value = suggestedLogValue({
    logs: histLogs.value,
    habitId: habit.id,
    isAbsolute: settings.value.logInputMode === 'absolute',
    todaySum: getTodayLogSum(habit.id),
    target: habit.target_value,
  })
  logSheetHabit.value = habit
}

function closeLogSheet() {
  logSheetHabit.value = null
}

async function submitLogSheet(value: number) {
  const habit = logSheetHabit.value
  if (!habit || logging.has(habit.id)) return
  const isAbsolute = settings.value.logInputMode === 'absolute'
  if (!isAbsolute && value <= 0) return
  logging.add(habit.id)
  try {
    if (isAbsolute) {
      const existing = logs.value.filter((l) => l.habit_id === habit.id)
      await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
      if (value > 0) await db.logHabitValue(habit.id, today, value)
    } else {
      await db.logHabitValue(habit.id, today, value)
    }
    logs.value = await db.getHabitLogsForDate(today)
    weekLogs.value = await db.getHabitLogsForDateRange(weekStart, today)
    logSheetHabit.value = null
    await impact('medium')
  } finally {
    logging.delete(habit.id)
  }
}

// ─── Logo sprout animation (empty state) ───────────────────────────────────────

const logoSvgRef = ref<SVGElement | null>(null)
const logoAnimating = ref(false)
const logoQueued = ref(false)

async function startLogoAnim() {
  logoAnimating.value = false
  await nextTick()
  void (logoSvgRef.value as HTMLElement | null)?.offsetWidth
  logoAnimating.value = true
}

function playLogoAnimation() {
  if (isMotionReduced()) return
  if (logoAnimating.value) {
    logoQueued.value = true
    return
  }
  startLogoAnim()
}

function onLogoAnimEnd(e: AnimationEvent) {
  if (!(e.target as Element).classList.contains('sprout-soil')) return
  if (logoQueued.value) {
    logoQueued.value = false
    startLogoAnim()
  } else {
    logoAnimating.value = false
  }
}

onMounted(async () => {
  await load()
  if (!loading.value && habits.value.length === 0) {
    nextTick(playLogoAnimation)
  }
})
</script>

<template>
  <div class="space-y-5">

    <!-- ── Loading skeleton ────────────────────────────────────────────────── -->
    <div v-if="loading" class="space-y-5 pt-2">
      <div class="flex flex-col items-center gap-3">
        <AppSkeleton variant="circle" />
        <AppSkeleton variant="text" />
      </div>
      <AppSkeleton variant="row" :count="3" />
    </div>

    <!-- ── Load error ────────────────────────────────────────────────────────── -->
    <EmptyState
      v-else-if="loadError"
      icon="exclamation-triangle"
      title="Couldn't load your day"
      :description="loadError"
    >
      <template #actions>
        <UButton @click="loading = true; load()">Try again</UButton>
      </template>
    </EmptyState>

    <!-- ── Welcome / empty state ────────────────────────────────────────────── -->
    <template v-else-if="habits.length === 0">
      <div class="flex flex-col items-center justify-center gap-7 pt-10 pb-4 text-center">
        <div class="relative flex items-center justify-center">
          <div class="absolute w-44 h-44 rounded-full bg-primary-500/10 blur-3xl" />
          <svg
            ref="logoSvgRef"
            class="plant-logo plant-logo-lg relative w-24 h-28"
            :class="{ 'sprout-anim': logoAnimating }"
            viewBox="0 0 40 44"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Habitat"
            @click="playLogoAnimation"
            @animationend="onLogoAnimEnd"
          >
            <!-- Stem (draws 1st) -->
            <line class="sprout-stem" x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
            <!-- Left leaf (draws 2nd) -->
            <path class="sprout-leaf-l" d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
            <!-- Right branch (draws 3rd) -->
            <path class="sprout-branch-r" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
            <!-- Soil mound (draws last, 4th) -->
            <path class="sprout-soil" d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" pathLength="1" />
          </svg>
        </div>
        <div class="space-y-2 max-w-xs">
          <h2 class="text-2xl font-bold leading-snug">Welcome to Your<br>New Routine</h2>
          <p class="text-sm text-(--ui-text-dimmed) leading-relaxed">
            Private, offline, and flexible habit tracking. Let's get started.
          </p>
        </div>
        <UButton to="/habits?modal=create" size="lg" :icon="resolveIcon('plus')" class="px-8">
          Create My First Habit
        </UButton>
      </div>
    </template>

    <!-- ── Active state ─────────────────────────────────────────────────────── -->
    <template v-else-if="!loading">
      <header>
        <p class="text-sm text-(--ui-text-dimmed)">{{ dateStr }}</p>
        <h2 class="text-2xl font-bold">{{ dayName }}</h2>
      </header>

      <!-- Progress ring -->
      <div class="flex flex-col items-center gap-1.5 py-2">
        <div class="relative">
          <svg width="160" height="160" viewBox="0 0 100 100" style="overflow: visible">
            <!-- Track -->
            <circle cx="50" cy="50" :r="R" fill="none" stroke-width="8" :style="{ stroke: 'var(--ui-border)' }" />
            <!-- Progress -->
            <circle
              cx="50" cy="50" :r="R"
              fill="none" stroke-width="8"
              stroke="var(--color-primary-400)" stroke-linecap="round"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 50 50)"
              :class="{ 'ring-complete': ringGlowing }"
              style="transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span class="text-3xl font-bold tabular-nums leading-none">{{ doneCount }}</span>
            <span class="text-xs text-(--ui-text-dimmed)">of {{ total }}</span>
          </div>
        </div>
        <p class="text-xs font-medium">
          <span v-if="allHabitsDone" class="text-primary-400">All done today!</span>
          <span v-else class="text-(--ui-text-dimmed)">{{ total - doneCount }} remaining</span>
        </p>
      </div>

      <!-- No habits scheduled today -->
      <p
        v-if="visibleHabits.length === 0 && habits.length > 0"
        class="text-center text-sm text-(--ui-text-dimmed) py-4"
      >
        No habits scheduled today — enjoy your rest.
      </p>

      <!-- ── Habit list ───────────────────────────────────────────────────────── -->
      <ul v-if="visibleHabits.length > 0" class="space-y-2">
        <template v-for="(habit, i) in sortedHabits" :key="habit.id">
          <!-- "Others" section label — inserted before first non-matching habit -->
          <li v-if="anyActive && i === contextHabits.length && otherHabits.length > 0" class="list-none pt-1 pb-0.5" aria-hidden="true">
            <p class="text-xs font-semibold uppercase tracking-wider px-1" style="opacity: 0.4">Others</p>
          </li>
          <HabitListItem
            :habit="habit"
            :done="isHabitDone(habit)"
            :over-limit="isOverLimit(habit)"
            :today-log-sum="getTodayLogSum(habit.id)"
            :weekly-info="weeklyInfo(habit)"
            :toggling="toggling.has(habit.id)"
            :dimmed="anyActive && !matchesContext(habit.tags)"
            :flashing="flashing.has(habit.id)"
            :show-tags="settings.showTagsOnToday"
            :show-annotations="settings.showAnnotationsOnToday"
            @toggle="toggle(habit)"
            @log="openLogSheet(habit)"
          />
        </template>
      </ul>

      <!-- ── Needs attention (struggling habits) ─────────────────────────────── -->
      <section
        v-if="strugglingHabits.length > 0"
        class="space-y-2"
        aria-label="Habits that need attention"
      >
        <p class="text-xs font-semibold uppercase tracking-wider text-amber-500 px-1">
          Needs attention
        </p>
        <StrugglingNudge
          v-for="h in strugglingHabits"
          :key="h.id"
          :habit="h"
          show-name
          :pausing="pausingId === h.id"
          @pause="pauseStrugglingToday(h)"
          @edit="editStruggling(h)"
        />
      </section>

      <!-- ── On your plate (today TODOs) ─────────────────────────────────────── -->
      <section
        v-if="settings.enableTodos && todoTotal > 0"
        class="space-y-2 transition-opacity duration-700"
        :class="todoAllDone ? 'opacity-50' : ''"
        aria-label="On your plate"
      >
        <div class="flex items-center justify-between px-1">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">On your plate</h3>
          <span class="text-xs tabular-nums text-(--ui-text-dimmed)">{{ todoDoneCount }} / {{ todoTotal }}</span>
        </div>

        <!-- Progress bar -->
        <div class="h-1 rounded-full overflow-hidden bg-(--ui-border)">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="todoAllDone ? 'bg-green-500' : 'bg-primary-500'"
            :style="{ width: `${(todoDoneCount / todoTotal) * 100}%` }"
          />
        </div>

        <ul v-if="todayTodos.length > 0" class="space-y-1.5">
          <TodoListItem
            v-for="todo in todayTodos"
            :key="todo.id"
            :todo="todo"
            :done="todoToggledIds.has(todo.id)"
            :toggling="todoToggling.has(todo.id)"
            @toggle="toggleTodoLocal(todo)"
          />
        </ul>

        <UButton to="/todos" variant="ghost" color="neutral" size="xs" :icon="resolveIcon('arrow-right')" trailing aria-label="See all todos">
          See all
        </UButton>
      </section>

      <!-- ── All done — bored suggestion ──────────────────────────────────────── -->
      <Transition name="reveal">
        <section v-if="boredSectionVisible" class="space-y-3 border-t border-(--ui-border) pt-3" aria-label="What's next suggestion">
          <div class="flex items-center justify-between px-1">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">All done! What's next?</h3>
            <button
              class="p-1 text-(--ui-text-dimmed) hover:text-(--ui-text-toned) transition-colors"
              aria-label="Dismiss"
              @click="boredDismissed = true"
            >
              <AppIcon name="x-mark" class="w-4 h-4" />
            </button>
          </div>

          <!-- Oracle + content row -->
          <div class="flex items-center gap-4">
            <!-- Mini oracle button — tap to roll again -->
            <button
              class="shrink-0 relative flex items-center justify-center"
              :class="[miniOracleClass, { 'mini-shake': boredShaking }]"
              :disabled="boredRolling"
              aria-label="Roll the oracle"
              @click="rollBored"
            >
              <!-- Habitat ball: specular + window -->
              <template v-if="settings.theme === 'habitat'">
                <div class="mini-ball-specular" />
                <div class="mini-ball-window">
                  <AppIcon
                    v-if="boredOracleResult && !boredShaking && boredCategory"
                    :name="boredCategory.icon"
                    :color="boredCategory.color"
                    class="w-3 h-3"
                  />
                  <span v-else class="mini-idle-symbol">?</span>
                </div>
              </template>

              <!-- Forest stone: carved face -->
              <template v-else-if="settings.theme === 'forest'">
                <div class="mini-stone-moss" />
                <div class="mini-stone-face">
                  <AppIcon
                    v-if="boredOracleResult && !boredShaking && boredCategory"
                    :name="boredCategory.icon"
                    :color="boredCategory.color"
                    class="w-3 h-3"
                  />
                  <span v-else class="mini-idle-symbol rune">ᛟ</span>
                </div>
              </template>

              <!-- Ocean jellyfish: rim glow + bubbles -->
              <template v-else>
                <div class="mini-jelly-rim" />
                <div class="mini-bubble mini-bubble-1" />
                <div class="mini-bubble mini-bubble-2" />
                <div class="mini-bubble mini-bubble-3" />
                <AppIcon
                  v-if="boredOracleResult && !boredShaking && boredCategory"
                  :name="boredCategory.icon"
                  :color="boredCategory.color"
                  class="w-3 h-3 relative z-10"
                />
                <span v-else class="mini-idle-symbol ocean relative z-10">✦</span>
              </template>
            </button>

            <!-- Right side: idle hint or result -->
            <div class="flex-1 min-w-0">
              <p v-if="boredRolling" class="text-sm text-(--ui-text-dimmed) animate-pulse">
                {{ boredRollingHint }}
              </p>
              <template v-else-if="boredOracleResult">
                <p class="text-sm font-semibold leading-snug">{{ boredTitle }}</p>
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span
                    v-if="boredCategory"
                    class="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                    :style="{ backgroundColor: boredCategory.color + '22', color: boredCategory.color }"
                  >
                    <AppIcon :name="boredCategory.icon" class="w-3 h-3" />
                    {{ boredCategory.name }}
                  </span>
                  <span v-if="boredEstimate" class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-toned)">
                    {{ boredEstimate }}
                  </span>
                </div>
                <p v-if="anyActive && !boredContextMatch" class="text-xs text-(--ui-text-dimmed) mt-1.5 italic">
                  Not tagged {{ activeContexts.join(' / ') }}, but might interest you
                </p>
              </template>
              <p v-else class="text-sm text-(--ui-text-dimmed)">{{ boredIdleHint }}</p>
            </div>
          </div>

          <!-- Done button (below oracle row, only when result is showing) -->
          <UButton
            v-if="boredOracleResult && !boredRolling"
            variant="soft"
            color="success"
            size="sm"
            :icon="resolveIcon('check')"
            :loading="boredMarking"
            @click="markBoredDone"
          >
            Done
          </UButton>
        </section>
      </Transition>

      <!-- ── Today's activity ──────────────────────────────────────────────────── -->
      <section
        v-if="hasTodayActivity"
        class="space-y-2"
      >
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Today's Activity</p>

        <div class="space-y-2">

          <!-- Check-in templates with responses today -->
          <AppCard
            v-for="ci in todayCheckins"
            :key="ci.template_id"
            :to="`/checkin/entry-${ci.template_id}`"
            :completed="ci.is_completed"
          >
            <AppCardIcon icon="pencil-square" bg-class="bg-primary-500/10" icon-color="var(--color-primary-400)" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-(--ui-text) truncate">{{ ci.title }}</p>
              <p class="text-xs text-(--ui-text-dimmed)">{{ ci.response_count }} {{ ci.response_count === 1 ? 'response' : 'responses' }}</p>
            </div>
            <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) flex-shrink-0" />
          </AppCard>

          <!-- Scribbles updated today -->
          <AppCard
            v-if="todayScribbles.length > 0"
            to="/jots"
          >
            <AppCardIcon icon="pencil" bg-class="bg-amber-500/10" icon-color="#fbbf24" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-(--ui-text)">Scribbles</p>
              <p class="text-xs text-(--ui-text-dimmed)">
                {{ todayScribbles.length }} {{ todayScribbles.length === 1 ? 'note' : 'notes' }} updated today
              </p>
            </div>
            <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) flex-shrink-0" />
          </AppCard>

          <!-- Voice notes recorded today -->
          <AppCard
            v-if="todayVoiceCount > 0"
            to="/jots"
          >
            <AppCardIcon icon="microphone" bg-class="bg-rose-500/10" icon-color="#fb7185" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-(--ui-text)">Voice Notes</p>
              <p class="text-xs text-(--ui-text-dimmed)">
                {{ todayVoiceCount }} {{ todayVoiceCount === 1 ? 'recording' : 'recordings' }} today
              </p>
            </div>
            <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) flex-shrink-0" />
          </AppCard>

        </div>
      </section>

    </template>

    <!-- ── Log sheet for NUMERIC / LIMIT habits ──────────────────────────────── -->
    <LogSheet
      :open="logSheetOpen"
      :title="logSheetHabit?.name ?? ''"
      :icon="logSheetHabit?.icon ?? ''"
      :icon-color="logSheetHabit?.color ?? 'var(--color-primary-400)'"
      :current="logSheetValue"
      :target="logSheetHabit?.target_value ?? 0"
      :min="0"
      :max="Math.max((logSheetHabit?.target_value ?? 10) * 2, 50)"
      :step="logSheetHabit?.target_value && logSheetHabit.target_value <= 10 ? 1
        : logSheetHabit?.target_value && logSheetHabit.target_value <= 50 ? 5
        : logSheetHabit?.target_value && logSheetHabit.target_value <= 500 ? 10
        : logSheetHabit?.target_value && logSheetHabit.target_value <= 5000 ? 100
        : 500"
      :unit="''"
      :accent="logSheetHabit?.type === 'LIMIT' ? 'amber' : 'primary'"
      :loading="logSheetHabit ? logging.has(logSheetHabit.id) : false"
      @save="submitLogSheet"
      @close="closeLogSheet"
    />

  </div>
</template>

<style scoped>
/* ── Mini 8-ball (Habitat) ──────────────────────────────── */
.mini-ball {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 27%, rgba(255,255,255,0.09) 0%, transparent 30%),
    radial-gradient(ellipse at 48% 52%, #111827 0%, #050d1f 55%, #000 100%);
  box-shadow:
    0 8px 20px rgba(0,0,0,0.85),
    0 3px 8px rgba(0,0,0,0.6),
    inset 0 -2px 5px rgba(79,70,229,0.12),
    0 0 0 1px rgba(255,255,255,0.04);
  transition: transform 0.15s ease;
}

.mini-ball:active:not(.mini-shake) {
  transform: scale(0.94);
}

.mini-ball-specular {
  position: absolute;
  top: 7%;
  left: 11%;
  width: 32%;
  height: 26%;
  border-radius: 50%;
  background: radial-gradient(ellipse at 38% 32%,
    rgba(255,255,255,0.55) 0%,
    rgba(255,255,255,0.18) 30%,
    transparent 68%
  );
  filter: blur(1.5px);
  pointer-events: none;
}

.mini-ball-window {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px solid transparent;
  background:
    radial-gradient(circle at 36% 30%, #1d2478, #0a0d30 52%, #040510 100%) padding-box,
    linear-gradient(145deg, #64748b 0%, #334155 28%, #1e293b 50%, #2d3748 72%, #64748b 100%) border-box;
  box-shadow: 0 2px 8px rgba(0,0,0,0.88), inset 0 1px 5px rgba(0,0,0,0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Mini moss stone (Forest) ───────────────────────────── */
.mini-stone {
  width: 5rem;
  height: 4.5rem;
  border-radius: 52% 48% 56% 44% / 44% 52% 48% 56%;
  cursor: pointer;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 28% 25%, rgba(55,90,50,0.4) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 50%, #222b1e 0%, #181f14 55%, #0f1a0b 100%);
  box-shadow:
    0 8px 20px rgba(0,0,0,0.8),
    0 3px 8px rgba(0,0,0,0.55),
    inset 0 -2px 6px rgba(0,0,0,0.5);
  transition: transform 0.15s ease;
}

.mini-stone:active:not(.mini-shake) {
  transform: scale(0.96);
}

.mini-stone-moss {
  position: absolute;
  top: 4%;
  left: 6%;
  width: 44%;
  height: 36%;
  border-radius: 50%;
  background: radial-gradient(ellipse at 40% 40%,
    rgba(32,138,101,0.55) 0%,
    rgba(32,138,101,0.18) 50%,
    transparent 70%
  );
  filter: blur(4px);
  pointer-events: none;
  animation: moss-sway 5s ease-in-out infinite;
}

.mini-stone-face {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 42%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px solid transparent;
  background:
    radial-gradient(circle at 50% 45%, #0b160a, #060f05 70%) padding-box,
    linear-gradient(145deg, #3a6e3a 0%, #204d20 30%, #122a12 55%, #4a7e4a 100%) border-box;
  box-shadow: 0 2px 8px rgba(0,0,0,0.85), inset 0 1px 5px rgba(0,0,0,0.95);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Mini jellyfish orb (Ocean) ─────────────────────────── */
.mini-jellyfish {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 85%, rgba(34,211,238,0.07) 0%, transparent 55%),
    radial-gradient(ellipse at 50% 50%, #041520 0%, #020c14 60%, #010810 100%);
  box-shadow:
    0 0 18px rgba(99,102,241,0.35),
    0 0 36px rgba(99,102,241,0.12),
    0 8px 20px rgba(0,0,0,0.9),
    0 0 0 1px rgba(255,255,255,0.04);
  transition: transform 0.15s ease;
}

.mini-jellyfish:active:not(.mini-shake) {
  transform: scale(0.96);
}

.mini-jelly-rim {
  position: absolute;
  bottom: -4%;
  left: 0;
  right: 0;
  height: 40%;
  background: radial-gradient(ellipse at 50% 100%,
    rgba(34,211,238,0.55) 0%,
    rgba(99,102,241,0.22) 42%,
    transparent 70%
  );
  border-radius: 0 0 50% 50%;
  filter: blur(4px);
  pointer-events: none;
  animation: rim-breathe 3s ease-in-out infinite;
}

/* Ocean bubbles (clipped inside 5rem orb) */
.mini-bubble {
  position: absolute;
  border-radius: 50%;
  background: rgba(34,211,238,0.22);
  border: 1px solid rgba(34,211,238,0.4);
  pointer-events: none;
}

.mini-bubble-1 { width: 4px;  height: 4px;  left: 34%; bottom: 12%; animation: mini-bubble-rise 4.5s ease-in infinite 0.8s; }
.mini-bubble-2 { width: 3px;  height: 3px;  left: 60%; bottom: 20%; animation: mini-bubble-rise 6s   ease-in infinite 2.5s; }
.mini-bubble-3 { width: 3px;  height: 3px;  left: 48%; bottom: 16%; animation: mini-bubble-rise 5s   ease-in infinite 4s;   }

/* ── Idle symbols ───────────────────────────────────────── */
.mini-idle-symbol {
  font-size: 0.9rem;
  font-weight: 800;
  color: rgba(148,163,184,0.55);
  user-select: none;
  line-height: 1;
}

.mini-idle-symbol.rune {
  font-weight: 400;
  color: rgba(32,138,101,0.5);
}

.mini-idle-symbol.ocean {
  font-weight: 400;
  color: rgba(34,211,238,0.55);
}

/* ── Shake animation ────────────────────────────────────── */
.mini-shake {
  animation: mini-shake-anim 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

@keyframes mini-shake-anim {
  0%   { transform: translate(0, 0)     rotate(0deg);  }
  10%  { transform: translate(-6px,-4px) rotate(-5deg); }
  22%  { transform: translate(8px, 3px)  rotate(5deg);  }
  33%  { transform: translate(-6px, 5px) rotate(-4deg); }
  45%  { transform: translate(7px,-5px)  rotate(5deg);  }
  57%  { transform: translate(-4px, 3px) rotate(-3deg); }
  68%  { transform: translate(4px,-3px)  rotate(2deg);  }
  80%  { transform: translate(-2px, 2px) rotate(-1deg); }
  92%  { transform: translate(1px,-1px)  rotate(1deg);  }
  100% { transform: translate(0, 0)     rotate(0deg);  }
}

/* ── Shared keyframes ───────────────────────────────────── */
@keyframes mini-bubble-rise {
  0%   { transform: translateY(0)     translateX(0);   opacity: 0.6; }
  50%  { transform: translateY(-30px) translateX(2px); opacity: 0.8; }
  100% { transform: translateY(-60px) translateX(-1px); opacity: 0;  }
}

@keyframes moss-sway {
  0%, 100% { opacity: 0.8; transform: scale(1);    }
  50%       { opacity: 1;   transform: scale(1.04); }
}

@keyframes rim-breathe {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 1;   }
}

/* ── All-done ring glow ──────────────────────────────────── */
.ring-complete {
  animation: ring-glow-pulse 2.5s ease-in-out infinite;
}

@keyframes ring-glow-pulse {
  0%, 100% { filter: drop-shadow(0 0 3px rgba(34, 211, 238, 0.35)); }
  50%       { filter: drop-shadow(0 0 7px rgba(34, 211, 238, 0.65)); }
}

/* ── Habit completion flash ──────────────────────────────── */
.habit-flash {
  animation: habit-flash-anim 0.4s ease-out both;
}

@keyframes habit-flash-anim {
  0%   { box-shadow: 0 0 0px rgba(34, 197, 94, 0); }
  25%  { box-shadow: 0 0 14px rgba(34, 197, 94, 0.5), inset 0 0 10px rgba(34, 197, 94, 0.08); }
  100% { box-shadow: 0 0 0px rgba(34, 197, 94, 0); }
}
</style>
