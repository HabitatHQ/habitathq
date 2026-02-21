<script setup lang="ts">
import type { HabitWithSchedule, Completion, HabitLog } from '~/types/database'

const db = useDatabase()
const { settings } = useAppSettings()

const today = new Date().toISOString().slice(0, 10)

// Always load 7 days so the grid updates live when weekDays changes in settings
const sevenDaysAgo = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
})()

// ─── Days to display ──────────────────────────────────────────────────────────

const days = computed(() => {
  const result: string[] = []
  for (let i = settings.value.weekDays - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    result.push(d.toISOString().slice(0, 10))
  }
  return result
})

// ─── Data ─────────────────────────────────────────────────────────────────────

const habits = ref<HabitWithSchedule[]>([])
const completions = ref<Completion[]>([])
const habitLogs = ref<HabitLog[]>([])
const loading = ref(true)

async function load() {
  if (!db.isAvailable) { loading.value = false; return }
  const [h, c, l] = await Promise.all([
    db.getHabits(),
    db.getCompletionsForDateRange(sevenDaysAgo, today),
    db.getHabitLogsForDateRange(sevenDaysAgo, today),
  ])
  habits.value = h
  completions.value = c
  habitLogs.value = l
  loading.value = false
}

// ─── State helpers ────────────────────────────────────────────────────────────

function getLogSum(habitId: string, date: string): number {
  return habitLogs.value
    .filter(l => l.habit_id === habitId && l.date === date)
    .reduce((s, l) => s + l.value, 0)
}

function isDone(habit: HabitWithSchedule, date: string): boolean {
  if (habit.type === 'BOOLEAN') {
    return completions.value.some(c => c.habit_id === habit.id && c.date === date)
  }
  const sum = getLogSum(habit.id, date)
  if (habit.type === 'NUMERIC') return sum >= habit.target_value
  return sum > 0 && sum < habit.target_value
}

// ─── BOOLEAN toggle ───────────────────────────────────────────────────────────

const toggling = reactive(new Set<string>())

async function toggle(habit: HabitWithSchedule, date: string) {
  const key = `${habit.id}:${date}`
  if (toggling.has(key) || !db.isAvailable) return
  toggling.add(key)
  try {
    await db.toggleCompletion(habit.id, date)
    completions.value = await db.getCompletionsForDateRange(sevenDaysAgo, today)
  } finally {
    toggling.delete(key)
  }
}

// ─── NUMERIC / LIMIT cell editor ──────────────────────────────────────────────

const cellEdit = ref<{ habit: HabitWithSchedule; date: string; value: number } | null>(null)
const cellInputRef = ref<HTMLInputElement | null>(null)
const savingCell = ref(false)

watch(cellEdit, (val) => {
  if (val) nextTick(() => cellInputRef.value?.focus())
})

function openCell(habit: HabitWithSchedule, date: string) {
  const initial = settings.value.logInputMode === 'absolute'
    ? getLogSum(habit.id, date)
    : 0
  cellEdit.value = { habit, date, value: initial }
}

async function saveCell() {
  if (!cellEdit.value || savingCell.value || !db.isAvailable) return
  const { habit, date, value } = cellEdit.value
  const isAbsolute = settings.value.logInputMode === 'absolute'
  if (!isAbsolute && value <= 0) { cellEdit.value = null; return }
  savingCell.value = true
  try {
    if (isAbsolute) {
      const existing = habitLogs.value.filter(l => l.habit_id === habit.id && l.date === date)
      await Promise.all(existing.map(l => db.deleteHabitLog(l.id)))
      if (value > 0) await db.logHabitValue(habit.id, date, value)
    } else {
      await db.logHabitValue(habit.id, date, value)
    }
    habitLogs.value = await db.getHabitLogsForDateRange(sevenDaysAgo, today)
    cellEdit.value = null
  } finally {
    savingCell.value = false
  }
}

// ─── Day header helpers ───────────────────────────────────────────────────────

function dayLabel(date: string): string {
  if (date === today) return 'Today'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
}

function dayNum(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">

    <!-- ── Header with plant logo ─────────────────────────────────────────────── -->
    <header class="flex flex-col items-center gap-3 pt-2">
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
      <div class="text-center">
        <p class="text-sm text-slate-500">Quick fill</p>
        <h2 class="text-2xl font-bold">Week</h2>
      </div>
    </header>

    <!-- ── Empty habits state ─────────────────────────────────────────────────── -->
    <div
      v-if="!loading && habits.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-8 text-center"
    >
      <p class="font-semibold text-slate-200">No habits yet</p>
      <UButton to="/habits" size="sm" variant="soft" color="neutral">Add habits</UButton>
    </div>

    <!-- ── Habit grid ─────────────────────────────────────────────────────────── -->
    <div v-else-if="!loading" class="overflow-x-auto -mx-4 px-4">
      <div class="min-w-max">

        <!-- Header row -->
        <div class="flex items-end pb-2 border-b border-slate-800">
          <div class="w-32 shrink-0 pr-2" />
          <div
            v-for="date in days"
            :key="date"
            class="w-12 shrink-0 text-center"
          >
            <p
              class="text-[10px] font-semibold"
              :class="date === today ? 'text-primary-400' : 'text-slate-500'"
            >{{ dayLabel(date) }}</p>
            <p class="text-[9px] text-slate-600">{{ dayNum(date) }}</p>
          </div>
        </div>

        <!-- Habit rows -->
        <div
          v-for="habit in habits"
          :key="habit.id"
          class="flex items-center border-b border-slate-800/40 py-1.5"
        >
          <!-- Habit name + icon -->
          <div class="w-32 shrink-0 pr-2 flex items-center gap-2 min-w-0">
            <div
              class="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
              :style="{ backgroundColor: habit.color + '33' }"
            >
              <UIcon :name="habit.icon" class="w-3.5 h-3.5" :style="{ color: habit.color }" />
            </div>
            <span class="text-xs font-medium text-slate-200 truncate">{{ habit.name }}</span>
          </div>

          <!-- Day cells -->
          <div
            v-for="date in days"
            :key="date"
            class="w-12 shrink-0 flex items-center justify-center"
          >
            <!-- BOOLEAN -->
            <button
              v-if="habit.type === 'BOOLEAN'"
              class="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-150"
              :class="isDone(habit, date)
                ? 'bg-primary-500 border-primary-500'
                : 'border-slate-700 hover:border-slate-500 bg-transparent'"
              :disabled="toggling.has(`${habit.id}:${date}`)"
              @click="toggle(habit, date)"
            >
              <UIcon v-if="isDone(habit, date)" name="i-heroicons-check" class="w-3.5 h-3.5 text-white" />
            </button>

            <!-- NUMERIC / LIMIT -->
            <button
              v-else
              class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all border"
              :class="[
                isDone(habit, date)
                  ? habit.type === 'NUMERIC'
                    ? 'bg-primary-500/20 border-primary-500/40 text-primary-300'
                    : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : getLogSum(habit.id, date) > 0
                    ? 'border-slate-600 text-slate-300 bg-slate-800/60'
                    : 'border-slate-800 text-slate-700',
                cellEdit?.habit.id === habit.id && cellEdit?.date === date
                  ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-slate-950'
                  : '',
              ]"
              @click="openCell(habit, date)"
            >
              {{ getLogSum(habit.id, date) > 0 ? getLogSum(habit.id, date) : '·' }}
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- ── Inline cell editor ─────────────────────────────────────────────────── -->

    <!-- Backdrop -->
    <div
      v-if="cellEdit"
      class="fixed inset-0 z-40 bg-black/40"
      @click="cellEdit = null"
    />

    <!-- Slide-up strip -->
    <Transition name="slide-up">
      <div
        v-if="cellEdit"
        class="fixed inset-x-0 bottom-0 z-50 bg-slate-900 border-t border-slate-700"
      >
        <!-- Drag handle -->
        <div class="flex justify-center pt-2.5 pb-1">
          <div class="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        <!-- Habit info row -->
        <div class="px-4 pb-2 flex items-center gap-2.5">
          <div
            class="w-7 h-7 rounded-full shrink-0 flex items-center justify-center"
            :style="{ backgroundColor: cellEdit.habit.color + '33' }"
          >
            <UIcon :name="cellEdit.habit.icon" class="w-4 h-4" :style="{ color: cellEdit.habit.color }" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-100 truncate">{{ cellEdit.habit.name }}</p>
            <p class="text-xs text-slate-400">
              {{ dayLabel(cellEdit.date) }}, {{ dayNum(cellEdit.date) }}
              · {{ cellEdit.habit.type === 'NUMERIC' ? `target ${cellEdit.habit.target_value}` : `limit ${cellEdit.habit.target_value}` }}
              <template v-if="settings.logInputMode === 'increment'">
                · now: {{ getLogSum(cellEdit.habit.id, cellEdit.date) }}
              </template>
            </p>
          </div>
          <button class="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" @click="cellEdit = null">
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>

        <!-- Input row -->
        <div class="px-4 pb-5 flex items-center gap-3">
          <input
            ref="cellInputRef"
            v-model.number="cellEdit.value"
            type="number"
            min="0"
            step="any"
            class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-xl font-semibold text-slate-100 text-center focus:outline-none focus:border-primary-500 transition-colors"
            @keydown.enter="saveCell"
            @keydown.escape="cellEdit = null"
          />
          <span class="text-sm text-slate-500 shrink-0 w-10">
            {{ settings.logInputMode === 'increment' ? 'add' : (cellEdit.habit.type === 'NUMERIC' ? 'total' : 'total') }}
          </span>
          <button
            class="w-12 h-12 rounded-xl bg-primary-500 flex items-center justify-center shrink-0 transition-opacity"
            :class="savingCell ? 'opacity-50' : ''"
            :disabled="savingCell"
            @click="saveCell"
          >
            <UIcon name="i-heroicons-check" class="w-5 h-5 text-white" />
          </button>
        </div>

        <!-- Safe-area spacer -->
        <div class="safe-area-bottom" />
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.22s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
