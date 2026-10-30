<script setup lang="ts">
import { computed, ref } from 'vue'
import { resolvePrescription } from '~/lib/prescription-evaluator'
import {
  canonicalTargetValue,
  displayTargetValue,
  fieldLabel,
  setSummary,
} from '~/lib/prescription-presentation'
import type {
  RoutineInputValue,
  RoutineSnapshot,
  TemplateAdoptionPreview,
} from '~/types/prescription'

const route = useRoute()
const id = computed(() => String(route.params['id'] ?? ''))
const routines = useRoutines()
const templates = useTemplates()
const templateRows = templates.templates
const workout = useWorkout()
const { exercises, load: loadExercises } = useExercises()
const { settings } = useAppSettings()
const snapshot = ref<RoutineSnapshot | null>(null)
const preview = ref<TemplateAdoptionPreview | null>(null)
const replacements = ref<Record<string, RoutineInputValue>>({})
const fixedReplacements = ref<Record<string, number>>({})
const errors = ref('')
const loading = ref(true)
const exerciseName = (exerciseId: string) =>
  exercises.value.find((exercise) => exercise.id === exerciseId)?.name ?? 'Exercise unavailable'
async function load() {
  loading.value = true
  try {
    await loadExercises()
    snapshot.value = await routines.get(id.value)
    await templates.load()
  } finally {
    loading.value = false
  }
}
await load()
async function reviewAdoption() {
  if (!snapshot.value) return
  try {
    const target = await templates.getRevision(snapshot.value.routine.templateId)
    if (target.id === snapshot.value.routine.adoptedTemplateRevisionId) {
      errors.value = 'This routine already uses the latest template revision.'
      return
    }
    preview.value = await routines.previewTemplateAdoption(id.value, target.id)
    replacements.value = {}
    fixedReplacements.value = { ...preview.value.preservedFixedTargetValues }
    errors.value = ''
  } catch (cause) {
    errors.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function applyAdoption() {
  if (!preview.value) return
  try {
    await routines.applyTemplateAdoption({
      previewId: preview.value.previewId,
      inputs: { ...replacements.value },
      fixedTargetValues: { ...fixedReplacements.value },
    })
    preview.value = null
    await load()
  } catch (cause) {
    errors.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function start() {
  if (!snapshot.value) return
  try {
    await workout.startRoutineWorkout(id.value, {
      expectedRoutineRevisionId: snapshot.value.revision.id,
    })
    await navigateTo('/workout')
  } catch (cause) {
    errors.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function refreshAfterStartConflict() {
  errors.value = ''
  await load()
}
const adoptionResolved = computed(() => {
  if (!preview.value) return null
  try {
    return resolvePrescription(
      preview.value.prescription,
      { ...preview.value.preservedInputs, ...replacements.value },
      { ...preview.value.preservedFixedTargetValues, ...fixedReplacements.value },
    )
  } catch {
    return null
  }
})
</script>

<template>
  <article class="space-y-5 p-4 pb-24">
    <div v-if="errors" class="flex items-center gap-2"><p role="alert" class="text-sm text-red-400">{{ errors }}</p><UButton size="sm" variant="outline" @click="refreshAfterStartConflict">Refresh routine</UButton></div><p v-if="loading">Loading routine…</p>
    <template v-else-if="snapshot">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-semibold">{{ snapshot.routine.name }}</h1>
        <UButton :to="`/routines/${id}/edit`" variant="outline">Edit configuration</UButton>
      </header>
      <section class="space-y-2 rounded-xl bg-(--color-surface) p-4">
        <p>Template: {{ templateRows.find((template) => template.id === snapshot?.routine.templateId)?.name ?? 'Unknown template' }}</p>
        <p>Saved from a template · routine revision {{ snapshot.revision.revisionNumber }}</p>
        <p>{{ snapshot.routine.continuationPolicy === 'calendar_bound' ? 'Follow scheduled dates' : 'Carry forward' }}<span v-if="snapshot.routine.deferralMode"> · {{ snapshot.routine.deferralMode === 'manual' ? 'manual scheduling' : 'automatic scheduling' }}</span></p>
        <UButton color="primary" @click="start">Start this routine</UButton><UButton variant="outline" @click="reviewAdoption">Review newer template revision</UButton>
      </section>
      <section class="space-y-2"><h2 class="font-semibold">Workout preview</h2><div v-for="activity in snapshot.revision.prescription.activities" :key="activity.id" class="rounded-xl bg-(--color-surface) p-3"><h3>{{ activity.order }}. {{ exerciseName(activity.exerciseId) }}</h3><p v-if="activity.targets.durationSec?.resolvedValue != null">{{ activity.targets.durationSec.resolvedValue }} seconds</p><p v-if="activity.targets.distanceM?.resolvedValue != null">{{ displayTargetValue(activity.targets.distanceM.resolvedValue, 'distanceM', settings.weightUnit, settings.distanceUnit) }} {{ settings.distanceUnit }}</p><p v-for="set in activity.sets" :key="set.id" class="text-sm">{{ setSummary(set, settings.weightUnit, settings) }}</p></div></section>
      <section v-if="preview" class="space-y-3 rounded-xl border border-(--ui-border) p-4">
        <h2 class="font-semibold">Review template changes</h2>
        <p>Review this structure before applying. Adoption changes future starts from all plans using this shared routine; existing sessions stay unchanged.</p>
        <ul v-if="preview.issues.length" class="list-disc pl-5 text-sm text-amber-400"><li v-for="issue in preview.issues" :key="`${issue.kind}:${issue.identity}`">{{ issue.message }}</li></ul>
        <p v-else class="text-sm">No incompatibilities found. Review targets and input values before saving.</p>
        <div v-for="activity in adoptionResolved?.activities ?? preview.prescription.activities" :key="activity.id" class="rounded-lg bg-(--color-surface) p-3">
          <h3>{{ activity.order }}. {{ exerciseName(activity.exerciseId) }}</h3>
          <p v-for="set in activity.sets" :key="set.id" class="text-sm">{{ setSummary(set, settings.weightUnit, settings) }}</p>
        </div>
        <p v-if="!adoptionResolved" role="alert" class="text-sm text-amber-400">Supply required inputs and resolve all formula errors to preview adoption.</p>
        <p v-else class="text-sm">{{ adoptionResolved.activities.length }} named activities resolve successfully.</p>
        <label v-for="input in preview.prescription.inputs" :key="input.id" class="block space-y-1">
          <span>{{ input.name }} · {{ fieldLabel(input.field, settings.weightUnit, settings.distanceUnit) }}{{ input.required ? ' · required' : '' }}</span>
          <input v-if="input.field === 'boolean'" v-model="replacements[input.id]" type="checkbox" />
          <input v-else :value="typeof replacements[input.id] === 'number' ? displayTargetValue(Number(replacements[input.id]), input.field, settings.weightUnit, settings.distanceUnit) : ''" type="number" step="any" class="w-full rounded bg-(--color-surface) p-2" @change="replacements[input.id] = canonicalTargetValue(Number(($event.target as HTMLInputElement).value), input.field, settings.weightUnit, settings.distanceUnit)" />
        </label>
        <UButton :disabled="!adoptionResolved" color="primary" @click="applyAdoption">Apply reviewed revision</UButton>
        <UButton variant="outline" @click="reviewAdoption">Refresh review</UButton>
      </section>
    </template>
  </article>
</template>
