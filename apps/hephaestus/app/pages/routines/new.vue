<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
import { resolvePrescription } from '~/lib/prescription-evaluator'
import {
  canonicalTargetValue,
  displayTargetValue,
  fieldLabel,
} from '~/lib/prescription-presentation'
import type {
  NumericTarget,
  PrescriptionInputDefinition,
  PrescriptionNumericField,
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
const { settings } = useAppSettings()
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
const initialDraft = ref('')
const draftSignature = computed(() =>
  JSON.stringify({
    name: name.value,
    templateId: templateId.value,
    templateRevisionId: templateRevisionId.value,
    values: values.value,
    fixed: fixed.value,
    policy: policy.value,
    deferral: deferral.value,
  }),
)
const isDirty = computed(
  () => initialDraft.value !== '' && draftSignature.value !== initialDraft.value,
)
function confirmLeave() {
  return !isDirty.value || window.confirm('Discard unsaved routine changes?')
}
function guardUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeRouteLeave(() => confirmLeave())
onMounted(() => window.addEventListener('beforeunload', guardUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', guardUnload))
function changeTemplate(event: Event) {
  const select = event.target as HTMLSelectElement
  const next = select.value
  if (next !== templateId.value && !confirmLeave()) {
    select.value = templateId.value
    return
  }
  templateId.value = next
}
let revisionRequest = 0
const loadingRevision = ref(false)
const exerciseName = (exerciseId: string) =>
  exercises.value.find((exercise) => exercise.id === exerciseId)?.name ?? 'Exercise unavailable'
function fixedTargetsFor(prescription: SerializablePrescription) {
  const result: Array<{
    exerciseId: string
    label: string
    field: PrescriptionNumericField
    target: NumericTarget
  }> = []
  for (const activity of prescription.activities) {
    for (const set of activity.sets) {
      const targets: Array<{
        label: string
        field: PrescriptionNumericField
        target: NumericTarget | null
      }> = [
        { label: `Set ${set.order} ${set.role}`, field: 'weightKg', target: set.weightKg },
        {
          label: `Set ${set.order} ${set.role}`,
          field: 'reps',
          target: set.reps?.kind === 'exact' ? set.reps.value : null,
        },
        { label: `Set ${set.order} ${set.role}`, field: 'restSec', target: set.restSec },
        {
          label: `Set ${set.order} ${set.role}`,
          field: 'rpe',
          target: set.rpe,
        },
        {
          label: `Set ${set.order} ${set.role}`,
          field: 'rir',
          target: set.rir,
        },
      ]
      for (const entry of targets) {
        if (entry.target?.rule.kind !== 'fixed') continue
        const label = `${entry.label} · ${fieldLabel(entry.field, settings.value.weightUnit, settings.value.distanceUnit)}`
        result.push({
          exerciseId: activity.exerciseId,
          label,
          field: entry.field,
          target: entry.target,
        })
      }
    }
    for (const [label, field, target] of [
      ['Duration', 'durationSec', activity.targets.durationSec],
      ['Distance', 'distanceM', activity.targets.distanceM],
    ] as const) {
      if (target?.rule.kind !== 'fixed') continue
      result.push({
        exerciseId: activity.exerciseId,
        label: `${label} · ${fieldLabel(field, settings.value.weightUnit, settings.value.distanceUnit)}`,
        field,
        target,
      })
    }
  }
  return result
}
const fixedTargets = computed(() =>
  revision.value
    ? fixedTargetsFor(revision.value.prescription).filter(
        (entry) =>
          (entry.field !== 'rpe' || settings.value.showRpe) &&
          (entry.field !== 'rir' || settings.value.showRir),
      )
    : [],
)
function displayFixed(field: PrescriptionNumericField, value: number) {
  return displayTargetValue(value, field, settings.value.weightUnit, settings.value.distanceUnit)
}
function updateFixed(targetId: string, field: PrescriptionNumericField, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  fixed.value[targetId] = canonicalTargetValue(
    value,
    field,
    settings.value.weightUnit,
    settings.value.distanceUnit,
  )
}
function displayInput(input: PrescriptionInputDefinition, value: number) {
  return displayTargetValue(
    value,
    input.field,
    settings.value.weightUnit,
    settings.value.distanceUnit,
  )
}
function displayInputBound(input: PrescriptionInputDefinition, value: number | null) {
  return value === null ? undefined : displayInput(input, value)
}
function updateInput(input: PrescriptionInputDefinition, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw.trim() === '') {
    delete values.value[input.id]
    return
  }
  const value = Number(raw)
  values.value[input.id] = canonicalTargetValue(
    value,
    input.field,
    settings.value.weightUnit,
    settings.value.distanceUnit,
  )
}
const resolved = computed(() => {
  if (!revision.value) return null
  try {
    return resolvePrescription(revision.value.prescription, values.value, fixed.value)
  } catch {
    return null
  }
})
async function refreshRevision() {
  const request = ++revisionRequest
  const selectedTemplateId = templateId.value
  const selectedRevisionId = templateRevisionId.value
  revision.value = null
  values.value = {}
  fixed.value = {}
  error.value = ''
  loadingRevision.value = Boolean(selectedTemplateId)
  if (!selectedTemplateId) return
  try {
    const selected = await templates.getRevision(
      selectedTemplateId,
      selectedRevisionId || undefined,
    )
    if (request !== revisionRequest || selectedTemplateId !== templateId.value) return
    revision.value = selected
    if (!selectedRevisionId) templateRevisionId.value = selected.id
    for (const input of selected.prescription.inputs)
      if (input.defaultValue !== null) values.value[input.id] = input.defaultValue
    for (const entry of fixedTargetsFor(selected.prescription))
      if (entry.target.rule.kind === 'fixed') fixed.value[entry.target.id] = entry.target.rule.value
    initialDraft.value = draftSignature.value
  } catch (cause) {
    if (request !== revisionRequest) return
    error.value = cause instanceof Error ? cause.message : 'Could not load this template revision.'
  } finally {
    if (request === revisionRequest) loadingRevision.value = false
  }
}
watch(
  templateId,
  (next, previous) => {
    if (next !== previous) templateRevisionId.value = ''
  },
  { flush: 'sync' },
)
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
    initialDraft.value = draftSignature.value
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
    <article class="space-y-5 p-4 pb-24">
      <header class="flex items-center justify-between gap-2"><NuxtLink to="/routines">Back</NuxtLink><h1 class="text-lg font-bold">Configure routine</h1><UButton color="primary" :loading="saving" :disabled="!name.trim() || !revision || !resolved || loadingRevision" @click="save">Save</UButton></header>
      <p v-if="error" role="alert" class="text-sm text-red-400">{{ error }}</p>
      <p v-if="loadingRevision" role="status" class="text-sm text-(--ui-text-muted)">Loading selected template revision…</p>
      <label class="block">Routine name<input v-model="name" class="mt-1 w-full rounded-xl bg-(--color-surface) p-3" /></label>
      <label class="block">Template<select :value="templateId" class="mt-1 w-full rounded-xl bg-(--color-surface) p-3" @change="changeTemplate"><option v-for="template in templateRows" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
    <section v-if="revision" class="space-y-3 rounded-xl bg-(--color-surface) p-4">
      <h2 class="font-semibold">{{ templateRows.find((template) => template.id === templateId)?.name }} · revision {{ revision.revisionNumber }}</h2>
      <p class="text-xs text-(--ui-text-muted)">Saved configuration remains independent of later template edits.</p>
      <template v-if="revision.prescription.inputs.length">
        <h3 class="font-medium">Configuration inputs</h3>
        <label v-for="input in revision.prescription.inputs" :key="input.id" class="block space-y-1">
          <span>{{ input.name }} · {{ fieldLabel(input.field, settings.weightUnit, settings.distanceUnit) }}{{ input.required ? ' · required' : ' · optional' }}</span>
          <input v-if="input.field === 'boolean'" v-model="values[input.id]" type="checkbox" />
          <input v-else :value="typeof values[input.id] === 'number' ? displayInput(input, values[input.id] as number) : ''" type="number" :min="displayInputBound(input, input.minimum)" :max="displayInputBound(input, input.maximum)" :step="input.integer ? 1 : 'any'" class="w-full rounded-lg bg-(--color-bg) p-2" @input="updateInput(input, $event)" />
        </label>
      </template>
      <template v-if="fixedTargets.length">
        <h3 class="font-medium">Direct fixed target values</h3>
        <label v-for="entry in fixedTargets" :key="entry.target.id" class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{{ exerciseName(entry.exerciseId) }} · {{ entry.label }}</span>
          <input :value="displayFixed(entry.field, fixed[entry.target.id] ?? 0)" type="number" min="0" step="any" class="w-28 rounded bg-(--color-bg) p-2" @input="updateFixed(entry.target.id, entry.field, $event)" />
        </label>
      </template>
      <h3 class="font-medium">Continuation</h3>
      <select v-model="policy" aria-label="Continuation policy" class="w-full rounded-lg bg-(--color-bg) p-2"><option value="calendar_bound">Follow scheduled dates</option><option value="carry_forward">Carry forward</option></select>
      <select v-if="policy === 'carry_forward'" v-model="deferral" aria-label="Deferral mode" class="w-full rounded-lg bg-(--color-bg) p-2"><option value="automatic">Automatic scheduling</option><option value="manual">Manual scheduling</option></select>
      <h3 class="font-medium">Named recalculation preview</h3>
      <p v-if="!resolved" role="alert" class="text-sm text-amber-400">Enter required values and resolve formula errors before saving.</p>
      <div v-for="activity in resolved?.activities" :key="activity.id" class="rounded-lg bg-(--color-bg) p-3">
        <h4>{{ exerciseName(activity.exerciseId) }}</h4>
        <p v-if="activity.loggingMode !== 'strength' && (activity.targets.durationSec?.resolvedValue != null || activity.targets.distanceM?.resolvedValue != null)" class="text-sm">
          {{ activity.loggingMode }}
          <span v-if="activity.targets.durationSec?.resolvedValue != null"> · {{ activity.targets.durationSec.resolvedValue }} sec</span>
          <span v-if="activity.targets.distanceM?.resolvedValue != null"> · {{ displayTargetValue(activity.targets.distanceM.resolvedValue, 'distanceM', settings.weightUnit, settings.distanceUnit).toFixed(2) }} {{ settings.distanceUnit }}</span>
        </p>
        <p v-for="set in activity.sets" :key="set.id" class="text-sm">
          {{ set.role }}<span v-if="set.weightKg?.resolvedValue != null"> · {{ displayTargetValue(set.weightKg.resolvedValue, 'weightKg', settings.weightUnit, settings.distanceUnit).toFixed(1) }} {{ settings.weightUnit }}</span>
          <span v-if="set.reps"> × {{ repsLabel(set) }} reps</span>
          <span v-if="set.restSec?.resolvedValue != null"> · rest {{ set.restSec.resolvedValue }} sec</span>
          <span v-if="settings.showRpe && set.rpe?.resolvedValue != null"> · RPE {{ set.rpe.resolvedValue }}</span>
          <span v-if="settings.showRir && set.rir?.resolvedValue != null"> · RIR {{ set.rir.resolvedValue }}</span>
        </p>
      </div>
    </section>
  </article>
</template>
