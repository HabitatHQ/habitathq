<script setup lang="ts">
import { fromKilograms, toKilograms } from '~/lib/equipment'
import type { ExerciseRow } from '~/types/database'

const { exercises, load: loadExercises } = useExercises()
const { load: loadProfiles, save, remove } = useEquipmentProfiles()
const { settings } = useAppSettings()
const profiles = ref(
  new Map<
    string,
    { minimum_kg: number; increment_kg: number; maximum_kg: number | null; additional: string }
  >(),
)
const savedProfiles = ref(new Set<string>())
const busy = ref<string | null>(null)
const error = ref('')

onMounted(async () => {
  await loadExercises()
  const rows = await loadProfiles()
  savedProfiles.value = new Set(rows.map((row) => row.exercise_id))
  const formProfiles = new Map<
    string,
    { minimum_kg: number; increment_kg: number; maximum_kg: number | null; additional: string }
  >()
  for (const row of rows) {
    let additional: number[] = []
    try {
      additional =
        typeof row.additional_loads_kg === 'string'
          ? JSON.parse(row.additional_loads_kg)
          : row.additional_loads_kg
    } catch {
      additional = []
    }
    formProfiles.set(row.exercise_id, {
      minimum_kg: fromKilograms(row.minimum_kg, settings.value.weightUnit),
      increment_kg: fromKilograms(row.increment_kg, settings.value.weightUnit),
      maximum_kg:
        row.maximum_kg == null ? null : fromKilograms(row.maximum_kg, settings.value.weightUnit),
      additional: additional
        .map((value) => fromKilograms(value, settings.value.weightUnit))
        .join(', '),
    })
  }
  for (const exercise of exercises.value.filter((item) => item.logging_mode === 'strength')) {
    if (!formProfiles.has(exercise.id)) {
      formProfiles.set(exercise.id, {
        minimum_kg: 0,
        increment_kg: fromKilograms(2.5, settings.value.weightUnit),
        maximum_kg: null,
        additional: '',
      })
    }
  }
  profiles.value = formProfiles
})

watch(
  () => settings.value.weightUnit,
  (nextUnit, previousUnit) => {
    if (nextUnit === previousUnit) return
    profiles.value = new Map(
      [...profiles.value].map(([id, profile]) => {
        const additional = profile.additional
          .split(',')
          .filter((value) => value.trim().length > 0)
          .map((value) => Number(value.trim()))
          .filter(Number.isFinite)
        return [
          id,
          {
            minimum_kg: fromKilograms(toKilograms(profile.minimum_kg, previousUnit), nextUnit),
            increment_kg: fromKilograms(toKilograms(profile.increment_kg, previousUnit), nextUnit),
            maximum_kg:
              profile.maximum_kg == null
                ? null
                : fromKilograms(toKilograms(profile.maximum_kg, previousUnit), nextUnit),
            additional: additional
              .map((value) => fromKilograms(toKilograms(value, previousUnit), nextUnit))
              .join(', '),
          },
        ]
      }),
    )
  },
)

const strengthExercises = computed(() =>
  exercises.value.filter((exercise: ExerciseRow) => exercise.logging_mode === 'strength'),
)
function profileFor(exerciseId: string) {
  return (
    profiles.value.get(exerciseId) ?? {
      minimum_kg: 0,
      increment_kg: 2.5,
      maximum_kg: null,
      additional: '',
    }
  )
}

async function saveProfile(exerciseId: string) {
  const profile = profileFor(exerciseId)
  busy.value = exerciseId
  error.value = ''
  try {
    const additional = profile.additional
      .split(',')
      .filter((value) => value.trim().length > 0)
      .map((value) => Number(value.trim()))
    if (additional.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Additional loads must be comma-separated non-negative numbers')
    }
    await save({
      exercise_id: exerciseId,
      minimum_kg: toKilograms(profile.minimum_kg, settings.value.weightUnit),
      increment_kg: toKilograms(profile.increment_kg, settings.value.weightUnit),
      maximum_kg:
        profile.maximum_kg == null
          ? null
          : toKilograms(profile.maximum_kg, settings.value.weightUnit),
      additional_loads_kg: additional.map((value) => toKilograms(value, settings.value.weightUnit)),
    })
    savedProfiles.value.add(exerciseId)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to save equipment profile'
  } finally {
    busy.value = null
  }
}

async function deleteProfile(exerciseId: string) {
  busy.value = exerciseId
  try {
    await remove(exerciseId)
    profiles.value.set(exerciseId, {
      minimum_kg: 0,
      increment_kg: fromKilograms(2.5, settings.value.weightUnit),
      maximum_kg: null,
      additional: '',
    })
    savedProfiles.value.delete(exerciseId)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Unable to remove equipment profile'
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <article class="mx-auto max-w-3xl p-4 space-y-5">
    <header>
      <h1 class="text-2xl font-bold">Equipment profiles</h1>
      <p class="text-sm text-(--ui-text-muted)">Configure available loads for suggestions. Values display in {{ settings.weightUnit }} and are stored canonically in kilograms. Manual set entry remains unrestricted.</p>
    </header>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <section v-for="exercise in strengthExercises" :key="exercise.id" class="rounded-xl border border-(--ui-border) p-4 space-y-3">
      <h2 class="font-semibold">{{ exercise.name }}</h2>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm">Minimum ({{ settings.weightUnit }})<input v-model.number="profileFor(exercise.id).minimum_kg" class="w-full rounded border p-2 bg-transparent" type="number" min="0" step="any" /></label>
        <label class="text-sm">Increment ({{ settings.weightUnit }})<input v-model.number="profileFor(exercise.id).increment_kg" class="w-full rounded border p-2 bg-transparent" type="number" min="0.001" step="any" /></label>
        <label class="text-sm">Maximum ({{ settings.weightUnit }}, optional)<input v-model.number="profileFor(exercise.id).maximum_kg" class="w-full rounded border p-2 bg-transparent" type="number" min="0" step="any" /></label>
        <label class="text-sm">Additional available loads ({{ settings.weightUnit }})<input v-model="profileFor(exercise.id).additional" class="w-full rounded border p-2 bg-transparent" placeholder="e.g. 7.5, 12" /></label>
      </div>
      <div class="flex gap-2">
        <UButton :loading="busy === exercise.id" @click="saveProfile(exercise.id)">Save profile</UButton>
        <UButton v-if="savedProfiles.has(exercise.id)" variant="outline" color="neutral" @click="deleteProfile(exercise.id)">Remove</UButton>
      </div>
    </section>
  </article>
</template>
