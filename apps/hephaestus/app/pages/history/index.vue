<script setup lang="ts">
import { formatCalendarDate, formatDurationSeconds as formatDuration } from '@habitathq/utils'
import { filterWorkouts, SESSION_TYPES, type SessionFilter, sessionLabel } from '~/lib/history'
import type { WorkoutRow } from '~/types/database'

const db = useDatabase()
const { settings } = useAppSettings()

const workouts = ref<WorkoutRow[]>([])
const loading = ref(true)
const runDistances = ref<Map<string, number>>(new Map())
const runDurations = ref<Map<string, number>>(new Map())
const filter = ref<SessionFilter>('all')
const searchQuery = ref('')

watch(
  db.status,
  async (s) => {
    if (s === 'ready') await load()
  },
  { immediate: true },
)

async function load() {
  loading.value = true
  try {
    workouts.value = await db.query<WorkoutRow>(
      'SELECT * FROM workouts WHERE ended_at IS NOT NULL ORDER BY date DESC, started_at DESC',
    )
    const runs = await db.query<{ workout_id: string; duration_sec: number | null }>(
      'SELECT workout_id,duration_sec FROM runs WHERE duration_sec IS NOT NULL',
    )
    runDurations.value = new Map(
      runs
        .filter((run) => run.duration_sec != null)
        .map((run) => [run.workout_id, run.duration_sec as number]),
    )
    const distances = await db.query<{ workout_id: string; distance_m: number | null }>(
      'SELECT workout_id,distance_m FROM runs WHERE distance_m IS NOT NULL',
    )
    runDistances.value = new Map(
      distances
        .filter((run) => run.distance_m != null)
        .map((run) => [run.workout_id, run.distance_m as number]),
    )
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => filterWorkouts(workouts.value, filter.value, searchQuery.value))

// Group by month
const grouped = computed(() => {
  const groups = new Map<string, WorkoutRow[]>()
  for (const w of filtered.value) {
    const month = w.date.slice(0, 7) // "2025-03"
    if (!groups.has(month)) groups.set(month, [])
    groups.get(month)?.push(w)
  }
  return [...groups.entries()].map(([month, items]) => ({ month, items }))
})

function monthLabel(ym: string): string {
  return formatCalendarDate(`${ym}-01`, { month: 'long', year: 'numeric' })
}

function duration(w: WorkoutRow): string {
  if (!w.ended_at) return '—'
  const elapsed = Math.round(
    (new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000,
  )
  const recorded = w.session_type === 'run' ? runDurations.value.get(w.id) : undefined
  return formatDuration(recorded ?? elapsed)
}

function distance(w: WorkoutRow): string | null {
  const meters = runDistances.value.get(w.id)
  if (w.session_type !== 'run' || meters == null) return null
  const unit = settings.value.distanceUnit
  const value = unit === 'mi' ? meters / 1609.344 : meters / 1000
  return `${value.toFixed(2)} ${unit}`
}
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="pt-2">
      <h1 class="text-2xl font-bold">History</h1>
    </header>

    <!-- Filter chips -->
    <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by session type">
      <button
        v-for="type in SESSION_TYPES"
        :key="type.value"
        class="min-h-11 px-3 py-1.5 text-xs font-medium rounded-full capitalize transition-colors"
        :class="
          filter === type.value
            ? 'bg-(--color-accent) text-(--color-on-accent)'
            : 'bg-(--color-surface) text-(--ui-text-muted)'
        "
        :aria-pressed="filter === type.value"
        @click="filter = type.value"
      >
        {{ type.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading workouts…</p>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="rounded-xl bg-(--color-surface) p-8 text-center text-(--ui-text-muted)">
      <p>No workouts yet. Start training!</p>
      <UButton class="mt-4" to="/workout" color="primary" size="sm">Start Workout</UButton>
    </div>

    <!-- Grouped list -->
    <template v-else>
      <section
        v-for="group in grouped"
        :key="group.month"
        :aria-labelledby="`month-${group.month}`"
      >
        <h2
          :id="`month-${group.month}`"
          class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2"
        >
          {{ monthLabel(group.month) }}
        </h2>
        <ul role="list" class="space-y-2">
          <li
            v-for="w in group.items"
            :key="w.id"
          >
            <NuxtLink
              :to="`/history/${w.id}`"
              class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3"
            >
              <!-- Session type avatar -->
              <div
                class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                :class="w.session_type === 'run' ? 'bg-green-500/20' : w.session_type === 'gym' ? 'bg-orange-500/20' : 'bg-(--color-surface-2)'"
                aria-hidden="true"
              >
                <UIcon
                  :name="w.session_type === 'run' ? 'i-ph-person-simple-run' : w.session_type === 'gym' ? 'i-ph-barbell' : 'i-ph-person-simple'"
                  class="w-4 h-4"
                  :class="w.session_type === 'run' ? 'text-green-400' : w.session_type === 'gym' ? 'text-orange-400' : 'text-(--ui-text-muted)'"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{{ sessionLabel(w) }}</p>
                <p class="text-xs text-(--ui-text-muted)">
                  {{ formatCalendarDate(w.date, { weekday: 'short', month: 'short', day: 'numeric' }) }}
                  · {{ duration(w) }}
                  <template v-if="distance(w)"> · {{ distance(w) }}</template>
                </p>
                <p v-if="w.notes" class="text-xs text-(--ui-text-muted) truncate mt-0.5">
                  {{ w.notes }}
                </p>
              </div>
              <UIcon name="i-ph-caret-right" class="w-4 h-4 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
            </NuxtLink>
          </li>
        </ul>
      </section>
    </template>
  </article>
</template>
