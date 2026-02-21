<script setup lang="ts">
import type { HabitWithSchedule, Completion, HabitLog, Scribble, CheckinDaySummary } from '~/types/database'

const db = useDatabase()
const { impact } = useHaptics()
const { settings } = useAppSettings()

watchEffect(() => {
  if (!settings.value.enableToday) void navigateTo('/habits')
})

const today = new Date().toISOString().slice(0, 10)
const todayDayOfWeek = new Date().getDay()
const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

// Get current week start (Sunday)
const weekStart = (() => {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
})()

const habits = ref<HabitWithSchedule[]>([])
const completions = ref<Completion[]>([])
const logs = ref<HabitLog[]>([])
const weekCompletions = ref<Completion[]>([])
const weekLogs = ref<HabitLog[]>([])
const loading = ref(true)
const toggling = reactive(new Set<string>())
const logging = reactive(new Set<string>())

// Per-habit inline log input state (NUMERIC type)
const logInputOpen = reactive(new Set<string>())
const logInputValues = reactive<Record<string, number>>({})

// ─── Today's activity summaries ───────────────────────────────────────────────

const todayCheckins = ref<CheckinDaySummary[]>([])
const todayScribbles = ref<Scribble[]>([])
const todayVoiceCount = ref(0)

function openVoiceIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('habitat', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('voice_notes', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadVoiceCount() {
  try {
    const idb = await openVoiceIdb()
    const notes: Array<{ created_at: string }> = await new Promise((resolve, reject) => {
      const req = idb.transaction('voice_notes', 'readonly').objectStore('voice_notes').getAll()
      req.onsuccess = () => resolve(req.result as Array<{ created_at: string }>)
      req.onerror = () => reject(req.error)
    })
    todayVoiceCount.value = notes.filter(n => n.created_at.slice(0, 10) === today).length
  } catch {
    todayVoiceCount.value = 0
  }
}

async function load() {
  if (!db.isAvailable) { loading.value = false; return }
  const [h, c, l, wc, wl, ci, sc] = await Promise.all([
    db.getHabits(),
    db.getCompletionsForDate(today),
    db.getHabitLogsForDate(today),
    db.getCompletionsForDateRange(weekStart, today),
    db.getHabitLogsForDateRange(weekStart, today),
    db.getCheckinSummaryForDate(today),
    db.getScribblesForDate(today),
  ])
  habits.value = h
  completions.value = c
  logs.value = l
  weekCompletions.value = wc
  weekLogs.value = wl
  todayCheckins.value = ci
  todayScribbles.value = sc
  loading.value = false
  void loadVoiceCount()
}

// ─── Filtering ────────────────────────────────────────────────────────────────

const visibleHabits = computed(() => habits.value.filter(h => {
  if (h.paused_until && h.paused_until >= today) return false
  const sched = h.schedule
  if (!sched) return true
  if (sched.schedule_type === 'SPECIFIC_DAYS') {
    return sched.days_of_week?.includes(todayDayOfWeek) ?? false
  }
  return true
}))

// ─── Type-aware helpers ───────────────────────────────────────────────────────

function getTodayLogSum(habitId: string): number {
  return logs.value
    .filter(l => l.habit_id === habitId)
    .reduce((s, l) => s + l.value, 0)
}

function isHabitDone(habit: HabitWithSchedule): boolean {
  if (habit.type === 'BOOLEAN') {
    return completions.value.some(c => c.habit_id === habit.id)
  }
  if (habit.type === 'NUMERIC') {
    return getTodayLogSum(habit.id) >= habit.target_value
  }
  // LIMIT: "done" = still under the limit
  return getTodayLogSum(habit.id) < habit.target_value
}

function isOverLimit(habit: HabitWithSchedule): boolean {
  return getTodayLogSum(habit.id) >= habit.target_value
}

function weeklyInfo(habit: HabitWithSchedule): { done: number; target: number } | null {
  if (habit.schedule?.schedule_type !== 'WEEKLY_FLEX') return null
  const target = habit.schedule.frequency_count ?? 7
  if (habit.type === 'BOOLEAN') {
    return { done: weekCompletions.value.filter(c => c.habit_id === habit.id).length, target }
  }
  const days = new Set(weekLogs.value.filter(l => l.habit_id === habit.id).map(l => l.date))
  return { done: days.size, target }
}

// ─── Progress ring ────────────────────────────────────────────────────────────

const doneCount = computed(() => visibleHabits.value.filter(h => isHabitDone(h)).length)
const total = computed(() => visibleHabits.value.length)
const pct = computed(() => total.value > 0 ? doneCount.value / total.value : 0)

const R = 42
const CIRC = 2 * Math.PI * R
const dashOffset = computed(() => CIRC * (1 - pct.value))

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
  } finally {
    toggling.delete(habit.id)
  }
}

// ─── NUMERIC log ─────────────────────────────────────────────────────────────

function openLogInput(habit: HabitWithSchedule) {
  logInputValues[habit.id] = settings.value.logInputMode === 'absolute'
    ? getTodayLogSum(habit.id)
    : 1
  logInputOpen.add(habit.id)
}

async function submitLog(habit: HabitWithSchedule) {
  if (logging.has(habit.id)) return
  const value = logInputValues[habit.id] ?? 0
  const isAbsolute = settings.value.logInputMode === 'absolute'
  if (!isAbsolute && value <= 0) return
  logging.add(habit.id)
  try {
    if (isAbsolute) {
      const existing = logs.value.filter(l => l.habit_id === habit.id)
      await Promise.all(existing.map(l => db.deleteHabitLog(l.id)))
      if (value > 0) await db.logHabitValue(habit.id, today, value)
    } else {
      await db.logHabitValue(habit.id, today, value)
    }
    logs.value = await db.getHabitLogsForDate(today)
    weekLogs.value = await db.getHabitLogsForDateRange(weekStart, today)
    logInputOpen.delete(habit.id)
    await impact('medium')
  } finally {
    logging.delete(habit.id)
  }
}


onMounted(load)
</script>

<template>
  <div class="space-y-5">

    <!-- ── Welcome / empty state ────────────────────────────────────────────── -->
    <template v-if="!loading && habits.length === 0">
      <div class="flex flex-col items-center justify-center gap-7 pt-10 pb-4 text-center">
        <div class="relative flex items-center justify-center">
          <div class="absolute w-44 h-44 rounded-full bg-primary-500/10 blur-3xl" />
          <svg
            class="plant-logo relative w-24 h-28"
            viewBox="0 0 40 44"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" />
            <line x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            <path d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="space-y-2 max-w-xs">
          <h2 class="text-2xl font-bold leading-snug">Welcome to Your<br>New Routine</h2>
          <p class="text-sm text-slate-500 leading-relaxed">
            Private, offline, and flexible habit tracking. Let's get started.
          </p>
        </div>
        <UButton to="/habits" size="lg" icon="i-heroicons-plus" class="px-8">
          Create My First Habit
        </UButton>
      </div>
    </template>

    <!-- ── Active state ─────────────────────────────────────────────────────── -->
    <template v-else-if="!loading">
      <header>
        <p class="text-sm text-slate-500">{{ dateStr }}</p>
        <h2 class="text-2xl font-bold">{{ dayName }}</h2>
      </header>

      <!-- Progress ring -->
      <div class="flex flex-col items-center gap-1.5 py-2">
        <div class="relative">
          <svg width="160" height="160" viewBox="0 0 100 100">
            <!-- Track -->
            <circle cx="50" cy="50" :r="R" fill="none" stroke-width="8" stroke="#1e293b" />
            <!-- Progress -->
            <circle
              cx="50" cy="50" :r="R"
              fill="none" stroke-width="8"
              stroke="#22d3ee" stroke-linecap="round"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 50 50)"
              style="transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span class="text-3xl font-bold tabular-nums leading-none">{{ doneCount }}</span>
            <span class="text-xs text-slate-500">of {{ total }}</span>
          </div>
        </div>
        <p class="text-xs font-medium">
          <span v-if="doneCount === total && total > 0" class="text-primary-400">All done today!</span>
          <span v-else class="text-slate-500">{{ total - doneCount }} remaining</span>
        </p>
      </div>

      <!-- ── Habit list ───────────────────────────────────────────────────────── -->
      <ul class="space-y-2">
        <li
          v-for="habit in visibleHabits"
          :key="habit.id"
          class="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200"
          :class="isHabitDone(habit)
            ? 'bg-slate-900/50 border-slate-800/50 opacity-70'
            : 'bg-slate-900 border-slate-800'"
        >
          <!-- Icon -->
          <div
            class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
            :style="{ backgroundColor: habit.color + '22' }"
          >
            <UIcon :name="habit.icon" class="w-5 h-5" :style="{ color: habit.color }" />
          </div>

          <!-- Name + subtitle -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <p
                class="text-sm font-medium truncate transition-colors"
                :class="isHabitDone(habit) && habit.type === 'BOOLEAN'
                  ? 'line-through text-slate-500'
                  : 'text-slate-100'"
              >{{ habit.name }}</p>
              <span
                v-if="habit.type !== 'BOOLEAN'"
                class="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
                :class="habit.type === 'NUMERIC'
                  ? 'bg-primary-500/15 text-primary-400'
                  : 'bg-amber-500/15 text-amber-400'"
              >{{ habit.type === 'NUMERIC' ? '# Metric' : '↓ Limit' }}</span>
            </div>
            <!-- NUMERIC: logged / target -->
            <p v-if="habit.type === 'NUMERIC'" class="text-xs text-slate-500">
              {{ getTodayLogSum(habit.id) }} / {{ habit.target_value }}
              <span v-if="weeklyInfo(habit)" class="ml-2 text-slate-600">
                · {{ weeklyInfo(habit)!.done }}/{{ weeklyInfo(habit)!.target }} this week
              </span>
            </p>
            <!-- LIMIT: count / limit -->
            <p
              v-else-if="habit.type === 'LIMIT'"
              class="text-xs"
              :class="isOverLimit(habit) ? 'text-red-400' : 'text-slate-500'"
            >
              {{ getTodayLogSum(habit.id) }} / {{ habit.target_value }} limit
              <span v-if="weeklyInfo(habit)" class="ml-2 text-slate-600">
                · {{ weeklyInfo(habit)!.done }}/{{ weeklyInfo(habit)!.target }} this week
              </span>
            </p>
            <!-- BOOLEAN weekly flex badge -->
            <p v-else-if="weeklyInfo(habit)" class="text-xs text-slate-500">
              {{ weeklyInfo(habit)!.done }}/{{ weeklyInfo(habit)!.target }} this week
            </p>
            <div v-if="settings.showTagsOnToday && habit.tags.length" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="tag in habit.tags"
                :key="tag"
                class="px-1.5 py-0.5 rounded text-[9px]"
                :class="tag.startsWith('habitat-') ? 'bg-cyan-900/40 text-cyan-600' : 'bg-slate-800 text-slate-500'"
              >#{{ tag.startsWith('habitat-') ? tag.slice(8) : tag }}</span>
            </div>
            <div v-if="settings.showAnnotationsOnToday && Object.keys(habit.annotations).length" class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              <span
                v-for="(val, key) in habit.annotations"
                :key="key"
                class="text-[9px] text-slate-600"
              >{{ key }}: {{ val }}</span>
            </div>
          </div>

          <!-- ── BOOLEAN: toggle button ── -->
          <template v-if="habit.type === 'BOOLEAN'">
            <button
              class="w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all duration-200"
              :class="isHabitDone(habit)
                ? 'bg-primary-500 border-primary-500'
                : 'border-slate-700 hover:border-slate-500 bg-transparent'"
              :disabled="toggling.has(habit.id)"
              @click="toggle(habit)"
            >
              <UIcon v-if="isHabitDone(habit)" name="i-heroicons-check" class="w-3.5 h-3.5 text-white" />
            </button>
          </template>

          <!-- ── NUMERIC / LIMIT: inline log input ── -->
          <template v-else>
            <template v-if="logInputOpen.has(habit.id)">
              <input
                v-model.number="logInputValues[habit.id]"
                type="number"
                min="0"
                step="any"
                class="w-16 px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-100 text-center focus:outline-none"
                :class="habit.type === 'NUMERIC' ? 'focus:border-primary-500' : 'focus:border-amber-500'"
                @keyup.enter="submitLog(habit)"
                @keyup.escape="logInputOpen.delete(habit.id)"
              />
              <button
                class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                :class="habit.type === 'NUMERIC' ? 'bg-primary-500' : 'bg-amber-500'"
                :disabled="logging.has(habit.id)"
                @click="submitLog(habit)"
              >
                <UIcon name="i-heroicons-check" class="w-3.5 h-3.5 text-white" />
              </button>
              <button
                class="w-7 h-7 rounded-full border border-slate-700 flex items-center justify-center flex-shrink-0 text-slate-500"
                @click="logInputOpen.delete(habit.id)"
              >
                <UIcon name="i-heroicons-x-mark" class="w-3.5 h-3.5" />
              </button>
            </template>
            <template v-else>
              <UButton
                size="xs"
                variant="soft"
                :color="habit.type === 'LIMIT' && isOverLimit(habit) ? 'error' : habit.type === 'NUMERIC' ? 'primary' : 'warning'"
                :disabled="logging.has(habit.id)"
                @click="openLogInput(habit)"
              >
                Log
              </UButton>
              <div v-if="isHabitDone(habit)" class="w-5 flex-shrink-0 flex items-center justify-center">
                <UIcon
                  name="i-heroicons-check-circle"
                  class="w-5 h-5"
                  :class="habit.type === 'NUMERIC' ? 'text-primary-400' : 'text-amber-400'"
                />
              </div>
            </template>
          </template>
        </li>
      </ul>
      <!-- ── Today's activity ──────────────────────────────────────────────────── -->
      <section
        v-if="todayCheckins.length > 0 || todayScribbles.length > 0 || todayVoiceCount > 0"
        class="space-y-2"
      >
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">Today's Activity</p>

        <div class="space-y-1.5">

          <!-- Check-in templates with responses today -->
          <NuxtLink
            v-for="ci in todayCheckins"
            :key="ci.template_id"
            :to="`/checkin/${ci.template_id}`"
            class="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div class="w-8 h-8 rounded-full bg-primary-500/10 flex-shrink-0 flex items-center justify-center">
              <UIcon name="i-heroicons-pencil-square" class="w-4 h-4 text-primary-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-100 truncate">{{ ci.title }}</p>
              <p class="text-xs text-slate-500">{{ ci.response_count }} {{ ci.response_count === 1 ? 'response' : 'responses' }}</p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-600 flex-shrink-0" />
          </NuxtLink>

          <!-- Scribbles updated today -->
          <NuxtLink
            v-if="todayScribbles.length > 0"
            to="/scribbles"
            class="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div class="w-8 h-8 rounded-full bg-amber-500/10 flex-shrink-0 flex items-center justify-center">
              <UIcon name="i-heroicons-pencil" class="w-4 h-4 text-amber-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-100">Scribbles</p>
              <p class="text-xs text-slate-500">
                {{ todayScribbles.length }} {{ todayScribbles.length === 1 ? 'note' : 'notes' }} updated today
              </p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-600 flex-shrink-0" />
          </NuxtLink>

          <!-- Voice notes recorded today -->
          <NuxtLink
            v-if="todayVoiceCount > 0"
            to="/voice"
            class="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div class="w-8 h-8 rounded-full bg-rose-500/10 flex-shrink-0 flex items-center justify-center">
              <UIcon name="i-heroicons-microphone" class="w-4 h-4 text-rose-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-100">Voice Notes</p>
              <p class="text-xs text-slate-500">
                {{ todayVoiceCount }} {{ todayVoiceCount === 1 ? 'recording' : 'recordings' }} today
              </p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-600 flex-shrink-0" />
          </NuxtLink>

        </div>
      </section>

    </template>

  </div>
</template>
