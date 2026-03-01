<script setup lang="ts">
import type { CheckinTemplate, CheckinQuestion, CheckinResponse, CheckinReminder } from '~/types/database'

const db = useDatabase()
const route = useRoute()
const templateId = computed(() => route.params['id'] as string)

// ─── Template + questions ─────────────────────────────────────────────────────

const template = ref<CheckinTemplate | null>(null)
const questions = ref<CheckinQuestion[]>([])
const loading = ref(true)

async function loadTemplate() {
  if (!db.isAvailable) { loading.value = false; return }
  const [tmpl, qs] = await Promise.all([
    db.getCheckinTemplate(templateId.value),
    db.getCheckinQuestions(templateId.value),
  ])
  template.value = tmpl
  questions.value = qs
  loading.value = false
}

// ─── Date navigation ──────────────────────────────────────────────────────────

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayKey = localDateKey(new Date())
const currentDate = ref(new Date())
const dateKey = computed(() => localDateKey(currentDate.value))
const isToday = computed(() => dateKey.value === todayKey)

const displayDate = computed(() =>
  currentDate.value.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }),
)

function prevDay() {
  const d = new Date(currentDate.value)
  d.setDate(d.getDate() - 1)
  currentDate.value = d
}

function nextDay() {
  if (isToday.value) return
  const d = new Date(currentDate.value)
  d.setDate(d.getDate() + 1)
  currentDate.value = d
}

// ─── Responses ────────────────────────────────────────────────────────────────

const responses = ref<Map<string, CheckinResponse>>(new Map())
const textValues = reactive<Record<string, string>>({})
let saveTimer: ReturnType<typeof setTimeout> | null = null

async function loadResponses() {
  if (!db.isAvailable) return
  const list = await db.getCheckinResponses(templateId.value, dateKey.value)
  responses.value = new Map(list.map(r => [r.question_id, r]))
  // Sync text inputs
  for (const q of questions.value) {
    const r = responses.value.get(q.id)
    if (r?.value_text != null) textValues[q.id] = r.value_text
    else delete textValues[q.id]
  }
}

watch(dateKey, async () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  await loadResponses()
})

async function setResponse(question_id: string, value_numeric: number | null, value_text: string | null) {
  if (!db.isAvailable) return
  const r = await db.upsertCheckinResponse(question_id, dateKey.value, value_numeric, value_text)
  responses.value.set(question_id, r)
}

function onText(question_id: string, val: string) {
  textValues[question_id] = val
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void setResponse(question_id, null, val.trim() || null)
  }, 600)
}

async function onScale(question_id: string, val: number) {
  const current = responses.value.get(question_id)?.value_numeric
  // Toggle off if same value
  if (current === val) {
    await setResponse(question_id, null, null)
  } else {
    await setResponse(question_id, val, null)
  }
}

async function onBoolean(question_id: string, val: number) {
  const current = responses.value.get(question_id)?.value_numeric
  if (current === val) {
    await setResponse(question_id, null, null)
  } else {
    await setResponse(question_id, val, null)
  }
}

onUnmounted(() => { if (saveTimer) clearTimeout(saveTimer) })

// ─── Questions management ─────────────────────────────────────────────────────

const showAddQuestion = ref(false)
const newPrompt = ref('')
const newResponseType = ref<'SCALE' | 'TEXT' | 'BOOLEAN'>('TEXT')
const addingQuestion = ref(false)
const deletingQuestion = reactive(new Set<string>())

async function addQuestion() {
  if (!db.isAvailable || !newPrompt.value.trim() || addingQuestion.value) return
  addingQuestion.value = true
  try {
    const q = await db.createCheckinQuestion({
      template_id: templateId.value,
      prompt: newPrompt.value.trim(),
      response_type: newResponseType.value,
      display_order: questions.value.length,
    })
    questions.value.push(q)
    newPrompt.value = ''
    newResponseType.value = 'TEXT'
    showAddQuestion.value = false
  } finally {
    addingQuestion.value = false
  }
}

async function deleteQuestion(qid: string) {
  if (!db.isAvailable || deletingQuestion.has(qid)) return
  deletingQuestion.add(qid)
  try {
    await db.deleteCheckinQuestion(qid)
    questions.value = questions.value.filter(q => q.id !== qid)
    responses.value.delete(qid)
    delete textValues[qid]
  } finally {
    deletingQuestion.delete(qid)
  }
}

// ─── Reminders ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const reminders = ref<CheckinReminder[]>([])
const showAddReminder = ref(false)
const newReminderTime = ref('')
const newReminderDays = ref<number[]>([])
const savingReminder = ref(false)
const deletingReminder = reactive(new Set<string>())

async function loadReminders() {
  if (!db.isAvailable) return
  reminders.value = await db.getCheckinRemindersForTemplate(templateId.value)
}

function reminderDaysLabel(r: CheckinReminder): string {
  if (!r.days_active || r.days_active.length === 0) return 'Every day'
  return r.days_active.map(d => DAY_NAMES[d]).join(', ')
}

function toggleNewReminderDay(day: number) {
  const idx = newReminderDays.value.indexOf(day)
  if (idx >= 0) newReminderDays.value.splice(idx, 1)
  else { newReminderDays.value.push(day); newReminderDays.value.sort((a, b) => a - b) }
}

async function addReminder() {
  if (!db.isAvailable || !newReminderTime.value || savingReminder.value) return
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
    useNotifications().scheduleAll().catch(console.error)
  } finally {
    savingReminder.value = false
  }
}

async function removeReminder(rid: string) {
  if (!db.isAvailable || deletingReminder.has(rid)) return
  deletingReminder.add(rid)
  try {
    await db.deleteCheckinReminder(rid)
    reminders.value = reminders.value.filter(r => r.id !== rid)
    useNotifications().scheduleAll().catch(console.error)
  } finally {
    deletingReminder.delete(rid)
  }
}

// ─── Edit template ────────────────────────────────────────────────────────────

const showEdit = ref(false)
const editTitle = ref('')
const editSchedule = ref<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY')
const editDays = ref<number[]>([])
const saving = ref(false)

function openEdit() {
  if (!template.value) return
  editTitle.value = template.value.title
  editSchedule.value = template.value.schedule_type
  editDays.value = template.value.days_active ? [...template.value.days_active] : []
  showEdit.value = true
}

function toggleEditDay(day: number) {
  const idx = editDays.value.indexOf(day)
  if (idx >= 0) editDays.value.splice(idx, 1)
  else { editDays.value.push(day); editDays.value.sort((a, b) => a - b) }
}

async function saveEdit() {
  if (!db.isAvailable || !template.value || saving.value) return
  saving.value = true
  try {
    const updated = await db.updateCheckinTemplate({
      id: template.value.id,
      title: editTitle.value.trim() || template.value.title,
      schedule_type: editSchedule.value,
      days_active: editSchedule.value === 'WEEKLY' && editDays.value.length ? [...editDays.value] : null,
    })
    template.value = updated
    showEdit.value = false
  } finally {
    saving.value = false
  }
}

// ─── Delete template ──────────────────────────────────────────────────────────

const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function deleteTemplate() {
  if (!db.isAvailable || !template.value || deleting.value) return
  deleting.value = true
  try {
    await db.deleteCheckinTemplate(template.value.id)
    await navigateTo('/checkin')
  } finally {
    deleting.value = false
  }
}

// ─── Schedule label helper ────────────────────────────────────────────────────

function scheduleLabel(t: CheckinTemplate): string {
  if (t.schedule_type === 'DAILY') return 'Daily'
  if (t.schedule_type === 'MONTHLY') return 'Monthly'
  if (!t.days_active || t.days_active.length === 0) return 'Weekly'
  return `Weekly · ${t.days_active.map(d => DAY_NAMES[d]).join(', ')}`
}

// ─── Init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadTemplate()
  await Promise.all([loadResponses(), loadReminders()])
})
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
        to="/checkin"
      />
      <span class="text-sm text-slate-500">Check-in</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin text-slate-600" />
    </div>

    <!-- Not found -->
    <div v-else-if="!template" class="flex flex-col items-center gap-3 py-12 text-center">
      <UIcon name="i-heroicons-exclamation-circle" class="w-8 h-8 text-slate-700" />
      <p class="text-sm text-slate-500">Check-in not found.</p>
      <UButton variant="ghost" color="neutral" size="sm" to="/checkin">Go back</UButton>
    </div>

    <template v-else>

      <!-- ── Header ────────────────────────────────────────────────────────── -->
      <header class="flex items-start justify-between">
        <div>
          <p class="text-xs text-slate-500">{{ scheduleLabel(template) }}</p>
          <h2 class="text-2xl font-bold leading-tight">{{ template.title }}</h2>
        </div>
        <div class="flex items-center gap-0.5 mt-1">
          <UButton
            icon="i-heroicons-pencil-square"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="openEdit"
          />
          <UButton
            icon="i-heroicons-chevron-left"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="prevDay"
          />
          <UButton
            icon="i-heroicons-chevron-right"
            variant="ghost"
            color="neutral"
            size="sm"
            :disabled="isToday"
            @click="nextDay"
          />
        </div>
      </header>

      <!-- Date label -->
      <p class="text-sm text-slate-400 -mt-2">{{ displayDate }}</p>

      <!-- ── Questions ─────────────────────────────────────────────────────── -->
      <div class="space-y-4">
        <div
          v-if="questions.length === 0"
          class="flex flex-col items-center gap-3 py-8 text-center"
        >
          <UIcon name="i-heroicons-plus-circle" class="w-7 h-7 text-slate-700" />
          <p class="text-sm text-slate-500">No questions yet. Add one below.</p>
        </div>

        <UCard
          v-for="q in questions"
          :key="q.id"
          :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <!-- Question prompt + delete -->
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-medium text-slate-100 leading-snug">{{ q.prompt }}</p>
            <button
              class="flex-shrink-0 text-slate-700 hover:text-red-400 transition-colors mt-0.5"
              :disabled="deletingQuestion.has(q.id)"
              @click="deleteQuestion(q.id)"
            >
              <UIcon name="i-heroicons-trash" class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- SCALE: 1–10 buttons -->
          <div v-if="q.response_type === 'SCALE'" class="flex gap-1 flex-wrap">
            <button
              v-for="n in 10"
              :key="n"
              class="w-8 h-8 rounded-full text-xs font-semibold border transition-colors"
              :class="responses.get(q.id)?.value_numeric === n
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'"
              @click="onScale(q.id, n)"
            >
              {{ n }}
            </button>
          </div>

          <!-- TEXT: textarea -->
          <UTextarea
            v-else-if="q.response_type === 'TEXT'"
            :model-value="textValues[q.id] ?? ''"
            placeholder="Write something…"
            :rows="3"
            autoresize
            variant="outline"
            class="w-full text-sm"
            @update:model-value="onText(q.id, $event)"
          />

          <!-- BOOLEAN: Yes / No -->
          <div v-else-if="q.response_type === 'BOOLEAN'" class="flex gap-2">
            <button
              class="flex-1 py-1.5 text-sm font-medium rounded-xl border transition-colors"
              :class="responses.get(q.id)?.value_numeric === 1
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'"
              @click="onBoolean(q.id, 1)"
            >
              Yes
            </button>
            <button
              class="flex-1 py-1.5 text-sm font-medium rounded-xl border transition-colors"
              :class="responses.get(q.id)?.value_numeric === 0
                ? 'bg-red-500/20 border-red-500 text-red-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'"
              @click="onBoolean(q.id, 0)"
            >
              No
            </button>
          </div>
        </UCard>
      </div>

      <!-- ── Add question ───────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">
        <div class="px-4 pt-3.5 pb-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-slate-400">Questions</p>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="showAddQuestion ? 'i-heroicons-chevron-up' : 'i-heroicons-plus'"
            @click="showAddQuestion = !showAddQuestion"
          />
        </div>

        <div v-if="showAddQuestion" class="px-4 py-3 space-y-3">
          <UInput
            v-model="newPrompt"
            placeholder="Question prompt…"
            autofocus
            @keydown.enter="addQuestion"
          />
          <!-- Response type -->
          <div class="space-y-1">
            <p class="text-[11px] text-slate-500">Response type</p>
            <div class="flex gap-1.5">
              <button
                v-for="rt in (['TEXT', 'SCALE', 'BOOLEAN'] as const)"
                :key="rt"
                class="flex-1 py-1 text-xs font-medium rounded-lg border transition-colors"
                :class="newResponseType === rt
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600'"
                @click="newResponseType = rt"
              >
                {{ rt === 'TEXT' ? 'Text' : rt === 'SCALE' ? '1–10' : 'Yes/No' }}
              </button>
            </div>
          </div>
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

      <!-- ── Reminders ─────────────────────────────────────────────────────── -->
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">
        <div class="px-4 pt-3.5 pb-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-slate-400">Reminders</p>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="showAddReminder ? 'i-heroicons-chevron-up' : 'i-heroicons-plus'"
            @click="showAddReminder = !showAddReminder"
          />
        </div>

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
            class="text-slate-700 hover:text-red-400 transition-colors"
            :disabled="deletingReminder.has(r.id)"
            @click="removeReminder(r.id)"
          >
            <UIcon name="i-heroicons-trash" class="w-4 h-4" />
          </button>
        </div>

        <div v-if="reminders.length === 0 && !showAddReminder" class="px-4 py-3 text-xs text-slate-600">
          No reminders set.
        </div>

        <div v-if="showAddReminder" class="px-4 py-3 space-y-3">
          <div class="flex items-center gap-3">
            <UInput v-model="newReminderTime" type="time" class="w-32" />
            <span class="text-xs text-slate-500">Remind me at this time</span>
          </div>
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

      <!-- ── Danger zone ────────────────────────────────────────────────────── -->
      <div class="space-y-2 pb-4">
        <p class="text-xs font-semibold text-slate-600">Danger zone</p>
        <UButton
          variant="soft"
          color="error"
          size="sm"
          icon="i-heroicons-trash"
          @click="showDeleteConfirm = true"
        >
          Delete check-in
        </UButton>
      </div>

    </template>

    <!-- ── Edit modal ─────────────────────────────────────────────────────── -->
    <div
      v-if="showEdit"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showEdit = false" />
      <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-slate-100">Edit Check-in</h3>
          <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showEdit = false" />
        </div>

        <UInput v-model="editTitle" placeholder="Name" @keydown.enter="saveEdit" />

        <div class="space-y-1.5">
          <p class="text-xs text-slate-500">Schedule</p>
          <div class="flex gap-1.5">
            <button
              v-for="sched in (['DAILY', 'WEEKLY', 'MONTHLY'] as const)"
              :key="sched"
              class="flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors"
              :class="editSchedule === sched
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'"
              @click="editSchedule = sched"
            >
              {{ sched === 'DAILY' ? 'Daily' : sched === 'WEEKLY' ? 'Weekly' : 'Monthly' }}
            </button>
          </div>
        </div>

        <div v-if="editSchedule === 'WEEKLY'" class="space-y-1.5">
          <p class="text-xs text-slate-500">Days (leave blank for every day)</p>
          <div class="flex gap-1.5">
            <button
              v-for="(label, i) in DAY_LABELS"
              :key="i"
              class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
              :class="editDays.includes(i)
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-slate-700 text-slate-500 hover:border-slate-600'"
              @click="toggleEditDay(i)"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <UButton variant="ghost" color="neutral" size="sm" @click="showEdit = false">Cancel</UButton>
          <UButton size="sm" :disabled="saving" :loading="saving" @click="saveEdit">Save</UButton>
        </div>
      </div>
    </div>

    <!-- ── Delete confirm modal ───────────────────────────────────────────── -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showDeleteConfirm = false" />
      <div class="relative w-full sm:max-w-sm bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
        <h3 class="font-semibold text-slate-100">Delete check-in?</h3>
        <p class="text-sm text-slate-400">
          This will delete <span class="text-slate-200 font-medium">{{ template?.title }}</span>
          along with all its questions and responses. This cannot be undone.
        </p>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" size="sm" @click="showDeleteConfirm = false">Cancel</UButton>
          <UButton
            color="error"
            size="sm"
            :disabled="deleting"
            :loading="deleting"
            @click="deleteTemplate"
          >
            Delete
          </UButton>
        </div>
      </div>
    </div>

  </div>
</template>
