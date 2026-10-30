<script setup lang="ts">
import {
  intervalElapsedSeconds,
  intervalProgressAt,
  parseIntervalConfiguration,
} from '~/lib/interval-clock'
import type { IntervalTemplate } from '~/lib/interval-templates'
import type { IntervalTemplateRow } from '~/types/database'

const route = useRoute()
const db = useDatabase()
const workout = useWorkout()
const config = ref<IntervalTemplate | null>(null)
const busy = ref(false)
const error = ref('')
const finished = ref(false)
const savedElapsed = ref(0)
const finishedRound = ref(1)
const now = ref(Date.now())
let timer: number | undefined
const ownSession = computed(() =>
  workout.activeInterval.value?.template_id === String(route.params['id'])
    ? workout.activeInterval.value
    : null,
)
const progress = computed(() =>
  ownSession.value && config.value
    ? intervalProgressAt(ownSession.value, config.value, now.value)
    : null,
)
const phaseName = computed(() =>
  finished.value
    ? 'Complete'
    : progress.value
      ? progress.value.paused_remaining_sec === null
        ? progress.value.phase === 'work'
          ? config.value?.type === 'mobility'
            ? 'Hold / practice'
            : 'Work'
          : progress.value.phase === 'rest'
            ? 'Rest'
            : 'Saving session'
        : 'Paused'
      : 'Ready',
)
const remaining = computed(() =>
  Math.ceil(
    progress.value?.paused_remaining_sec ??
      Math.max(0, ((progress.value?.phase_deadline_ms ?? now.value) - now.value) / 1000),
  ),
)
const elapsed = computed(() =>
  finished.value
    ? savedElapsed.value
    : ownSession.value && config.value
      ? intervalElapsedSeconds(ownSession.value, config.value, now.value)
      : 0,
)

function stopTicker() {
  window.clearInterval(timer)
  timer = undefined
}

async function runAction(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : 'Unable to save this session. Try again.'
  } finally {
    busy.value = false
  }
}

async function finishSession() {
  const round = progress.value?.round ?? 1
  const summary = await workout.finishWorkout({
    notes: `${config.value?.name ?? 'Interval session'} · round ${progress.value?.round ?? 1}`,
  })
  savedElapsed.value = summary.durationSec
  finishedRound.value = round
  finished.value = true
  stopTicker()
}

async function synchronize() {
  now.value = Date.now()
  const state = ownSession.value
  const next = progress.value
  if (!state || !next) return
  if (state.phase !== next.phase || state.round !== next.round)
    await workout.saveIntervalState(next)
  if (next.phase === 'complete') await finishSession()
}

onMounted(async () => {
  await runAction(async () => {
    await workout.hydrateActiveWorkout()
    if (ownSession.value) {
      config.value = { ...ownSession.value.config }
      await synchronize()
    } else {
      const rows = await db.query<IntervalTemplateRow>(
        'SELECT * FROM interval_templates WHERE id=?',
        [route.params['id']],
      )
      config.value = parseIntervalConfiguration(rows[0])
      if (workout.activeWorkout.value)
        error.value = 'Another session is unfinished. Resume or discard it from Workout first.'
    }
  })
  timer = window.setInterval(() => {
    if (ownSession.value && !finished.value && !error.value) void runAction(synchronize)
  }, 250)
})
onBeforeUnmount(stopTicker)

async function start() {
  await runAction(async () => {
    if (!config.value || workout.activeWorkout.value) return
    await workout.startWorkout(undefined, { intervalTemplateId: String(route.params['id']) })
    await workout.resumeWorkout()
    await synchronize()
  })
}

async function togglePause() {
  await runAction(async () => {
    await synchronize()
    const state = ownSession.value
    if (!state || finished.value) return
    now.value = Date.now()
    if (state.paused_remaining_sec === null) {
      await workout.saveIntervalState({
        ...state,
        paused_remaining_sec: Math.max(
          0,
          ((state.phase_deadline_ms ?? now.value) - now.value) / 1000,
        ),
        phase_deadline_ms: null,
      })
    } else {
      await workout.saveIntervalState({
        ...state,
        phase_deadline_ms: now.value + state.paused_remaining_sec * 1000,
        paused_remaining_sec: null,
      })
    }
  })
}

async function finishEarly() {
  if (!window.confirm('Finish and save this interval session now?')) return
  await runAction(finishSession)
}
</script>

<template>
  <article class="mx-auto max-w-lg p-4 space-y-5">
    <header class="flex items-center gap-3">
      <NuxtLink to="/templates/intervals" aria-label="Back to interval plans"><UIcon name="i-ph-arrow-left" class="h-5 w-5" /></NuxtLink>
      <h1 class="text-xl font-bold">{{ config?.name ?? 'Interval session' }}</h1>
    </header>
    <p v-if="error" role="alert" class="text-(--color-error)">{{ error }}</p>
    <UButton v-if="workout.activeWorkout.value && !ownSession" to="/workout" variant="outline">Go to unfinished workout</UButton>
    <section v-if="config" class="rounded-2xl bg-(--color-surface) p-6 text-center space-y-4">
      <p role="status" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">{{ phaseName }}</p>
      <p role="timer" :aria-label="`${phaseName}: ${remaining} seconds remaining`" class="text-6xl font-bold tabular-nums">{{ finished ? '✓' : !progress ? '—' : remaining }}</p>
      <p v-if="config.type !== 'amrap'" class="text-sm text-(--ui-text-muted)">Round {{ finished ? finishedRound : progress?.round ?? 1 }} of {{ config.rounds }}</p>
      <p class="text-sm text-(--ui-text-muted)">{{ elapsed }} seconds of training</p>
      <p class="text-xs text-(--ui-text-muted)">Your timer survives navigation and reload. Pause when you need a break.</p>
      <UButton v-if="!ownSession && !finished" class="w-full" :loading="busy" :disabled="!!workout.activeWorkout.value" @click="start">Start session</UButton>
      <div v-else-if="!finished" class="space-y-2">
        <UButton class="w-full" variant="outline" :disabled="busy" @click="togglePause">{{ progress?.paused_remaining_sec !== null ? 'Resume timer' : 'Pause timer' }}</UButton>
        <UButton class="w-full" variant="outline" :disabled="busy" @click="finishEarly">Finish session</UButton>
        <UButton v-if="error" class="w-full" :disabled="busy" @click="runAction(synchronize)">Retry saving</UButton>
      </div>
      <div v-else class="space-y-2">
        <p role="status">Session saved · {{ savedElapsed }} seconds</p>
        <UButton class="w-full" to="/workout">Return to training</UButton>
      </div>
    </section>
  </article>
</template>
