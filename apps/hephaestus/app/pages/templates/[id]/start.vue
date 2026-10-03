<script setup lang="ts">
import { computed, ref } from 'vue'
import { resolvePrescription } from '~/lib/prescription-evaluator'
import type { SessionType } from '~/types/database'
import type {
  NumericTarget,
  RoutineInputValue,
  SerializablePrescription,
} from '~/types/prescription'

const route = useRoute()
const templates = useTemplates()
const workout = useWorkout()
const { exercises, load: loadExercises } = useExercises()
const templateId = String(route.params['id'] ?? '')
const revision = ref<Awaited<ReturnType<typeof templates.getRevision>> | null>(null)
const inputs = ref<Record<string, RoutineInputValue>>({})
const fixedTargetValues = ref<Record<string, number>>({})
const error = ref('')
const starting = ref(false)
const scale = Number(route.query['scale'] ?? 1)
const excludedExerciseIds = String(route.query['exclude'] ?? '')
  .split(',')
  .filter(Boolean)
const requestedSessionType = String(route.query['sessionType'])
const sessionType: SessionType =
  requestedSessionType === 'conditioning' || requestedSessionType === 'mobility'
    ? requestedSessionType
    : 'gym'
const exerciseName = (id: string) =>
  exercises.value.find((exercise) => exercise.id === id)?.name ?? `Unknown exercise (${id})`
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
      .filter((activity) => !excludedExerciseIds.includes(activity.exerciseId))
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
if (revision.value)
  for (const input of revision.value.prescription.inputs)
    if (input.defaultValue !== null) inputs.value[input.id] = input.defaultValue
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
      scale,
      excludedExerciseIds,
      sessionType,
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
    <p class="text-sm text-(--ui-text-muted)">One-time prescribed session from template revision {{ revision?.revisionNumber }}. It will not create or change a saved routine.</p>
    <div v-if="error" class="flex items-center gap-2"><p role="alert" class="text-sm text-red-400">{{ error }}</p><UButton size="sm" variant="outline" @click="refreshReviewedRevision">Refresh revision</UButton></div><p v-else-if="resolved?.error" role="alert" class="text-sm text-red-400">{{ resolved.error }}</p>
    <section v-if="revision" class="space-y-3 rounded-xl bg-(--color-surface) p-3"><h2 class="font-semibold">Configuration inputs</h2><label v-for="input in revision.prescription.inputs" :key="input.id" class="block space-y-1"><span>{{ input.name }}{{ input.required ? ' · required' : ' · optional' }}</span><input v-if="input.field === 'boolean'" v-model="inputs[input.id]" type="checkbox" /><input v-else v-model.number="inputs[input.id]" type="number" :min="input.minimum ?? undefined" :max="input.maximum ?? undefined" :step="input.integer ? 1 : 'any'" class="w-full rounded bg-(--color-bg) p-2" /></label></section>
    <section v-if="revision" class="space-y-3 rounded-xl bg-(--color-surface) p-3"><h2 class="font-semibold">Direct fixed targets</h2><label v-for="entry in targets(revision.prescription)" :key="entry.target.id" class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{{ exerciseName(entry.exerciseId) }} · {{ entry.label }}</span><input v-if="entry.target.rule.kind === 'fixed'" v-model.number="fixedTargetValues[entry.target.id]" type="number" min="0" step="any" class="w-28 rounded bg-(--color-bg) p-2" /></label></section>
    <section class="space-y-2 rounded-xl border border-(--ui-border) p-3"><h2 class="font-semibold">Resolved session preview</h2><p v-for="activity in previewLines" :key="activity.id" class="text-sm"><strong>{{ activity.name }}</strong><span v-if="activity.targets.loggingMode !== 'strength'"> · {{ activity.targets.targets.durationSec?.resolvedValue ?? 'duration not prescribed' }} sec · {{ activity.targets.targets.distanceM?.resolvedValue ?? 'distance not prescribed' }} m</span><span v-for="set in activity.targets.sets" :key="set.id"> · {{ set.role }} {{ set.weightKg?.resolvedValue ?? 'load not prescribed' }} kg × {{ set.reps?.kind === 'exact' ? set.reps.value.resolvedValue : set.reps?.kind === 'range' ? `${set.reps.minimum}–${set.reps.maximum}` : set.reps?.kind === 'minimum' ? `${set.reps.minimum}+` : 'reps not prescribed' }} reps · RPE {{ set.rpe?.resolvedValue ?? 'unknown' }} · RIR {{ set.rir?.resolvedValue ?? 'unknown' }}</span></p></section>
  </article>
</template>
