<script setup lang="ts">
import type { IntervalTemplate } from '~/lib/interval-templates'
import { calculateIntervalTotalTime } from '~/lib/interval-templates'
import type { IntervalTemplateRow } from '~/types/database'

const db = useDatabase()

const templates = ref<IntervalTemplateRow[]>([])
const loading = ref(true)

async function loadTemplates() {
  templates.value = await db.query<IntervalTemplateRow>(
    'SELECT * FROM interval_templates ORDER BY created_at DESC',
  )
}

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    await loadTemplates()
    loading.value = false
  },
  { immediate: true },
)

async function handleDelete(id: string) {
  await db.exec('DELETE FROM interval_templates WHERE id = ?', [id])
  templates.value = templates.value.filter((t) => t.id !== id)
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}min`
  return `${m}m ${s}s`
}

function totalTime(t: IntervalTemplateRow): string {
  const it: IntervalTemplate = {
    type: (t.type as any) ?? 'custom',
    name: t.name,
    rounds: t.rounds ?? 0,
    work_sec: t.work_sec ?? 0,
    rest_sec: t.rest_sec ?? 0,
    time_cap_sec: null,
  }
  const total = calculateIntervalTotalTime(it)
  return total > 0 ? formatDuration(total) : '—'
}

const typeColors: Record<string, string> = {
  tabata: 'text-orange-400',
  emom: 'text-blue-400',
  amrap: 'text-green-400',
  custom: 'text-zinc-400',
}
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center justify-between pt-2">
      <div class="flex items-center gap-3">
        <NuxtLink to="/templates" class="text-(--ui-text-muted)" aria-label="Back">
          <UIcon name="i-heroicons-arrow-left" class="w-6 h-6" aria-hidden="true" />
        </NuxtLink>
        <h1 class="text-2xl font-bold">Intervals</h1>
      </div>
      <UButton size="sm" color="primary" to="/templates/intervals/new">
        <UIcon name="i-heroicons-plus" class="w-4 h-4" aria-hidden="true" />
        New
      </UButton>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <ul v-else-if="templates.length > 0" role="list" class="space-y-2">
      <li v-for="t in templates" :key="t.id">
        <div class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <p class="font-semibold text-sm">{{ t.name }}</p>
              <span :class="['text-[10px] font-bold uppercase', typeColors[t.type] ?? 'text-zinc-400']">
                {{ t.type }}
              </span>
            </div>
            <p class="text-xs text-(--ui-text-muted) mt-0.5">
              <template v-if="t.rounds">{{ t.rounds }} rounds · </template>
              <template v-if="t.work_sec">{{ t.work_sec }}s on</template>
              <template v-if="t.rest_sec"> / {{ t.rest_sec }}s off</template>
              · {{ totalTime(t) }} total
            </p>
          </div>
          <button
            class="text-(--ui-text-muted) hover:text-red-400"
            :aria-label="`Delete ${t.name}`"
            @click="handleDelete(t.id)"
          >
            <UIcon name="i-heroicons-trash" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>

    <div v-else class="rounded-xl bg-(--color-surface) p-10 text-center space-y-3">
      <UIcon name="i-heroicons-clock" class="w-10 h-10 text-(--ui-text-muted) mx-auto" />
      <p class="text-sm text-(--ui-text-muted)">No interval templates yet.</p>
      <UButton to="/templates/intervals/new" color="primary" size="sm">Create Interval</UButton>
    </div>
  </article>
</template>
