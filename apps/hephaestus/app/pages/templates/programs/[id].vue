<script setup lang="ts">
import type { ProgramRow } from '~/types/database'

const route = useRoute()
const programId = computed(() => route.params.id as string)
const { load, setActive, advanceWeek, getProgress } = usePrograms()
const db = useDatabase()

const program = ref<ProgramRow | null>(null)
const progress = ref<any>(null)
const loading = ref(true)

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    try {
      const programs = await load()
      program.value = programs.find((p) => p.id === programId.value) ?? null
      if (program.value) {
        progress.value = await getProgress(programId.value)
      }
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function handleSetActive() {
  if (!program.value) return
  await setActive(programId.value)
  const programs = await load()
  program.value = programs.find((p) => p.id === programId.value) ?? null
}

async function handleAdvanceWeek() {
  await advanceWeek(programId.value)
  const programs = await load()
  program.value = programs.find((p) => p.id === programId.value) ?? null
  progress.value = await getProgress(programId.value)
}
</script>

<template>
  <article class="p-4 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink to="/templates/programs" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1 truncate">{{ program?.name ?? 'Program' }}</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <template v-else-if="program">
      <!-- Status -->
      <div class="rounded-xl bg-(--color-surface) p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold">
              Week {{ program.current_week }} of {{ program.weeks }}
            </p>
            <p class="text-xs text-(--ui-text-muted)">
              {{ Math.round(((program.current_week - 1) / program.weeks) * 100) }}% complete
            </p>
          </div>
          <span
            v-if="program.active"
            class="text-xs font-bold px-2 py-1 rounded-full bg-(--color-accent)/15 text-(--color-accent)"
          >
            Active
          </span>
        </div>
        <div class="h-2 bg-(--color-surface-2) rounded-full overflow-hidden">
          <div
            class="h-full bg-(--color-accent) rounded-full transition-all"
            :style="{ width: `${Math.min(100, ((program.current_week - 1) / program.weeks) * 100)}%` }"
          />
        </div>
      </div>

      <!-- Today's days -->
      <div v-if="progress?.todaysDays?.length > 0" class="rounded-xl bg-(--color-surface) p-4 space-y-2">
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">Today</p>
        <div v-for="day in progress.todaysDays" :key="day.id" class="flex items-center justify-between">
          <p class="text-sm font-medium">{{ day.label ?? `Day ${day.day_num}` }}</p>
          <NuxtLink
            v-if="day.template_id"
            :to="`/templates/${day.template_id}`"
            class="text-xs text-(--color-accent)"
          >
            View template →
          </NuxtLink>
        </div>
      </div>

      <!-- Actions -->
      <div class="space-y-2">
        <UButton v-if="!program.active" class="w-full" color="primary" @click="handleSetActive">
          Set as Active Program
        </UButton>
        <UButton class="w-full" variant="outline" @click="handleAdvanceWeek">
          Advance to Week {{ program.current_week + 1 }}
        </UButton>
      </div>
    </template>
  </article>
</template>
