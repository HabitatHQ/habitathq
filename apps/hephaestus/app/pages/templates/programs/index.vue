<script setup lang="ts">
import type { ProgramRow } from '~/types/database'

const { load } = usePrograms()
const db = useDatabase()

const programs = ref<ProgramRow[]>([])
const loading = ref(true)

watch(
  db.status,
  async (s) => {
    if (s !== 'ready') return
    loading.value = true
    programs.value = await load()
    loading.value = false
  },
  { immediate: true },
)
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center justify-between pt-2">
      <div class="flex items-center gap-3">
        <NuxtLink to="/templates" class="text-(--ui-text-muted)" aria-label="Back">
          <UIcon name="i-ph-arrow-left" class="w-6 h-6" aria-hidden="true" />
        </NuxtLink>
        <h1 class="text-2xl font-bold">Programs</h1>
      </div>
      <UButton size="sm" color="primary" to="/templates/programs/new">
        <UIcon name="i-ph-plus" class="w-4 h-4" aria-hidden="true" />
        New
      </UButton>
    </header>
    <p class="text-sm text-(--ui-text-muted)">Follow an adopted Program revision in a personal Training Plan. Editing a design does not change existing plans or captured workouts.</p>
    <UButton to="/plans" variant="outline">Personal Training Plans</UButton>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <ul v-else-if="programs.length > 0" role="list" class="space-y-2">
      <li v-for="p in programs" :key="p.id">
        <div class="rounded-xl bg-(--color-surface) px-4 py-3 space-y-2">
          <div class="flex items-start gap-3">
            <NuxtLink :to="`/templates/programs/${p.id}`" class="flex-1">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-sm">{{ p.name }}</p>
                <span
                  v-if="p.is_builtin"
                  class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400"
                >
                  Built-in
                </span>
              </div>
              <p class="text-xs text-(--ui-text-muted) mt-0.5">
                {{ p.weeks }} weeks · reusable template-based design
              </p>
            </NuxtLink>
          </div>

        </div>
      </li>
    </ul>

    <div v-else class="rounded-xl bg-(--color-surface) p-10 text-center space-y-3">
      <UIcon name="i-ph-calendar-dots" class="w-10 h-10 text-(--ui-text-muted) mx-auto" />
      <div>
        <p class="font-medium text-sm">No programs yet</p>
        <p class="text-xs text-(--ui-text-muted) mt-1">Create a structured training program with weekly templates.</p>
      </div>
      <UButton class="mt-2" to="/templates/programs/new" color="primary" size="sm">
        Create Program
      </UButton>
    </div>
  </article>
</template>
