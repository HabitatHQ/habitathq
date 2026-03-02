<script setup lang="ts">
import type { HabitLog, HabitWithSchedule } from '~/types/database'

const db = useDatabase()

const today = new Date().toISOString().slice(0, 10)
const sevenDaysAgo = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return d.toISOString().slice(0, 10)
})()

const habits = ref<HabitWithSchedule[]>([])
const todayLogs = ref<HabitLog[]>([])
const weekLogs = ref<HabitLog[]>([])
const loading = ref(true)

async function load() {
  if (!db.isAvailable) {
    loading.value = false
    return
  }
  const [h, tl, wl] = await Promise.all([
    db.getHabits(),
    db.getHabitLogsForDate(today),
    db.getHabitLogsForDateRange(sevenDaysAgo, today),
  ])
  habits.value = h.filter((habit) => habit.tags.includes('habitat-health'))
  todayLogs.value = tl.filter((l) => habits.value.some((h) => h.id === l.habit_id))
  weekLogs.value = wl.filter((l) => habits.value.some((h) => h.id === l.habit_id))
  loading.value = false
}

async function refreshLogs() {
  if (!db.isAvailable) return
  const [tl, wl] = await Promise.all([
    db.getHabitLogsForDate(today),
    db.getHabitLogsForDateRange(sevenDaysAgo, today),
  ])
  todayLogs.value = tl.filter((l) => habits.value.some((h) => h.id === l.habit_id))
  weekLogs.value = wl.filter((l) => habits.value.some((h) => h.id === l.habit_id))
}

// ─── Habit slices ─────────────────────────────────────────────────────────────

const stepsHabit = computed(
  () => habits.value.find((h) => h.tags.includes('habitat-steps')) ?? null,
)

const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner']
const mealHabits = computed(() =>
  habits.value
    .filter((h) => h.tags.includes('habitat-meals'))
    .sort((a, b) => MEAL_ORDER.indexOf(a.name) - MEAL_ORDER.indexOf(b.name)),
)

const waterHabit = computed(
  () => habits.value.find((h) => h.tags.includes('habitat-water')) ?? null,
)

const sleepHabit = computed(
  () => habits.value.find((h) => h.tags.includes('habitat-sleep')) ?? null,
)

// ─── Steps ────────────────────────────────────────────────────────────────────

function logSumFor(habitId: string, logs: HabitLog[]): number {
  return logs.filter((l) => l.habit_id === habitId).reduce((s, l) => s + l.value, 0)
}

const stepsToday = computed(() =>
  stepsHabit.value ? logSumFor(stepsHabit.value.id, todayLogs.value) : 0,
)

// Odometer: 5 digits, each 0-9
const odometerDigits = computed(() =>
  String(Math.min(99999, Math.round(stepsToday.value)))
    .padStart(5, '0')
    .split('')
    .map(Number),
)

// Weekly steps bar chart (last 7 days)
const weeklySteps = computed(() => {
  if (!stepsHabit.value) return []
  const sid = stepsHabit.value.id
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    return {
      date,
      label: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
      steps: logSumFor(
        sid,
        weekLogs.value.filter((l) => l.date === date),
      ),
      isToday: date === today,
    }
  })
})

const stepsGoal = computed(() => stepsHabit.value?.target_value ?? 10000)
const maxWeeklySteps = computed(() =>
  Math.max(stepsGoal.value, ...weeklySteps.value.map((d) => d.steps)),
)

// Steps log state
const showStepsInput = ref(false)
const stepsInput = ref(0)
const savingSteps = ref(false)

function openStepsLog() {
  stepsInput.value = Math.round(stepsToday.value)
  showStepsInput.value = true
}

async function saveSteps() {
  if (!stepsHabit.value || !db.isAvailable) return
  savingSteps.value = true
  try {
    const existing = todayLogs.value.filter((l) => l.habit_id === stepsHabit.value!.id)
    await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
    if (stepsInput.value > 0) {
      await db.logHabitValue(stepsHabit.value.id, today, stepsInput.value)
    }
    await refreshLogs()
    showStepsInput.value = false
  } finally {
    savingSteps.value = false
  }
}

// ─── Water ────────────────────────────────────────────────────────────────────

const waterToday = computed(() =>
  waterHabit.value ? logSumFor(waterHabit.value.id, todayLogs.value) : 0,
)
const waterGoal = computed(() => waterHabit.value?.target_value ?? 8)
const savingWater = ref(false)

async function setWater(glasses: number) {
  if (!waterHabit.value || !db.isAvailable || savingWater.value) return
  savingWater.value = true
  try {
    const existing = todayLogs.value.filter((l) => l.habit_id === waterHabit.value!.id)
    await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
    if (glasses > 0) await db.logHabitValue(waterHabit.value.id, today, glasses)
    await refreshLogs()
  } finally {
    savingWater.value = false
  }
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

const sleepToday = computed(() =>
  sleepHabit.value ? logSumFor(sleepHabit.value.id, todayLogs.value) : 0,
)
const sleepGoal = computed(() => sleepHabit.value?.target_value ?? 8)
const showSleepInput = ref(false)
const sleepInput = ref(0)
const savingSleep = ref(false)

// Weekly sleep bar chart (last 7 days)
const weeklySleep = computed(() => {
  if (!sleepHabit.value) return []
  const sid = sleepHabit.value.id
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    return {
      date,
      label: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
      hours: logSumFor(sid, weekLogs.value.filter((l) => l.date === date)),
      isToday: date === today,
    }
  })
})

const maxWeeklySleep = computed(() =>
  Math.max(sleepGoal.value, ...weeklySleep.value.map((d) => d.hours)),
)

function openSleepLog() {
  sleepInput.value = sleepToday.value
  showSleepInput.value = true
}

async function saveSleep() {
  if (!sleepHabit.value || !db.isAvailable) return
  savingSleep.value = true
  try {
    const existing = todayLogs.value.filter((l) => l.habit_id === sleepHabit.value!.id)
    await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
    if (sleepInput.value > 0) await db.logHabitValue(sleepHabit.value.id, today, sleepInput.value)
    await refreshLogs()
    showSleepInput.value = false
  } finally {
    savingSleep.value = false
  }
}

// ─── Meals ────────────────────────────────────────────────────────────────────

const mealTotals = computed(() => {
  const map = new Map<string, number>()
  for (const l of todayLogs.value) map.set(l.habit_id, (map.get(l.habit_id) ?? 0) + l.value)
  return map
})

const totalCaloriesToday = computed(() =>
  mealHabits.value.reduce((s, h) => s + (mealTotals.value.get(h.id) ?? 0), 0),
)

// One meal editable at a time — avoids index-signature undefined issues
const mealEdit = ref<{ habitId: string; value: number } | null>(null)
const savingMeal = ref(false)

function openMealLog(habitId: string) {
  mealEdit.value = { habitId, value: mealTotals.value.get(habitId) ?? 0 }
}

function closeMealLog() {
  mealEdit.value = null
}

async function saveMeal(habit: HabitWithSchedule) {
  if (!db.isAvailable || !mealEdit.value) return
  savingMeal.value = true
  try {
    const existing = todayLogs.value.filter((l) => l.habit_id === habit.id)
    await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
    if (mealEdit.value.value > 0) await db.logHabitValue(habit.id, today, mealEdit.value.value)
    await refreshLogs()
    closeMealLog()
  } finally {
    savingMeal.value = false
  }
}

const MEAL_ICONS: Record<string, string> = {
  Breakfast: 'i-heroicons-sun',
  Lunch: 'i-heroicons-sparkles',
  Dinner: 'i-heroicons-moon',
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-slate-500">Wellness</p>
      <h2 class="text-2xl font-bold">Health</h2>
    </header>

    <!-- Empty state -->
    <div
      v-if="!loading && habits.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
        <UIcon name="i-heroicons-heart" class="w-8 h-8 text-rose-400" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-slate-200">No health habits yet</p>
        <p class="text-sm text-slate-500">Enable Health in Settings to set up step and meal tracking.</p>
      </div>
      <UButton to="/settings" variant="soft" color="neutral" size="sm">Open Settings</UButton>
    </div>

    <template v-else-if="!loading">

      <!-- ── Steps ────────────────────────────────────────────────────────────── -->
      <UCard v-if="stepsHabit" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-4' }">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-fire" class="w-4 h-4 text-rose-400" />
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Steps Today</p>
          </div>
          <UButton
            icon="i-heroicons-pencil-square"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="openStepsLog"
          />
        </div>

        <!-- Odometer -->
        <div class="flex flex-col items-center gap-3">
          <div class="flex items-center gap-1">
            <!-- Digit drums -->
            <div
              v-for="(digit, i) in odometerDigits"
              :key="i"
              class="w-11 h-16 overflow-hidden bg-slate-900 rounded-xl border border-slate-700/60 relative shadow-inner"
            >
              <!-- Rolling track: 10 digits stacked -->
              <div
                class="flex flex-col transition-transform duration-700 ease-out"
                :style="{ transform: `translateY(-${digit * 10}%)` }"
              >
                <div
                  v-for="n in 10"
                  :key="n"
                  class="w-11 h-16 flex items-center justify-center text-3xl font-mono font-bold text-slate-100 select-none"
                >{{ n - 1 }}</div>
              </div>
              <!-- Drum edge gradient -->
              <div class="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-transparent to-slate-900/80 pointer-events-none rounded-xl" />
              <!-- Center highlight line -->
              <div class="absolute inset-x-0 top-1/2 -translate-y-px h-px bg-slate-600/60 pointer-events-none" />
            </div>
          </div>

          <p class="text-xs text-slate-500 tracking-wide">
            / {{ stepsGoal.toLocaleString() }} steps goal
          </p>
        </div>

        <!-- Progress bar -->
        <div class="space-y-1.5">
          <div class="h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :class="stepsToday >= stepsGoal ? 'bg-emerald-500' : 'bg-rose-500'"
              :style="{ width: `${Math.min(100, (stepsToday / stepsGoal) * 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-[11px] text-slate-600">
            <span>{{ Math.round(stepsToday).toLocaleString() }} logged</span>
            <span v-if="stepsToday >= stepsGoal" class="text-emerald-400 font-medium">Goal reached!</span>
            <span v-else>{{ (stepsGoal - Math.round(stepsToday)).toLocaleString() }} to go</span>
          </div>
        </div>

        <!-- Weekly bar chart -->
        <div v-if="weeklySteps.some(d => d.steps > 0)" class="space-y-1.5">
          <p class="text-[11px] text-slate-600 uppercase tracking-wide">This week</p>
          <div class="flex items-end gap-1 h-14">
            <div
              v-for="day in weeklySteps"
              :key="day.date"
              class="flex-1 flex flex-col items-center gap-0.5"
            >
              <div class="w-full flex-1 flex items-end">
                <div
                  class="w-full rounded-t-sm transition-all duration-500"
                  :class="[
                    day.steps >= stepsGoal ? 'bg-emerald-500' : day.isToday ? 'bg-rose-500' : 'bg-slate-700',
                    day.steps === 0 ? 'opacity-0' : '',
                  ]"
                  :style="{ height: `${maxWeeklySteps > 0 ? Math.round((day.steps / maxWeeklySteps) * 100) : 0}%` }"
                />
              </div>
              <span class="text-[9px] text-slate-600" :class="day.isToday ? 'text-rose-400 font-medium' : ''">
                {{ day.label }}
              </span>
            </div>
          </div>
          <!-- Goal line annotation -->
          <div class="relative h-px">
            <div
              class="absolute right-0 left-0 border-t border-dashed border-slate-700"
              :style="{ bottom: `${maxWeeklySteps > 0 ? Math.round((stepsGoal / maxWeeklySteps) * 56) : 0}px` }"
            />
          </div>
        </div>

        <!-- Log inline input -->
        <div v-if="showStepsInput" class="flex items-center gap-2 pt-2 border-t border-slate-800">
          <UInput
            v-model.number="stepsInput"
            type="number"
            min="0"
            step="100"
            placeholder="Total steps today"
            class="flex-1"
            autofocus
          />
          <UButton size="sm" :loading="savingSteps" @click="saveSteps">Save</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="showStepsInput = false">
            <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
          </UButton>
        </div>
      </UCard>

      <!-- ── Water ────────────────────────────────────────────────────────────── -->
      <UCard v-if="waterHabit" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-beaker" class="w-4 h-4 text-sky-400" />
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Water Today</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500">
              <span class="font-semibold text-slate-300 tabular-nums">{{ Math.round(waterToday) }}</span>
              / {{ waterGoal }} glasses
            </span>
            <div class="flex items-center gap-1">
              <button
                class="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
                :disabled="savingWater || waterToday <= 0"
                @click="setWater(Math.max(0, Math.round(waterToday) - 1))"
              >
                <UIcon name="i-heroicons-minus" class="w-3.5 h-3.5" />
              </button>
              <button
                class="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-sky-400 disabled:opacity-30 transition-colors"
                :disabled="savingWater || waterToday >= waterGoal"
                @click="setWater(Math.round(waterToday) + 1)"
              >
                <UIcon name="i-heroicons-plus" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <!-- Glass dots — tap to set count -->
        <div class="flex gap-1.5 flex-wrap">
          <button
            v-for="i in waterGoal"
            :key="i"
            class="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-90"
            :class="i <= waterToday
              ? 'bg-sky-500/20 border border-sky-500/50 text-sky-400'
              : 'bg-slate-800 border border-slate-700 text-slate-700'"
            :disabled="savingWater"
            @click="setWater(i === Math.round(waterToday) ? i - 1 : i)"
          >
            <UIcon name="i-heroicons-beaker" class="w-4 h-4" />
          </button>
        </div>

        <!-- Progress bar -->
        <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="waterToday >= waterGoal ? 'bg-sky-400' : 'bg-sky-500'"
            :style="{ width: `${Math.min(100, (waterToday / waterGoal) * 100)}%` }"
          />
        </div>
      </UCard>

      <!-- ── Sleep ─────────────────────────────────────────────────────────────── -->
      <UCard v-if="sleepHabit" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-4' }">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-moon" class="w-4 h-4 text-indigo-400" />
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sleep Last Night</p>
          </div>
          <UButton
            icon="i-heroicons-pencil-square"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="openSleepLog"
          />
        </div>

        <!-- Hours display -->
        <div class="flex items-end gap-1.5">
          <span
            class="text-4xl font-bold tabular-nums leading-none"
            :class="sleepToday >= sleepGoal ? 'text-indigo-400' : sleepToday > 0 ? 'text-slate-100' : 'text-slate-700'"
          >{{ sleepToday > 0 ? sleepToday % 1 === 0 ? sleepToday : sleepToday.toFixed(1) : '—' }}</span>
          <span class="text-slate-500 text-sm mb-1">hrs / {{ sleepGoal }} goal</span>
        </div>

        <!-- Progress bar -->
        <div v-if="sleepToday > 0" class="space-y-1.5">
          <div class="h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-700"
              :class="sleepToday >= sleepGoal ? 'bg-indigo-400' : 'bg-indigo-500'"
              :style="{ width: `${Math.min(100, (sleepToday / sleepGoal) * 100)}%` }"
            />
          </div>
          <div class="flex justify-between text-[11px] text-slate-600">
            <span>{{ sleepToday >= sleepGoal ? 'Goal reached!' : `${(sleepGoal - sleepToday).toFixed(1)} hrs short` }}</span>
          </div>
        </div>

        <!-- Weekly bar chart -->
        <div v-if="weeklySleep.some(d => d.hours > 0)" class="space-y-1.5">
          <p class="text-[11px] text-slate-600 uppercase tracking-wide">This week</p>
          <div class="flex items-end gap-1 h-14">
            <div
              v-for="day in weeklySleep"
              :key="day.date"
              class="flex-1 flex flex-col items-center gap-0.5"
            >
              <div class="w-full flex-1 flex items-end">
                <div
                  class="w-full rounded-t-sm transition-all duration-500"
                  :class="[
                    day.hours >= sleepGoal ? 'bg-indigo-400' : day.isToday ? 'bg-indigo-500' : 'bg-slate-700',
                    day.hours === 0 ? 'opacity-0' : '',
                  ]"
                  :style="{ height: `${maxWeeklySleep > 0 ? Math.round((day.hours / maxWeeklySleep) * 100) : 0}%` }"
                />
              </div>
              <span class="text-[9px] text-slate-600" :class="day.isToday ? 'text-indigo-400 font-medium' : ''">
                {{ day.label }}
              </span>
            </div>
          </div>
        </div>

        <!-- Log inline input -->
        <div v-if="showSleepInput" class="flex items-center gap-2 pt-2 border-t border-slate-800">
          <UInput
            v-model.number="sleepInput"
            type="number"
            min="0"
            max="24"
            step="0.5"
            placeholder="Hours slept"
            class="flex-1"
            autofocus
          />
          <UButton size="sm" :loading="savingSleep" @click="saveSleep">Save</UButton>
          <UButton size="sm" variant="ghost" color="neutral" @click="showSleepInput = false">
            <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
          </UButton>
        </div>
      </UCard>

      <!-- ── Meals ─────────────────────────────────────────────────────────────── -->
      <UCard v-if="mealHabits.length" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-scale" class="w-4 h-4 text-amber-400" />
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Meals</p>
          </div>
          <p class="text-xs text-slate-500">
            <span class="font-semibold text-slate-300">{{ totalCaloriesToday.toLocaleString() }}</span>
            kcal today
          </p>
        </div>

        <div class="space-y-2">
          <div
            v-for="meal in mealHabits"
            :key="meal.id"
            class="rounded-xl border border-slate-800 overflow-hidden"
          >
            <!-- Meal row -->
            <div class="flex items-center justify-between px-3 py-3">
              <div class="flex items-center gap-2">
                <UIcon
                  :name="MEAL_ICONS[meal.name] ?? 'i-heroicons-beaker'"
                  class="w-4 h-4 text-slate-400"
                />
                <span class="text-sm font-medium">{{ meal.name }}</span>
              </div>
              <div class="flex items-center gap-3">
                <div class="text-right leading-tight">
                  <span
                    class="text-base font-semibold tabular-nums"
                    :class="(mealTotals.get(meal.id) ?? 0) >= meal.target_value ? 'text-amber-400' : 'text-slate-200'"
                  >{{ mealTotals.get(meal.id) ?? 0 }}</span>
                  <span class="text-xs text-slate-600"> / {{ meal.target_value }} kcal</span>
                </div>
                <button
                  class="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
                  @click="openMealLog(meal.id)"
                >
                  <UIcon name="i-heroicons-pencil" class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <!-- Calorie bar -->
            <div class="h-1 bg-slate-800/80">
              <div
                class="h-full transition-all duration-500"
                :class="(mealTotals.get(meal.id) ?? 0) >= meal.target_value ? 'bg-amber-400' : 'bg-emerald-500'"
                :style="{ width: `${Math.min(100, ((mealTotals.get(meal.id) ?? 0) / meal.target_value) * 100)}%` }"
              />
            </div>

            <!-- Inline log input -->
            <div
              v-if="mealEdit?.habitId === meal.id"
              class="flex items-center gap-2 px-3 py-2.5 border-t border-slate-800 bg-slate-900/50"
            >
              <UInput
                v-model.number="mealEdit.value"
                type="number"
                min="0"
                step="10"
                :placeholder="`${meal.name} calories`"
                class="flex-1"
                autofocus
              />
              <UButton size="sm" :loading="savingMeal" @click="saveMeal(meal)">Save</UButton>
              <UButton size="sm" variant="ghost" color="neutral" @click="closeMealLog">
                <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
              </UButton>
            </div>
          </div>
        </div>
      </UCard>

    </template>
  </div>
</template>
