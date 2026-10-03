<script setup lang="ts">
import { computed, ref } from 'vue'
import { resolvePrescription } from '~/lib/prescription-evaluator'
import type {
  NumericTarget,
  RoutineInputValue,
  SerializablePrescription,
} from '~/types/prescription'

const route = useRoute()
const routineId = computed(() => String(route.params['id'] ?? ''))
const routines = useRoutines()
const { exercises, load: loadExercises } = useExercises()
const data = ref<Awaited<ReturnType<typeof routines.get>> | null>(null)
const inputs = ref<Record<string, RoutineInputValue>>({})
const fixedValues = ref<Record<string, number>>({})
const name = ref('')
const policy = ref<'calendar_bound' | 'carry_forward'>('calendar_bound')
const deferral = ref<'automatic' | 'manual'>('automatic')
const error = ref('')
const exerciseName = (id: string) =>
  exercises.value.find((exercise) => exercise.id === id)?.name ?? `Unknown exercise (${id})`
const resolved = computed(() => {
  if (!data.value) return null
  try {
    return resolvePrescription(data.value.revision.prescription, inputs.value, fixedValues.value)
  } catch {
    return null
  }
})
const fixedTargets = computed(() =>
  data.value
    ? data.value.revision.prescription.activities.flatMap((activity) =>
        [
          ...activity.sets.flatMap((set) =>
            [
              {
                target: set.weightKg,
                label: `${exerciseName(activity.exerciseId)} · Set ${set.order} load (kg)`,
              },
              {
                target: set.reps?.kind === 'exact' ? set.reps.value : null,
                label: `${exerciseName(activity.exerciseId)} · Set ${set.order} exact reps`,
              },
              {
                target: set.restSec,
                label: `${exerciseName(activity.exerciseId)} · Set ${set.order} rest (sec)`,
              },
              {
                target: set.rpe,
                label: `${exerciseName(activity.exerciseId)} · Set ${set.order} RPE`,
              },
              {
                target: set.rir,
                label: `${exerciseName(activity.exerciseId)} · Set ${set.order} RIR`,
              },
            ].filter(
              (entry): entry is { target: NumericTarget; label: string } =>
                entry.target?.rule.kind === 'fixed',
            ),
          ),
          {
            target: activity.targets.durationSec,
            label: `${exerciseName(activity.exerciseId)} · Duration (sec)`,
          },
          {
            target: activity.targets.distanceM,
            label: `${exerciseName(activity.exerciseId)} · Distance (m)`,
          },
        ].filter(
          (entry): entry is { target: NumericTarget; label: string } =>
            entry.target?.rule.kind === 'fixed',
        ),
      )
    : [],
)
await Promise.all([
  loadExercises(),
  routines.get(routineId.value).then((value) => {
    data.value = value
  }),
])
if (data.value) {
  name.value = data.value.routine.name
  inputs.value = { ...data.value.revision.inputs }
  policy.value = data.value.routine.continuationPolicy
  deferral.value = data.value.routine.deferralMode ?? 'automatic'
  for (const activity of data.value.revision.prescription.activities) {
    for (const set of activity.sets)
      for (const target of [
        set.weightKg,
        set.restSec,
        set.rpe,
        set.rir,
        set.reps?.kind === 'exact' ? set.reps.value : null,
      ])
        if (target?.rule.kind === 'fixed') fixedValues.value[target.id] = target.rule.value
    for (const target of [activity.targets.durationSec, activity.targets.distanceM])
      if (target?.rule.kind === 'fixed') fixedValues.value[target.id] = target.rule.value
  }
}
async function save() {
  if (!data.value) return
  try {
    await routines.edit({
      routineId: routineId.value,
      expectedRevisionId: data.value.revision.id,
      name: name.value.trim(),
      inputs: { ...inputs.value },
      fixedTargetValues: { ...fixedValues.value },
      continuationPolicy: policy.value,
      deferralMode: policy.value === 'carry_forward' ? deferral.value : null,
    })
    await navigateTo(`/routines/${routineId.value}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function repsLabel(set: SerializablePrescription['activities'][number]['sets'][number]): string {
  if (!set.reps) return 'not prescribed'
  if (set.reps.kind === 'exact') return String(set.reps.value.resolvedValue ?? 'unresolved')
  if (set.reps.kind === 'range') return `${set.reps.minimum}–${set.reps.maximum}`
  return `${set.reps.minimum}+`
}
</script>

<template>
  <article class="space-y-5 p-4 pb-24"><header class="flex items-center justify-between gap-2"><NuxtLink :to="`/routines/${routineId}`">Back</NuxtLink><h1 class="font-bold">Edit routine configuration</h1><UButton color="primary" :disabled="!resolved" @click="save">Save revision</UButton></header><p v-if="error" role="alert" class="text-red-400">{{ error }}</p><template v-if="data"><label class="block">Name<input v-model="name" class="mt-1 w-full rounded-lg bg-(--color-surface) p-2" /></label><section v-for="input in data.revision.prescription.inputs" :key="input.id" class="rounded-lg bg-(--color-surface) p-3"><label>{{ input.name }} · {{ input.field }}<input v-if="input.field === 'boolean'" v-model="inputs[input.id]" type="checkbox" class="ml-2" /><input v-else v-model.number="inputs[input.id]" type="number" :min="input.minimum ?? undefined" :max="input.maximum ?? undefined" :step="input.integer ? 1 : 'any'" class="ml-2 rounded bg-(--color-bg) p-1" /></label></section><section class="space-y-2 rounded-xl bg-(--color-surface) p-3"><h2 class="font-semibold">Direct fixed targets</h2><label v-for="entry in fixedTargets" :key="entry.target.id" class="flex items-center justify-between gap-2 text-sm"><span>{{ entry.label }}</span><input v-model.number="fixedValues[entry.target.id]" type="number" min="0" step="any" class="w-24 rounded bg-(--color-bg) p-1" /></label></section><label>Continuation<select v-model="policy" aria-label="Continuation policy" class="ml-2 rounded bg-(--color-surface) p-2"><option value="calendar_bound">Calendar-bound</option><option value="carry_forward">Carry forward</option></select></label><select v-if="policy === 'carry_forward'" v-model="deferral" aria-label="Deferral mode" class="rounded bg-(--color-surface) p-2"><option value="automatic">Automatic</option><option value="manual">Manual</option></select><section v-if="resolved" class="space-y-2 rounded-xl border border-(--ui-border) p-3"><h2 class="font-semibold">Named recalculated targets</h2><div v-for="activity in resolved.activities" :key="activity.id"><h3 class="font-medium">{{ exerciseName(activity.exerciseId) }}</h3><p v-if="activity.loggingMode !== 'strength'" class="text-sm">{{ activity.loggingMode }} · duration {{ activity.targets.durationSec?.resolvedValue ?? 'not prescribed' }} sec · distance {{ activity.targets.distanceM?.resolvedValue ?? 'not prescribed' }} m</p><p v-for="set in activity.sets" :key="set.id" class="text-sm">{{ set.role }} · {{ set.weightKg?.resolvedValue ?? 'load not prescribed' }} kg × {{ repsLabel(set) }} reps · rest {{ set.restSec?.resolvedValue ?? 'not prescribed' }} sec · RPE {{ set.rpe?.resolvedValue ?? 'unknown' }} · RIR {{ set.rir?.resolvedValue ?? 'unknown' }}</p></div></section></template></article>
</template>
