<script setup lang="ts">
import { resolvePrescription } from '~/lib/prescription-evaluator'
import {
  canonicalTargetValue,
  displayTargetValue,
  fieldLabel,
  setSummary,
} from '~/lib/prescription-presentation'
import type { SessionType } from '~/types/database'
import type {
  NumericTarget,
  RoutineInputValue,
  SerializablePrescription,
  TemplateRevision,
} from '~/types/prescription'

const route = useRoute()
const templates = useTemplates()
const workout = useWorkout()
const { exercises, load: loadExercises } = useExercises()
const { settings } = useAppSettings()
const templateId = String(route.params['id'] ?? '')
const revision = ref<TemplateRevision | null>(null)
const inputs = ref<Record<string, RoutineInputValue>>({})
const fixedTargetValues = ref<Record<string, number>>({})
const error = ref('')
const starting = ref(false)
const scale = ref(Number(route.query['scale'] ?? 1))
const excludedExerciseIds = ref(
  String(route.query['exclude'] ?? '')
    .split(',')
    .filter(Boolean),
)
const requestedSessionType = String(route.query['sessionType'])
const sessionType = ref<SessionType>(
  requestedSessionType === 'conditioning' ||
    requestedSessionType === 'mobility' ||
    requestedSessionType === 'run'
    ? requestedSessionType
    : 'gym',
)
const exerciseName = (id: string) =>
  exercises.value.find((exercise) => exercise.id === id)?.name ?? 'Exercise unavailable'
function targets(prescription: SerializablePrescription) {
  const result: Array<{
    activityId: string
    exerciseId: string
    label: string
    target: NumericTarget
  }> = []
  for (const activity of prescription.activities) {
    for (const set of activity.sets) {
      for (const [label, target] of [
        ['load kg', set.weightKg],
        ['exact reps', set.reps?.kind === 'exact' ? set.reps.value : null],
        ['rest sec', set.restSec],
        ['RPE', set.rpe],
        ['RIR', set.rir],
      ] as const)
        if (target?.rule.kind === 'fixed')
          result.push({
            activityId: activity.id,
            exerciseId: activity.exerciseId,
            label: `Set ${set.order} ${set.role} · ${label}`,
            target,
          })
    }
    for (const [label, target] of [
      ['duration sec', activity.targets.durationSec],
      ['distance m', activity.targets.distanceM],
    ] as const)
      if (target?.rule.kind === 'fixed')
        result.push({ activityId: activity.id, exerciseId: activity.exerciseId, label, target })
  }
  return result
}
const resolved = computed(() => {
  if (!revision.value) return null
  try {
    return {
      prescription: resolvePrescription(
        revision.value.prescription,
        inputs.value,
        fixedTargetValues.value,
      ),
      error: '',
    }
  } catch (cause) {
    return { prescription: null, error: cause instanceof Error ? cause.message : String(cause) }
  }
})
const previewLines = computed(
  () =>
    resolved.value?.prescription?.activities
      .filter((activity) => !excludedExerciseIds.value.includes(activity.exerciseId))
      .map((activity) => ({
        id: activity.id,
        name: exerciseName(activity.exerciseId),
        targets: activity,
      })) ?? [],
)
await Promise.all([
  loadExercises(),
  templates.getRevision(templateId).then((value) => {
    revision.value = value
  }),
])
if (revision.value) {
  for (const input of revision.value.prescription.inputs)
    if (input.defaultValue !== null) inputs.value[input.id] = input.defaultValue
  for (const entry of targets(revision.value.prescription))
    if (entry.target.rule.kind === 'fixed')
      fixedTargetValues.value[entry.target.id] = entry.target.rule.value
}
function targetField(targetId: string) {
  for (const activity of revision.value?.prescription.activities ?? []) {
    if (activity.targets.distanceM?.id === targetId) return 'distanceM'
    if (activity.sets.some((set) => set.weightKg?.id === targetId)) return 'weightKg'
  }
  return 'scalar'
}
function targetLabel(entry: { label: string }) {
  return entry.label
    .replace('load kg', `load (${settings.value.weightUnit})`)
    .replace('distance m', `distance (${settings.value.distanceUnit})`)
}
function displayTarget(targetId: string) {
  const value = fixedTargetValues.value[targetId]
  return value === undefined
    ? ''
    : displayTargetValue(
        value,
        targetField(targetId),
        settings.value.weightUnit,
        settings.value.distanceUnit,
      )
}
function updateTarget(targetId: string, value: number) {
  fixedTargetValues.value[targetId] = canonicalTargetValue(
    value,
    targetField(targetId),
    settings.value.weightUnit,
    settings.value.distanceUnit,
  )
}
const activityExerciseIds = computed(() => [
  ...new Set(revision.value?.prescription.activities.map((activity) => activity.exerciseId) ?? []),
])
function toggleExcluded(exerciseId: string) {
  excludedExerciseIds.value = excludedExerciseIds.value.includes(exerciseId)
    ? excludedExerciseIds.value.filter((id) => id !== exerciseId)
    : [...excludedExerciseIds.value, exerciseId]
}
async function refreshReviewedRevision() {
  revision.value = await templates.getRevision(templateId)
  inputs.value = {}
  fixedTargetValues.value = {}
  for (const input of revision.value.prescription.inputs)
    if (input.defaultValue !== null) inputs.value[input.id] = input.defaultValue
  for (const entry of targets(revision.value.prescription))
    if (entry.target.rule.kind === 'fixed')
      fixedTargetValues.value[entry.target.id] = entry.target.rule.value
  error.value = ''
}
async function start() {
  if (!revision.value || !resolved.value?.prescription) return
  starting.value = true
  error.value = ''
  try {
    await workout.startWorkout(templateId, {
      scale: scale.value,
      excludedExerciseIds: excludedExerciseIds.value,
      sessionType: sessionType.value,
      inputs: { ...inputs.value },
      fixedTargetValues: { ...fixedTargetValues.value },
      expectedTemplateRevisionId: revision.value.id,
    })
    await navigateTo('/workout')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <article class="space-y-4 p-4 pb-24">
    <header class="flex items-center justify-between gap-2"><NuxtLink :to="`/templates/${templateId}`">Back</NuxtLink><h1 class="text-lg font-bold">Start once</h1><UButton color="primary" :loading="starting" :disabled="!revision || !resolved?.prescription" @click="start">Start workout</UButton></header>
    <p v-if="error" role="alert" class="text-(--color-error)">{{ error }}</p>
    <UButton v-if="error" variant="outline" @click="refreshReviewedRevision">Reload template</UButton>
    <p class="text-sm text-(--ui-text-muted)">One-time prescribed session from template revision {{ revision?.revisionNumber }}. It will not create or change a saved routine.</p>
    <section class="grid grid-cols-1 gap-3 rounded-xl bg-(--color-surface) p-3 sm:grid-cols-2">
      <label class="block text-sm">Session type<select v-model="sessionType" class="mt-1 w-full rounded bg-(--color-bg) p-2"><option value="gym">Strength / hypertrophy</option><option value="conditioning">Conditioning</option><option value="mobility">Mobility / recovery</option><option value="run">Run / cardio</option></select></label>
      <label class="block text-sm">Prescription scale<input v-model.number="scale" type="number" min="0.1" max="5" step="0.1" class="mt-1 w-full rounded bg-(--color-bg) p-2" /></label>
    </section>
    <fieldset v-if="activityExerciseIds.length > 1" class="space-y-2 rounded-xl bg-(--color-surface) p-3"><legend class="font-semibold">Exercises in this session</legend><label v-for="exerciseId in activityExerciseIds" :key="exerciseId" class="flex items-center gap-2 text-sm"><input type="checkbox" :checked="!excludedExerciseIds.includes(exerciseId)" @change="toggleExcluded(exerciseId)" />{{ exerciseName(exerciseId) }}</label></fieldset>
    <section v-if="revision?.prescription.inputs.length" class="space-y-3 rounded-xl bg-(--color-surface) p-3"><h2 class="font-semibold">Configuration inputs</h2><label v-for="input in revision.prescription.inputs" :key="input.id" class="block space-y-1"><span>{{ input.name }} · {{ fieldLabel(input.field, settings.weightUnit, settings.distanceUnit) }}{{ input.required ? ' · required' : ' · optional' }}</span><input v-if="input.field === 'boolean'" v-model="inputs[input.id]" type="checkbox" /><input v-else :value="typeof inputs[input.id] === 'number' ? displayTargetValue(Number(inputs[input.id]), input.field, settings.weightUnit, settings.distanceUnit) : ''" type="number" step="any" class="w-full rounded bg-(--color-bg) p-2" @change="inputs[input.id] = canonicalTargetValue(Number(($event.target as HTMLInputElement).value), input.field, settings.weightUnit, settings.distanceUnit)" /></label></section>
    <details v-if="revision && targets(revision.prescription).length" class="space-y-3 rounded-xl bg-(--color-surface) p-3"><summary class="cursor-pointer font-semibold">Adjust optional fixed targets</summary><label v-for="entry in targets(revision.prescription)" :key="entry.target.id" class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{{ exerciseName(entry.exerciseId) }} · {{ targetLabel(entry) }}</span><input v-if="entry.target.rule.kind === 'fixed'" :value="displayTarget(entry.target.id)" type="number" min="0" step="any" :aria-label="`${exerciseName(entry.exerciseId)} ${targetLabel(entry)}`" class="w-28 rounded bg-(--color-bg) p-2" @change="updateTarget(entry.target.id, Number(($event.target as HTMLInputElement).value))" /></label></details>
    <section class="space-y-2 rounded-xl border border-(--ui-border) p-3"><h2 class="font-semibold">Resolved session preview</h2><div v-for="activity in previewLines" :key="activity.id" class="text-sm"><h3 class="font-medium">{{ activity.name }}</h3><p v-if="activity.targets.targets.durationSec?.resolvedValue != null">{{ activity.targets.targets.durationSec.resolvedValue }} seconds</p><p v-if="activity.targets.targets.distanceM?.resolvedValue != null">{{ displayTargetValue(activity.targets.targets.distanceM.resolvedValue, 'distanceM', settings.weightUnit, settings.distanceUnit) }} {{ settings.distanceUnit }}</p><p v-for="set in activity.targets.sets" :key="set.id">{{ setSummary(set, settings.weightUnit, settings) }}</p></div></section>
  </article>
</template>
