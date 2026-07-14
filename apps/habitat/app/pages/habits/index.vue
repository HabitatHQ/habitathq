<script setup lang="ts">
import type { HabitWithSchedule } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { settings } = useAppSettings()
const { anyActive, matchesContext } = useContextFilter()
const habits = ref<HabitWithSchedule[]>([])
const loading = ref(true)
const staggerOnce = useFirstVisit('habits-list')
const isOpen = useBoolModalQuery('create')

// ── Pause all ──────────────────────────────────────────────────────────────────
const showPauseAllModal = ref(false)
const pauseAllDate = ref('')
const pausingAll = ref(false)

const today = new Date().toISOString().slice(0, 10)
const tomorrow = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
})()

const todayCompletionHabitIds = ref(new Set<string>())

const anyPaused = computed(() =>
  habits.value.some((h) => h.paused_until && h.paused_until >= today),
)

async function confirmPauseAll() {
  if (!pauseAllDate.value) return
  pausingAll.value = true
  try {
    await db.pauseAllHabits(pauseAllDate.value)
    await loadHabits()
    showPauseAllModal.value = false
    pauseAllDate.value = ''
  } finally {
    pausingAll.value = false
  }
}

async function resumeAllHabits() {
  pausingAll.value = true
  try {
    await db.pauseAllHabits(null)
    await loadHabits()
  } finally {
    pausingAll.value = false
  }
}

function openPauseAll() {
  pauseAllDate.value = tomorrow
  showPauseAllModal.value = true
}

// ── Pending reminders (create-only — added before the habit exists in the DB) ──
const pendingReminders = ref<{ time: string; days: number[] }[]>([])
const showAddReminder = ref(false)
const newReminderTime = ref('')
const newReminderDays = ref<number[]>([])

function addPendingReminder() {
  if (!newReminderTime.value) return
  pendingReminders.value.push({ time: newReminderTime.value, days: [...newReminderDays.value] })
  newReminderTime.value = ''
  newReminderDays.value = []
}

function removePendingReminder(i: number) {
  pendingReminders.value.splice(i, 1)
}

function resetReminders() {
  pendingReminders.value = []
  showAddReminder.value = false
  newReminderTime.value = ''
  newReminderDays.value = []
}

const loadError = ref<string | null>(null)

const toggling = reactive(new Set<string>())
const { impact } = useHaptics()

async function loadHabits() {
  try {
    const [h, comps] = await Promise.all([db.getHabits(), db.getCompletionsForDate(today)])
    habits.value = h
    todayCompletionHabitIds.value = new Set(comps.map((c) => c.habit_id))
    loadError.value = null
  } catch (e) {
    loadError.value = logError('[habits/load]', e)
  } finally {
    loading.value = false
  }
}

async function quickToggle(habit: HabitWithSchedule, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  if (toggling.has(habit.id)) return
  toggling.add(habit.id)
  try {
    await db.toggleCompletion(habit.id, today)
    const comps = await db.getCompletionsForDate(today)
    todayCompletionHabitIds.value = new Set(comps.map((c) => c.habit_id))
    await impact('medium')
  } catch (e) {
    logError('[habits/quickToggle]', e)
    toast.add({ title: "Couldn't save — try again", color: 'error', duration: 3000 })
  } finally {
    toggling.delete(habit.id)
  }
}

function openCreate() {
  resetReminders()
  isOpen.value = true
}

async function onHabitCreated(newHabit: HabitWithSchedule) {
  if (pendingReminders.value.length > 0) {
    await Promise.all(
      pendingReminders.value.map((r) =>
        db.createReminder(newHabit.id, r.time, r.days.length ? [...r.days] : null),
      ),
    )
    useNotifications()
      .scheduleAll()
      .catch((e) => logError('[scheduleAll]', e))
  }
  resetReminders()
  await loadHabits()
  toast.add({
    title: `"${newHabit.name}" created`,
    color: 'success',
    duration: 5000,
    actions:
      habits.value.length === 1
        ? [{ label: 'Complete it now', onClick: () => navigateTo('/') }]
        : [],
  })
}

onMounted(() => {
  void loadHabits()
})
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Habits</h2>
      <div class="flex items-center gap-1">
        <NuxtLink
          to="/archive"
          class="icon-btn text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)/50"
          aria-label="View archived habits"
        >
          <AppIcon :name="resolveIcon('archive-box')" class="w-5 h-5" />
        </NuxtLink>
        <AppIconButton
          v-if="anyPaused"
          icon="play"
          label="Resume all habits"
          @click="resumeAllHabits"
        />
        <AppIconButton
          v-if="habits.length > 0"
          icon="pause"
          label="Pause all habits"
          @click="openPauseAll"
        />
        <UButton :icon="resolveIcon('plus')" size="sm" class="min-h-[44px]" @click="openCreate">New</UButton>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="space-y-2 pt-2">
      <AppSkeleton variant="row" :count="3" />
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="loadError"
      icon="exclamation-triangle"
      title="Couldn't load habits"
      :description="loadError"
    >
      <template #actions>
        <UButton @click="loading = true; loadHabits()">Try again</UButton>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="habits.length === 0"
      icon="clipboard-document-list"
      title="No habits yet"
      description="Tap New to create your first habit."
    />

    <ul v-else :class="['space-y-2', { 'stagger-list': staggerOnce }]">
      <AppCard
        v-for="habit in habits"
        :key="habit.id"
        tag="li"
        :to="`/habits/${habit.id}`"
        :completed="todayCompletionHabitIds.has(habit.id)"
        :dimmed="anyActive && !matchesContext(habit.tags)"
      >
        <AppCardIcon :icon="habit.icon" :icon-color="habit.color" :bg-color="habit.color + '33'" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            <p class="text-sm font-medium truncate text-(--ui-text)">{{ habit.name }}</p>
            <span
              v-if="habit.type !== 'BOOLEAN'"
              class="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
              :class="habit.type === 'NUMERIC'
                ? 'bg-primary-500/15 text-primary-400'
                : 'bg-amber-500/15 text-amber-400'"
            ># {{ habit.type === 'NUMERIC' ? 'Target' : 'Limit' }}</span>
          </div>
          <p class="text-xs text-(--ui-text-dimmed)">
            {{ habitScheduleLabel(habit) }}
            <span v-if="habit.type !== 'BOOLEAN'" class="ml-1">
              · {{ habit.type === 'NUMERIC' ? `target ${habit.target_value}` : `limit ${habit.target_value}` }}
            </span>
            <span v-if="habit.paused_until && habit.paused_until >= today" class="ml-1 text-amber-500">
              · Paused
            </span>
          </p>
          <div v-if="settings.showTagsOnHabits && habit.tags.length" class="flex flex-wrap gap-1 mt-1">
            <span
              v-for="tag in habit.tags"
              :key="tag"
              class="px-1.5 py-0.5 rounded text-[9px]"
              :class="tag.startsWith('habitat-') ? 'bg-cyan-900/40 text-cyan-600' : 'bg-(--ui-bg-elevated) text-(--ui-text-dimmed)'"
            >#{{ tag.startsWith('habitat-') ? tag.slice(8) : tag }}</span>
          </div>
          <div v-if="settings.showAnnotationsOnHabits && Object.keys(habit.annotations).length" class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            <span
              v-for="(val, key) in habit.annotations"
              :key="key"
              class="text-[9px] text-(--ui-text-dimmed)"
            >{{ key }}: {{ val }}</span>
          </div>
        </div>
        <button
          v-if="habit.type === 'BOOLEAN'"
          class="relative w-7 h-7 rounded-full border-2 shrink-0 flex items-center justify-center transition-all duration-200 after:absolute after:inset-[-8px] after:content-['']"
          :class="todayCompletionHabitIds.has(habit.id)
            ? 'bg-primary-500 border-primary-500'
            : 'border-(--ui-border-accented) bg-transparent'"
          :disabled="toggling.has(habit.id)"
          :aria-label="todayCompletionHabitIds.has(habit.id) ? `Mark ${habit.name} incomplete` : `Mark ${habit.name} complete`"
          @click="quickToggle(habit, $event)"
        >
          <AppIcon v-if="todayCompletionHabitIds.has(habit.id)" name="check" class="w-4 h-4 text-white" />
        </button>
        <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) flex-shrink-0" />
      </AppCard>
    </ul>

    <!-- ── Pause all modal ───────────────────────────────────────────────────── -->
    <AppModal v-model="showPauseAllModal">
      <div>
        <h3 class="text-lg font-semibold">Pause all habits</h3>
        <p class="text-sm text-(--ui-text-muted) mt-0.5">All active habits will be hidden from Today until this date.</p>
      </div>
      <UFormField label="Pause until">
        <AppTextField v-model="pauseAllDate" type="date" :min="tomorrow" class="w-full" />
      </UFormField>
      <div class="flex justify-end gap-2 pt-1">
        <UButton variant="ghost" color="neutral" @click="showPauseAllModal = false">Cancel</UButton>
        <UButton
          color="warning"
          :disabled="!pauseAllDate || pausingAll"
          :loading="pausingAll"
          @click="confirmPauseAll"
        >
          Pause all
        </UButton>
      </div>
    </AppModal>

    <!-- ── Create modal ──────────────────────────────────────────────────────── -->
    <HabitFormModal v-model="isOpen" mode="create" @saved="onHabitCreated">
      <template #reminders>
        <div>
          <button
            class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1"
            @click="showAddReminder = !showAddReminder"
          >
            <AppIcon :name="showAddReminder ? 'chevron-down' : 'chevron-right'" class="w-4 h-4" />
            {{ showAddReminder ? 'Hide reminders' : pendingReminders.length > 0 ? `Reminders (${pendingReminders.length})` : 'Add reminders' }}
          </button>
          <div v-if="showAddReminder" class="mt-2 space-y-2">
            <!-- Pending reminder list -->
            <div
              v-for="(r, i) in pendingReminders"
              :key="i"
              class="flex items-center gap-2"
            >
              <AppIcon name="bell" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
              <span class="text-sm type-duration text-(--ui-text-toned)">{{ r.time }}</span>
              <span class="text-xs text-(--ui-text-dimmed)">
                {{ r.days.length ? r.days.map(d => HABIT_DAY_LABELS[d]).join(' ') : 'Every day' }}
              </span>
              <button aria-label="Remove reminder" class="ml-auto min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-700 hover:text-red-400 transition-colors" @click="removePendingReminder(i)">
                <AppIcon name="x-mark" class="w-4 h-4" />
              </button>
            </div>

            <!-- New reminder form -->
            <div class="space-y-1.5 pt-0.5">
              <div class="flex items-center gap-2">
                <AppTextField v-model="newReminderTime" type="time" class="w-32" />
                <button
                  class="text-xs font-medium transition-colors"
                  :class="newReminderTime ? 'text-primary-400 hover:text-primary-300' : 'text-slate-600 cursor-not-allowed'"
                  :disabled="!newReminderTime"
                  @click="addPendingReminder"
                >
                  + Add
                </button>
              </div>
              <div class="flex items-center gap-1">
                <DayPicker v-model="newReminderDays" :labels="HABIT_DAY_LABELS" />
                <span v-if="newReminderDays.length === 0" class="text-[10px] text-slate-600 ml-1">every day</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </HabitFormModal>
  </div>
</template>
