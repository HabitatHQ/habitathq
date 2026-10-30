<script setup lang="ts">
import { toRaw } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { TargetReferenceOption } from '~/components/templates/PrescriptionTargetEditor.vue'
import PrescriptionTargetEditor from '~/components/templates/PrescriptionTargetEditor.vue'
import { generateUuidV7 } from '~/lib/db-identity'
import { parseSerializablePrescription } from '~/lib/prescription-domain'
import {
  PrescriptionTargetError,
  resolvePrescription,
  validatePrescriptionExpressions,
} from '~/lib/prescription-evaluator'
import {
  canonicalTargetValue,
  displayTargetValue,
  duplicatePrescriptionSet,
  setSummary,
} from '~/lib/prescription-presentation'
import type {
  NumericTarget,
  PrescriptionActivity,
  PrescriptionInputDefinition,
  PrescriptionNumericField,
  PrescriptionSet,
  SerializablePrescription,
  TemplateEditRequest,
  TemplateRevision,
} from '~/types/prescription'

const props = defineProps<{ templateId?: string }>()
const templates = useTemplates()
const { settings } = useAppSettings()
const { exercises, load: loadExercises } = useExercises()
const version = 'cel-js-8.0.0-js-number-v1'
const name = ref('')
const description = ref('')
const busy = ref(false)
const error = ref('')
const openedRevision = ref<TemplateRevision | null>(null)
const draft = ref<SerializablePrescription>(empty())
const previewInputs = ref<Record<string, number | boolean>>({})
const initialDraft = ref('')
const draftSignature = computed(() =>
  JSON.stringify({ name: name.value, description: description.value, draft: draft.value }),
)
const isDirty = computed(
  () => initialDraft.value !== '' && draftSignature.value !== initialDraft.value,
)
const draftKey = computed(() => `hephaestus-template-draft:${props.templateId ?? 'new'}`)
function persistDraft() {
  if (import.meta.server || !isDirty.value) return
  localStorage.setItem(
    draftKey.value,
    JSON.stringify({
      baseRevisionId: openedRevision.value?.id ?? null,
      name: name.value,
      description: description.value,
      draft: toRaw(draft.value),
    }),
  )
}
onBeforeRouteLeave(() => {
  persistDraft()
})
function guardUnload(event: BeforeUnloadEvent) {
  persistDraft()
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', guardUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', guardUnload))
const unit = computed(() => settings.value.weightUnit)
const distanceUnit = computed(() => settings.value.distanceUnit)

const exerciseName = (id: string) =>
  exercises.value.find((entry) => entry.id === id)?.name ?? 'Exercise unavailable'
const resolvedPreview = computed(() => {
  try {
    const prescription = parseSerializablePrescription(draft.value)
    validatePrescriptionExpressions(prescription)
    return {
      prescription: resolvePrescription(prescription, previewInputs.value),
      error: '',
      targetId: null,
    }
  } catch (cause) {
    return {
      prescription: null,
      error:
        cause instanceof PrescriptionTargetError
          ? cause.message.replaceAll(cause.targetId, 'this target')
          : cause instanceof Error
            ? cause.message
            : String(cause),
      targetId: cause instanceof PrescriptionTargetError ? cause.targetId : null,
    }
  }
})
function targetError(target: NumericTarget | null): string {
  return target?.id === resolvedPreview.value.targetId ? resolvedPreview.value.error : ''
}
const references = computed(() => {
  const result: TargetReferenceOption[] = []
  for (const activity of draft.value.activities) {
    const add = (
      target: NumericTarget | null,
      field: PrescriptionNumericField,
      set: PrescriptionSet | null,
    ) => {
      if (!target) return
      result.push({
        targetId: target.id,
        activityId: activity.id,
        activityName: exerciseName(activity.exerciseId),
        setId: set?.id ?? null,
        setOrder: set?.order ?? null,
        role: set?.role ?? null,
        field,
        label: set
          ? `${exerciseName(activity.exerciseId)} · Set ${set.order} (${set.role})`
          : `${exerciseName(activity.exerciseId)} · activity target`,
      })
    }
    add(activity.targets.durationSec, 'durationSec', null)
    add(activity.targets.distanceM, 'distanceM', null)
    for (const set of activity.sets) {
      if (set.reps?.kind === 'exact') add(set.reps.value, 'reps', set)
      add(set.weightKg, 'weightKg', set)
      add(set.restSec, 'restSec', set)
      add(set.rpe, 'rpe', set)
      add(set.rir, 'rir', set)
    }
  }
  return result
})

function empty(): SerializablePrescription {
  return {
    schemaVersion: 1,
    evaluatorVersion: version,
    inputs: [],
    defaults: { incrementKg: 2.5, restSec: 90 },
    groups: [],
    activities: [],
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
  }
}
const uid = () => generateUuidV7()
function fixed(value: number): NumericTarget {
  return { id: uid(), rule: { kind: 'fixed', value }, resolvedValue: value }
}
function createSet(order: number): PrescriptionSet {
  return {
    id: uid(),
    order,
    role: 'working',
    reps: { kind: 'exact', value: fixed(8) },
    weightKg: null,
    restSec: fixed(draft.value.defaults.restSec),
    rpe: null,
    rir: null,
    notes: null,
    legacyScheme: null,
  }
}
function addActivity(exerciseId: string) {
  const exercise = exercises.value.find((entry) => entry.id === exerciseId)
  if (!exercise) return
  const strength = exercise.logging_mode === 'strength'
  draft.value.activities.push({
    id: uid(),
    exerciseId,
    order: draft.value.activities.length + 1,
    loggingMode: exercise.logging_mode,
    executionGroupId: null,
    sets: strength ? [createSet(1)] : [],
    targets: { durationSec: null, distanceM: null },
    notes: null,
  })
}
function reorderActivities() {
  draft.value.activities.forEach((activity, index) => {
    activity.order = index + 1
  })
}
function moveActivity(index: number, offset: number) {
  const next = index + offset
  if (next < 0 || next >= draft.value.activities.length) return
  const [activity] = draft.value.activities.splice(index, 1)
  if (!activity) return
  draft.value.activities.splice(next, 0, activity)
  reorderActivities()
}
function isTargetReferenced(targetId: string) {
  return allTargets().some(
    (candidate) =>
      candidate.rule.kind === 'formula' &&
      candidate.rule.bindings.some(
        (binding) => binding.source.kind === 'target' && binding.source.targetId === targetId,
      ),
  )
}
function removeActivity(id: string) {
  const activity = draft.value.activities.find((entry) => entry.id === id)
  if (
    activity?.sets.some(
      (set) =>
        [
          set.weightKg,
          set.restSec,
          set.rpe,
          set.rir,
          set.reps?.kind === 'exact' ? set.reps.value : null,
        ].some((target) => target && isTargetReferenced(target.id)) ||
        [activity.targets.durationSec, activity.targets.distanceM].some(
          (target) => target && isTargetReferenced(target.id),
        ),
    )
  ) {
    error.value =
      'This activity has targets referenced by formulas. Remove or change those formulas first.'
    return
  }
  draft.value.activities = draft.value.activities.filter((activity) => activity.id !== id)
  for (const group of draft.value.groups)
    group.activityIds = group.activityIds.filter((activityId) => activityId !== id)
  reorderActivities()
}
function addGroup() {
  draft.value.groups.push({
    id: uid(),
    label: String.fromCharCode(65 + draft.value.groups.length),
    name: null,
    type: 'superset',
    activityIds: [],
    transitionRestSec: 0,
    restAfterRoundSec: 120,
    circuitRestMode: 'after_round',
    rounds: 1,
    amrap: false,
    timeCapSec: null,
  })
}
function assignGroup(activity: PrescriptionActivity, groupId: string) {
  for (const group of draft.value.groups)
    group.activityIds = group.activityIds.filter((id) => id !== activity.id)
  activity.executionGroupId = groupId || null
  if (groupId)
    draft.value.groups.find((group) => group.id === groupId)?.activityIds.push(activity.id)
}
function removeGroup(groupId: string) {
  for (const activity of draft.value.activities)
    if (activity.executionGroupId === groupId) activity.executionGroupId = null
  draft.value.groups = draft.value.groups.filter((group) => group.id !== groupId)
}
function addSet(activity: PrescriptionActivity) {
  activity.sets.push(createSet(activity.sets.length + 1))
}
function removeSet(activity: PrescriptionActivity, id: string) {
  const set = activity.sets.find((entry) => entry.id === id)
  if (
    set &&
    [
      set.weightKg,
      set.restSec,
      set.rpe,
      set.rir,
      set.reps?.kind === 'exact' ? set.reps.value : null,
    ].some((target) => target && isTargetReferenced(target.id))
  ) {
    error.value = 'This set has targets referenced by formulas. Change those formulas first.'
    return
  }
  activity.sets = activity.sets.filter((set) => set.id !== id)
  activity.sets.forEach((set, index) => {
    set.order = index + 1
  })
}
function updateRepKind(set: PrescriptionSet, kind: string) {
  if (set.reps?.kind === 'exact' && kind !== 'exact' && isTargetReferenced(set.reps.value.id)) {
    error.value = 'This rep target is referenced by a formula. Change that formula first.'
    return
  }
  if (kind === 'none') set.reps = null
  else if (kind === 'exact') set.reps = { kind, value: fixed(8) }
  else if (kind === 'range') set.reps = { kind, minimum: 8, maximum: 12 }
  else if (kind === 'minimum') set.reps = { kind, minimum: 8 }
}
function addInput() {
  draft.value.inputs.push({
    id: uid(),
    name: '',
    field: 'scalar',
    required: false,
    defaultValue: null,
    minimum: null,
    maximum: null,
    integer: false,
  })
}
function updateInputField(input: PrescriptionInputDefinition, field: string) {
  if (
    ![
      'scalar',
      'boolean',
      'weightKg',
      'reps',
      'restSec',
      'durationSec',
      'distanceM',
      'rpe',
      'rir',
    ].includes(field)
  )
    return
  input.field = field as PrescriptionInputDefinition['field']
  input.defaultValue = null
  input.minimum = field === 'boolean' ? null : field === 'reps' ? 1 : 0
  input.maximum = field === 'rpe' || field === 'rir' ? 10 : null
  input.integer = field === 'reps'
}
function allTargets() {
  return references.value.flatMap((reference) => {
    const target = findTarget(reference.targetId)
    return target ? [target] : []
  })
}
function setInputDefault(input: PrescriptionInputDefinition, event: Event) {
  const control = event.target
  if (!(control instanceof HTMLInputElement)) return
  const value =
    input.field === 'boolean'
      ? control.checked
      : control.value.trim() === ''
        ? null
        : Number(control.value)
  input.defaultValue = value
  if (value === null) delete previewInputs.value[input.id]
  else previewInputs.value[input.id] = value
}
function findTarget(id: string): NumericTarget | null {
  for (const activity of draft.value.activities)
    for (const target of [
      activity.targets.durationSec,
      activity.targets.distanceM,
      ...activity.sets.flatMap((set) => [
        set.weightKg,
        set.restSec,
        set.rpe,
        set.rir,
        set.reps?.kind === 'exact' ? set.reps.value : null,
      ]),
    ])
      if (target?.id === id) return target
  return null
}
function removeInput(id: string) {
  if (
    allTargets().some(
      (target) =>
        (target.rule.kind === 'input' && target.rule.inputId === id) ||
        (target.rule.kind === 'formula' &&
          target.rule.bindings.some(
            (binding) => binding.source.kind === 'input' && binding.source.inputId === id,
          )),
    )
  ) {
    error.value = 'This input is referenced by a target. Change those target rules first.'
    return
  }
  draft.value.inputs = draft.value.inputs.filter((input) => input.id !== id)
}
function removeTarget(target: NumericTarget) {
  if (isTargetReferenced(target.id)) {
    error.value =
      'This target is referenced by a formula. Change the dependent formula before removing this target.'
    return
  }
  for (const activity of draft.value.activities) {
    if (activity.targets.durationSec?.id === target.id) activity.targets.durationSec = null
    if (activity.targets.distanceM?.id === target.id) activity.targets.distanceM = null
    for (const set of activity.sets) removeSetTarget(set, target.id)
  }
}
function removeSetTarget(set: PrescriptionSet, targetId: string) {
  if (set.weightKg?.id === targetId) set.weightKg = null
  if (set.restSec?.id === targetId) set.restSec = null
  if (set.rpe?.id === targetId) set.rpe = null
  if (set.rir?.id === targetId) set.rir = null
  if (set.reps?.kind === 'exact' && set.reps.value.id === targetId) set.reps = null
}
function updateActivityTarget(
  activity: PrescriptionActivity,
  field: 'durationSec' | 'distanceM',
  target: NumericTarget | null,
) {
  const previous = activity.targets[field]
  if (target) activity.targets[field] = target
  else if (previous) removeTarget(previous)
}
function updateSetTarget(
  set: PrescriptionSet,
  field: 'weightKg' | 'restSec' | 'rpe' | 'rir',
  target: NumericTarget | null,
) {
  const previous = set[field]
  if (target) set[field] = target
  else if (previous) removeTarget(previous)
}
function updateExactRepTarget(set: PrescriptionSet, target: NumericTarget | null) {
  if (set.reps && set.reps.kind !== 'exact') return
  if (!target && set.reps?.kind === 'exact' && isTargetReferenced(set.reps.value.id)) {
    error.value = 'This rep target is referenced by a formula. Change that formula first.'
    return
  }
  set.reps = target ? { kind: 'exact', value: target } : null
}
function setMode(activity: PrescriptionActivity, mode: string) {
  if (mode !== 'strength' && mode !== 'cardio' && mode !== 'distance') return
  if (mode !== 'strength' && activity.sets.length > 0) {
    error.value =
      'Remove the authored strength sets individually before changing this activity mode.'
    return
  }
  activity.loggingMode = mode
  if (mode === 'strength' && activity.sets.length === 0) addSet(activity)
}
const repeatCounts = reactive<Record<string, number>>({})
function repeatSets(activity: PrescriptionActivity) {
  const count = repeatCounts[activity.id] ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 20) return
  const source = activity.sets.at(-1)
  if (!source) return
  for (let index = 0; index < count; index++)
    activity.sets.push(duplicatePrescriptionSet(toRaw(source), activity.sets.length + 1, uid))
}
function duplicateSet(activity: PrescriptionActivity, set: PrescriptionSet) {
  activity.sets.splice(
    activity.sets.indexOf(set) + 1,
    0,
    duplicatePrescriptionSet(toRaw(set), 0, uid),
  )
  activity.sets.forEach((entry, index) => {
    entry.order = index + 1
  })
}
async function load() {
  await loadExercises()
  if (props.templateId) {
    const row = await templates.getById(props.templateId)
    const revision = await templates.getRevision(props.templateId)
    if (!row) throw new Error('Template was not found')
    name.value = row.name
    description.value = row.description ?? ''
    openedRevision.value = revision
    draft.value = parseSerializablePrescription(revision.prescription)
  }
  const baseline = draftSignature.value
  initialDraft.value = baseline
  const stored = import.meta.client ? localStorage.getItem(draftKey.value) : null
  if (stored) {
    try {
      const candidate = JSON.parse(stored) as {
        baseRevisionId: string | null
        name: string
        description: string
        draft: SerializablePrescription
      }
      if (candidate.baseRevisionId === (openedRevision.value?.id ?? null)) {
        draft.value = parseSerializablePrescription(candidate.draft)
        name.value = candidate.name
        description.value = candidate.description
      } else localStorage.removeItem(draftKey.value)
    } catch {
      localStorage.removeItem(draftKey.value)
    }
  }
  for (const input of draft.value.inputs)
    if (input.defaultValue !== null) previewInputs.value[input.id] = input.defaultValue
  initialDraft.value = baseline
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const prescription = parseSerializablePrescription(draft.value)
    validatePrescriptionExpressions(prescription)
    if (
      prescription.activities.some(
        (activity) => activity.loggingMode === 'strength' && activity.sets.length === 0,
      )
    )
      throw new Error('Strength activities require at least one authored set.')
    if (
      prescription.activities.some(
        (activity) => activity.loggingMode !== 'strength' && activity.sets.length > 0,
      )
    )
      throw new Error('Non-strength activities cannot contain strength sets.')
    if (props.templateId) {
      if (!openedRevision.value)
        throw new Error('The template revision opened for editing is unavailable.')
      const request: TemplateEditRequest = {
        templateId: props.templateId,
        expectedRevisionId: openedRevision.value.id,
        name: name.value.trim(),
        description: description.value.trim() || null,
        prescription,
      }
      await templates.editRevision(request)
      localStorage.removeItem(draftKey.value)
      initialDraft.value = draftSignature.value
      await navigateTo(`/templates/${props.templateId}`)
    } else {
      const created = await templates.createRevision({
        name: name.value.trim(),
        description: description.value.trim() || null,
        prescription,
      })
      localStorage.removeItem(draftKey.value)
      initialDraft.value = draftSignature.value
      await navigateTo(`/templates/${created.templateId}`)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
await load()
</script>

<template>
  <form class="space-y-5 p-4 pb-24" @submit.prevent="save">
    <header class="flex items-center justify-between gap-2"><NuxtLink to="/templates">Cancel</NuxtLink><h1 class="text-lg font-bold">{{ templateId ? 'Edit template revision' : 'Create template' }}</h1><UButton type="submit" color="primary" :loading="busy">Save</UButton></header>
    <details class="space-y-2 rounded-xl bg-(--color-surface) p-3"><summary class="cursor-pointer font-semibold">Workout defaults</summary><div class="grid grid-cols-2 gap-2"><label>Load increment ({{ unit }})<input :value="displayTargetValue(draft.defaults.incrementKg, 'weightKg', unit, distanceUnit)" type="number" min="0.1" step="any" class="w-full rounded bg-(--color-bg) p-2" @change="draft.defaults.incrementKg = canonicalTargetValue(Number(($event.target as HTMLInputElement).value), 'weightKg', unit, distanceUnit)" /></label><label>Rest seconds<input v-model.number="draft.defaults.restSec" type="number" min="0" step="any" class="w-full rounded bg-(--color-bg) p-2" /></label></div></details>
    <label class="block">Name<input v-model="name" required maxlength="120" class="mt-1 w-full rounded-lg bg-(--color-surface) p-2" /></label>
    <label class="block">Description<textarea v-model="description" class="mt-1 w-full rounded-lg bg-(--color-surface) p-2" /></label>
    <section class="space-y-3 rounded-xl bg-(--color-surface) p-3"><header class="flex items-center justify-between gap-2"><h2 class="font-semibold">Activities and ordered sets</h2><select class="min-w-0 rounded bg-(--color-bg) p-2" aria-label="Add activity" @change="addActivity(($event.target as HTMLSelectElement).value)"><option value="">Add exercise…</option><option v-for="exercise in exercises" :key="exercise.id" :value="exercise.id">{{ exercise.name }}</option></select></header>
      <article v-for="(activity, activityIndex) in draft.activities" :key="activity.id" class="space-y-3 rounded-xl border border-(--ui-border) p-3">
        <header class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold">{{ exerciseName(activity.exerciseId) }}</h3><div class="flex gap-2"><UButton type="button" size="xs" variant="ghost" :disabled="activityIndex === 0" @click="moveActivity(activityIndex, -1)">Move up</UButton><UButton type="button" size="xs" variant="ghost" :disabled="activityIndex === draft.activities.length - 1" @click="moveActivity(activityIndex, 1)">Move down</UButton><UButton type="button" size="xs" variant="ghost" color="error" @click="removeActivity(activity.id)">Remove activity</UButton></div></header>
        <details><summary class="cursor-pointer text-sm">Activity options</summary>
        <div class="grid grid-cols-2 gap-2"><label>Mode<select :value="activity.loggingMode" class="mt-1 w-full rounded bg-(--color-bg) p-2" @change="setMode(activity, ($event.target as HTMLSelectElement).value)"><option value="strength">Strength</option><option value="cardio">Cardio</option><option value="distance">Distance</option></select></label><label v-if="settings.showSupersets">Execution group<select :value="activity.executionGroupId ?? ''" class="mt-1 w-full rounded bg-(--color-bg) p-2" @change="assignGroup(activity, ($event.target as HTMLSelectElement).value)"><option value="">None</option><option v-for="group in draft.groups" :key="group.id" :value="group.id">{{ group.label }} · {{ group.type }}</option></select></label></div>
        </details>
        <div v-if="activity.loggingMode !== 'strength'" class="space-y-2"><PrescriptionTargetEditor :model-value="activity.targets.durationSec" :validation-message="targetError(activity.targets.durationSec)" field="durationSec" label="Duration (seconds)" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'durationSec')" @update:model-value="updateActivityTarget(activity, 'durationSec', $event)" /><PrescriptionTargetEditor :model-value="activity.targets.distanceM" :validation-message="targetError(activity.targets.distanceM)" field="distanceM" label="Distance (metres)" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'distanceM')" @update:model-value="updateActivityTarget(activity, 'distanceM', $event)" /></div>
        <div v-for="set in activity.sets" :key="set.id" class="space-y-2 rounded-lg bg-(--color-bg) p-3">
          <header class="flex flex-wrap items-center justify-between gap-2"><span class="font-semibold">Set {{ set.order }}</span><div class="flex gap-2"><button type="button" class="text-sm" @click="duplicateSet(activity, set)">Duplicate set</button><button type="button" class="text-sm text-red-400" @click="removeSet(activity, set.id)">Remove set</button></div></header>
          <details v-if="settings.showSetSchemes"><summary class="cursor-pointer text-sm">Set role and rep scheme</summary>
          <label>Role<select v-model="set.role" class="ml-1 rounded bg-(--color-surface) p-1"><option value="warm_up">Warm-up</option><option value="working">Working</option><option value="top">Top</option><option value="back_off">Back-off</option></select></label>
          <label>Reps<select :value="set.reps?.kind ?? 'none'" class="ml-1 rounded bg-(--color-surface) p-1" @change="updateRepKind(set, ($event.target as HTMLSelectElement).value)"><option value="none">Not prescribed</option><option value="exact">Exact</option><option v-if="settings.showSetSchemes || set.reps?.kind === 'range'" value="range" :disabled="!settings.showSetSchemes">Range{{ settings.showSetSchemes ? '' : ' · enable set schemes to edit' }}</option><option v-if="settings.showSetSchemes || set.reps?.kind === 'minimum'" value="minimum" :disabled="!settings.showSetSchemes">Minimum{{ settings.showSetSchemes ? '' : ' · enable set schemes to edit' }}</option></select></label>
          </details>
          <p v-if="!settings.showSetSchemes && set.reps?.kind === 'range'" class="text-sm text-(--ui-text-muted)">Saved range: {{ set.reps.minimum }}–{{ set.reps.maximum }} reps. Enable set schemes to edit it.</p>
          <p v-if="!settings.showSetSchemes && set.reps?.kind === 'minimum'" class="text-sm text-(--ui-text-muted)">Saved minimum: {{ set.reps.minimum }} reps. Enable set schemes to edit it.</p>
          <PrescriptionTargetEditor v-if="!set.reps || set.reps.kind === 'exact'" :model-value="set.reps?.kind === 'exact' ? set.reps.value : null" :validation-message="targetError(set.reps?.kind === 'exact' ? set.reps.value : null)" field="reps" label="Reps" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'reps')" @update:model-value="updateExactRepTarget(set, $event)" />
          <div v-if="settings.showSetSchemes && set.reps?.kind === 'range'" class="grid grid-cols-2 gap-2"><label>Minimum<input v-model.number="set.reps.minimum" type="number" min="1" step="1" class="w-full rounded bg-(--color-surface) p-2" /></label><label>Maximum<input v-model.number="set.reps.maximum" type="number" min="1" step="1" class="w-full rounded bg-(--color-surface) p-2" /></label></div>
          <label v-if="settings.showSetSchemes && set.reps?.kind === 'minimum'" class="block">Minimum reps<input v-model.number="set.reps.minimum" type="number" min="1" step="1" class="ml-2 w-24 rounded bg-(--color-surface) p-2" /></label>
          <PrescriptionTargetEditor :model-value="set.weightKg" :validation-message="targetError(set.weightKg)" field="weightKg" label="Load (kg)" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'weightKg')" @update:model-value="updateSetTarget(set, 'weightKg', $event)" />
          <PrescriptionTargetEditor v-if="settings.showVariableRest" :model-value="set.restSec" :validation-message="targetError(set.restSec)" field="restSec" label="Rest (seconds)" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'restSec')" @update:model-value="updateSetTarget(set, 'restSec', $event)" />
          <details><summary class="cursor-pointer text-sm">Effort and notes</summary>
          <PrescriptionTargetEditor v-if="settings.showRpe" :model-value="set.rpe" :validation-message="targetError(set.rpe)" field="rpe" label="RPE" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'rpe')" @update:model-value="updateSetTarget(set, 'rpe', $event)" />
          <PrescriptionTargetEditor v-if="settings.showRir" :model-value="set.rir" :validation-message="targetError(set.rir)" field="rir" label="RIR" :inputs="draft.inputs" :references="references.filter((reference) => reference.field === 'rir')" @update:model-value="updateSetTarget(set, 'rir', $event)" />
          <label class="block">Set notes<input v-model="set.notes" class="mt-1 w-full rounded bg-(--color-surface) p-2" /></label>
          </details>
        </div><div class="flex flex-wrap gap-2"><UButton v-if="activity.loggingMode === 'strength'" type="button" size="sm" variant="outline" @click="addSet(activity)">Add default set</UButton><label v-if="activity.loggingMode === 'strength'" class="text-sm">Duplicate last set<input v-model.number="repeatCounts[activity.id]" type="number" min="1" max="20" class="ml-2 w-20 rounded bg-(--color-bg) p-2" aria-label="Number of duplicate sets to add" @keydown.enter.prevent /><UButton type="button" size="sm" variant="outline" @click="repeatSets(activity)">Add duplicates</UButton></label></div><label class="block">Activity notes<textarea v-model="activity.notes" class="mt-1 w-full rounded bg-(--color-bg) p-2" /></label>
      </article>
    </section>
    <details class="space-y-3"><summary class="cursor-pointer font-semibold">Advanced authoring</summary>
    <section class="space-y-3 rounded-xl bg-(--color-surface) p-3">
      <header class="flex items-center justify-between gap-2"><h2 class="font-semibold">Named configuration inputs</h2><UButton type="button" size="sm" variant="outline" @click="addInput">Add input</UButton></header>
      <article v-for="input in draft.inputs" :key="input.id" class="grid grid-cols-2 gap-2 rounded bg-(--color-bg) p-2">
        <input v-model="input.name" required placeholder="Name" class="min-w-0 rounded bg-(--color-surface) p-2" aria-label="Input name" />
        <select :value="input.field" class="min-w-0 rounded bg-(--color-surface) p-2" aria-label="Input type" @change="updateInputField(input, ($event.target as HTMLSelectElement).value)">
          <option value="scalar">Scalar</option><option value="boolean">Boolean</option>
          <option v-for="field in ['weightKg', 'reps', 'restSec', 'durationSec', 'distanceM', 'rpe', 'rir']" :key="field" :value="field">{{ field }}</option>
        </select>
        <label class="text-sm"><input v-model="input.required" type="checkbox" /> Required</label>
        <label v-if="input.field === 'boolean'" class="text-sm">Default true<input :checked="input.defaultValue === true" type="checkbox" @change="setInputDefault(input, $event)" /></label>
        <label v-else class="text-sm">Default<input :value="input.defaultValue ?? ''" type="number" :min="input.minimum ?? 0" :max="input.maximum ?? undefined" :step="input.integer ? 1 : 'any'" class="ml-1 w-24 rounded bg-(--color-surface) p-1" @change="setInputDefault(input, $event)" /></label>
        <template v-if="input.field !== 'boolean'"><label>Minimum<input v-model.number="input.minimum" type="number" :min="input.field === 'reps' ? 1 : 0" :max="input.field === 'rpe' || input.field === 'rir' ? 10 : undefined" :step="input.integer ? 1 : 'any'" class="mt-1 w-full rounded bg-(--color-surface) p-1" /></label><label>Maximum<input v-model.number="input.maximum" type="number" :min="input.field === 'reps' ? 1 : 0" :max="input.field === 'rpe' || input.field === 'rir' ? 10 : undefined" :step="input.integer ? 1 : 'any'" class="mt-1 w-full rounded bg-(--color-surface) p-1" /></label></template>
        <button type="button" class="col-span-2 text-left text-sm text-red-400" @click="removeInput(input.id)">Remove input</button>
      </article>
    </section>
    <section class="space-y-3 rounded-xl bg-(--color-surface) p-3"><header class="flex items-center justify-between"><h2 class="font-semibold">Execution groups</h2><UButton type="button" size="sm" variant="outline" @click="addGroup">Add group</UButton></header><article v-for="group in draft.groups" :key="group.id" class="space-y-2 rounded border border-(--ui-border) p-2"><div class="grid grid-cols-2 gap-2"><input v-model="group.label" aria-label="Group label" class="rounded bg-(--color-bg) p-2" /><input v-model="group.name" aria-label="Group name" placeholder="Optional name" class="rounded bg-(--color-bg) p-2" /></div><select v-model="group.type" aria-label="Group type" class="w-full rounded bg-(--color-bg) p-2"><option value="superset">Superset</option><option value="giant_set">Giant set</option><option value="circuit">Circuit</option><option value="pre_exhaust">Pre-exhaust</option></select><div class="grid grid-cols-2 gap-2"><label>Rounds<input v-model.number="group.rounds" type="number" min="1" class="w-full rounded bg-(--color-bg) p-2" /></label><label>Transition rest sec<input v-model.number="group.transitionRestSec" type="number" min="0" class="w-full rounded bg-(--color-bg) p-2" /></label><label>Rest after round sec<input v-model.number="group.restAfterRoundSec" type="number" min="0" class="w-full rounded bg-(--color-bg) p-2" /></label><label>Circuit rest<select v-model="group.circuitRestMode" class="w-full rounded bg-(--color-bg) p-2"><option value="after_round">After round</option><option value="after_each">After each</option></select></label></div><label><input v-model="group.amrap" type="checkbox" /> AMRAP</label><label class="block">Time cap sec<input v-model.number="group.timeCapSec" type="number" min="0" class="mt-1 w-full rounded bg-(--color-bg) p-2" /></label><button type="button" class="text-sm text-red-400" @click="removeGroup(group.id)">Remove group</button></article></section>
    </details>
    <section class="space-y-2 rounded-xl border border-(--ui-border) p-3">
      <h2 class="font-semibold">Workout preview</h2>
      <p v-if="resolvedPreview.error" role="alert" class="text-sm text-amber-400">{{ resolvedPreview.error }}</p>
      <label v-for="input in draft.inputs" :key="input.id" class="flex items-center gap-2 text-sm"><span>{{ input.name || 'Unnamed input' }}</span><input v-if="input.field === 'boolean'" v-model="previewInputs[input.id]" type="checkbox" /><input v-else v-model.number="previewInputs[input.id]" type="number" :min="input.minimum ?? undefined" :max="input.maximum ?? undefined" :step="input.integer ? 1 : 'any'" class="w-24 rounded bg-(--color-surface) p-2" /></label>
      <template v-if="resolvedPreview.prescription"><div v-for="activity in resolvedPreview.prescription.activities" :key="activity.id" class="text-sm"><h3 class="font-medium">{{ activity.order }}. {{ exerciseName(activity.exerciseId) }}</h3><p v-for="set in activity.sets" :key="set.id">{{ setSummary(set, unit, settings) }}</p><p v-if="activity.targets.durationSec?.resolvedValue != null">{{ activity.targets.durationSec.resolvedValue }} seconds</p><p v-if="activity.targets.distanceM?.resolvedValue != null">{{ displayTargetValue(activity.targets.distanceM.resolvedValue, 'distanceM', unit, distanceUnit) }} {{ distanceUnit }}</p></div></template>
    </section>

</form>
</template>
