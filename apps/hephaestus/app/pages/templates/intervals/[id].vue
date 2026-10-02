<script setup lang="ts">
import type { IntervalTemplate, IntervalType } from '~/lib/interval-templates'
import { advanceIntervalPhase } from '~/lib/interval-templates'
import type { IntervalTemplateRow } from '~/types/database'

const route = useRoute()
const db = useDatabase()
const workout = useWorkout()
const template = ref<IntervalTemplateRow | null>(null)
const phase = ref<'ready' | 'work' | 'rest' | 'complete'>('ready')
const remaining = ref(0)
const round = ref(1)
const elapsed = ref(0)
const starting = ref(false)
const error = ref('')
let timer: number | null = null

const sessionType = computed(() =>
  template.value?.type === 'mobility' ? ('mobility' as const) : ('conditioning' as const),
)
const isAmrap = computed(() => template.value?.type === 'amrap')
const rounds = computed(() => (isAmrap.value ? null : (template.value?.rounds ?? 1)))
const phaseName = computed(() =>
  phase.value === 'work'
    ? sessionType.value === 'mobility'
      ? 'Hold / practice'
      : 'Work'
    : phase.value === 'rest'
      ? sessionType.value === 'mobility'
        ? 'Recovery'
        : 'Rest'
      : phase.value === 'complete'
        ? 'Complete'
        : 'Ready',
)

function intervalConfig(row: IntervalTemplateRow): IntervalTemplate {
  const type: IntervalType =
    row.type === 'tabata' || row.type === 'emom' || row.type === 'amrap' || row.type === 'mobility'
      ? row.type
      : 'custom'
  return {
    type,
    name: row.name,
    rounds: row.rounds ?? 0,
    work_sec: row.work_sec ?? 0,
    rest_sec: row.rest_sec ?? 0,
    time_cap_sec: type === 'amrap' ? row.work_sec : null,
  }
}

onMounted(async () => {
  const rows = await db.query<IntervalTemplateRow>(
    'SELECT * FROM interval_templates WHERE id = ?',
    [route.params['id']],
  )
  template.value = rows[0] ?? null
  if (!template.value) error.value = 'Interval plan not found.'
})

async function finish(completed = true) {
  window.clearInterval(timer ?? 0)
  timer = null
  if (workout.activeWorkout.value) {
    const outcome = completed ? 'completed' : `stopped during ${phase.value}`
    try {
      await workout.finishWorkout({
        notes: `${template.value?.name ?? 'Training session'} · ${outcome} · round ${round.value}${rounds.value == null ? '' : ` of ${rounds.value}`} · ${elapsed.value}s`,
      })
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Unable to save this session.'
      return
    }
  }
  phase.value = 'complete'
}

async function start() {
  if (!template.value || starting.value || phase.value !== 'ready') return
  starting.value = true
  error.value = ''
  try {
    await workout.startWorkout(undefined, { sessionType: sessionType.value })
    phase.value = 'work'
    remaining.value = isAmrap.value
      ? Math.max(1, template.value.work_sec ?? 300)
      : Math.max(1, template.value.work_sec ?? 1)
    round.value = 1
    elapsed.value = 0
    timer = window.setInterval(() => {
      elapsed.value++
      remaining.value--
      if (
        remaining.value > 0 ||
        !template.value ||
        phase.value === 'ready' ||
        phase.value === 'complete'
      )
        return
      const next = advanceIntervalPhase(
        { phase: phase.value, round: round.value, remainingSeconds: 0 },
        intervalConfig(template.value),
      )
      if (next.phase === 'complete') {
        void finish()
        return
      }
      phase.value = next.phase
      round.value = next.round
      remaining.value = next.remainingSeconds
    }, 1000)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to start this session.'
  } finally {
    starting.value = false
  }
}

async function finishEarly() {
  await finish(false)
}

onBeforeUnmount(() => {
  window.clearInterval(timer ?? 0)
  timer = null
})
</script>

<template>
  <main class="mx-auto max-w-lg p-4 space-y-5">
    <header class="flex items-center gap-3">
      <NuxtLink to="/templates/intervals" aria-label="Back to interval plans"><UIcon name="i-ph-arrow-left" class="h-5 w-5" /></NuxtLink>
      <h1 class="text-xl font-bold">{{ template?.name ?? 'Training session' }}</h1>
    </header>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <section v-if="template" class="rounded-2xl bg-(--color-surface) p-6 text-center space-y-4" aria-live="polite">
      <p class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">{{ phaseName }}</p>
      <p class="text-6xl font-bold tabular-nums">{{ phase === 'ready' ? '—' : phase === 'complete' ? '✓' : remaining }}</p>
      <p v-if="!isAmrap" class="text-sm text-(--ui-text-muted)">Round {{ Math.min(round, rounds ?? 1) }} of {{ rounds }}</p>
      <p v-else class="text-sm text-(--ui-text-muted)">Time cap · {{ elapsed }}s elapsed</p>
      <p class="text-xs text-(--ui-text-muted)">
        {{ sessionType === 'mobility' ? 'Mobility holds are followed by recovery periods.' : 'Follow the work and rest cues; rounds advance automatically.' }}
      </p>
      <UButton v-if="phase === 'ready'" class="w-full" color="primary" :loading="starting" @click="start">Start session</UButton>
      <UButton v-else-if="phase !== 'complete'" class="w-full" color="neutral" variant="outline" @click="finishEarly">Finish session</UButton>
      <div v-else class="space-y-2">
        <p role="status">Session saved · {{ elapsed }} seconds</p>
        <UButton class="w-full" to="/workout">Return to training</UButton>
      </div>
    </section>
  </main>
</template>
