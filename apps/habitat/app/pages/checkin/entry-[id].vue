<script setup lang="ts">
import type { CheckinQuestion, CheckinResponse, CheckinTemplate } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'

const db = useDatabase()
const route = useRoute()
const router = useRouter()
const { notification } = useHaptics()

const templateId = computed(() => route.params['id'] as string)

// ─── Template + questions ─────────────────────────────────────────────────────

const template = ref<CheckinTemplate | null>(null)
const questions = ref<CheckinQuestion[]>([])
const loading = ref(true)

const loadError = ref<string | null>(null)

async function loadTemplate() {
  try {
    const [tmpl, qs] = await Promise.all([
      db.getCheckinTemplate(templateId.value),
      db.getCheckinQuestions(templateId.value),
    ])
    template.value = tmpl
    questions.value = qs
    loadError.value = null
  } catch (e) {
    loadError.value = logError('[checkin-entry/load]', e)
  } finally {
    loading.value = false
  }
}

// ─── Date navigation ──────────────────────────────────────────────────────────

const todayKey = toLocalDateKey()
const initDateStr = route.query['date'] as string | undefined
const initialDate = initDateStr ? new Date(`${initDateStr}T12:00:00`) : new Date()
const currentDate = ref(initialDate)
const dateKey = computed(() => toLocalDateKey(currentDate.value))
const isToday = computed(() => dateKey.value === todayKey)

const displayDate = computed(() =>
  currentDate.value.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
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
const savedIndicator = reactive<Record<string, boolean>>({})
const savedTimers: Record<string, ReturnType<typeof setTimeout>> = {}

async function loadResponses() {
  const [list, summary] = await Promise.all([
    db.getCheckinResponses(templateId.value, dateKey.value),
    db.getCheckinSummaryForDate(dateKey.value),
  ])
  responses.value = new Map(list.map((r) => [r.question_id, r]))
  isCompleted.value = summary.some((s) => s.template_id === templateId.value && s.is_completed)
  for (const q of questions.value) {
    const r = responses.value.get(q.id)
    if (r?.value_text == null) delete textValues[q.id]
    else textValues[q.id] = r.value_text
  }
}

let pendingQuestionId: string | null = null

async function flushPendingSave() {
  if (saveTimer && pendingQuestionId) {
    clearTimeout(saveTimer)
    saveTimer = null
    const val = textValues[pendingQuestionId]
    if (val != null) {
      await setResponse(pendingQuestionId, null, val.trim() || null)
    }
    pendingQuestionId = null
  }
}

watch(dateKey, async () => {
  await flushPendingSave()
  await loadResponses()
})

async function setResponse(
  question_id: string,
  value_numeric: number | null,
  value_text: string | null,
) {
  const r = await db.upsertCheckinResponse(question_id, dateKey.value, value_numeric, value_text)
  responses.value.set(question_id, r)
}

function onText(question_id: string, val: string) {
  textValues[question_id] = val
  pendingQuestionId = question_id
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    pendingQuestionId = null
    await setResponse(question_id, null, val.trim() || null)
    savedIndicator[question_id] = true
    if (savedTimers[question_id]) clearTimeout(savedTimers[question_id])
    savedTimers[question_id] = setTimeout(() => {
      savedIndicator[question_id] = false
    }, 1500)
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

onUnmounted(() => {
  void flushPendingSave()
})

// ─── Actions ──────────────────────────────────────────────────────────────────

const isCompleted = ref(false)
const completing = ref(false)

async function handleDone() {
  if (!template.value || completing.value) return
  completing.value = true
  try {
    await flushPendingSave()
    await db.toggleCheckinCompletion(template.value.id, dateKey.value)
    isCompleted.value = !isCompleted.value
    if (isCompleted.value) {
      void notification('success')
      router.back()
    }
  } finally {
    completing.value = false
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadTemplate()
  await loadResponses()
})
</script>

<template>
  <div class="space-y-5 pb-24">
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
      <header class="flex items-start justify-between">
        <div>
          <h2 class="text-2xl font-bold leading-tight">{{ template.title }}</h2>
        </div>
        <div class="flex items-center gap-0.5 mt-1">
          <UButton
            :icon="resolveIcon('cog-6-tooth')"
            variant="ghost"
            color="neutral"
            size="sm"
            aria-label="Check-in settings"
            class="min-h-[44px] min-w-[44px]"
            :to="`/checkin/${template.id}`"
          />
          <UButton
            :icon="resolveIcon('chevron-left')"
            variant="ghost"
            color="neutral"
            size="sm"
            aria-label="Previous day"
            class="min-h-[44px] min-w-[44px]"
            @click="prevDay"
          />
          <UButton
            :icon="resolveIcon('chevron-right')"
            variant="ghost"
            color="neutral"
            size="sm"
            aria-label="Next day"
            class="min-h-[44px] min-w-[44px]"
            :disabled="isToday"
            @click="nextDay"
          />
        </div>
      </header>

      <!-- Date label -->
      <p class="text-sm text-(--ui-text-muted) -mt-2">{{ displayDate }}</p>

      <!-- ── Questions ─────────────────────────────────────────────────────── -->
      <div class="space-y-4">
        <div
          v-if="questions.length === 0"
          class="flex flex-col items-center gap-3 py-8 text-center"
        >
          <AppIcon name="exclamation-circle" class="w-7 h-7 text-(--ui-text-dimmed)" />
          <p class="text-sm text-(--ui-text-dimmed)">This check-in has no questions yet.</p>
          <UButton variant="soft" color="neutral" size="sm" :to="`/checkin/${template.id}`">
            Configure Questions
          </UButton>
        </div>

        <UCard
          v-for="q in questions"
          :key="q.id"
          :ui="{ root: 'rounded-2xl', body: 'p-4 sm:p-4 space-y-3' }"
        >
          <!-- Question prompt -->
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-medium text-(--ui-text) leading-snug">{{ q.prompt }}</p>
          </div>

          <!-- SCALE: 1–10 buttons -->
          <div v-if="q.response_type === 'SCALE'" class="flex gap-1 flex-wrap">
            <button
              v-for="n in 10"
              :key="n"
              class="w-8 h-8 rounded-full text-xs font-semibold border transition-colors"
              :class="responses.get(q.id)?.value_numeric === n
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented) hover:text-(--ui-text-muted)'"
              @click="onScale(q.id, n)"
            >
              {{ n }}
            </button>
          </div>

          <!-- TEXT: textarea -->
          <template v-else-if="q.response_type === 'TEXT'">
            <AppTextArea
              :model-value="textValues[q.id] ?? ''"
              placeholder="Write something…"
              :rows="3"
              autoresize
              variant="outline"
              class="w-full"
              @update:model-value="onText(q.id, $event)"
            />
            <Transition
              enter-active-class="transition-opacity duration-150"
              leave-active-class="transition-opacity duration-500"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <span
                v-if="savedIndicator[q.id]"
                class="flex items-center gap-1 text-xs text-green-400 mt-1"
                aria-live="polite"
              >
                <AppIcon name="check" class="w-3 h-3" />
                Saved
              </span>
            </Transition>
          </template>

          <!-- BOOLEAN: Yes / No -->
          <div v-else-if="q.response_type === 'BOOLEAN'" class="flex gap-2">
            <button
              class="flex-1 py-1.5 text-sm font-medium rounded-xl border transition-colors"
              :class="responses.get(q.id)?.value_numeric === 1
                ? (q.desired_answer === 1
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'bg-red-500/20 border-red-500 text-red-300')
                : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented) hover:text-(--ui-text-muted)'"
              @click="onBoolean(q.id, 1)"
            >
              Yes
            </button>
            <button
              class="flex-1 py-1.5 text-sm font-medium rounded-xl border transition-colors"
              :class="responses.get(q.id)?.value_numeric === 0
                ? (q.desired_answer === 0
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'bg-red-500/20 border-red-500 text-red-300')
                : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented) hover:text-(--ui-text-muted)'"
              @click="onBoolean(q.id, 0)"
            >
              No
            </button>
          </div>
        </UCard>
      </div>

      <!-- Done Button -->
      <div v-if="questions.length > 0" class="mt-8 pt-4 pb-12 flex justify-center">
        <div class="w-full max-w-2xl mx-auto">
          <UButton
            block
            size="lg"
            :color="isCompleted ? 'success' : 'primary'"
            variant="solid"
            class="shadow-xl"
            :icon="isCompleted ? resolveIcon('check') : undefined"
            :loading="completing"
            @click="handleDone"
          >
            {{ isCompleted ? 'Completed' : 'Complete Check-in' }}
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
