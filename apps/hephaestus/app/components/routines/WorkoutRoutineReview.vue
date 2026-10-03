<script setup lang="ts">
import { resolvePrescription } from '~/lib/prescription-evaluator'
import type { FutureUpdatePreview, RoutineInputValue } from '~/types/prescription'

const props = defineProps<{ workoutId: string }>()
const emit = defineEmits<{ close: [] }>()
const routines = useRoutines()
const preview = ref<FutureUpdatePreview | null>(null)
const selected = ref<Record<string, RoutineInputValue>>({})
const error = ref('')
const loading = ref(false)
const applying = ref(false)
const { exercises } = useExercises()
const exerciseName = (id: string) =>
  exercises.value.find((exercise) => exercise.id === id)?.name ?? 'Unknown exercise'
const targetLabels = computed(() => {
  const labels = new Map<string, string>()
  const add = (target: { id: string } | null, label: string) => {
    if (target) labels.set(target.id, label)
  }
  for (const activity of preview.value?.prescription.activities ?? []) {
    const name = exerciseName(activity.exerciseId)
    add(activity.targets.durationSec, `${name} · Duration (seconds)`)
    add(activity.targets.distanceM, `${name} · Distance (metres)`)
    for (const set of activity.sets) {
      const prefix = `${name} · Set ${set.order}`
      add(set.weightKg, `${prefix} · Load (kg)`)
      if (set.reps?.kind === 'exact') add(set.reps.value, `${prefix} · Reps`)
      add(set.restSec, `${prefix} · Rest (seconds)`)
      add(set.rpe, `${prefix} · RPE`)
      add(set.rir, `${prefix} · RIR`)
    }
  }
  return labels
})
const candidateLabel = (candidate: FutureUpdatePreview['candidates'][number]) =>
  candidate.kind === 'fixed_target'
    ? (targetLabels.value.get(candidate.id) ?? candidate.label)
    : candidate.label
const recalculation = computed(() => {
  if (!preview.value) return { prescription: null, error: '' }
  const inputs = { ...preview.value.inputs }
  const fixedTargets: Record<string, number> = {}
  for (const candidate of preview.value.candidates) {
    const value = selected.value[candidate.id]
    if (value === undefined) continue
    if (candidate.kind === 'input') inputs[candidate.id] = value
    else if (typeof value === 'number') fixedTargets[candidate.id] = value
    else return { prescription: null, error: `${candidateLabel(candidate)} must be a number.` }
  }
  try {
    return {
      prescription: resolvePrescription(preview.value.prescription, inputs, fixedTargets),
      error: '',
    }
  } catch (cause) {
    return { prescription: null, error: cause instanceof Error ? cause.message : String(cause) }
  }
})
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    preview.value = await routines.previewFutureUpdate(props.workoutId)
    selected.value = {}
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}
async function apply() {
  if (!preview.value || Object.keys(selected.value).length === 0) return
  applying.value = true
  error.value = ''
  try {
    await routines.applyFutureUpdate({
      previewId: preview.value.previewId,
      selectedValues: selected.value,
    })
    await refresh()
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    applying.value = false
  }
}
await refresh()
</script>

<template>
  <section class="rounded-2xl border border-(--ui-border) bg-(--color-surface) p-4 space-y-4" aria-labelledby="routine-future-review-title">
    <header class="flex items-center justify-between"><h2 id="routine-future-review-title" class="font-semibold">Update future routine</h2><UButton variant="ghost" aria-label="Close review" @click="emit('close')">Close</UButton></header>
    <p v-if="error" role="alert" class="text-sm text-red-400">{{ error }}</p>
    <p v-else-if="loading" class="text-sm">Loading captured intent and actual work…</p>
    <template v-else-if="preview">
      <p class="text-xs text-(--ui-text-muted)">Review compares captured routine revision to actual completed rows and current revision {{ preview.currentRoutineRevisionId }}. Applying changes only affects future routine starts.</p>
      <ul v-if="preview.ambiguities.length" class="list-disc pl-5 text-sm text-amber-400"><li v-for="(ambiguity, index) in preview.ambiguities" :key="index">{{ ambiguity }}</li></ul>
      <p v-if="preview.candidates.length === 0" class="text-sm">No direct target or configuration differences are available to review.</p>
      <fieldset v-for="candidate in preview.candidates" :key="candidate.id" class="rounded-xl border border-(--ui-border) p-3 space-y-2">
        <legend class="px-1 text-sm font-medium">{{ candidateLabel(candidate) }}</legend>
        <p class="text-xs text-(--ui-text-muted)">Captured: {{ candidate.capturedValue }} · Actual: {{ candidate.actualValue ?? 'not directly inferable' }} · Current: {{ candidate.currentValue }}</p>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" :aria-label="`Select future update for ${candidateLabel(candidate)}`" :checked="selected[candidate.id] !== undefined" @change="selected[candidate.id] === undefined ? selected[candidate.id] = candidate.proposedValue : delete selected[candidate.id]" />Select this explicit future update</label>
        <label v-if="selected[candidate.id] !== undefined" class="flex items-center gap-2 text-sm">
          <span>Future value</span>
          <input v-if="typeof candidate.currentValue === 'boolean'" v-model="selected[candidate.id]" type="checkbox" :aria-label="`${candidateLabel(candidate)} future value`" />
          <input v-else v-model.number="selected[candidate.id]" type="number" step="any" class="w-28 rounded bg-(--color-bg) p-1" :aria-label="`${candidateLabel(candidate)} future value`" />
        </label>
      </fieldset>
      <p v-if="recalculation.error" role="alert" class="text-sm text-red-400">{{ recalculation.error }}</p>
      <section v-else-if="recalculation.prescription && Object.keys(selected).length" class="space-y-2">
        <h3 class="text-sm font-medium">Targets after selected changes</h3>
        <article v-for="activity in recalculation.prescription.activities" :key="activity.id" class="text-xs">
          <h4 class="font-medium">{{ exerciseName(activity.exerciseId) }}</h4>
          <p v-for="set in activity.sets" :key="set.id">Set {{ set.order }} · {{ set.role }} · {{ set.weightKg?.resolvedValue ?? 'not prescribed' }} kg · {{ set.reps?.kind === 'exact' ? set.reps.value.resolvedValue : set.reps?.kind === 'range' ? `${set.reps.minimum}–${set.reps.maximum}` : set.reps?.kind === 'minimum' ? `${set.reps.minimum}+` : 'not prescribed' }} reps · rest {{ set.restSec?.resolvedValue ?? 'not prescribed' }} sec · RPE {{ set.rpe?.resolvedValue ?? 'unknown' }} · RIR {{ set.rir?.resolvedValue ?? 'unknown' }}</p>
          <p v-if="activity.loggingMode !== 'strength'">Duration {{ activity.targets.durationSec?.resolvedValue ?? 'not prescribed' }} sec · distance {{ activity.targets.distanceM?.resolvedValue ?? 'not prescribed' }} m</p>
        </article>
      </section>
      <section v-if="preview.referencingPlans.length" class="rounded-xl bg-(--color-bg) p-3"><h3 class="text-sm font-medium">Referencing plans affected</h3><ul class="list-disc pl-5 text-xs"><li v-for="plan in preview.referencingPlans" :key="plan.id">{{ plan.name }}</li></ul></section>
      <p class="text-xs text-(--ui-text-muted)">Formula rules and structure are never rewritten from actual work. Unselected values and newer unrelated routine fields remain unchanged.</p>
      <footer class="flex gap-2"><UButton color="primary" :loading="applying" :disabled="Object.keys(selected).length === 0 || !!recalculation.error" @click="apply">Apply selected future updates</UButton><UButton variant="outline" @click="refresh">Refresh stale review</UButton></footer>
    </template>
    <p v-else class="text-sm">This session has no captured saved-routine intent to update.</p>
  </section>
</template>
