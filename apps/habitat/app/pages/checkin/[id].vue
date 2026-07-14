<script setup lang="ts">
import { useDragReorder } from '~/composables/useTabReorder'
import type { CheckinQuestion, CheckinReminder, CheckinTemplate } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const route = useRoute()
const templateId = computed(() => route.params['id'] as string)
// Freshly created check-ins arrive with ?new=1 — focus the title so the user can name it right away.
const isNew = route.query['new'] === '1'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Template + questions ─────────────────────────────────────────────────────

const template = ref<CheckinTemplate | null>(null)
const questions = ref<CheckinQuestion[]>([])
const reminders = ref<CheckinReminder[]>([])
const loading = ref(true)

// ─── Identity (title / icon / color / schedule) — auto-saved inline ───────────

const form = reactive({
  title: '',
  icon: 'pencil-square',
  color: '#22d3ee',
  schedule_type: 'DAILY' as 'DAILY' | 'WEEKLY' | 'MONTHLY',
  days_active: [] as number[],
  dayOfMonth: new Date().getDate(),
})

function clampDayOfMonth(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(31, Math.max(1, Math.round(n)))
}
let hydrated = false
const savedFlash = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null
let titleTimer: ReturnType<typeof setTimeout> | null = null

function flashSaved() {
  savedFlash.value = true
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    savedFlash.value = false
  }, 1500)
}

async function persistIdentity() {
  if (!template.value) return
  let days: number[] | null = null
  if (form.schedule_type === 'WEEKLY' && form.days_active.length) days = [...form.days_active]
  else if (form.schedule_type === 'MONTHLY') days = [clampDayOfMonth(form.dayOfMonth)]
  try {
    template.value = await db.updateCheckinTemplate({
      id: template.value.id,
      title: form.title.trim() || template.value.title,
      schedule_type: form.schedule_type,
      days_active: days,
      icon: form.icon,
      color: form.color,
    })
    flashSaved()
  } catch (e) {
    logError('[checkin/persistIdentity]', e)
    toast.add({ title: 'Failed to save', color: 'error', duration: 3000 })
  }
}

function onTitleInput(val: string) {
  form.title = val
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(persistIdentity, 600)
}

// Discrete selections (icon / color / schedule / days) save immediately.
watch(
  [
    () => form.icon,
    () => form.color,
    () => form.schedule_type,
    () => form.days_active,
    () => form.dayOfMonth,
  ],
  () => {
    if (hydrated) void persistIdentity()
  },
  { deep: true },
)

async function loadTemplate() {
  const [tmpl, qs] = await Promise.all([
    db.getCheckinTemplate(templateId.value),
    db.getCheckinQuestions(templateId.value),
  ])
  template.value = tmpl
  questions.value = qs
  if (tmpl) {
    form.title = tmpl.title
    form.icon = tmpl.icon
    form.color = tmpl.color
    form.schedule_type = tmpl.schedule_type
    form.days_active =
      tmpl.schedule_type === 'WEEKLY' && tmpl.days_active ? [...tmpl.days_active] : []
    if (tmpl.schedule_type === 'MONTHLY' && tmpl.days_active?.length) {
      form.dayOfMonth = clampDayOfMonth(tmpl.days_active[0] ?? 1)
    }
  }
  await nextTick()
  hydrated = true
  loading.value = false
}

// ─── Questions management ─────────────────────────────────────────────────────

const showAddQuestion = ref(false)
const newPrompt = ref('')
const newResponseType = ref<'SCALE' | 'TEXT' | 'BOOLEAN'>('TEXT')
const newDesiredAnswer = ref(1)
const addingQuestion = ref(false)
const deletingQuestion = reactive(new Set<string>())

function questionTypeLabel(q: CheckinQuestion): string {
  if (q.response_type === 'TEXT') return 'Text Input'
  if (q.response_type === 'SCALE') return '1–10 Scale'
  return `Yes/No · desired: ${q.desired_answer === 0 ? 'No' : 'Yes'}`
}

async function addQuestion() {
  if (!newPrompt.value.trim() || addingQuestion.value) return
  addingQuestion.value = true
  try {
    const q = await db.createCheckinQuestion({
      template_id: templateId.value,
      prompt: newPrompt.value.trim(),
      response_type: newResponseType.value,
      display_order: questions.value.length,
      desired_answer: newResponseType.value === 'BOOLEAN' ? newDesiredAnswer.value : 1,
    })
    questions.value.push(q)
    newPrompt.value = ''
    newResponseType.value = 'TEXT'
    newDesiredAnswer.value = 1
    showAddQuestion.value = false
  } catch (err) {
    logError('[addQuestion]', err)
    toast.add({ title: 'Failed to add question', color: 'error', duration: 4000 })
  } finally {
    addingQuestion.value = false
  }
}

async function deleteQuestion(qid: string) {
  if (deletingQuestion.has(qid)) return
  deletingQuestion.add(qid)
  try {
    await db.deleteCheckinQuestion(qid)
    questions.value = questions.value.filter((q) => q.id !== qid)
  } catch (err) {
    logError('[deleteQuestion]', err)
    toast.add({ title: 'Failed to delete question', color: 'error', duration: 4000 })
  } finally {
    deletingQuestion.delete(qid)
  }
}

// ─── Question reorder (drag) ──────────────────────────────────────────────────

const questionsContainerRef = ref<HTMLElement | null>(null)
const { state: qDrag, onPointerDown: qDragPointerDown } = useDragReorder(
  questions,
  (newOrder) => {
    void applyQuestionOrder(newOrder)
  },
  { orientation: 'vertical' },
)

function onQuestionPointerDown(index: number, e: PointerEvent) {
  if (questionsContainerRef.value) qDragPointerDown(index, e, questionsContainerRef.value)
}

async function applyQuestionOrder(newOrder: CheckinQuestion[]) {
  const previousOrder = questions.value
  questions.value = newOrder
  try {
    await Promise.all(
      newOrder.map((q, i) =>
        q.display_order === i ? null : db.updateCheckinQuestion({ id: q.id, display_order: i }),
      ),
    )
    newOrder.forEach((q, i) => {
      q.display_order = i
    })
  } catch (err) {
    logError('[reorderQuestions]', err)
    toast.add({ title: 'Failed to save order', color: 'error', duration: 3000 })
    questions.value = previousOrder
  }
}

// ─── Reminders ────────────────────────────────────────────────────────────────

const showAddReminder = ref(false)
const newReminderTime = ref('')
const newReminderDays = ref<number[]>([])
const savingReminder = ref(false)
const deletingReminder = reactive(new Set<string>())

async function loadReminders() {
  reminders.value = await db.getCheckinRemindersForTemplate(templateId.value)
}

function reminderDaysLabel(r: CheckinReminder): string {
  if (!r.days_active || r.days_active.length === 0) return 'Every day'
  return r.days_active.map((d) => DAY_NAMES[d]).join(', ')
}

async function addReminder() {
  if (!newReminderTime.value || savingReminder.value) return
  savingReminder.value = true
  try {
    const r = await db.createCheckinReminder(
      templateId.value,
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

async function removeReminder(rid: string) {
  if (deletingReminder.has(rid)) return
  deletingReminder.add(rid)
  try {
    await db.deleteCheckinReminder(rid)
    reminders.value = reminders.value.filter((r) => r.id !== rid)
    useNotifications()
      .scheduleAll()
      .catch((e) => logError('[scheduleAll]', e))
  } finally {
    deletingReminder.delete(rid)
  }
}

// ─── Delete template ──────────────────────────────────────────────────────────

const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function deleteTemplate() {
  if (!template.value || deleting.value) return
  deleting.value = true
  try {
    await db.deleteCheckinTemplate(template.value.id)
    await navigateTo('/checkin')
  } finally {
    deleting.value = false
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadTemplate()
  await loadReminders()
})
</script>

<template>
  <div class="space-y-5 pb-12">

    <!-- Back nav -->
    <BackNav to="/checkin" label="Check-ins" />

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <AppIcon name="arrow-path" class="w-5 h-5 animate-spin text-(--ui-text-muted)" />
    </div>

    <!-- Not found -->
    <div v-else-if="!template" class="flex flex-col items-center gap-3 py-12 text-center">
      <AppIcon name="exclamation-circle" class="w-8 h-8 text-slate-700" />
      <p class="text-sm text-(--ui-text-dimmed)">Check-in not found.</p>
      <UButton variant="ghost" color="neutral" size="sm" to="/checkin">Go back</UButton>
    </div>

    <template v-else>

      <!-- ── Header ────────────────────────────────────────────────────────── -->
      <header class="flex items-center justify-between">
        <h1 class="text-2xl font-bold leading-tight">Edit check-in</h1>
        <Transition name="swap-slow">
          <span
            v-if="savedFlash"
            class="flex items-center gap-1 text-xs text-green-400"
            aria-live="polite"
          >
            <AppIcon name="check" class="w-3.5 h-3.5" />
            Saved
          </span>
        </Transition>
      </header>

      <!-- ── Identity (auto-saved) ─────────────────────────────────────────── -->
      <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-muted) p-4 space-y-4">
        <!-- Icon preview + title -->
        <div class="flex items-center gap-3">
          <AppCardIcon :icon="form.icon" :icon-color="form.color" :bg-color="form.color + '33'" />
          <AppTextField
            :model-value="form.title"
            placeholder="Check-in name"
            class="flex-1 text-base font-semibold"
            :autofocus="isNew"
            @update:model-value="onTitleInput"
          />
        </div>

        <UFormField label="Color">
          <HabitColorPicker v-model="form.color" />
        </UFormField>
        <UFormField label="Icon">
          <HabitIconPicker v-model="form.icon" :color="form.color" />
        </UFormField>

        <UFormField label="Schedule">
          <TypeSelector
            v-model="form.schedule_type"
            :options="[{value:'DAILY',label:'Daily'},{value:'WEEKLY',label:'Weekly'},{value:'MONTHLY',label:'Monthly'}]"
          />
        </UFormField>
        <UFormField v-if="form.schedule_type === 'WEEKLY'" label="Days (leave blank for every day)">
          <DayPicker v-model="form.days_active" :labels="CHECKIN_DAY_LABELS" />
        </UFormField>
        <UFormField
          v-if="form.schedule_type === 'MONTHLY'"
          label="Day of the month"
          help="Months without this day fall back to their last day."
        >
          <AppTextField
            :model-value="form.dayOfMonth"
            type="number"
            min="1"
            max="31"
            class="w-24"
            @update:model-value="(v: string) => (form.dayOfMonth = clampDayOfMonth(Number(v)))"
          />
        </UFormField>
      </div>

      <!-- ── Questions ─────────────────────────────────────────────────────── -->
      <div class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">Questions</p>
          <p v-if="questions.length > 1" class="text-[11px] text-(--ui-text-dimmed)">Drag to reorder</p>
        </div>

        <div
          v-if="questions.length === 0"
          class="flex flex-col items-center gap-3 py-8 text-center bg-(--ui-bg-muted) rounded-2xl border border-(--ui-border)"
        >
          <AppIcon name="plus-circle" class="w-7 h-7 text-slate-700" />
          <p class="text-sm text-(--ui-text-dimmed)">No questions yet. Add one below.</p>
        </div>

        <ul v-else ref="questionsContainerRef" class="space-y-2">
          <li
            v-for="(q, i) in questions"
            :key="q.id"
            class="flex items-start gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3"
            :class="{ 'opacity-60': qDrag.dragging && qDrag.dragIndex === i }"
          >
            <button
              type="button"
              class="flex-shrink-0 -ml-1 mt-0.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-(--ui-text-dimmed) hover:text-(--ui-text-muted) cursor-grab active:cursor-grabbing touch-none"
              aria-label="Drag to reorder question"
              @pointerdown="onQuestionPointerDown(i, $event)"
            >
              <AppIcon name="bars-3" class="w-4 h-4" />
            </button>
            <div class="flex-1 min-w-0 space-y-1">
              <p class="text-sm font-medium text-(--ui-text) leading-snug">{{ q.prompt }}</p>
              <p class="text-xs text-(--ui-text-dimmed) font-mono">{{ questionTypeLabel(q) }}</p>
            </div>
            <button
              type="button"
              class="icon-btn flex-shrink-0 text-slate-700 hover:text-red-400"
              aria-label="Delete question"
              :disabled="deletingQuestion.has(q.id)"
              @click="deleteQuestion(q.id)"
            >
              <AppIcon name="trash" class="w-4 h-4" />
            </button>
          </li>
        </ul>

        <!-- ── Add question ─────────────────────────────────────────────────── -->
        <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
          <div class="px-4 pt-3.5 pb-3 flex items-center justify-between">
            <p class="text-xs font-semibold text-(--ui-text-muted)">Add Question</p>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              :icon="resolveIcon(showAddQuestion ? 'chevron-up' : 'plus')"
              :aria-label="showAddQuestion ? 'Collapse add question' : 'Expand add question'"
              class="min-h-[44px] min-w-[44px]"
              @click.stop="showAddQuestion = !showAddQuestion"
            />
          </div>

          <div v-if="showAddQuestion" class="px-4 py-3 space-y-3">
            <UFormField label="Prompt">
              <AppTextField
                v-model="newPrompt"
                placeholder="e.g. How are you feeling?"
                class="w-full"
                autofocus
                @keydown.enter="addQuestion"
              />
            </UFormField>
            <UFormField label="Response type">
              <div class="flex gap-1.5" role="group" aria-label="Response type">
                <button
                  v-for="rt in (['TEXT', 'SCALE', 'BOOLEAN'] as const)"
                  :key="rt"
                  :aria-pressed="newResponseType === rt"
                  class="flex-1 min-h-[44px] py-1.5 text-xs font-medium rounded-lg border transition-colors"
                  :class="newResponseType === rt
                    ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                    : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented)'"
                  @click="newResponseType = rt"
                >
                  {{ rt === 'TEXT' ? 'Text' : rt === 'SCALE' ? '1–10' : 'Yes/No' }}
                </button>
              </div>
            </UFormField>
            <UFormField v-if="newResponseType === 'BOOLEAN'" label="Desired answer">
              <div class="flex gap-1.5" role="group" aria-label="Desired answer">
                <button
                  v-for="opt in ([{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }] as const)"
                  :key="opt.value"
                  :aria-pressed="newDesiredAnswer === opt.value"
                  class="flex-1 min-h-[44px] py-1.5 text-xs font-medium rounded-lg border transition-colors"
                  :class="newDesiredAnswer === opt.value
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented)'"
                  @click="newDesiredAnswer = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton size="xs" variant="ghost" color="neutral" @click="showAddQuestion = false">Cancel</UButton>
              <UButton
                size="xs"
                :disabled="!newPrompt.trim() || addingQuestion"
                :loading="addingQuestion"
                @click="addQuestion"
              >
                Add
              </UButton>
            </div>
          </div>
        </UCard>
      </div>

      <!-- ── Reminders ─────────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-(--ui-border)' }">
        <div class="px-4 pt-3.5 pb-3 flex items-center justify-between cursor-pointer" @click="showAddReminder = !showAddReminder">
          <p class="text-xs font-semibold text-(--ui-text-muted)">Reminders</p>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="resolveIcon(showAddReminder ? 'chevron-up' : 'plus')"
            :aria-label="showAddReminder ? 'Collapse reminders' : 'Add reminder'"
            class="min-h-[44px] min-w-[44px]"
            @click.stop="showAddReminder = !showAddReminder"
          />
        </div>

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
            class="text-slate-700 hover:text-red-400 transition-colors"
            aria-label="Delete reminder"
            :disabled="deletingReminder.has(r.id)"
            @click="removeReminder(r.id)"
          >
            <AppIcon name="trash" class="w-4 h-4" />
          </button>
        </div>

        <div v-if="reminders.length === 0 && !showAddReminder" class="px-4 py-3 text-xs text-slate-600">
          No reminders set.
        </div>

        <div v-if="showAddReminder" class="px-4 py-3 space-y-3">
          <div class="flex items-center gap-3">
            <AppTextField v-model="newReminderTime" type="time" class="w-32" />
            <span class="text-xs text-(--ui-text-dimmed)">Remind me at this time</span>
          </div>
          <div class="space-y-1">
            <p class="text-[11px] text-(--ui-text-dimmed)">Days (leave blank for every day)</p>
            <DayPicker v-model="newReminderDays" :labels="CHECKIN_DAY_LABELS" />
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

      <!-- ── Danger zone ────────────────────────────────────────────────────── -->
      <div class="space-y-2 pb-4 pt-4">
        <p class="text-xs font-semibold text-slate-600">Danger zone</p>
        <UButton
          variant="soft"
          color="error"
          size="sm"
          :icon="resolveIcon('trash')"
          @click="showDeleteConfirm = true"
        >
          Delete check-in
        </UButton>
      </div>

    </template>

    <!-- ── Delete confirm ─────────────────────────────────────────────────── -->
    <ConfirmDialog
      :open="showDeleteConfirm"
      icon="trash"
      icon-color="red"
      :title="`Delete &quot;${template?.title}&quot;?`"
      message="This will delete the check-in along with all its questions and responses. This cannot be undone."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="deleteTemplate"
      @cancel="showDeleteConfirm = false"
      @update:open="(open) => !open && (showDeleteConfirm = false)"
    />

  </div>
</template>
