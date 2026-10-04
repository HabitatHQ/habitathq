<script setup lang="ts">
import { formatDurationSeconds as formatDuration, localDateString } from '@habitathq/utils'
import type { ReadinessResult } from '~/lib/readiness'
import type { WorkoutRow } from '~/types/database'

const db = useDatabase()
const progress = useProgress()
const workout = useWorkout()
const organization = useOrganization()
const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const recentWorkouts = ref<WorkoutRow[]>([])
const unfinishedWorkout = ref<WorkoutRow | null>(null)
const streak = ref(0)
const readiness = ref<ReadinessResult | null>(null)
const priorityItems = ref<import('~/types/organization').OrganizationTodayItem[]>([])
const startError = ref('')
const starting = ref<string | null>(null)
const routineNames = ref<Record<string, string>>({})

// Watch at setup scope so the watcher is automatically stopped on unmount,
// preventing stale async callbacks from touching unmounted component state.
watch(
  db.status,
  async (s) => {
    if (s === 'ready') await loadData()
  },
  { immediate: true },
)

async function loadData() {
  const unfinished = await db.query<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
  )
  unfinishedWorkout.value = unfinished[0] ?? null
  const rows = await db.query<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC LIMIT 5',
  )
  recentWorkouts.value = rows

  // Calculate streak
  const workoutDates = await db.query<{ date: string }>(
    'SELECT DISTINCT date FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC LIMIT 365',
  )
  const dateSet = new Set(workoutDates.map((w) => w.date))
  let currentStreak = 0
  const todayDate = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - i)
    const ds = localDateString(d)
    if (dateSet.has(ds)) {
      currentStreak++
    } else if (i > 0) {
      break
    }
  }
  streak.value = currentStreak

  readiness.value = await progress.readinessData()
  priorityItems.value = await organization.today(localDateString(new Date()))
  const routineRows = await db.query<{ id: string; name: string }>(
    'SELECT id,name FROM saved_routines ORDER BY name,id',
  )
  routineNames.value = Object.fromEntries(routineRows.map((row) => [row.id, row.name]))
}

async function startPriority(
  item: import('~/types/organization').OrganizationTodayItem,
  alternativeRoutineId?: string,
) {
  if (item.kind === 'recovery' || item.workoutId) {
    await navigateTo('/workout')
    return
  }
  const chosenRoutine = alternativeRoutineId ?? item.routineId
  if (!chosenRoutine) return
  starting.value = item.id
  startError.value = ''
  try {
    await workout.startRoutineWorkout(chosenRoutine, {
      ...(alternativeRoutineId === undefined && item.kind === 'appointment'
        ? { appointmentId: item.id }
        : {}),
      ...(alternativeRoutineId === undefined &&
      item.kind === 'rotation' &&
      item.rotationId &&
      item.generation !== null
        ? { rotationId: item.rotationId, rotationGeneration: item.generation }
        : {}),
    })
    await navigateTo('/workout')
  } catch (cause) {
    startError.value = cause instanceof Error ? cause.message : 'Could not start this selection.'
  } finally {
    starting.value = null
  }
}
async function postponeAppointment(item: import('~/types/organization').OrganizationTodayItem) {
  if (item.kind !== 'appointment' || item.workoutId) return
  const proposed = window.prompt(
    'Move this appointment to local date (YYYY-MM-DD):',
    item.date ?? localDateString(new Date()),
  )
  if (!proposed) return
  try {
    const preview = await organization.previewPostpone(item.id, proposed)
    const confirmed =
      preview.collisionIds.length === 0 ||
      window.confirm(
        `This creates ${preview.collisionIds.length} same-routine collision(s). Move anyway?`,
      )
    if (!confirmed) return
    await organization.postpone(item.id, proposed, preview.collisionIds.length > 0)
    await loadData()
  } catch (cause) {
    startError.value =
      cause instanceof Error ? cause.message : 'Could not postpone this appointment.'
  }
}

function sessionLabel(w: WorkoutRow): string {
  if (w.session_type === 'run') return 'Run'
  const elapsed = w.ended_at
    ? formatDuration(
        Math.round((new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000),
      )
    : '—'
  const label = {
    gym: 'Strength',
    run: 'Run',
    conditioning: 'Conditioning',
    mobility: 'Mobility',
    other: 'Other',
  }[w.session_type]
  return `${label} · ${elapsed}`
}
</script>

<template>
  <article class="p-4 space-y-6">
    <header class="pt-2">
      <h1 class="text-2xl font-bold">Today</h1>
      <time class="text-sm text-(--ui-text-muted)">{{ today }}</time>
    </header>
    <section aria-labelledby="next-heading" class="space-y-3">
      <h2 id="next-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">Next up</h2>
      <p v-if="startError" role="alert" class="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{{ startError }}</p>
      <article v-for="item in priorityItems" :key="`${item.kind}-${item.id}`" class="rounded-xl bg-(--color-surface) p-4 space-y-3">
        <div>
          <p class="font-semibold">{{ item.title }}</p>
          <p class="text-sm text-(--ui-text-muted)">{{ item.explanation }}</p>
          <p v-if="item.planName" class="text-xs text-(--ui-text-muted)">{{ item.planName }}</p>
          <p v-if="item.date" class="text-xs text-(--ui-text-muted)">{{ item.date }}{{ item.time ? ` · ${item.time}` : '' }}</p>
        </div>
        <UButton v-if="item.kind === 'recovery' || item.workoutId" class="w-full" color="primary" @click="startPriority(item)">Resume unfinished workout</UButton>
        <UButton v-else-if="item.routineId" class="w-full" color="primary" :loading="starting === item.id" @click="startPriority(item)">
          Start {{ item.kind === 'appointment' ? 'scheduled' : item.kind === 'rotation' ? 'rotation' : 'suggested' }} workout
        </UButton>
        <UButton v-if="item.kind === 'appointment' && !item.workoutId" class="w-full" variant="outline" @click="postponeAppointment(item)">Postpone</UButton>
        <div v-if="item.alternatives.length" class="flex flex-wrap gap-2">
          <UButton v-for="alternative in item.alternatives" :key="alternative" size="sm" variant="outline" @click="startPriority(item, alternative)">
            {{ routineNames[alternative] ?? 'Alternative routine' }}
          </UButton>
        </div>
      </article>
      <div class="flex gap-2">
        <UButton class="flex-1" to="/workout" variant="outline">Start ad-hoc</UButton>
        <UButton class="flex-1" to="/plans" variant="outline">Plans &amp; schedules</UButton>
      </div>
    </section>

    <!-- Streak + Readiness -->
    <section class="grid grid-cols-2 gap-3">
      <!-- Streak -->
      <div class="bg-(--color-surface) rounded-xl p-4 flex flex-col items-center justify-center">
        <UIcon name="i-ph-flame" class="text-orange-400 text-2xl mb-1" aria-hidden="true" />
        <p class="text-2xl font-bold">{{ streak }}</p>
        <p class="text-xs text-(--ui-text-muted)">Day streak</p>
      </div>
      <!-- Readiness -->
      <div v-if="readiness" class="bg-(--color-surface) rounded-xl p-4">
        <p class="text-xs text-(--ui-text-muted) mb-1">Readiness</p>
        <p v-if="readiness.score !== null" class="text-2xl font-bold">{{ readiness.score }}<span class="text-xs text-(--ui-text-muted) ml-1">/ 100</span></p>
        <p class="text-xs" :class="{
          'text-green-400': readiness.label === 'High',
          'text-yellow-400': readiness.label === 'Moderate',
          'text-red-400': readiness.label === 'Low',
        }">{{ readiness.label }}</p>
      </div>
      <div v-else class="bg-(--color-surface) rounded-xl p-4 flex items-center justify-center">
        <p class="text-xs text-(--ui-text-muted)">No data yet</p>
      </div>
      <p class="col-span-2 text-xs text-(--ui-text-muted)">Readiness is an estimate from your recent training, not medical advice or a recovery prescription.</p>
    </section>


    <!-- Quick start -->
    <section aria-label="Quick start">
      <UButton size="xl" color="primary" class="w-full" to="/workout">
        <UIcon name="i-ph-lightning" class="w-5 h-5" aria-hidden="true" />
        {{ unfinishedWorkout ? 'Resume Workout' : 'Start Workout' }}
      </UButton>
    </section>
    <section aria-label="Training tools" class="flex flex-wrap gap-2">
      <UButton to="/templates" variant="soft">Templates &amp; programs</UButton>
      <UButton to="/progress" variant="soft">Progress</UButton>
      <UButton to="/templates/intervals" variant="soft">Interval timer</UButton>
    </section>

    <!-- Recent activity -->
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
        Recent Activity
      </h2>

      <ul v-if="recentWorkouts.length > 0" role="list" class="space-y-2">
        <li
          v-for="w in recentWorkouts"
          :key="w.id"
        >
          <NuxtLink
            :to="`/history/${w.id}`"
            class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center justify-between"
          >
            <div>
              <p class="text-sm font-medium">{{ sessionLabel(w) }}</p>
              <p class="text-xs text-(--ui-text-muted)">
                {{ new Date(`${w.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}
              </p>
            </div>
            <UIcon name="i-ph-caret-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
          </NuxtLink>
        </li>
      </ul>

      <p v-else class="rounded-xl bg-(--color-surface) p-4 text-center text-(--ui-text-muted) text-sm">
        No recent workouts. Log your first session!
      </p>
    </section>
  </article>
</template>
