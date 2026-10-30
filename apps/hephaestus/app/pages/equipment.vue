<script setup lang="ts">
import { fromKilograms, toKilograms } from '~/lib/equipment'

type Profile = {
  minimum_kg: number
  increment_kg: number
  maximum_kg: number | null
  additional: string
}
const { exercises, load: loadExercises } = useExercises()
const { load: loadProfiles, save, remove } = useEquipmentProfiles()
const { settings } = useAppSettings()
const profiles = ref(new Map<string, Profile>())
const savedProfiles = ref(new Set<string>())
const search = ref('')
const selectedExerciseId = ref('')
const busy = ref(false)
const error = ref('')
const status = ref('')
const filteredExercises = computed(() =>
  exercises.value.filter(
    (exercise) =>
      exercise.logging_mode === 'strength' &&
      exercise.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
  ),
)
const selectedExercise = computed(() =>
  exercises.value.find((exercise) => exercise.id === selectedExerciseId.value),
)
const profile = computed(() => profiles.value.get(selectedExerciseId.value))

onMounted(async () => {
  try {
    await loadExercises()
    const rows = await loadProfiles()
    for (const row of rows) {
      savedProfiles.value.add(row.exercise_id)
      const additional: number[] =
        typeof row.additional_loads_kg === 'string'
          ? JSON.parse(row.additional_loads_kg)
          : row.additional_loads_kg
      profiles.value.set(row.exercise_id, {
        minimum_kg: row.minimum_kg,
        increment_kg: row.increment_kg,
        maximum_kg: row.maximum_kg,
        additional: additional.join(', '),
      })
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to load equipment profiles.'
  }
})
watch(selectedExerciseId, (id) => {
  if (id && !profiles.value.has(id))
    profiles.value.set(id, { minimum_kg: 0, increment_kg: 2.5, maximum_kg: null, additional: '' })
  error.value = ''
  status.value = ''
})

// Conversion is display-only until an input event; saving an untouched field preserves exact kg.
function displayLoad(kg: number | null): number | null {
  return kg === null ? null : Math.round(fromKilograms(kg, settings.value.weightUnit) * 100) / 100
}
function editLoad(field: 'minimum_kg' | 'increment_kg' | 'maximum_kg', event: Event) {
  if (!profile.value || !(event.target instanceof HTMLInputElement)) return
  if (field === 'maximum_kg' && !event.target.value) profile.value[field] = null
  else profile.value[field] = toKilograms(event.target.valueAsNumber, settings.value.weightUnit)
  status.value = ''
}
const additionalDisplay = computed(() =>
  (profile.value?.additional ?? '')
    .split(',')
    .map((token) => {
      if (!token.trim()) return ''
      const kg = Number(token.trim())
      return Number.isFinite(kg) ? String(displayLoad(kg)) : token
    })
    .join(', '),
)
function editAdditional(event: Event) {
  if (!profile.value || !(event.target instanceof HTMLInputElement)) return
  profile.value.additional = event.target.value
    .split(',')
    .map((token) => {
      if (!token.trim()) return ''
      const value = Number(token.trim())
      return Number.isFinite(value) ? String(toKilograms(value, settings.value.weightUnit)) : token
    })
    .join(',')
  status.value = ''
}
async function saveProfile() {
  if (!profile.value) return
  busy.value = true
  error.value = ''
  try {
    const additional = profile.value.additional
      .split(',')
      .filter((value) => value.trim())
      .map(Number)
    if (additional.some((value) => !Number.isFinite(value) || value < 0))
      throw new Error('Additional loads must be comma-separated non-negative numbers.')
    await save({
      exercise_id: selectedExerciseId.value,
      minimum_kg: profile.value.minimum_kg,
      increment_kg: profile.value.increment_kg,
      maximum_kg: profile.value.maximum_kg,
      additional_loads_kg: additional,
    })
    savedProfiles.value.add(selectedExerciseId.value)
    status.value = 'Equipment profile saved.'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to save equipment profile.'
  } finally {
    busy.value = false
  }
}
async function deleteProfile() {
  busy.value = true
  error.value = ''
  try {
    await remove(selectedExerciseId.value)
    savedProfiles.value.delete(selectedExerciseId.value)
    profiles.value.set(selectedExerciseId.value, {
      minimum_kg: 0,
      increment_kg: 2.5,
      maximum_kg: null,
      additional: '',
    })
    status.value = 'Equipment profile removed; suggestions use the default increment.'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to remove equipment profile.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="mx-auto max-w-3xl space-y-5 p-4">
    <header class="space-y-2">
      <NuxtLink to="/templates" class="inline-flex items-center gap-2 text-sm text-(--ui-text-muted)"><UIcon name="i-ph-arrow-left" class="h-4 w-4" aria-hidden="true" />Back to training library</NuxtLink>
      <h1 class="text-2xl font-bold">Equipment profiles</h1>
      <p class="text-sm text-(--ui-text-muted)">Set available loads for suggestions. You can still enter any load while training.</p>
    </header>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <p v-if="status" role="status" class="text-sm">{{ status }}</p>
    <p v-if="savedProfiles.size" class="text-sm text-(--ui-text-muted)">{{ savedProfiles.size }} configured profiles</p>
    <label class="block space-y-1 text-sm">Find a strength exercise
      <input v-model="search" type="search" placeholder="Search exercises…" class="w-full rounded-lg border border-(--ui-border) bg-(--color-surface) p-3" />
    </label>
    <label class="block space-y-1 text-sm">Exercise
      <select v-model="selectedExerciseId" class="w-full rounded-lg border border-(--ui-border) bg-(--color-surface) p-3">
        <option value="">Choose an exercise</option>
        <option v-for="exercise in filteredExercises" :key="exercise.id" :value="exercise.id">{{ exercise.name }}{{ savedProfiles.has(exercise.id) ? ' · configured' : '' }}</option>
      </select>
    </label>
    <p v-if="!filteredExercises.length" class="rounded-xl bg-(--color-surface) p-4 text-sm text-(--ui-text-muted)">No strength exercises match that search.</p>
    <section v-if="selectedExercise && profile" class="space-y-3 rounded-xl border border-(--ui-border) p-4">
      <h2 class="font-semibold">{{ selectedExercise.name }}</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="text-sm">Minimum ({{ settings.weightUnit }})<input :value="displayLoad(profile.minimum_kg)" class="w-full min-w-0 rounded border bg-transparent p-2" type="number" min="0" step="any" @change="editLoad('minimum_kg', $event)" /></label>
        <label class="text-sm">Increment ({{ settings.weightUnit }})<input :value="displayLoad(profile.increment_kg)" class="w-full min-w-0 rounded border bg-transparent p-2" type="number" min="0.001" step="any" @change="editLoad('increment_kg', $event)" /></label>
        <label class="text-sm">Maximum ({{ settings.weightUnit }}, optional)<input :value="displayLoad(profile.maximum_kg)" class="w-full min-w-0 rounded border bg-transparent p-2" type="number" min="0" step="any" @change="editLoad('maximum_kg', $event)" /></label>
        <label class="text-sm">Additional available loads ({{ settings.weightUnit }})<input :value="additionalDisplay" class="w-full min-w-0 rounded border bg-transparent p-2" placeholder="e.g. 7.5, 12" @change="editAdditional" /></label>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton :loading="busy" @click="saveProfile">Save profile</UButton>
        <UButton v-if="savedProfiles.has(selectedExercise.id)" :disabled="busy" variant="outline" color="neutral" @click="deleteProfile">Remove profile</UButton>
      </div>
    </section>
  </article>
</template>
