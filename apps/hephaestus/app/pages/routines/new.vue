<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolvePrescription } from '~/lib/prescription-evaluator'
import type {
  NumericTarget,
  RoutineInputValue,
  SerializablePrescription,
  TemplateRevision,
} from '~/types/prescription'

const route = useRoute()
const templates = useTemplates()
const templateRows = templates.templates
const routines = useRoutines()
const db = useDatabase()
const { exercises, load: loadExercises } = useExercises()
const name = ref('')
const templateId = ref(String(route.query['templateId'] ?? ''))
const templateRevisionId = ref(String(route.query['templateRevisionId'] ?? ''))
const revision = ref<TemplateRevision | null>(null)
const values = ref<Record<string, RoutineInputValue>>({})
const fixed = ref<Record<string, number>>({})
const policy = ref<'calendar_bound' | 'carry_forward'>('calendar_bound')
const deferral = ref<'automatic' | 'manual'>('automatic')
const error = ref('')
const saving = ref(false)
const exerciseName = (exerciseId: string) =>
  exercises.value.find((exercise) => exercise.id === exerciseId)?.name ??
  `Unknown exercise (${exerciseId})`
function fixedTargetsFor(prescription: SerializablePrescription) {
  const result: Array<{ exerciseId: string; label: string; target: NumericTarget }> = []
  for (const activity of prescription.activities) {
    for (const set of activity.sets)
      for (const [field, target] of [
        ['load kg', set.weightKg],
        ['exact reps', set.reps?.kind === 'exact' ? set.reps.value : null],
        ['rest sec', set.restSec],
        ['RPE', set.rpe],
        ['RIR', set.rir],
      ] as const)
        if (target?.rule.kind === 'fixed')
          result.push({
            exerciseId: activity.exerciseId,
            label: `Set ${set.order} ${set.role} · ${field}`,
            target,
          })
    for (const [field, target] of [
      ['duration sec', activity.targets.durationSec],
      ['distance m', activity.targets.distanceM],
    ] as const)
      if (target?.rule.kind === 'fixed')
        result.push({ exerciseId: activity.exerciseId, label: field, target })
  }
  return result
}
const fixedTargets = computed(() =>
  revision.value ? fixedTargetsFor(revision.value.prescription) : [],
)
const resolved = computed(() => {
  if (!revision.value) return null
  try {
    return resolvePrescription(revision.value.prescription, values.value, fixed.value)
  } catch {
    return null
  }
})
async function refreshRevision() {
  revision.value = null
  values.value = {}
  fixed.value = {}
  if (!templateId.value) return
  const selected = await templates.getRevision(
    templateId.value,
    templateRevisionId.value || undefined,
  )
  revision.value = selected
  templateRevisionId.value = selected.id
  for (const input of selected.prescription.inputs)
    if (input.defaultValue !== null) values.value[input.id] = input.defaultValue
  for (const entry of fixedTargetsFor(selected.prescription))
    if (entry.target.rule.kind === 'fixed') fixed.value[entry.target.id] = entry.target.rule.value
}
watch(
  () => templates.templates.value,
  () => {
    if (!templateId.value) templateId.value = templates.templates.value[0]?.id ?? ''
  },
  { immediate: true },
)
watch(
  [templateId, templateRevisionId],
  () => {
    void refreshRevision()
  },
  { immediate: true },
)
watch(
  db.status,
  async (status) => {
    if (status === 'ready') {
      await templates.load()
      await loadExercises()
    }
  },
  { immediate: true },
)
async function save() {
  if (!revision.value) return
  saving.value = true
  error.value = ''
  try {
    await routines.save({
      name: name.value.trim(),
      templateId: templateId.value,
      templateRevisionId: revision.value.id,
      inputs: { ...values.value },
      fixedTargetValues: { ...fixed.value },
      continuationPolicy: policy.value,
      deferralMode: policy.value === 'carry_forward' ? deferral.value : null,
    })
    await navigateTo('/routines')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
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
  <article class="space-y-5 p-4 pb-24"><header class="flex items-center justify-between gap-2"><NuxtLink to="/routines">Back</NuxtLink><h1 class="text-lg font-bold">Configure routine</h1><UButton color="primary" :loading="saving" :disabled="!name.trim() || !revision || !resolved" @click="save">Save</UButton></header>
    <p v-if="error" role="alert" class="text-sm text-red-400">{{ error }}</p><label class="block">Routine name<input v-model="name" class="mt-1 w-full rounded-xl bg-(--color-surface) p-3" /></label>
    <label class="block">Template<select v-model="templateId" class="mt-1 w-full rounded-xl bg-(--color-surface) p-3"><option v-for="template in templateRows" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
    <section v-if="revision" class="space-y-3 rounded-xl bg-(--color-surface) p-4"><h2 class="font-semibold">{{ templateRows.find((template) => template.id === templateId)?.name }} · revision {{ revision.revisionNumber }}</h2><p class="text-xs text-(--ui-text-muted)">Saved configuration remains independent of later template edits.</p><h3 class="font-medium">Configuration inputs</h3><label v-for="input in revision.prescription.inputs" :key="input.id" class="block space-y-1"><span>{{ input.name }} · {{ input.field }}{{ input.required ? ' · required' : ' · optional' }}</span><input v-if="input.field === 'boolean'" v-model="values[input.id]" type="checkbox" /><input v-else v-model.number="values[input.id]" type="number" :min="input.minimum ?? undefined" :max="input.maximum ?? undefined" :step="input.integer ? 1 : 'any'" class="w-full rounded-lg bg-(--color-bg) p-2" /></label>
      <h3 class="font-medium">Direct fixed target values</h3><label v-for="entry in fixedTargets" :key="entry.target.id" class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{{ exerciseName(entry.exerciseId) }} · {{ entry.label }}</span><input v-model.number="fixed[entry.target.id]" type="number" min="0" step="any" class="w-28 rounded bg-(--color-bg) p-2" /></label>
      <h3 class="font-medium">Continuation</h3><select v-model="policy" aria-label="Continuation policy" class="w-full rounded-lg bg-(--color-bg) p-2"><option value="calendar_bound">Calendar-bound</option><option value="carry_forward">Carry forward</option></select><select v-if="policy === 'carry_forward'" v-model="deferral" aria-label="Deferral mode" class="w-full rounded-lg bg-(--color-bg) p-2"><option value="automatic">Automatic deferral</option><option value="manual">Manual deferral</option></select>
      <h3 class="font-medium">Named recalculation preview</h3><p v-if="!resolved" role="alert" class="text-sm text-amber-400">Enter required values and resolve formula errors before saving.</p><div v-for="activity in resolved?.activities" :key="activity.id" class="rounded-lg bg-(--color-bg) p-3"><h4>{{ exerciseName(activity.exerciseId) }}</h4><p v-if="activity.loggingMode !== 'strength'" class="text-sm">{{ activity.loggingMode }} · {{ activity.targets.durationSec?.resolvedValue ?? 'duration not prescribed' }} sec · {{ activity.targets.distanceM?.resolvedValue ?? 'distance not prescribed' }} m</p><p v-for="set in activity.sets" :key="set.id" class="text-sm">{{ set.role }} · {{ set.weightKg?.resolvedValue ?? 'load not prescribed' }} kg × {{ repsLabel(set) }} reps · rest {{ set.restSec?.resolvedValue ?? 'not prescribed' }} sec · RPE {{ set.rpe?.resolvedValue ?? 'unknown' }} · RIR {{ set.rir?.resolvedValue ?? 'unknown' }}</p></div>
    </section>
  </article>
</template>
