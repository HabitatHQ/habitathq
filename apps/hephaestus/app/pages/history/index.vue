<script setup lang="ts">
import { formatDuration } from '~/lib/format'
import type { WorkoutRow } from '~/types/database'

const db = useDatabase()

const workouts = ref<WorkoutRow[]>([])
const loading = ref(true)
const filter = ref<'all' | 'gym' | 'run'>('all')
const searchQuery = ref('')

onMounted(async () => {
  if (db.status.value === 'ready') {
    await load()
  } else {
    watch(db.status, async (s) => {
      if (s === 'ready') await load()
    })
  }
})

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

const filtered = computed(() => {
  let result = workouts.value
  if (filter.value !== 'all') result = result.filter((w) => w.session_type === filter.value)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter((w) => w.date.includes(q) || (w.notes ?? '').toLowerCase().includes(q))
  }
  return result
})

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

function sessionLabel(w: WorkoutRow): string {
  if (w.session_type === 'run') return '🏃 Run'
  return '🏋️ Gym Session'
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
    <div class="flex gap-2" role="group" aria-label="Filter by session type">
      <button
        v-for="type in (['all', 'gym', 'run'] as const)"
        :key="type"
        class="px-3 py-1.5 text-xs font-medium rounded-full capitalize transition-colors"
        :class="
          filter === type
            ? 'bg-(--color-accent) text-white'
            : 'bg-(--color-surface) text-(--ui-text-muted)'
        "
        :aria-pressed="filter === type"
        @click="filter = type"
      >
        {{ type === 'all' ? 'All' : type === 'gym' ? 'Gym' : 'Runs' }}
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
            class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center justify-between"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ sessionLabel(w) }}</p>
              <p class="text-xs text-(--ui-text-muted)">
                {{ new Date(w.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}
                · {{ duration(w) }}
              </p>
              <p v-if="w.notes" class="text-xs text-(--ui-text-muted) truncate mt-0.5">
                {{ w.notes }}
              </p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-muted) shrink-0" aria-hidden="true" />
          </li>
        </ul>
      </section>
    </template>
  </article>
</template>
