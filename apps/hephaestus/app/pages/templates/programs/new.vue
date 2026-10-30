<script setup lang="ts">
import { BUILTIN_PROGRAMS } from '~/lib/programs'

const { create, addWeek, seedBuiltinPrograms } = usePrograms()

const programName = ref('')
const weekCount = ref(4)
const saving = ref(false)
const seeding = ref(false)

const selectedBuiltins = ref<string[]>([])
const canSave = computed(() => programName.value.trim().length > 0 && weekCount.value > 0)

async function handleSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const id = await create(programName.value.trim(), weekCount.value)
    for (let w = 1; w <= weekCount.value; w++) {
      await addWeek(id, w, { isDeload: w % 4 === 0 })
    }
    await navigateTo(`/templates/programs/${id}`)
  } finally {
    saving.value = false
  }
}

async function handleSeedBuiltins() {
  seeding.value = true
  try {
    await seedBuiltinPrograms(selectedBuiltins.value)
    await navigateTo('/templates/programs')
  } finally {
    seeding.value = false
  }
}
</script>

<template>
  <article class="p-4 pb-24 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink to="/templates/programs" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-ph-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1">New Program</h1>
      <UButton size="sm" color="primary" :disabled="!canSave || saving" :loading="saving" @click="handleSave">
        Save
      </UButton>
    </header>

    <div class="space-y-1">
      <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="prog-name">
        Program Name
      </label>
      <input
        id="prog-name"
        v-model="programName"
        type="text"
        placeholder="e.g. 5/3/1 BBB"
        class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
      />
    </div>

    <div class="space-y-1">
      <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider" for="prog-weeks">
        Duration (weeks)
      </label>
      <input
        id="prog-weeks"
        v-model.number="weekCount"
        type="number"
        min="1"
        max="52"
        class="w-full bg-(--color-surface) rounded-xl px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
      />
    </div>

    <div class="rounded-xl bg-(--color-surface) p-4 space-y-3">
      <p class="text-sm font-medium">Use a built-in design preset</p>
      <p class="text-xs text-(--ui-text-muted)">These presets contain progression suggestions and empty template slots, not ready-made workouts. Add your own templates to the slots before following a program.</p>
      <label v-for="program in BUILTIN_PROGRAMS" :key="program.name" class="flex items-start gap-3 rounded-lg bg-(--color-surface-2) p-3">
        <input v-model="selectedBuiltins" type="checkbox" :value="program.name" class="mt-1" />
        <span><strong>{{ program.name }}</strong><span class="block text-xs text-(--ui-text-muted)">{{ program.weeks }} weeks · {{ program.description }}</span></span>
      </label>
      <UButton class="w-full" variant="outline" :disabled="selectedBuiltins.length === 0" :loading="seeding" @click="handleSeedBuiltins">Import selected designs</UButton>
    </div>
  </article>
</template>
