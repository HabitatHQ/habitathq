<script setup lang="ts">
import { formatVolume } from '~/lib/format'
import { calculateAcuteLoad, calculateChronicLoad, getLoadRatio } from '~/lib/training-load'
import type { PersonalRecordRow, WeeklyTrainingLoadRow } from '~/types/database'

const { settings } = useAppSettings()
const db = useDatabase()

const prs = ref<PersonalRecordRow[]>([])
const weeklyLoad = ref<WeeklyTrainingLoadRow[]>([])
const loading = ref(true)

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
    // Load recent PRs with exercise names
    prs.value = await db.query<PersonalRecordRow>(
      'SELECT pr.* FROM personal_records pr ORDER BY pr.date DESC LIMIT 20',
    )
    weeklyLoad.value = await db.query<WeeklyTrainingLoadRow>(
      'SELECT * FROM weekly_training_load ORDER BY week DESC LIMIT 8',
    )
  } finally {
    loading.value = false
  }
}

const weeklyVolumes = computed(() => [...weeklyLoad.value].reverse().map((w) => w.gym_volume ?? 0))

const acuteLoad = computed(() => calculateAcuteLoad(weeklyVolumes.value))
const chronicLoad = computed(() => calculateChronicLoad(weeklyVolumes.value))
const acwr = computed(() => getLoadRatio(acuteLoad.value, chronicLoad.value))

const acwrColor = computed(() => {
  const r = acwr.value
  if (r === 0) return 'text-(--ui-text-muted)'
  if (r < 0.8) return 'text-blue-400'
  if (r <= 1.3) return 'text-green-400'
  return 'text-red-400'
})

const acwrLabel = computed(() => {
  const r = acwr.value
  if (r === 0) return 'No data'
  if (r < 0.8) return 'Detraining'
  if (r <= 1.0) return 'Optimal'
  if (r <= 1.3) return 'Progressive'
  return 'High risk'
})

const recentPRs = computed(() => prs.value.slice(0, 5))
</script>

<template>
  <article class="p-4 space-y-6">
    <header class="pt-2">
      <h1 class="text-2xl font-bold">Progress</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading analytics…</p>
    </div>

    <template v-else>
      <!-- Training Load -->
      <section aria-labelledby="load-heading">
        <h2 id="load-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-3">
          Training Load
        </h2>
        <div class="grid grid-cols-3 gap-3">
          <CommonStatCard
            label="Acute"
            :value="acuteLoad > 0 ? formatVolume(acuteLoad, settings.weightUnit) : '—'"
            sub="7-day avg"
          />
          <CommonStatCard
            label="Chronic"
            :value="chronicLoad > 0 ? formatVolume(chronicLoad, settings.weightUnit) : '—'"
            sub="28-day avg"
          />
          <div class="rounded-xl bg-(--color-surface) p-4 space-y-1">
            <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider">ACWR</p>
            <p class="text-2xl font-bold tabular-nums" :class="acwrColor">
              {{ acwr > 0 ? acwr.toFixed(2) : '—' }}
            </p>
            <p class="text-xs" :class="acwrColor">{{ acwrLabel }}</p>
          </div>
        </div>

        <!-- Weekly volume bars -->
        <div v-if="weeklyLoad.length > 0" class="mt-4 rounded-xl bg-(--color-surface) p-4">
          <p class="text-xs text-(--ui-text-muted) mb-3">Weekly Volume (last 8 weeks)</p>
          <div class="flex items-end gap-1 h-20">
            <div
              v-for="(w, i) in [...weeklyLoad].reverse()"
              :key="w.week"
              class="flex-1 rounded-sm transition-all"
              :class="i === weeklyLoad.length - 1 ? 'bg-(--color-accent)' : 'bg-(--color-surface-2)'"
              :style="{
                height: weeklyLoad.length ? `${((w.gym_volume ?? 0) / Math.max(...weeklyLoad.map(r => r.gym_volume ?? 0), 1)) * 100}%` : '0%',
                minHeight: (w.gym_volume ?? 0) > 0 ? '4px' : '0',
              }"
              :title="w.week"
              role="img"
              :aria-label="`Week ${w.week}: ${Math.round(w.gym_volume ?? 0)} kg`"
            />
          </div>
        </div>
      </section>

      <!-- Personal Records -->
      <section aria-labelledby="prs-heading">
        <h2 id="prs-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-3">
          Recent Personal Records
        </h2>

        <ul v-if="recentPRs.length > 0" role="list" class="space-y-2">
          <li
            v-for="pr in recentPRs"
            :key="pr.id"
            class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3"
          >
            <UIcon name="i-heroicons-trophy" class="w-5 h-5 text-yellow-400 shrink-0" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium capitalize">{{ pr.record_type }} PR</p>
              <p class="text-xs text-(--ui-text-muted)">
                {{ new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
              </p>
            </div>
            <span class="text-sm font-bold tabular-nums text-(--color-accent)">
              {{ Math.round(pr.value * 10) / 10 }} kg
            </span>
          </li>
        </ul>

        <div v-else class="rounded-xl bg-(--color-surface) p-6 text-center text-(--ui-text-muted)">
          <p>Complete workouts to track PRs.</p>
        </div>
      </section>
    </template>
  </article>
</template>
