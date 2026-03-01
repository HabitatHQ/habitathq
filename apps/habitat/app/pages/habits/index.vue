<script setup lang="ts">
import type { HabitWithSchedule } from '~/types/database'

const db = useDatabase()
const { settings } = useAppSettings()
const habits = ref<HabitWithSchedule[]>([])
const isOpen = ref(false)
const saving = ref(false)
const scheduleError = ref<string | null>(null)

// ── Pause all ──────────────────────────────────────────────────────────────────
const showPauseAllModal = ref(false)
const pauseAllDate = ref('')
const pausingAll = ref(false)

const today = new Date().toISOString().slice(0, 10)
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()

const anyPaused = computed(() =>
  habits.value.some(h => h.paused_until && h.paused_until >= today),
)

async function confirmPauseAll() {
  if (!db.isAvailable || !pauseAllDate.value) return
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
  if (!db.isAvailable) return
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

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const form = reactive({
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

const tagInput = ref('')
const annotationEntries = ref<{ key: string; value: string }[]>([])
const showAnnotations = ref(false)

function addTag() {
  const tag = tagInput.value.replace(/,$/, '').trim()
  if (tag && !tag.startsWith('habitat-') && !form.tags.includes(tag)) form.tags.push(tag)
  tagInput.value = ''
}
function removeTag(tag: string) {
  const idx = form.tags.indexOf(tag)
  if (idx >= 0) form.tags.splice(idx, 1)
}
function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
}
function addAnnotationEntry() { annotationEntries.value.push({ key: '', value: '' }) }
function removeAnnotationEntry(i: number) { annotationEntries.value.splice(i, 1) }
function buildAnnotations(entries: { key: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { key, value } of entries) { if (key.trim()) result[key.trim()] = value }
  return result
}

function validateSchedule(): string | null {
  if (form.type === 'NUMERIC') {
    if (form.schedule_type === 'SPECIFIC_DAYS') return 'Metric habits can only be daily or 1× per week.'
    if (form.schedule_type === 'WEEKLY_FLEX' && form.frequency_count > 1) return 'Metric habits must use WEEKLY_FLEX with frequency 1, or be daily.'
  }
  if (form.type === 'LIMIT' && form.schedule_type !== 'DAILY') return 'Limit habits must be daily.'
  return null
}

watch([() => form.type, () => form.schedule_type, () => form.frequency_count], () => {
  scheduleError.value = null
})

async function loadHabits() {
  if (!db.isAvailable) return
  habits.value = await db.getHabits()
}

function toggleDay(day: number) {
  const idx = form.days_of_week.indexOf(day)
  if (idx >= 0) {
    form.days_of_week.splice(idx, 1)
  } else {
    form.days_of_week.push(day)
    form.days_of_week.sort((a, b) => a - b)
  }
}

async function handleCreate() {
  if (!db.isAvailable || !form.name.trim()) return
  const err = validateSchedule()
  if (err) { scheduleError.value = err; return }
  scheduleError.value = null
  saving.value = true
  try {
    const newHabit = await db.createHabit({
      name: form.name.trim(),
      description: form.description.trim(),
      color: '#06b6d4',
      icon: 'i-heroicons-star',
      frequency: 'daily',
      tags: [...form.tags],
      annotations: buildAnnotations(annotationEntries.value),
      type: form.type,
      target_value: form.target_value,
      paused_until: null,
    })
    // Update schedule if user chose a non-DAILY schedule or due time
    if (newHabit.schedule) {
      const needsScheduleUpdate = form.schedule_type !== 'DAILY' || (form.show_due_time && form.due_time)
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
    await loadHabits()
    closeModal()
  } finally {
    saving.value = false
  }
}

function closeModal() {
  isOpen.value = false
  scheduleError.value = null
  form.name = ''
  form.description = ''
  form.type = 'BOOLEAN'
  form.target_value = 1
  form.schedule_type = 'DAILY'
  form.frequency_count = 3
  form.days_of_week = []
  form.tags = []
  tagInput.value = ''
  annotationEntries.value = []
  showAnnotations.value = false
  form.show_due_time = false
  form.due_time = ''
}

function scheduleLabel(habit: HabitWithSchedule): string {
  const sched = habit.schedule
  if (!sched || sched.schedule_type === 'DAILY') return 'Daily'
  if (sched.schedule_type === 'WEEKLY_FLEX') return `${sched.frequency_count ?? 1}×/week`
  if (sched.schedule_type === 'SPECIFIC_DAYS') {
    return (sched.days_of_week ?? []).map(d => DAY_LABELS[d]).join(' ')
  }
  return 'Daily'
}

onMounted(loadHabits)
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Habits</h2>
      <div class="flex items-center gap-2">
        <UButton
          to="/archive"
          icon="i-heroicons-archive-box"
          variant="ghost"
          color="neutral"
          size="sm"
        />
        <UButton
          v-if="anyPaused"
          icon="i-heroicons-play"
          variant="ghost"
          color="neutral"
          size="sm"
          :loading="pausingAll"
          title="Resume all habits"
          @click="resumeAllHabits"
        />
        <UButton
          v-if="habits.length > 0"
          icon="i-heroicons-pause"
          variant="ghost"
          color="neutral"
          size="sm"
          title="Pause all habits"
          @click="openPauseAll"
        />
        <UButton icon="i-heroicons-plus" size="sm" @click="isOpen = true">New</UButton>
      </div>
    </header>

    <section
      v-if="habits.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
        <UIcon name="i-heroicons-clipboard-document-list" class="w-8 h-8 text-slate-400" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-slate-200">No habits yet</p>
        <p class="text-sm text-slate-500">Tap New to create your first habit.</p>
      </div>
    </section>

    <ul v-else class="space-y-2">
      <NuxtLink
        v-for="habit in habits"
        :key="habit.id"
        :to="`/habits/${habit.id}`"
        class="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 active:opacity-70 transition-opacity"
      >
        <div
          class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          :style="{ backgroundColor: habit.color + '33' }"
        >
          <UIcon :name="habit.icon" class="w-5 h-5" :style="{ color: habit.color }" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            <p class="font-medium text-sm truncate text-slate-100">{{ habit.name }}</p>
            <span
              v-if="habit.type !== 'BOOLEAN'"
              class="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
              :class="habit.type === 'NUMERIC'
                ? 'bg-primary-500/15 text-primary-400'
                : 'bg-amber-500/15 text-amber-400'"
            >{{ habit.type === 'NUMERIC' ? '# Metric' : '↓ Limit' }}</span>
          </div>
          <p class="text-xs text-slate-600">
            {{ scheduleLabel(habit) }}
            <span v-if="habit.type !== 'BOOLEAN'" class="ml-1">
              · {{ habit.type === 'NUMERIC' ? `target ${habit.target_value}` : `limit ${habit.target_value}` }}
            </span>
            <span v-if="habit.paused_until && habit.paused_until >= new Date().toISOString().slice(0, 10)" class="ml-1 text-amber-500">
              · Paused
            </span>
          </p>
          <div v-if="settings.showTagsOnHabits && habit.tags.length" class="flex flex-wrap gap-1 mt-1">
            <span
              v-for="tag in habit.tags"
              :key="tag"
              class="px-1.5 py-0.5 rounded text-[9px]"
              :class="tag.startsWith('habitat-') ? 'bg-cyan-900/40 text-cyan-600' : 'bg-slate-800 text-slate-500'"
            >#{{ tag.startsWith('habitat-') ? tag.slice(8) : tag }}</span>
          </div>
          <div v-if="settings.showAnnotationsOnHabits && Object.keys(habit.annotations).length" class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            <span
              v-for="(val, key) in habit.annotations"
              :key="key"
              class="text-[9px] text-slate-600"
            >{{ key }}: {{ val }}</span>
          </div>
        </div>
        <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-700 flex-shrink-0" />
      </NuxtLink>
    </ul>

    <!-- ── Pause all modal ───────────────────────────────────────────────────── -->
    <UModal v-model:open="showPauseAllModal">
      <template #content>
        <div class="p-4 space-y-4">
          <div>
            <h3 class="text-lg font-semibold">Pause all habits</h3>
            <p class="text-sm text-slate-400 mt-0.5">All active habits will be hidden from Today until this date.</p>
          </div>
          <UFormField label="Pause until">
            <UInput v-model="pauseAllDate" type="date" :min="tomorrow" class="w-full" />
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
        </div>
      </template>
    </UModal>

    <!-- ── Create modal ──────────────────────────────────────────────────────── -->
    <UModal v-model:open="isOpen">
      <template #content>
        <div class="p-4 space-y-4">
          <h3 class="text-lg font-semibold">New Habit</h3>

          <!-- Name -->
          <UFormField label="Name" required>
            <UInput v-model="form.name" placeholder="e.g. Morning run" autofocus />
          </UFormField>

          <!-- Description -->
          <UFormField label="Description">
            <UInput v-model="form.description" placeholder="Optional description" />
          </UFormField>

          <!-- Tags -->
          <UFormField label="Tags">
            <div class="space-y-2">
              <div v-if="form.tags.length" class="flex flex-wrap gap-1">
                <span
                  v-for="tag in form.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300"
                >
                  {{ tag }}
                  <button class="text-slate-500 hover:text-white leading-none" @click="removeTag(tag)">×</button>
                </span>
              </div>
              <UInput v-model="tagInput" placeholder="Add tag, press Enter" @keydown="onTagKeydown" />
            </div>
          </UFormField>

          <!-- Type selector -->
          <UFormField label="Type">
            <div class="flex gap-2">
              <button
                v-for="t in (['BOOLEAN', 'NUMERIC', 'LIMIT'] as const)"
                :key="t"
                class="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors"
                :class="form.type === t
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                @click="form.type = t"
              >
                {{ t === 'BOOLEAN' ? '✓ Done' : t === 'NUMERIC' ? '# Metric' : '↓ Limit' }}
              </button>
            </div>
          </UFormField>

          <!-- Target (NUMERIC / LIMIT only) -->
          <UFormField v-if="form.type !== 'BOOLEAN'" :label="form.type === 'NUMERIC' ? 'Target' : 'Limit'">
            <div class="flex items-center gap-2">
              <UInput
                v-model.number="form.target_value"
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
                :class="form.schedule_type === s
                  ? 'bg-slate-700 border-slate-500 text-slate-100'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                @click="form.schedule_type = s"
              >
                {{ s === 'DAILY' ? 'Daily' : s === 'WEEKLY_FLEX' ? 'N× week' : 'Specific days' }}
              </button>
            </div>

            <!-- WEEKLY_FLEX: frequency count -->
            <div v-if="form.schedule_type === 'WEEKLY_FLEX'" class="flex items-center gap-2">
              <span class="text-sm text-slate-400">Times per week:</span>
              <div class="flex items-center gap-1">
                <button
                  class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                  @click="form.frequency_count = Math.max(1, form.frequency_count - 1)"
                >−</button>
                <span class="w-5 text-center text-sm font-medium">{{ form.frequency_count }}</span>
                <button
                  class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-sm"
                  @click="form.frequency_count = Math.min(7, form.frequency_count + 1)"
                >+</button>
              </div>
            </div>

            <!-- SPECIFIC_DAYS: day pills -->
            <div v-if="form.schedule_type === 'SPECIFIC_DAYS'" class="flex gap-1.5">
              <button
                v-for="(label, i) in DAY_LABELS"
                :key="i"
                class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
                :class="form.days_of_week.includes(i)
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600'"
                @click="toggleDay(i)"
              >
                {{ label }}
              </button>
            </div>
          </UFormField>

          <!-- Due time (collapsible) -->
          <div>
            <button
              class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1"
              @click="form.show_due_time = !form.show_due_time"
            >
              <UIcon :name="form.show_due_time ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5" />
              {{ form.show_due_time ? 'Remove due time' : 'Add due time' }}
            </button>
            <div v-if="form.show_due_time" class="mt-2">
              <UInput v-model="form.due_time" type="time" class="w-32" />
            </div>
          </div>

          <!-- Annotations (collapsible) -->
          <div>
            <button
              class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1"
              @click="showAnnotations = !showAnnotations"
            >
              <UIcon :name="showAnnotations ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'" class="w-3.5 h-3.5" />
              {{ showAnnotations ? 'Hide annotations' : annotationEntries.length > 0 ? `Annotations (${annotationEntries.length})` : 'Add annotations' }}
            </button>
            <div v-if="showAnnotations" class="mt-2 space-y-1.5">
              <div v-for="(entry, i) in annotationEntries" :key="i" class="flex items-center gap-1.5">
                <UInput v-model="entry.key" placeholder="key" class="w-24 shrink-0" />
                <span class="text-slate-600 text-xs">:</span>
                <UInput v-model="entry.value" placeholder="value" class="flex-1" />
                <button class="p-2 -m-1 text-slate-700 hover:text-red-400 transition-colors" @click="removeAnnotationEntry(i)">
                  <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
                </button>
              </div>
              <button class="text-xs text-slate-500 hover:text-slate-400 flex items-center gap-1" @click="addAnnotationEntry">
                <UIcon name="i-heroicons-plus" class="w-3 h-3" /> Add annotation
              </button>
            </div>
          </div>

          <p v-if="scheduleError" class="text-sm text-red-400 flex items-center gap-1.5">
            <UIcon name="i-heroicons-exclamation-circle" class="w-4 h-4 flex-shrink-0" />
            {{ scheduleError }}
          </p>

          <div class="flex justify-end gap-2 pt-2">
            <UButton variant="ghost" color="neutral" @click="closeModal">Cancel</UButton>
            <UButton :disabled="!form.name.trim() || saving" :loading="saving" @click="handleCreate">
              Create
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
