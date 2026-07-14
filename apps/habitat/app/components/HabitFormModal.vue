<script setup lang="ts">
import type { HabitWithSchedule } from '~/types/database'

type HabitType = 'BOOLEAN' | 'NUMERIC' | 'LIMIT'
type ScheduleType = 'DAILY' | 'WEEKLY_FLEX' | 'SPECIFIC_DAYS'

const props = defineProps<{
  mode: 'create' | 'edit'
  /** Prefill source when editing. */
  habit?: HabitWithSchedule | null
}>()

const emit = defineEmits<{
  saved: [habit: HabitWithSchedule]
}>()

const open = defineModel<boolean>({ default: false })

const db = useDatabase()
const { loadTags, suggest: suggestHabitTags } = useTagSuggestions('habit')

const form = reactive({
  name: '',
  description: '',
  why: '',
  icon: 'star',
  color: '#06b6d4',
  type: 'BOOLEAN' as HabitType,
  target_value: 1,
  schedule_type: 'DAILY' as ScheduleType,
  frequency_count: 3,
  days_of_week: [] as number[],
  tags: [] as string[],
  show_due_time: false,
  due_time: '',
})

const annotationEntries = ref<{ key: string; value: string }[]>([])
const showAnnotations = ref(false)
const nameError = ref<string | null>(null)
const scheduleError = ref<string | null>(null)
const saving = ref(false)

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
      return 'Target habits can only be daily or 1× per week.'
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

function reset() {
  if (props.mode === 'edit' && props.habit) {
    const h = props.habit
    const sched = h.schedule
    form.name = h.name
    form.description = h.description
    form.why = h.why
    form.icon = h.icon
    form.color = h.color
    form.type = h.type
    form.target_value = h.target_value
    form.schedule_type = sched?.schedule_type ?? 'DAILY'
    form.frequency_count = sched?.frequency_count ?? 3
    form.days_of_week = sched?.days_of_week ? [...sched.days_of_week] : []
    form.tags = [...h.tags]
    form.show_due_time = !!sched?.due_time
    form.due_time = sched?.due_time ?? ''
    annotationEntries.value = Object.entries(h.annotations).map(([key, value]) => ({ key, value }))
    showAnnotations.value = annotationEntries.value.length > 0
  } else {
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
  }
  nameError.value = null
  scheduleError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) reset()
})

function addAnnotationEntry() {
  annotationEntries.value.push({ key: '', value: '' })
}
function removeAnnotationEntry(i: number) {
  annotationEntries.value.splice(i, 1)
}

async function save() {
  if (saving.value) return
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
    const annotations = buildAnnotations(annotationEntries.value)
    const schedulePatch = {
      schedule_type: form.schedule_type,
      frequency_count: form.schedule_type === 'WEEKLY_FLEX' ? form.frequency_count : null,
      days_of_week: form.schedule_type === 'SPECIFIC_DAYS' ? [...form.days_of_week] : null,
      due_time: form.show_due_time && form.due_time ? form.due_time : null,
    }
    let result: HabitWithSchedule
    if (props.mode === 'edit' && props.habit) {
      const updated = await db.updateHabit({
        id: props.habit.id,
        name: form.name.trim(),
        description: form.description.trim(),
        why: form.why.trim(),
        icon: form.icon,
        color: form.color,
        type: form.type,
        target_value: form.target_value,
        tags: [...form.tags],
        annotations,
      })
      if (updated.schedule) {
        const newSchedule = await db.updateHabitSchedule({
          id: updated.schedule.id,
          ...schedulePatch,
        })
        result = { ...updated, schedule: newSchedule }
      } else {
        result = updated
      }
    } else {
      const newHabit = await db.createHabit({
        name: form.name.trim(),
        description: form.description.trim(),
        why: form.why.trim(),
        color: form.color,
        icon: form.icon,
        frequency: 'daily',
        tags: [...form.tags],
        annotations,
        type: form.type,
        target_value: form.target_value,
        paused_until: null,
      })
      const needsScheduleUpdate =
        form.schedule_type !== 'DAILY' || (form.show_due_time && !!form.due_time)
      if (newHabit.schedule && needsScheduleUpdate) {
        const newSchedule = await db.updateHabitSchedule({
          id: newHabit.schedule.id,
          ...schedulePatch,
        })
        result = { ...newHabit, schedule: newSchedule }
      } else {
        result = newHabit
      }
    }
    emit('saved', result)
    open.value = false
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadTags()
})
</script>

<template>
  <AppModal v-model="open" :title="mode === 'create' ? 'New Habit' : 'Edit Habit'">
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

    <!-- Color & Icon -->
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
      <div v-else role="group" aria-label="Schedule type" class="flex gap-2 mb-2">
        <button
          v-for="s in availableSchedules"
          :key="s"
          :aria-pressed="form.schedule_type === s"
          class="flex-1 min-h-[44px] py-1.5 rounded-lg text-sm font-medium transition-colors"
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
            aria-label="Decrease times per week"
            class="min-h-[44px] min-w-[44px] rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
            @click="form.frequency_count = Math.max(1, form.frequency_count - 1)"
          >−</button>
          <span class="w-5 text-center text-sm font-medium">{{ form.frequency_count }}</span>
          <button
            aria-label="Increase times per week"
            class="min-h-[44px] min-w-[44px] rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
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
          <button aria-label="Remove annotation" class="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-700 hover:text-red-400 transition-colors" @click="removeAnnotationEntry(i)">
            <AppIcon name="x-mark" class="w-4 h-4" />
          </button>
        </div>
        <button class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1" @click="addAnnotationEntry">
          <AppIcon name="plus" class="w-3 h-3" /> Add annotation
        </button>
      </div>
    </div>

    <!-- Reminders (create-only; provided by the page) -->
    <slot v-if="mode === 'create'" name="reminders" />

    <p v-if="scheduleError" class="text-sm text-red-400 flex items-center gap-1.5">
      <AppIcon name="exclamation-circle" class="w-4 h-4 flex-shrink-0" />
      {{ scheduleError }}
    </p>

    <template #footer>
      <div class="flex gap-2">
        <UButton variant="soft" color="neutral" class="flex-1" @click="open = false">Cancel</UButton>
        <UButton class="flex-1" :disabled="!form.name.trim() || saving" :loading="saving" @click="save">
          {{ mode === 'create' ? 'Create' : 'Save' }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
