<script setup lang="ts">
import { formatDuration } from '~/lib/format'
import { filterWorkouts, SESSION_TYPES, type SessionFilter, sessionLabel } from '~/lib/history'
import type { WorkoutRow } from '~/types/database'

const db = useDatabase()

const workouts = ref<WorkoutRow[]>([])
const loading = ref(true)
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
  const [year, month] = ym.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

function duration(w: WorkoutRow): string {
  if (!w.ended_at) return '—'
  const secs = Math.round(
    (new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000,
  )
  return formatDuration(secs)
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
                  {{ new Date(`${w.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}
                  · {{ duration(w) }}
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
