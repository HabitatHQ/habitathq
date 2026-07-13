<script setup lang="ts">
import {
  computeStreak,
  isStruggling,
  type StreakInput,
  type StreakResult,
} from '~/lib/streak-engine'
import type { Completion, HabitLog, HabitWithSchedule, Reminder } from '~/types/database'

const route = useRoute()
const db = useDatabase()
const { impact, notification } = useHaptics()
const { settings } = useAppSettings()
const toast = useToast()

const habit = ref<HabitWithSchedule | null>(null)
const completions = ref<Completion[]>([])
const habitLogs = ref<HabitLog[]>([])
const reminders = ref<Reminder[]>([])
const loading = ref(true)
const notFound = ref(false)

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

async function load() {
  const id = route.params['id'] as string
  const to = new Date().toISOString().slice(0, 10)
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - 89)
  const from = fromDate.toISOString().slice(0, 10)

  const [habits, comps, logs, rems] = await Promise.all([
    db.getHabits(),
    db.getCompletionsForHabit(id, from, to),
    db.getHabitLogsForHabit(id, from, to),
    db.getRemindersForHabit(id),
  ])
  habit.value = habits.find((h) => h.id === id) ?? null
  if (!habit.value) {
    notFound.value = true
    loading.value = false
    return
  }
  completions.value = comps
  habitLogs.value = logs
  reminders.value = rems
  loading.value = false
}

// ─── Schedule label ───────────────────────────────────────────────────────────

const scheduleLabel = computed(() => {
  const sched = habit.value?.schedule
  if (!sched || sched.schedule_type === 'DAILY') return 'Daily'
  if (sched.schedule_type === 'WEEKLY_FLEX') return `${sched.frequency_count ?? 1}× per week`
  if (sched.schedule_type === 'SPECIFIC_DAYS') {
    return (sched.days_of_week ?? []).map((d) => DAY_NAMES[d]).join(' · ') || 'No days selected'
  }
  return 'Daily'
})

const todayStr = new Date().toISOString().slice(0, 10)

// ─── Daily Status (for Calendar and Stats) ────────────────────────────────────
type DayStatus = 'done' | 'partial' | 'failed' | 'none'

function resolveNumericStatus(sum: number, target: number): DayStatus | null {
  if (sum >= target) return 'done'
  if (sum > 0) return 'partial'
  return null
}

function resolveLimitStatus(sum: number, target: number): DayStatus | null {
  if (sum <= target && sum >= 0) return 'done'
  if (sum > target) return 'failed'
  return null
}

// Calculates status for every tracked day to standardize the 4-week calendar and stats.
const dailyStatus = computed(() => {
  const statusMap = new Map<string, DayStatus>()
  if (!habit.value) return statusMap

  const h = habit.value
  if (h.type === 'BOOLEAN') {
    completions.value.forEach((c) => {
      statusMap.set(c.date, 'done')
    })
    return statusMap
  }

  const sums = new Map<string, number>()
  habitLogs.value.forEach((log) => {
    sums.set(log.date, (sums.get(log.date) || 0) + log.value)
  })

  const resolve = h.type === 'NUMERIC' ? resolveNumericStatus : resolveLimitStatus
  for (const [date, sum] of sums) {
    const status = resolve(sum, h.target_value)
    if (status) statusMap.set(date, status)
  }
  return statusMap
})

// Used by boolean toggle directly
const completionDates = computed(() => new Set(completions.value.map((c) => c.date)))

// ─── Calendar (4 weeks ending this Saturday) ──────────────────────────────────
// Shows 28 days of history dynamically lit up based on the habit type rules above.
const calendarCells = computed(() => {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  sunday.setDate(sunday.getDate() - 3 * 7) // 4 weeks total

  return Array.from({ length: 28 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    const ds = d.toISOString().slice(0, 10)
    const status = dailyStatus.value.get(ds) || 'none'
    return {
      dateStr: ds,
      day: d.getDate(),
      status, // 'done', 'partial', 'failed', 'none'
      isToday: ds === todayStr,
      future: ds > todayStr,
    }
  })
})

// ─── Unified Stats ────────────────────────────────────────────────────────────

// Shared streak-engine input — drives both the streak and the struggling detector.
const streakInput = computed<StreakInput | null>(() => {
  const h = habit.value
  if (!h) return null
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
      completions: new Set(completions.value.map((c) => c.date)),
      today: todayStr,
    }
  }
  const sums = new Map<string, number>()
  for (const log of habitLogs.value) sums.set(log.date, (sums.get(log.date) ?? 0) + log.value)
  return { type: h.type, target: h.target_value, schedule, sums, today: todayStr }
})

// Schedule-aware streak with never-miss-twice grace.
const streak = computed<StreakResult>(() =>
  streakInput.value
    ? computeStreak(streakInput.value)
    : { current: 0, longest: 0, status: 'broken', saved: 0 },
)

const streakColor = computed(() => {
  const s = streak.value.status
  if (s === 'frozen') return '#7dd3fc'
  if (s === 'thawing') return '#38bdf8'
  return habit.value?.color ?? 'currentColor'
})

const streakCaption = computed(() => {
  const s = streak.value
  if (s.current === 0) return 'Start a streak'
  if (s.status === 'frozen') return 'Frozen ❄️ — complete 3 to thaw'
  if (s.status === 'thawing') return `Thawing — ${s.thawProgress}/3`
  const best = s.longest > s.current ? ` · best ${s.longest}` : ''
  return `day streak${best}`
})

const totalLogged = computed(() => {
  if (habit.value?.type === 'BOOLEAN') return completions.value.length
  return habitLogs.value.reduce((s, l) => s + l.value, 0)
})

const avgStat = computed(() => {
  if (habit.value?.type === 'BOOLEAN') {
    if (!completions.value.length) return { label: 'Avg / week', value: 0 }
    // Calculate average days completed per week since tracking started
    const firstLogStr = completions.value[0]?.date || habit.value.created_at.slice(0, 10)
    const daysTracked = Math.max(
      1,
      (new Date(todayStr).getTime() - new Date(firstLogStr).getTime()) / (1000 * 60 * 60 * 24),
    )
    const weeksTracked = Math.max(1, daysTracked / 7)
    const avg = Math.round((completions.value.length / weeksTracked) * 10) / 10
    return { label: 'Avg / week', value: `${avg} days` }
  } else {
    if (!habitLogs.value.length) return { label: 'Avg / day', value: 0 }
    const days = new Set(habitLogs.value.map((l) => l.date)).size
    const avg = Math.round((totalLogged.value / days) * 10) / 10
    return { label: 'Avg / day', value: avg }
  }
})

// ─── Log history ──────────────────────────────────────────────────────────────

const showAllLogs = ref(false)

const recentLog = computed(() => {
  const sorted = [...completions.value].sort((a, b) => b.completed_at.localeCompare(a.completed_at))
  return showAllLogs.value ? sorted : sorted.slice(0, 5)
})

const recentHabitLogs = computed(() => {
  const sorted = [...habitLogs.value].sort((a, b) => b.logged_at.localeCompare(a.logged_at))
  return showAllLogs.value ? sorted : sorted.slice(0, 10)
})

// ─── Delete habit log ─────────────────────────────────────────────────────────

const deletingLog = reactive(new Set<string>())

async function deleteLog(id: string) {
  if (deletingLog.has(id)) return
  deletingLog.add(id)
  try {
    await db.deleteHabitLog(id)
    void notification('warning')
    habitLogs.value = habitLogs.value.filter((l) => l.id !== id)
  } catch (err) {
    logError('[deleteLog]', err)
    toast.add({ title: 'Failed to delete log entry', color: 'error', duration: 4000 })
  } finally {
    deletingLog.delete(id)
  }
}

// Enable deletion of BOOLEAN completions from the history view
async function deleteCompletionRecord(date: string) {
  if (!habit.value || deletingLog.has(date)) return
  deletingLog.add(date)
  try {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 89)
    const from = fromDate.toISOString().slice(0, 10)
    await db.toggleCompletion(habit.value.id, date)
    completions.value = await db.getCompletionsForHabit(habit.value.id, from, todayStr)
    void notification('warning')
  } catch (err) {
    logError('[deleteCompletionRecord]', err)
    toast.add({ title: 'Failed to delete completion', color: 'error', duration: 4000 })
  } finally {
    deletingLog.delete(date)
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

const isEditing = ref(false)

function openEdit() {
  if (!habit.value) return
  isEditing.value = true
}

async function onHabitEdited(updated: HabitWithSchedule) {
  habit.value = updated
  await notification('success')
  toast.add({ title: 'Habit saved', color: 'success', duration: 2000 })
}

// ─── Pause / Resume ───────────────────────────────────────────────────────────

const showPauseModal = ref(false)
const pauseDate = ref('')
const pausing = ref(false)

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const tomorrowStr = tomorrow.toISOString().slice(0, 10)

const isPaused = computed(() => {
  const pu = habit.value?.paused_until
  return pu != null && pu >= todayStr
})

async function confirmPause() {
  if (!habit.value || !pauseDate.value) return
  pausing.value = true
  try {
    habit.value = await db.pauseHabit(habit.value.id, pauseDate.value)
    showPauseModal.value = false
    await notification('success')
  } finally {
    pausing.value = false
  }
}

async function resumeHabit() {
  if (!habit.value) return
  pausing.value = true
  try {
    habit.value = await db.pauseHabit(habit.value.id, null)
    await impact('medium')
  } finally {
    pausing.value = false
  }
}

// ─── Struggling-habit intervention ──────────────────────────────────────────────
// Low recent completion (<30% over the last 2 weeks) → resurface motivation + pause.
// Hidden once there's activity today, so a fresh win doesn't keep nagging.
const activeToday = computed(() => {
  const inp = streakInput.value
  if (!inp) return false
  return inp.completions ? inp.completions.has(todayStr) : (inp.sums?.get(todayStr) ?? 0) > 0
})

const struggling = computed(
  () =>
    !isPaused.value &&
    !activeToday.value &&
    streakInput.value != null &&
    isStruggling(streakInput.value),
)

async function pauseStruggling() {
  if (!habit.value) return
  const until = new Date()
  until.setDate(until.getDate() + 7)
  pausing.value = true
  try {
    habit.value = await db.pauseHabit(habit.value.id, until.toISOString().slice(0, 10))
    await notification('success')
  } finally {
    pausing.value = false
  }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

const showArchiveConfirm = ref(false)
const archiving = ref(false)

async function archiveHabit() {
  if (!habit.value) return
  archiving.value = true
  try {
    await db.archiveHabit(habit.value.id)
    await notification('success')
    toast.add({ title: 'Habit archived', color: 'neutral', duration: 2000 })
    await navigateTo('/habits')
  } finally {
    archiving.value = false
  }
}

// ─── Reminders ────────────────────────────────────────────────────────────────

const showAddReminder = ref(false)
const newReminderTime = ref('')
const newReminderDays = ref<number[]>([])
const savingReminder = ref(false)
const deletingReminder = reactive(new Set<string>())

function reminderDaysLabel(r: Reminder): string {
  if (!r.days_active || r.days_active.length === 0) return 'Every day'
  return r.days_active.map((d) => DAY_NAMES[d]).join(', ')
}

function toggleNewReminderDay(day: number) {
  const idx = newReminderDays.value.indexOf(day)
  if (idx >= 0) {
    newReminderDays.value.splice(idx, 1)
  } else {
    newReminderDays.value.push(day)
    newReminderDays.value.sort((a, b) => a - b)
  }
}

async function addReminder() {
  if (!habit.value || !newReminderTime.value) return
  savingReminder.value = true
  try {
    const r = await db.createReminder(
      habit.value.id,
      newReminderTime.value,
      newReminderDays.value.length ? [...newReminderDays.value] : null,
    )
    reminders.value.push(r)
    newReminderTime.value = ''
    newReminderDays.value = []
    showAddReminder.value = false
    useNotifications()
      .scheduleAll()
      .catch((e) => logError('[scheduleAll]', e))
  } finally {
    savingReminder.value = false
  }
}

async function removeReminder(id: string) {
  if (deletingReminder.has(id)) return
  deletingReminder.add(id)
  try {
    await db.deleteReminder(id)
    reminders.value = reminders.value.filter((r) => r.id !== id)
    useNotifications()
      .scheduleAll()
      .catch((e) => logError('[scheduleAll]', e))
  } finally {
    deletingReminder.delete(id)
  }
}

// ─── Log today ────────────────────────────────────────────────────────────────

const togglingToday = ref(false)
const todayCompleted = computed(
  () => habit.value?.type === 'BOOLEAN' && completionDates.value.has(todayStr),
)

async function toggleToday() {
  if (!habit.value || togglingToday.value) return
  togglingToday.value = true
  try {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 89)
    const from = fromDate.toISOString().slice(0, 10)
    await db.toggleCompletion(habit.value.id, todayStr)
    completions.value = await db.getCompletionsForHabit(habit.value.id, from, todayStr)
    await impact(todayCompleted.value ? 'light' : 'medium')
  } finally {
    togglingToday.value = false
  }
}

// NUMERIC/LIMIT log sheet
const logSheetOpen = ref(false)
const logSheetValue = ref(0)
const loggingToday = ref(false)

function openLogSheet() {
  const h = habit.value
  if (!h) return
  const todaySum = habitLogs.value
    .filter((l) => l.date === todayStr)
    .reduce((s, l) => s + l.value, 0)
  logSheetValue.value = suggestedLogValue({
    logs: habitLogs.value,
    habitId: h.id,
    isAbsolute: settings.value.logInputMode === 'absolute',
    todaySum,
    target: h.target_value,
  })
  logSheetOpen.value = true
}

async function submitLogSheet(value: number) {
  if (!habit.value || loggingToday.value) return
  const isAbsolute = settings.value.logInputMode === 'absolute'
  if (!isAbsolute && value <= 0) return
  loggingToday.value = true
  try {
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 89)
    const from = fromDate.toISOString().slice(0, 10)
    if (isAbsolute) {
      const existing = habitLogs.value.filter((l) => l.date === todayStr)
      await Promise.all(existing.map((l) => db.deleteHabitLog(l.id)))
      if (value > 0) await db.logHabitValue(habit.value.id, todayStr, value)
    } else {
      await db.logHabitValue(habit.value.id, todayStr, value)
    }
    habitLogs.value = await db.getHabitLogsForHabit(habit.value.id, from, todayStr)
    logSheetOpen.value = false
    await impact('medium')
  } finally {
    loggingToday.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="space-y-5">

    <!-- Back nav -->
    <BackNav to="/habits" label="Habits" />

    <!-- Not found -->
    <div v-if="notFound" class="text-center py-12 text-(--ui-text-dimmed) text-sm">
      Habit not found.
    </div>

    <template v-else-if="!loading && habit">
      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: habit.color + '33' }"
        >
          <AppIcon :name="habit.icon" :color="habit.color" class="w-6 h-6" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-bold truncate">{{ habit.name }}</h2>
          <p v-if="habit.description" class="text-sm text-(--ui-text-dimmed) truncate">{{ habit.description }}</p>
          <p v-if="habit.why" class="text-sm text-(--ui-text-dimmed) italic truncate">{{ habit.why }}</p>
        </div>
      </div>

      <!-- ── Sprout streak hero ──────────────────────────────────────────────── -->
      <div class="flex flex-col items-center gap-2 py-1">
        <SproutPlant
          :level="streak.plantLevel"
          :status="streak.status"
          :streak="streak.current"
          :color="habit.color"
          :size="92"
        />
        <div class="text-center leading-tight">
          <p class="text-3xl font-bold tabular-nums" :style="{ color: streakColor }">
            {{ streak.current }}
          </p>
          <p class="text-xs text-(--ui-text-dimmed) mt-0.5">{{ streakCaption }}</p>
          <p v-if="streak.thawed > 0" class="text-xs text-emerald-400 mt-1 font-medium">
            <AppIcon name="activity" class="w-3.5 h-3.5 inline-block -mt-0.5" />
            Thawed {{ streak.thawed }}×
          </p>
        </div>
        <DaisyShelf v-if="streak.daisies > 0" :count="streak.daisies" :color="habit.color" class="justify-center pt-1" />
      </div>

      <!-- ── Struggling-habit nudge ──────────────────────────────────────────── -->
      <StrugglingNudge
        v-if="struggling"
        :habit="habit"
        :pausing="pausing"
        @pause="pauseStruggling"
        @edit="openEdit"
      />

      <!-- ── Paused banner ───────────────────────────────────────────────────── -->
      <div
        v-if="isPaused"
        class="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
      >
        <AppIcon name="pause-circle" class="w-5 h-5 text-amber-400 flex-shrink-0" />
        <p class="text-sm text-amber-300 flex-1">
          Paused until {{ fmtArchived(habit.paused_until!) }}
        </p>
        <UButton size="xs" color="warning" variant="soft" :loading="pausing" @click="resumeHabit">
          Resume
        </UButton>
      </div>

      <!-- ── Stats cards ─────────────────────────────────────────────────────── -->
      <!-- Unified 4-stat grid for all habit types -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Best streak" :value="`${streak.longest} days`" />
        <StatCard :label="habit.type === 'BOOLEAN' ? 'Total completed' : 'Total logged'" :value="totalLogged.toFixed(totalLogged % 1 === 0 ? 0 : 1)" />
        <StatCard :label="avgStat.label" :value="avgStat.value" />
        <StatCard label="Tracked since" :value="fmtArchived(habit.created_at)" />
      </div>

      <!-- ── Log today ──────────────────────────────────────────────────────── -->
      <template v-if="!isPaused">
        <UButton
          v-if="habit.type === 'BOOLEAN'"
          :variant="todayCompleted ? 'soft' : 'soft'"
          :color="todayCompleted ? 'success' : 'primary'"
          :icon="resolveIcon(todayCompleted ? 'check-circle' : 'plus-circle')"
          :loading="togglingToday"
          class="w-full justify-center"
          @click="toggleToday"
        >
          {{ todayCompleted ? 'Completed today' : 'Log today' }}
        </UButton>
        <UButton
          v-else
          variant="soft"
          :color="dailyStatus.get(todayStr) === 'done' ? 'success' : 'primary'"
          :icon="resolveIcon(dailyStatus.get(todayStr) === 'done' ? 'check-circle' : 'plus-circle')"
          class="w-full justify-center"
          @click="openLogSheet"
        >
          Log today
        </UButton>
      </template>

      <!-- ── Schedule card ───────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4' }">
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <p class="text-xs font-semibold text-(--ui-text-muted)">Schedule</p>
            <p class="text-sm text-(--ui-text)">{{ scheduleLabel }}</p>
            <p v-if="habit.schedule?.due_time" class="text-xs text-(--ui-text-dimmed)">
              Due at {{ habit.schedule.due_time }}
            </p>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" @click="openEdit">Edit</UButton>
        </div>
      </UCard>

      <!-- ── Reminders ───────────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
        <div class="px-4 pt-3.5 pb-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-(--ui-text-muted)">Reminders</p>
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="resolveIcon(showAddReminder ? 'chevron-up' : 'plus')"
            @click="showAddReminder = !showAddReminder"
          />
        </div>

        <!-- Existing reminders -->
        <div
          v-for="r in reminders"
          :key="r.id"
          class="flex items-center justify-between px-4 py-2.5"
        >
          <div>
            <p class="text-sm font-medium text-(--ui-text)">{{ r.trigger_time }}</p>
            <p class="text-[11px] text-(--ui-text-dimmed)">{{ reminderDaysLabel(r) }}</p>
          </div>
          <button
            class="p-2 -m-2 text-slate-700 hover:text-red-400 transition-colors"
            :disabled="deletingReminder.has(r.id)"
            @click="removeReminder(r.id)"
          >
            <AppIcon name="trash" class="w-4 h-4" />
          </button>
        </div>

        <div v-if="reminders.length === 0 && !showAddReminder" class="px-4 py-3 text-xs text-slate-600">
          No reminders set.
        </div>

        <!-- Add reminder form -->
        <div v-if="showAddReminder" class="px-4 py-3 space-y-3">
          <div class="flex items-center gap-3">
            <AppTextField v-model="newReminderTime" type="time" class="w-32" />
            <span class="text-xs text-(--ui-text-dimmed)">Remind me at this time</span>
          </div>

          <!-- Day selector (empty = every day) -->
          <div class="space-y-1">
            <p class="text-[11px] text-(--ui-text-dimmed)">Days (leave blank for every day)</p>
            <div class="flex gap-1.5">
              <button
                v-for="(label, i) in DAY_LABELS"
                :key="i"
                class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
                :class="newReminderDays.includes(i)
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented)'"
                @click="toggleNewReminderDay(i)"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <UButton size="xs" variant="ghost" color="neutral" @click="showAddReminder = false">Cancel</UButton>
            <UButton
              size="xs"
              :disabled="!newReminderTime || savingReminder"
              :loading="savingReminder"
              @click="addReminder"
            >
              Add
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- ── 4-week calendar (All types) ─────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-2' }">
        <p class="text-xs font-semibold text-(--ui-text-muted) mb-3">Activity</p>
        <div class="grid grid-cols-7 gap-1 mb-1">
          <div
            v-for="d in ['S','M','T','W','T','F','S']"
            :key="d"
            class="text-center text-[10px] text-slate-600 font-medium"
          >{{ d }}</div>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <div
            v-for="cell in calendarCells"
            :key="cell.dateStr"
            class="aspect-square flex items-center justify-center"
          >
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium transition-colors"
              :class="{
                'text-white': cell.status === 'done',
                'ring-1 ring-inset ring-primary-500 text-primary-400': cell.status === 'none' && cell.isToday,
                'text-slate-700': cell.status === 'none' && !cell.isToday && !cell.future,
                'text-(--ui-border-accented)': cell.status === 'none' && cell.future,
              }"
              :style="
                cell.status === 'done' ? { backgroundColor: habit.color } 
                : cell.status === 'partial' ? { backgroundColor: habit.color + '40', color: habit.color }
                : cell.status === 'failed' ? { backgroundColor: '#ef444440', color: '#ef4444' }
                : {}
              "
            >
              {{ cell.day }}
            </div>
          </div>
        </div>
      </UCard>

      <!-- ── Pause section ───────────────────────────────────────────────────── -->
      <UCard v-if="!isPaused" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4' }">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-(--ui-text-toned)">Pause habit</p>
            <p class="text-xs text-(--ui-text-dimmed)">Hide from today screen until a date</p>
          </div>
          <UButton size="xs" variant="soft" color="neutral" @click="showPauseModal = true">
            Pause
          </UButton>
        </div>
      </UCard>

      <!-- ── Log history ─────────────────────────────────────────────────────── -->

      <!-- Unified Log History -->
      <UCard
        v-if="habit.type === 'BOOLEAN' ? recentLog.length : recentHabitLogs.length"
        :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }"
      >
        <div class="px-4 pt-3 pb-2 flex items-center justify-between">
          <p class="text-xs font-semibold text-(--ui-text-muted)">Log History</p>
          <button
            v-if="!showAllLogs && (habit.type === 'BOOLEAN' ? completions.length > 5 : habitLogs.length > 10)"
            class="text-xs text-primary-400 hover:text-primary-300 transition-colors"
            @click="showAllLogs = true"
          >
            View all ({{ habit.type === 'BOOLEAN' ? completions.length : habitLogs.length }})
          </button>
        </div>

        <!-- BOOLEAN completions -->
        <template v-if="habit.type === 'BOOLEAN'">
          <div
            v-for="entry in recentLog"
            :key="entry.id"
            class="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p class="text-sm text-(--ui-text-toned)">{{ fmtLogDate(entry.completed_at) }}</p>
              <p class="text-xs text-slate-600">{{ fmtLogTime(entry.completed_at) }} — Completed</p>
            </div>
            <button
              class="p-2 -m-2 text-slate-700 hover:text-red-400 transition-colors"
              :disabled="deletingLog.has(entry.date)"
              @click="deleteCompletionRecord(entry.date)"
            >
              <AppIcon name="trash" class="w-4 h-4" />
            </button>
          </div>
        </template>

        <!-- NUMERIC / LIMIT log entries -->
        <template v-else>
          <div
            v-for="entry in recentHabitLogs"
            :key="entry.id"
            class="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p class="text-sm text-(--ui-text-toned)">{{ fmtLogDate(entry.logged_at) }}</p>
              <p class="text-xs text-slate-600">{{ fmtLogTime(entry.logged_at) }}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium text-(--ui-text)">{{ entry.value }}</span>
              <button
                class="p-2 -m-2 text-slate-700 hover:text-red-400 transition-colors"
                :disabled="deletingLog.has(entry.id)"
                @click="deleteLog(entry.id)"
              >
                <AppIcon name="trash" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </template>
      </UCard>

      <!-- ── Actions ────────────────────────────────────────────────────────── -->
      <div class="flex gap-3 pt-1">
        <UButton variant="outline" color="neutral" class="flex-1 justify-center" @click="openEdit">
          Edit Habit
        </UButton>
        <UButton variant="soft" color="error" class="flex-1 justify-center" @click="showArchiveConfirm = true">
          Archive
        </UButton>
      </div>
    </template>

    <!-- ── Edit modal ─────────────────────────────────────────────────────────── -->
    <HabitFormModal v-model="isEditing" mode="edit" :habit="habit" @saved="onHabitEdited" />

    <!-- ── Pause modal ────────────────────────────────────────────────────────── -->
    <UModal v-model:open="showPauseModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <AppIcon name="pause-circle" class="w-5 h-5 text-amber-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Pause "{{ habit?.name }}"</p>
              <p class="text-sm text-(--ui-text-muted)">Choose when to resume. The habit will be hidden until then.</p>
            </div>
          </div>
          <UFormField label="Resume on">
            <AppTextField
              v-model="pauseDate"
              type="date"
              :min="tomorrowStr"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="showPauseModal = false">Cancel</UButton>
            <UButton color="warning" :disabled="!pauseDate" :loading="pausing" @click="confirmPause">
              Pause
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Archive confirm ─────────────────────────────────────────────────────── -->
    <ConfirmDialog
      :open="showArchiveConfirm"
      icon="archive-box"
      icon-color="amber"
      :title="`Archive &quot;${habit?.name}&quot;?`"
      message="The habit and all its history will be preserved in your archive."
      confirm-label="Archive"
      confirm-color="warning"
      @confirm="archiveHabit"
      @cancel="showArchiveConfirm = false"
      @update:open="(v) => (showArchiveConfirm = v)"
    />

    <!-- ── Log sheet for NUMERIC / LIMIT habits ──────────────────────────────── -->
    <LogSheet
      v-if="habit && habit.type !== 'BOOLEAN'"
      :open="logSheetOpen"
      :title="habit.name"
      :icon="habit.icon"
      :icon-color="habit.color"
      :current="logSheetValue"
      :target="habit.target_value"
      :min="0"
      :max="Math.max(habit.target_value * 2, 50)"
      :step="habit.target_value <= 10 ? 1
        : habit.target_value <= 50 ? 5
        : habit.target_value <= 500 ? 10
        : habit.target_value <= 5000 ? 100
        : 500"
      :unit="''"
      :accent="habit.type === 'LIMIT' ? 'amber' : 'primary'"
      :loading="loggingToday"
      @save="submitLogSheet"
      @close="logSheetOpen = false"
    />

  </div>
</template>
