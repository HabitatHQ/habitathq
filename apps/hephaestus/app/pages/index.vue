<script setup lang="ts">
import { formatDuration, formatVolume, isoWeek, localDateString } from '~/lib/format'
import type { ReadinessResult } from '~/lib/readiness'
import type { WorkoutRow } from '~/types/database'

const { settings } = useAppSettings()
const db = useDatabase()
const progress = useProgress()

const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const recentWorkouts = ref<WorkoutRow[]>([])
const thisWeekVolume = ref(0)
const lastWeekVolume = ref(0)
const streak = ref(0)
const readiness = ref<ReadinessResult | null>(null)

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
  const rows = await db.query<WorkoutRow>(
    'SELECT * FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC LIMIT 5',
  )
  recentWorkouts.value = rows

  // Weekly volume comparison
  const now = new Date()
  const thisWeek = isoWeek(now)
  const lastWeekDate = new Date(now)
  lastWeekDate.setDate(lastWeekDate.getDate() - 7)
  const lastWeek = isoWeek(lastWeekDate)

  const loadRows = await db.query<{ week: string; gym_volume: number | null }>(
    'SELECT week, gym_volume FROM weekly_training_load WHERE week IN (?, ?)',
    [thisWeek, lastWeek],
  )
  for (const row of loadRows) {
    if (row.week === thisWeek) thisWeekVolume.value = row.gym_volume ?? 0
    else lastWeekVolume.value = row.gym_volume ?? 0
  }

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
}

const volumeDelta = computed(() => {
  if (lastWeekVolume.value === 0) return null
  const pct = ((thisWeekVolume.value - lastWeekVolume.value) / lastWeekVolume.value) * 100
  return Math.round(pct)
})

function sessionLabel(w: WorkoutRow): string {
  if (w.session_type === 'run') return 'Run'
  const elapsed = w.ended_at
    ? formatDuration(
        Math.round((new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000),
      )
    : '—'
  return `Gym · ${elapsed}`
}
</script>

<template>
  <article class="p-4 space-y-6">
    <header class="pt-2">
      <h1 class="text-2xl font-bold">Today</h1>
      <time class="text-sm text-(--ui-text-muted)">{{ today }}</time>
    </header>

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
        <p class="text-2xl font-bold">{{ readiness.score }}<span class="text-xs text-(--ui-text-muted) ml-1">/ 100</span></p>
        <p class="text-xs" :class="{
          'text-green-400': readiness.label === 'High',
          'text-yellow-400': readiness.label === 'Moderate',
          'text-red-400': readiness.label === 'Low',
          'text-zinc-400': readiness.label === 'Detraining',
        }">{{ readiness.label }}</p>
      </div>
      <div v-else class="bg-(--color-surface) rounded-xl p-4 flex items-center justify-center">
        <p class="text-xs text-(--ui-text-muted)">No data yet</p>
      </div>
    </section>

    <!-- Weekly volume -->
    <section v-if="thisWeekVolume > 0" aria-labelledby="volume-heading" class="grid grid-cols-2 gap-3">
      <h2 id="volume-heading" class="sr-only">This week's training volume</h2>
      <CommonStatCard
        label="This Week"
        :value="formatVolume(thisWeekVolume, settings.weightUnit)"
        v-bind="volumeDelta !== null ? { sub: `${volumeDelta > 0 ? '+' : ''}${volumeDelta}% vs last week` } : {}"
      />
    </section>

    <!-- Quick start -->
    <section aria-label="Quick start">
      <UButton size="xl" color="primary" class="w-full" to="/workout">
        <UIcon name="i-heroicons-bolt" class="w-5 h-5" aria-hidden="true" />
        Start Workout
      </UButton>
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
                {{ new Date(w.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}
              </p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
          </NuxtLink>
        </li>
      </ul>

      <p v-else class="rounded-xl bg-(--color-surface) p-4 text-center text-(--ui-text-muted) text-sm">
        No recent workouts. Log your first session!
      </p>
    </section>
  </article>
</template>
