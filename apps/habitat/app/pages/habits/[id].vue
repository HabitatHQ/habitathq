<script setup lang="ts">
import type { HabitWithSchedule, Completion, HabitLog, Reminder } from '~/types/database'

const route = useRoute()
const db = useDatabase()
const { impact, notification } = useHaptics()

const habit = ref<HabitWithSchedule | null>(null)
const completions = ref<Completion[]>([])
const habitLogs = ref<HabitLog[]>([])
const reminders = ref<Reminder[]>([])
const loading = ref(true)
const notFound = ref(false)

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

async function load() {
  if (!db.isAvailable) { loading.value = false; return }
  const id = route.params['id'] as string
  const to = new Date().toISOString().slice(0, 10)
  const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 89)
  const from = fromDate.toISOString().slice(0, 10)

  const [habits, comps, logs, rems] = await Promise.all([
    db.getHabits(),
    db.getCompletionsForHabit(id, from, to),
    db.getHabitLogsForHabit(id, from, to),
    db.getRemindersForHabit(id),
  ])
  habit.value = habits.find(h => h.id === id) ?? null
  if (!habit.value) { notFound.value = true; loading.value = false; return }
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
    return (sched.days_of_week ?? []).map(d => DAY_NAMES[d]).join(' · ') || 'No days selected'
  }
  return 'Daily'
})

// ─── Calendar (6 weeks ending this Saturday) ──────────────────────────────────

const completionDates = computed(() => new Set(completions.value.map(c => c.date)))
const todayStr = new Date().toISOString().slice(0, 10)

const calendarCells = computed(() => {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  sunday.setDate(sunday.getDate() - 5 * 7)

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    const ds = d.toISOString().slice(0, 10)
    return {
      dateStr: ds,
      day: d.getDate(),
      done: completionDates.value.has(ds),
      isToday: ds === todayStr,
      future: ds > todayStr,
    }
  })
})

// ─── Streak (BOOLEAN only) ────────────────────────────────────────────────────

const currentStreak = computed(() => {
  let streak = 0
  const d = new Date()
  while (completionDates.value.has(d.toISOString().slice(0, 10))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
})

// ─── Numeric stats ────────────────────────────────────────────────────────────

const totalLogged = computed(() => habitLogs.value.reduce((s, l) => s + l.value, 0))
const avgDailyValue = computed(() => {
  if (!habitLogs.value.length) return 0
  const days = new Set(habitLogs.value.map(l => l.date)).size
  return Math.round((totalLogged.value / days) * 10) / 10
})

// ─── Log history ──────────────────────────────────────────────────────────────

const recentLog = computed(() =>
  [...completions.value]
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    .slice(0, 5)
)

const recentHabitLogs = computed(() =>
  [...habitLogs.value]
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
    .slice(0, 10)
)

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtArchived(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Delete habit log ─────────────────────────────────────────────────────────

const deletingLog = reactive(new Set<string>())

async function deleteLog(id: string) {
  if (deletingLog.has(id)) return
  deletingLog.add(id)
  try {
    await db.deleteHabitLog(id)
    habitLogs.value = habitLogs.value.filter(l => l.id !== id)
  } finally {
    deletingLog.delete(id)
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

const isEditing = ref(false)
const editScheduleError = ref<string | null>(null)

// Clear error when the modal closes (cancel or after save)
watch(isEditing, (open) => { if (!open) editScheduleError.value = null })

const editForm = reactive({
  name: '',
  description: '',
  type: 'BOOLEAN' as 'BOOLEAN' | 'NUMERIC' | 'LIMIT',
  target_value: 1,
  schedule_type: 'DAILY' as 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS',
  frequency_count: 3,
  days_of_week: [] as number[],
  tags: [] as string[],
  show_due_time: false,
  due_time: '',
})
const saving = ref(false)

const editTagInput = ref('')
const editAnnotationEntries = ref<{ key: string; value: string }[]>([])
const editShowAnnotations = ref(false)

function addEditTag() {
  const tag = editTagInput.value.replace(/,$/, '').trim()
  if (tag && !tag.startsWith('habitat-') && !editForm.tags.includes(tag)) editForm.tags.push(tag)
  editTagInput.value = ''
}
function removeEditTag(tag: string) {
  const idx = editForm.tags.indexOf(tag)
  if (idx >= 0) editForm.tags.splice(idx, 1)
}
function onEditTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEditTag() }
}
function addEditAnnotationEntry() { editAnnotationEntries.value.push({ key: '', value: '' }) }
function removeEditAnnotationEntry(i: number) { editAnnotationEntries.value.splice(i, 1) }

function validateEditSchedule(): string | null {
  if (editForm.type === 'NUMERIC') {
    if (editForm.schedule_type === 'SPECIFIC_DAYS') return 'Metric habits can only be daily or 1× per week.'
    if (editForm.schedule_type === 'WEEKLY_FLEX' && editForm.frequency_count > 1) return 'Metric habits can only be daily or 1× per week.'
  }
  if (editForm.type === 'LIMIT' && editForm.schedule_type !== 'DAILY') return 'Limit habits must be daily.'
  return null
}

watch([() => editForm.type, () => editForm.schedule_type, () => editForm.frequency_count], () => {
  editScheduleError.value = null
})

function toggleEditDay(day: number) {
  const idx = editForm.days_of_week.indexOf(day)
  if (idx >= 0) {
    editForm.days_of_week.splice(idx, 1)
  } else {
    editForm.days_of_week.push(day)
    editForm.days_of_week.sort((a, b) => a - b)
  }
}

function openEdit() {
  if (!habit.value) return
  const sched = habit.value.schedule
  editForm.name = habit.value.name
  editForm.description = habit.value.description
  editForm.type = habit.value.type
  editForm.target_value = habit.value.target_value
  editForm.schedule_type = sched?.schedule_type ?? 'DAILY'
  editForm.frequency_count = sched?.frequency_count ?? 3
  editForm.days_of_week = sched?.days_of_week ? [...sched.days_of_week] : []
  editForm.tags = [...habit.value.tags]
  editForm.show_due_time = !!sched?.due_time
  editForm.due_time = sched?.due_time ?? ''
  editTagInput.value = ''
  editAnnotationEntries.value = Object.entries(habit.value.annotations).map(([key, value]) => ({ key, value }))
  editShowAnnotations.value = editAnnotationEntries.value.length > 0
  isEditing.value = true
}

async function saveEdit() {
  if (!habit.value || !editForm.name.trim()) return
  const err = validateEditSchedule()
  if (err) { editScheduleError.value = err; return }
  editScheduleError.value = null
  saving.value = true
  try {
    const editAnnotations: Record<string, string> = {}
    for (const { key, value } of editAnnotationEntries.value) {
      if (key.trim()) editAnnotations[key.trim()] = value
    }
    const updated = await db.updateHabit({
      id: habit.value.id,
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      type: editForm.type,
      target_value: editForm.target_value,
      tags: [...editForm.tags],
      annotations: editAnnotations,
    })
    const sched = updated.schedule
    if (sched) {
      const newSchedule = await db.updateHabitSchedule({
        id: sched.id,
        schedule_type: editForm.schedule_type,
        frequency_count: editForm.schedule_type === 'WEEKLY_FLEX' ? editForm.frequency_count : null,
        days_of_week: editForm.schedule_type === 'SPECIFIC_DAYS' ? [...editForm.days_of_week] : null,
        due_time: editForm.show_due_time && editForm.due_time ? editForm.due_time : null,
      })
      habit.value = { ...updated, schedule: newSchedule }
    } else {
      habit.value = updated
    }
    isEditing.value = false
    await notification('success')
  } finally {
    saving.value = false
  }
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

// ─── Archive ──────────────────────────────────────────────────────────────────

const showArchiveConfirm = ref(false)
const archiving = ref(false)

async function archiveHabit() {
  if (!habit.value) return
  archiving.value = true
  try {
    await db.archiveHabit(habit.value.id)
    await notification('success')
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
  return r.days_active.map(d => DAY_NAMES[d]).join(', ')
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
  } finally {
    savingReminder.value = false
  }
}

async function removeReminder(id: string) {
  if (deletingReminder.has(id)) return
  deletingReminder.add(id)
  try {
    await db.deleteReminder(id)
    reminders.value = reminders.value.filter(r => r.id !== id)
  } finally {
    deletingReminder.delete(id)
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">

    <!-- Back nav -->
    <div class="flex items-center gap-2 -mb-1">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
        to="/habits"
      />
      <span class="text-sm text-slate-500">Habits</span>
    </div>

    <!-- Not found -->
    <div v-if="notFound" class="text-center py-12 text-slate-500 text-sm">
      Habit not found.
    </div>

    <template v-else-if="!loading && habit">
      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="flex items-center gap-3">
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: habit.color + '33' }"
        >
          <UIcon :name="habit.icon" class="w-6 h-6" :style="{ color: habit.color }" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-bold truncate">{{ habit.name }}</h2>
          <p v-if="habit.description" class="text-sm text-slate-500 truncate">{{ habit.description }}</p>
        </div>
      </div>

      <!-- ── Paused banner ───────────────────────────────────────────────────── -->
      <div
        v-if="isPaused"
        class="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
      >
        <UIcon name="i-heroicons-pause-circle" class="w-5 h-5 text-amber-400 flex-shrink-0" />
        <p class="text-sm text-amber-300 flex-1">
          Paused until {{ fmtArchived(habit.paused_until!) }}
        </p>
        <UButton size="xs" color="warning" variant="soft" :loading="pausing" @click="resumeHabit">
          Resume
        </UButton>
      </div>

      <!-- ── Stats cards ─────────────────────────────────────────────────────── -->
      <div class="flex gap-3">
        <!-- BOOLEAN: streak -->
        <template v-if="habit.type === 'BOOLEAN'">
          <UCard :ui="{ root: 'rounded-2xl flex-1', body: 'p-3 sm:p-3 space-y-0.5' }">
            <p class="text-[11px] text-slate-500">Current streak</p>
            <p class="text-2xl font-bold text-slate-100">{{ currentStreak }} <span class="text-sm font-normal text-slate-500">days</span></p>
          </UCard>
        </template>
        <!-- NUMERIC / LIMIT: total + avg -->
        <template v-else>
          <UCard :ui="{ root: 'rounded-2xl flex-1', body: 'p-3 sm:p-3 space-y-0.5' }">
            <p class="text-[11px] text-slate-500">Total logged</p>
            <p class="text-2xl font-bold text-slate-100">{{ totalLogged.toFixed(totalLogged % 1 === 0 ? 0 : 1) }}</p>
          </UCard>
          <UCard :ui="{ root: 'rounded-2xl flex-1', body: 'p-3 sm:p-3 space-y-0.5' }">
            <p class="text-[11px] text-slate-500">Avg / day</p>
            <p class="text-2xl font-bold text-slate-100">{{ avgDailyValue }}</p>
          </UCard>
        </template>
        <UCard :ui="{ root: 'rounded-2xl flex-1', body: 'p-3 sm:p-3 space-y-0.5' }">
          <p class="text-[11px] text-slate-500">Tracked since</p>
          <p class="text-sm font-medium text-slate-300 pt-1">{{ fmtArchived(habit.created_at) }}</p>
        </UCard>
      </div>

      <!-- ── Schedule card ───────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4' }">
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <p class="text-xs font-semibold text-slate-400">Schedule</p>
            <p class="text-sm text-slate-200">{{ scheduleLabel }}</p>
            <p v-if="habit.schedule?.due_time" class="text-xs text-slate-500">
              Due at {{ habit.schedule.due_time }}
            </p>
          </div>
          <UButton size="xs" variant="ghost" color="neutral" @click="openEdit">Edit</UButton>
        </div>
      </UCard>

      <!-- ── Reminders ───────────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">
        <div class="px-4 pt-3.5 pb-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-slate-400">Reminders</p>
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="showAddReminder ? 'i-heroicons-chevron-up' : 'i-heroicons-plus'"
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
            <p class="text-sm font-medium text-slate-200">{{ r.trigger_time }}</p>
            <p class="text-[11px] text-slate-500">{{ reminderDaysLabel(r) }}</p>
          </div>
          <button
            class="p-2 -m-2 text-slate-700 hover:text-red-400 transition-colors"
            :disabled="deletingReminder.has(r.id)"
            @click="removeReminder(r.id)"
          >
            <UIcon name="i-heroicons-trash" class="w-4 h-4" />
          </button>
        </div>

        <div v-if="reminders.length === 0 && !showAddReminder" class="px-4 py-3 text-xs text-slate-600">
          No reminders set.
        </div>

        <!-- Add reminder form -->
        <div v-if="showAddReminder" class="px-4 py-3 space-y-3">
          <div class="flex items-center gap-3">
            <UInput v-model="newReminderTime" type="time" class="w-32" />
            <span class="text-xs text-slate-500">Remind me at this time</span>
          </div>

          <!-- Day selector (empty = every day) -->
          <div class="space-y-1">
            <p class="text-[11px] text-slate-500">Days (leave blank for every day)</p>
            <div class="flex gap-1.5">
              <button
                v-for="(label, i) in DAY_LABELS"
                :key="i"
                class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
                :class="newReminderDays.includes(i)
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600'"
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

      <!-- ── 6-week calendar (BOOLEAN only) ─────────────────────────────────── -->
      <UCard v-if="habit.type === 'BOOLEAN'" :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-2' }">
        <p class="text-xs font-semibold text-slate-400 mb-3">Activity</p>
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
                'text-white': cell.done,
                'ring-1 ring-inset ring-primary-500 text-primary-400': cell.isToday && !cell.done,
                'text-slate-700': !cell.done && !cell.isToday && !cell.future,
                'text-slate-800': cell.future,
              }"
              :style="cell.done ? { backgroundColor: habit.color } : {}"
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
            <p class="text-sm font-medium text-slate-300">Pause habit</p>
            <p class="text-xs text-slate-500">Hide from today screen until a date</p>
          </div>
          <UButton size="xs" variant="soft" color="neutral" @click="showPauseModal = true">
            Pause
          </UButton>
        </div>
      </UCard>

      <!-- ── Log history ─────────────────────────────────────────────────────── -->

      <!-- BOOLEAN completions -->
      <UCard
        v-if="habit.type === 'BOOLEAN' && recentLog.length"
        :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }"
      >
        <div class="px-4 pt-3 pb-2">
          <p class="text-xs font-semibold text-slate-400">Log History</p>
        </div>
        <div
          v-for="entry in recentLog"
          :key="entry.id"
          class="flex items-center justify-between px-4 py-3"
        >
          <p class="text-sm text-slate-300">{{ fmtDate(entry.completed_at) }}</p>
          <p class="text-xs text-slate-600">{{ fmtTime(entry.completed_at) }} — Completed</p>
        </div>
      </UCard>

      <!-- NUMERIC / LIMIT log entries -->
      <UCard
        v-if="habit.type !== 'BOOLEAN' && recentHabitLogs.length"
        :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }"
      >
        <div class="px-4 pt-3 pb-2">
          <p class="text-xs font-semibold text-slate-400">Log History</p>
        </div>
        <div
          v-for="entry in recentHabitLogs"
          :key="entry.id"
          class="flex items-center justify-between px-4 py-3"
        >
          <div>
            <p class="text-sm text-slate-300">{{ fmtDate(entry.logged_at) }}</p>
            <p class="text-xs text-slate-600">{{ fmtTime(entry.logged_at) }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium text-slate-200">{{ entry.value }}</span>
            <button
              class="p-2 -m-2 text-slate-700 hover:text-red-400 transition-colors"
              :disabled="deletingLog.has(entry.id)"
              @click="deleteLog(entry.id)"
            >
              <UIcon name="i-heroicons-trash" class="w-4 h-4" />
            </button>
          </div>
        </div>
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
    <UModal v-model:open="isEditing">
      <template #content>
        <div class="p-4 space-y-4">
          <h3 class="text-lg font-semibold">Edit Habit</h3>

          <UFormField label="Name" required>
            <UInput v-model="editForm.name" autofocus />
          </UFormField>

          <UFormField label="Description">
            <UInput v-model="editForm.description" placeholder="Optional description" />
          </UFormField>

          <!-- Tags -->
          <UFormField label="Tags">
            <div class="space-y-2">
              <div v-if="editForm.tags.length" class="flex flex-wrap gap-1">
                <span
                  v-for="tag in editForm.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300"
                >
                  {{ tag }}
                  <button class="text-slate-500 hover:text-white leading-none" @click="removeEditTag(tag)">×</button>
                </span>
              </div>
              <UInput v-model="editTagInput" placeholder="Add tag, press Enter" @keydown="onEditTagKeydown" />
            </div>
          </UFormField>

          <!-- Type selector -->
          <UFormField label="Type">
            <div class="flex gap-2">
              <button
                v-for="t in (['BOOLEAN', 'NUMERIC', 'LIMIT'] as const)"
                :key="t"
                class="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors"
                :class="editForm.type === t
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                @click="editForm.type = t"
              >
                {{ t === 'BOOLEAN' ? '✓ Done' : t === 'NUMERIC' ? '# Metric' : '↓ Limit' }}
              </button>
            </div>
          </UFormField>

          <!-- Target (NUMERIC / LIMIT only) -->
          <UFormField v-if="editForm.type !== 'BOOLEAN'" :label="editForm.type === 'NUMERIC' ? 'Target' : 'Limit'">
            <div class="flex items-center gap-2">
              <UInput
                v-model.number="editForm.target_value"
                type="number"
                min="0.1"
                step="any"
                class="w-28"
              />
              <span class="text-sm text-slate-500">per day</span>
            </div>
          </UFormField>

          <!-- Schedule -->
          <UFormField label="Schedule">
            <div class="flex gap-2 mb-2">
              <button
                v-for="s in (['DAILY', 'WEEKLY_FLEX', 'SPECIFIC_DAYS'] as const)"
                :key="s"
                class="flex-1 py-1.5 px-1 rounded-lg text-xs font-medium border transition-colors"
                :class="editForm.schedule_type === s
                  ? 'bg-slate-700 border-slate-500 text-slate-100'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                @click="editForm.schedule_type = s"
              >
                {{ s === 'DAILY' ? 'Daily' : s === 'WEEKLY_FLEX' ? 'N× week' : 'Specific days' }}
              </button>
            </div>

            <div v-if="editForm.schedule_type === 'WEEKLY_FLEX'" class="flex items-center gap-2">
              <span class="text-sm text-slate-400">Times per week:</span>
              <div class="flex items-center gap-1">
                <button
                  class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                  @click="editForm.frequency_count = Math.max(1, editForm.frequency_count - 1)"
                >−</button>
                <span class="w-5 text-center text-sm font-medium">{{ editForm.frequency_count }}</span>
                <button
                  class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                  @click="editForm.frequency_count = Math.min(7, editForm.frequency_count + 1)"
                >+</button>
              </div>
            </div>

            <div v-if="editForm.schedule_type === 'SPECIFIC_DAYS'" class="flex gap-1.5">
              <button
                v-for="(label, i) in DAY_LABELS"
                :key="i"
                class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
                :class="editForm.days_of_week.includes(i)
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600'"
                @click="toggleEditDay(i)"
              >
                {{ label }}
              </button>
            </div>
          </UFormField>

          <!-- Due time -->
          <div>
            <button
              class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1"
              @click="editForm.show_due_time = !editForm.show_due_time"
            >
              <UIcon :name="editForm.show_due_time ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5" />
              {{ editForm.show_due_time ? 'Remove due time' : 'Add due time' }}
            </button>
            <div v-if="editForm.show_due_time" class="mt-2">
              <UInput v-model="editForm.due_time" type="time" class="w-32" />
            </div>
          </div>

          <!-- Annotations (collapsible) -->
          <div>
            <button
              class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1"
              @click="editShowAnnotations = !editShowAnnotations"
            >
              <UIcon :name="editShowAnnotations ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5" />
              {{ editShowAnnotations ? 'Hide annotations' : editAnnotationEntries.length > 0 ? `Annotations (${editAnnotationEntries.length})` : 'Add annotations' }}
            </button>
            <div v-if="editShowAnnotations" class="mt-2 space-y-1.5">
              <div v-for="(entry, i) in editAnnotationEntries" :key="i" class="flex items-center gap-1.5">
                <UInput v-model="entry.key" placeholder="key" class="w-24 shrink-0" />
                <span class="text-slate-600 text-xs">:</span>
                <UInput v-model="entry.value" placeholder="value" class="flex-1" />
                <button class="text-slate-700 hover:text-red-400 transition-colors" @click="removeEditAnnotationEntry(i)">
                  <UIcon name="i-heroicons-x-mark" class="w-3.5 h-3.5" />
                </button>
              </div>
              <button class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1" @click="addEditAnnotationEntry">
                <UIcon name="i-heroicons-plus" class="w-3 h-3" /> Add annotation
              </button>
            </div>
          </div>

          <p v-if="editScheduleError" class="text-sm text-red-400 flex items-center gap-1.5">
            <UIcon name="i-heroicons-exclamation-circle" class="w-4 h-4 flex-shrink-0" />
            {{ editScheduleError }}
          </p>

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" @click="isEditing = false">Cancel</UButton>
            <UButton :disabled="!editForm.name.trim() || saving" :loading="saving" @click="saveEdit">
              Save
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- ── Pause modal ────────────────────────────────────────────────────────── -->
    <UModal v-model:open="showPauseModal">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-pause-circle" class="w-5 h-5 text-amber-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Pause "{{ habit?.name }}"</p>
              <p class="text-sm text-slate-400">Choose when to resume. The habit will be hidden until then.</p>
            </div>
          </div>
          <UFormField label="Resume on">
            <UInput
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
    <UModal v-model:open="showArchiveConfirm">
      <template #content>
        <div class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <UIcon name="i-heroicons-archive-box" class="w-5 h-5 text-amber-400" />
            </div>
            <div class="space-y-1">
              <p class="font-semibold">Archive "{{ habit?.name }}"?</p>
              <p class="text-sm text-slate-400">The habit and all its history will be preserved in your archive.</p>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="showArchiveConfirm = false">Cancel</UButton>
            <UButton color="warning" :loading="archiving" @click="archiveHabit">Archive</UButton>
          </div>
        </div>
      </template>
    </UModal>

  </div>
</template>
