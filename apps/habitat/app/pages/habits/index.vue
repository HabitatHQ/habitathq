<script setup lang="ts">
import type { HabitWithSchedule } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const { settings } = useAppSettings()
const { anyActive, matchesContext } = useContextFilter()
const habits = ref<HabitWithSchedule[]>([])
const loading = ref(true)
const isOpen = useBoolModalQuery('create')
const saving = ref(false)
const scheduleError = ref<string | null>(null)
const nameError = ref<string | null>(null)

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

const form = reactive({
  name: '',
  description: '',
  why: '',
  icon: 'star',
  color: '#06b6d4',
  type: 'BOOLEAN' as 'BOOLEAN' | 'NUMERIC' | 'LIMIT',
  target_value: 1,
  schedule_type: 'DAILY' as 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS',
  frequency_count: 3,
  days_of_week: [] as number[],
  tags: [] as string[],
  show_due_time: false,
  due_time: '',
})

const { loadTags, suggest: suggestHabitTags } = useTagSuggestions('habit')
const annotationEntries = ref<{ key: string; value: string }[]>([])
const showAnnotations = ref(false)

// ── Pending reminders (added before the habit exists in the DB) ─────────────
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
function addAnnotationEntry() {
  annotationEntries.value.push({ key: '', value: '' })
}
function removeAnnotationEntry(i: number) {
  annotationEntries.value.splice(i, 1)
}
const availableSchedules = computed(() => {
  if (form.type === 'LIMIT') return ['DAILY'] as const
  if (form.type === 'NUMERIC') return ['DAILY', 'WEEKLY_FLEX'] as const
  return ['DAILY', 'WEEKLY_FLEX', 'SPECIFIC_DAYS'] as const
})

watch(
  () => form.type,
  (newType) => {
    if (newType === 'LIMIT') {
      form.schedule_type = 'DAILY'
    } else if (newType === 'NUMERIC') {
      if (form.schedule_type === 'SPECIFIC_DAYS') form.schedule_type = 'DAILY'
      if (form.schedule_type === 'WEEKLY_FLEX') form.frequency_count = 1
    }
  },
)

watch(
  () => form.schedule_type,
  (newSched) => {
    if (form.type === 'NUMERIC' && newSched === 'WEEKLY_FLEX') {
      form.frequency_count = 1
    }
  },
)

function validateSchedule(): string | null {
  if (form.type === 'NUMERIC') {
    if (form.schedule_type === 'SPECIFIC_DAYS')
      return 'Target habits can only be daily or 1× per week.'
    if (form.schedule_type === 'WEEKLY_FLEX' && form.frequency_count > 1)
      return 'Target habits must use WEEKLY_FLEX with frequency 1, or be daily.'
  }
  if (form.type === 'LIMIT' && form.schedule_type !== 'DAILY') return 'Limit habits must be daily.'
  return null
}

watch([() => form.type, () => form.schedule_type, () => form.frequency_count], () => {
  scheduleError.value = null
})
watch(
  () => form.name,
  () => {
    nameError.value = null
  },
)

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

async function handleCreate() {
  if (!form.name.trim()) {
    nameError.value = 'Name is required'
    return
  }
  nameError.value = null
  const err = validateSchedule()
  if (err) {
    scheduleError.value = err
    return
  }
  scheduleError.value = null
  saving.value = true
  try {
    const newHabit = await db.createHabit({
      name: form.name.trim(),
      description: form.description.trim(),
      why: form.why.trim(),
      color: form.color,
      icon: form.icon,
      frequency: 'daily',
      tags: [...form.tags],
      annotations: buildAnnotations(annotationEntries.value),
      type: form.type,
      target_value: form.target_value,
      paused_until: null,
    })
    // Update schedule if user chose a non-DAILY schedule or due time
    if (newHabit.schedule) {
      const needsScheduleUpdate =
        form.schedule_type !== 'DAILY' || (form.show_due_time && form.due_time)
      if (needsScheduleUpdate) {
        await db.updateHabitSchedule({
          id: newHabit.schedule.id,
          schedule_type: form.schedule_type,
          frequency_count: form.schedule_type === 'WEEKLY_FLEX' ? form.frequency_count : null,
          days_of_week: form.schedule_type === 'SPECIFIC_DAYS' ? [...form.days_of_week] : null,
          due_time: form.show_due_time && form.due_time ? form.due_time : null,
        })
      }
    }
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
    const createdName = form.name.trim()
    await loadHabits()
    closeModal()
    toast.add({
      title: `"${createdName}" created`,
      color: 'success',
      duration: 5000,
      actions:
        habits.value.length === 1
          ? [{ label: 'Complete it now', onClick: () => navigateTo('/') }]
          : [],
    })
  } finally {
    saving.value = false
  }
}

function closeModal() {
  isOpen.value = false
  scheduleError.value = null
  nameError.value = null
  form.name = ''
  form.description = ''
  form.why = ''
  form.icon = 'star'
  form.color = '#06b6d4'
  form.type = 'BOOLEAN'
  form.target_value = 1
  form.schedule_type = 'DAILY'
  form.frequency_count = 3
  form.days_of_week = []
  form.tags = []
  annotationEntries.value = []
  showAnnotations.value = false
  form.show_due_time = false
  form.due_time = ''
  pendingReminders.value = []
  showAddReminder.value = false
  newReminderTime.value = ''
  newReminderDays.value = []
}

onMounted(() => {
  void loadHabits()
  void loadTags()
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
        <UButton :icon="resolveIcon('plus')" size="sm" class="min-h-[44px]" @click="isOpen = true">New</UButton>
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

    <ul v-else class="space-y-2 stagger-list">
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
          class="w-7 h-7 min-w-[44px] min-h-[44px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all duration-200"
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
    <AppModal v-model="isOpen" title="New Habit">
      <!-- Name -->
      <UFormField label="Name" required>
        <AppTextField v-model="form.name" placeholder="e.g. Morning run" class="w-full" autofocus />
      </UFormField>
      <p v-if="nameError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
        <AppIcon name="exclamation-circle" class="w-4 h-4 flex-shrink-0" />
        {{ nameError }}
      </p>

      <!-- Description -->
      <UFormField label="Description">
        <AppTextArea v-model="form.description" placeholder="Optional description" class="w-full" />
      </UFormField>

      <!-- Why -->
      <UFormField label="Why is this important?">
        <AppTextArea v-model="form.why" placeholder="What motivates you to build this habit?" class="w-full" />
      </UFormField>

      <!-- Icon & Color -->
      <UFormField label="Color">
        <HabitColorPicker v-model="form.color" />
      </UFormField>
      <UFormField label="Icon">
        <HabitIconPicker v-model="form.icon" :color="form.color" />
      </UFormField>

      <!-- Tags -->
      <UFormField label="Tags">
        <TagInput v-model="form.tags" :suggest="suggestHabitTags" />
      </UFormField>

      <!-- Type selector -->
      <UFormField label="Type">
        <TypeSelector
          v-model="form.type"
          :options="[{value:'BOOLEAN',label:'Yes/No'},{value:'NUMERIC',label:'Target'},{value:'LIMIT',label:'Limit'}]"
        />
      </UFormField>

        <!-- Target (NUMERIC / LIMIT only) -->
        <UFormField v-if="form.type !== 'BOOLEAN'" :label="form.type === 'NUMERIC' ? 'Target' : 'Limit'">
          <div class="flex items-center gap-2">
            <AppTextField
              :model-value="form.target_value"
              type="number"
              min="0.1"
              class="w-28 sm:w-full"
              @update:model-value="form.target_value = Number($event)"
            />
            <span class="text-sm text-(--ui-text-dimmed)">
              {{ form.schedule_type === 'WEEKLY_FLEX' ? 'per week' : 'per day' }}
            </span>
          </div>
        </UFormField>

        <!-- Schedule -->
        <UFormField label="Schedule">
          <div v-if="form.type === 'LIMIT'" class="py-1.5 px-3 rounded-lg text-sm bg-(--ui-bg-elevated) text-(--ui-text-toned) text-center font-medium">
            Daily
          </div>
          <div v-else class="flex gap-2 mb-2">
            <button
              v-for="s in availableSchedules"
              :key="s"
              class="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
              :class="form.schedule_type === s
                ? 'bg-primary-600 text-white'
                : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
              @click="form.schedule_type = s"
            >
              {{ s === 'DAILY' ? 'Daily' : s === 'WEEKLY_FLEX' ? 'Weekly' : 'Specific days' }}
            </button>
          </div>

          <!-- WEEKLY_FLEX: frequency count -->
          <div v-if="form.schedule_type === 'WEEKLY_FLEX' && form.type !== 'NUMERIC'" class="flex items-center gap-2">
            <span class="text-sm text-(--ui-text-muted)">Times per week:</span>
            <div class="flex items-center gap-1">
              <button
                class="w-7 h-7 rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
                @click="form.frequency_count = Math.max(1, form.frequency_count - 1)"
              >−</button>
              <span class="w-5 text-center text-sm font-medium">{{ form.frequency_count }}</span>
              <button
                class="w-7 h-7 rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
                @click="form.frequency_count = Math.min(7, form.frequency_count + 1)"
              >+</button>
            </div>
          </div>

          <!-- SPECIFIC_DAYS: day pills -->
          <DayPicker v-if="form.schedule_type === 'SPECIFIC_DAYS'" v-model="form.days_of_week" :labels="HABIT_DAY_LABELS" />
        </UFormField>

        <!-- Due time (collapsible) -->
        <div>
          <button
            class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1"
            @click="form.show_due_time = !form.show_due_time"
          >
            <AppIcon :name="form.show_due_time ? 'chevron-down' : 'chevron-right'" class="w-4 h-4" />
            {{ form.show_due_time ? 'Remove due time' : 'Add due time' }}
          </button>
          <div v-if="form.show_due_time" class="mt-2">
            <AppTextField v-model="form.due_time" type="time" class="w-32" />
          </div>
        </div>

        <!-- Annotations (collapsible) -->
        <div>
          <button
            class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1"
            @click="showAnnotations = !showAnnotations"
          >
            <AppIcon :name="showAnnotations ? 'chevron-down' : 'chevron-right'" class="w-4 h-4" />
            {{ showAnnotations ? 'Hide annotations' : annotationEntries.length > 0 ? `Annotations (${annotationEntries.length})` : 'Add annotations' }}
          </button>
          <div v-if="showAnnotations" class="mt-2 space-y-1.5">
            <div v-for="(entry, i) in annotationEntries" :key="i" class="flex items-center gap-1.5">
              <AppTextField v-model="entry.key" placeholder="key" class="w-24 shrink-0" />
              <span class="text-slate-600 text-xs">:</span>
              <AppTextField v-model="entry.value" placeholder="value" class="flex-1" />
              <button class="p-2 -m-1 text-slate-700 hover:text-red-400 transition-colors" @click="removeAnnotationEntry(i)">
                <AppIcon name="x-mark" class="w-4 h-4" />
              </button>
            </div>
            <button class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1" @click="addAnnotationEntry">
              <AppIcon name="plus" class="w-3 h-3" /> Add annotation
            </button>
          </div>
        </div>

        <!-- Reminders (collapsible) -->
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
              <button class="ml-auto p-1.5 -m-1 text-slate-700 hover:text-red-400 transition-colors" @click="removePendingReminder(i)">
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

        <p v-if="scheduleError" class="text-sm text-red-400 flex items-center gap-1.5">
          <AppIcon name="exclamation-circle" class="w-4 h-4 flex-shrink-0" />
          {{ scheduleError }}
        </p>

      <template #footer>
        <div class="flex gap-2">
          <UButton variant="soft" color="neutral" class="flex-1" @click="closeModal">Cancel</UButton>
          <UButton class="flex-1" :disabled="!form.name.trim() || saving" :loading="saving" @click="handleCreate">
            Create
          </UButton>
        </div>
      </template>
    </AppModal>
  </div>
</template>
