<script setup lang="ts">
import { fromKilograms, toKilograms } from '~/lib/equipment'
import { formatWeight } from '~/lib/format'
import type { WorkoutSetIntent } from '~/lib/workout-storage'
import type { LoggingMode, SetRow } from '~/types/database'

const props = defineProps<{
  set: SetRow
  unit?: 'kg' | 'lbs'
  loggingMode?: LoggingMode
  exerciseName?: string
  intent?: Readonly<WorkoutSetIntent> | null
  skipped?: boolean
  prescribed?: boolean
}>()
const emit = defineEmits<{ tap: [set: SetRow] }>()
const workout = useWorkout()
const unit = computed(() => props.unit ?? 'kg')
const loggingMode = computed(() => props.loggingMode ?? 'strength')
const busy = ref(false)
const saving = ref(false)
const error = ref('')
type NumericField = 'weight' | 'reps' | 'distance' | 'duration' | 'rpe' | 'rir'
type EditableField = NumericField | 'notes' | 'warmup'
const text = reactive<Record<Exclude<EditableField, 'warmup'>, string>>({
  weight: '',
  reps: '',
  distance: '',
  duration: '',
  rpe: '',
  rir: '',
  notes: '',
})
const warmup = ref(false)
const dirty = new Set<EditableField>()
const invalid = new Set<EditableField>()
let generation = 0
let draftQueue: Promise<void> = Promise.resolve()
const suffix = computed(() => (props.exerciseName ? ` for ${props.exerciseName}` : ''))
const detailLabel = computed(() => `Edit set ${props.set.set_num}${suffix.value}`)
const label = computed(() => (props.set.is_warmup ? 'Warm-up' : `Set ${props.set.set_num}`))
const targetReps = computed(() => {
  if (props.intent?.exactReps !== null && props.intent?.exactReps !== undefined)
    return `${props.intent.exactReps} reps`
  if (props.intent?.minimumReps !== null && props.intent?.minimumReps !== undefined) {
    return props.intent.maximumReps === null
      ? `${props.intent.minimumReps}+ reps`
      : `${props.intent.minimumReps}–${props.intent.maximumReps} reps`
  }
  return null
})

function syncFields() {
  const set = props.set
  const values: Record<Exclude<EditableField, 'warmup'>, string> = {
    weight:
      set.weight_kg === null
        ? ''
        : unit.value === 'kg'
          ? String(set.weight_kg)
          : String(Number(fromKilograms(set.weight_kg, unit.value).toFixed(1))),
    reps: set.reps === null ? '' : String(set.reps),
    distance: set.distance_m === null ? '' : String(set.distance_m),
    duration: set.duration_sec === null ? '' : String(set.duration_sec),
    rpe: set.rpe === null ? '' : String(set.rpe),
    rir: set.rir === null ? '' : String(set.rir),
    notes: set.notes ?? '',
  }
  for (const field of Object.keys(values)) {
    if (
      field === 'weight' ||
      field === 'reps' ||
      field === 'distance' ||
      field === 'duration' ||
      field === 'rpe' ||
      field === 'rir' ||
      field === 'notes'
    ) {
      if (!dirty.has(field)) text[field] = values[field]
    }
  }
  if (!dirty.has('warmup')) warmup.value = set.is_warmup === 1
}
watch([() => props.set, unit], syncFields, { immediate: true })

function number(
  field: NumericField,
  integer = false,
  maximum = Number.POSITIVE_INFINITY,
): number | null {
  if (invalid.has(field)) throw new Error(`Enter a valid ${field} value.`)
  const value = text[field].trim()
  if (!value) return null
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > maximum ||
    (integer && !Number.isSafeInteger(parsed))
  )
    throw new Error(
      `${field} must be nonnegative${integer ? ' and a whole number' : ''}${Number.isFinite(maximum) ? `, up to ${maximum}` : ''}.`,
    )
  return parsed
}

function visiblePartial(): Partial<SetRow> {
  const weight = number('weight')
  const reps = number('reps', true)
  const distance = number('distance')
  const duration = number('duration')
  const rpe = number('rpe', false, 10)
  const rir = number('rir', false, 10)
  const partial: Partial<SetRow> = {}
  if (dirty.has('weight'))
    partial.weight_kg = weight === null ? null : toKilograms(weight, unit.value)
  if (dirty.has('reps')) partial.reps = reps
  if (dirty.has('distance')) partial.distance_m = distance
  if (dirty.has('duration')) partial.duration_sec = duration
  if (dirty.has('rpe')) partial.rpe = rpe
  if (dirty.has('rir')) partial.rir = rir
  if (dirty.has('notes')) partial.notes = text.notes.trim() || null
  if (dirty.has('warmup')) partial.is_warmup = warmup.value ? 1 : 0
  return partial
}

function onInput(field: EditableField, event: Event) {
  if (busy.value) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return
  if (field === 'warmup') {
    if (!(input instanceof HTMLInputElement)) return
    warmup.value = input.checked
  } else text[field] = input.value
  if (input instanceof HTMLInputElement && input.validity.badInput) invalid.add(field)
  else invalid.delete(field)
  dirty.add(field)
  const revision = ++generation
  try {
    const partial = visiblePartial()
    error.value = ''
    saving.value = true
    const setId = props.set.id
    draftQueue = draftQueue
      .then(async () => {
        await workout.saveDraft(setId, partial)
        if (revision === generation) dirty.clear()
      })
      .catch((failure: unknown) => {
        if (revision === generation)
          error.value = failure instanceof Error ? failure.message : 'Could not save this draft.'
      })
      .finally(() => {
        if (revision === generation) saving.value = false
      })
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Invalid draft.'
    saving.value = false
  }
}

async function complete() {
  if (busy.value) return
  busy.value = true
  try {
    await draftQueue
    const saved = await workout.completeSet(props.set.id, visiblePartial())
    syncFieldsFromCompleted(saved)
    error.value = ''
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not complete this set.'
  } finally {
    busy.value = false
  }
}

function syncFieldsFromCompleted(set: SetRow) {
  const values: Record<Exclude<EditableField, 'warmup'>, string> = {
    weight:
      set.weight_kg === null
        ? ''
        : unit.value === 'kg'
          ? String(set.weight_kg)
          : String(Number(fromKilograms(set.weight_kg, unit.value).toFixed(1))),
    reps: set.reps === null ? '' : String(set.reps),
    distance: set.distance_m === null ? '' : String(set.distance_m),
    duration: set.duration_sec === null ? '' : String(set.duration_sec),
    rpe: set.rpe === null ? '' : String(set.rpe),
    rir: set.rir === null ? '' : String(set.rir),
    notes: set.notes ?? '',
  }
  Object.assign(text, values)
  warmup.value = set.is_warmup === 1
  dirty.clear()
  invalid.clear()
}
async function undo() {
  busy.value = true
  try {
    await workout.undoSet(props.set.id)
    error.value = ''
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not undo completion.'
  } finally {
    busy.value = false
  }
}

async function toggleSkip() {
  busy.value = true
  try {
    await draftQueue
    if (!props.skipped) await workout.saveDraft(props.set.id, visiblePartial())
    await workout.skipSet(props.set.id, !props.skipped)
    error.value = ''
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not change this skip.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <li class="py-3 space-y-2 text-sm" :class="set.is_warmup ? 'opacity-70' : ''">
    <div class="flex items-center gap-2">
      <span class="font-medium">{{ label }}</span>
      <span v-if="intent?.role === 'top' || intent?.role === 'back_off'" class="text-xs text-(--ui-text-muted)">
        {{ intent.role === 'top' ? 'Top set' : 'Back-off' }}
      </span>
      <span v-if="prescribed && !intent && loggingMode === 'strength'" class="text-xs text-(--ui-text-muted)">Extra</span>
      <span v-if="skipped" class="text-xs text-(--ui-text-muted)">Skipped—not performed</span>
      <span v-else-if="!set.completed" class="text-xs text-(--ui-text-muted)">Draft—not performed</span>
      <UButton v-if="!set.completed" class="ml-auto min-h-11" size="xs" variant="ghost" :aria-label="detailLabel" :disabled="busy" @click="emit('tap', set)">
        Details
      </UButton>
    </div>
    <p v-if="intent && (intent.weightKg !== null || targetReps)" class="text-xs text-(--ui-text-muted)">
      Target:
      <template v-if="intent.weightKg !== null">{{ formatWeight(intent.weightKg, unit) }}</template>
      <template v-if="intent.weightKg !== null && targetReps"> × </template>
      {{ targetReps }}
    </p>
    <p v-if="intent && (intent.rpe !== null || intent.rir !== null)" class="text-xs text-(--ui-text-muted)">
      Effort target:
      <span v-if="intent.rpe !== null">RPE {{ intent.rpe }}</span>
      <span v-if="intent.rir !== null"> RIR {{ intent.rir }}</span>
    </p>

    <div v-if="set.completed" class="flex items-center gap-3">
      <button type="button" class="min-h-11 flex-1 text-left tabular-nums" :aria-label="detailLabel" @click="emit('tap', set)">
        <template v-if="loggingMode === 'strength'">
          <span>{{ set.weight_kg === null ? 'Unspecified load' : formatWeight(set.weight_kg, unit) }}</span>
          <span class="text-(--ui-text-muted)"> × </span>
          <span>{{ set.reps ?? '—' }} reps</span>
        </template>
        <template v-else>
          <span v-if="set.distance_m !== null">{{ (set.distance_m / 1000).toFixed(2) }} km</span>
          <span v-if="set.duration_sec !== null"> {{ set.duration_sec }} sec</span>
        </template>
        <span v-if="set.rpe !== null" class="ml-2 text-xs">RPE {{ set.rpe }}</span>
        <span v-if="set.rir !== null" class="ml-2 text-xs">RIR {{ set.rir }}</span>
        <span v-if="set.failure_flag" class="ml-2 text-xs">Failure</span>
        <span v-if="set.notes" class="ml-2 text-xs" :title="set.notes">Note</span>
      </button>
      <UButton variant="outline" size="xs" class="min-h-11" :loading="busy" :aria-label="`Undo set ${set.set_num}${suffix}`" @click="undo">Undo</UButton>
    </div>

    <template v-else-if="!skipped">
      <div class="grid grid-cols-2 gap-2">
        <template v-if="loggingMode === 'strength'">
          <label class="block text-xs">
            Weight ({{ unit }})
            <input :value="text.weight" type="number" min="0" step="any" inputmode="decimal" :disabled="busy"
              :aria-label="`Weight (${unit}) for set ${set.set_num}${suffix}`"
              class="mt-1 w-full min-h-11 rounded-lg bg-(--color-surface-2) px-3 text-base tabular-nums"
              @input="onInput('weight', $event)" />
          </label>
          <label class="block text-xs">
            {{ intent?.minimumReps !== null && intent?.minimumReps !== undefined ? 'Achieved reps' : 'Reps' }}
            <input :value="text.reps" type="number" min="0" step="1" inputmode="numeric" :disabled="busy"
              :placeholder="targetReps ?? ''" :aria-label="`Reps for set ${set.set_num}${suffix}`"
              class="mt-1 w-full min-h-11 rounded-lg bg-(--color-surface-2) px-3 text-base tabular-nums"
              @input="onInput('reps', $event)" />
          </label>
        </template>
        <template v-else>
          <label class="block text-xs">
            Distance (m)
            <input :value="text.distance" type="number" min="0" step="any" inputmode="decimal" :disabled="busy"
              :aria-label="`Distance (m) for set ${set.set_num}${suffix}`"
              class="mt-1 w-full min-h-11 rounded-lg bg-(--color-surface-2) px-3 text-base"
              @input="onInput('distance', $event)" />
          </label>
          <label class="block text-xs">
            Duration (sec)
            <input :value="text.duration" type="number" min="0" step="any" inputmode="decimal" :disabled="busy"
              :aria-label="`Duration (sec) for set ${set.set_num}${suffix}`"
              class="mt-1 w-full min-h-11 rounded-lg bg-(--color-surface-2) px-3 text-base"
              @input="onInput('duration', $event)" />
          </label>
        </template>
      </div>
      <details>
        <summary class="min-h-11 flex items-center text-xs text-(--ui-text-muted) cursor-pointer">Effort &amp; notes</summary>
        <div class="grid grid-cols-2 gap-2">
          <label v-if="loggingMode === 'strength'" class="block text-xs">RPE
            <input :value="text.rpe" type="number" min="0" max="10" step="0.5" :disabled="busy" :aria-label="`RPE for set ${set.set_num}${suffix}`"
              class="mt-1 min-h-11 w-full rounded-lg bg-(--color-surface-2) px-3" @input="onInput('rpe', $event)" />
          </label>
          <label v-if="loggingMode === 'strength'" class="block text-xs">RIR
            <input :value="text.rir" type="number" min="0" max="10" step="0.5" :disabled="busy" :aria-label="`RIR for set ${set.set_num}${suffix}`"
              class="mt-1 min-h-11 w-full rounded-lg bg-(--color-surface-2) px-3" @input="onInput('rir', $event)" />
          </label>
          <label class="col-span-2 block text-xs">Notes
            <textarea :value="text.notes" :disabled="busy" :aria-label="`Notes for set ${set.set_num}${suffix}`"
              class="mt-1 min-h-11 w-full rounded-lg bg-(--color-surface-2) p-3" @input="onInput('notes', $event)" />
          </label>
          <label v-if="loggingMode === 'strength'" class="col-span-2 min-h-11 flex items-center gap-2 text-xs">
            <input type="checkbox" :checked="warmup" :disabled="busy" class="h-5 w-5" @change="onInput('warmup', $event)" />
            Warm-up
          </label>
        </div>
      </details>
      <div class="flex items-center gap-2">
        <UButton class="min-h-11 flex-1 justify-center" :loading="busy" :aria-label="`Complete set ${set.set_num}${suffix}`" @click="complete">Complete</UButton>
        <UButton variant="ghost" class="min-h-11" :disabled="busy" :aria-label="`Skip set ${set.set_num}${suffix}`" @click="toggleSkip">Skip</UButton>
      </div>
      <p class="min-h-4 text-xs text-(--ui-text-muted)" aria-live="polite">{{ saving ? 'Saving draft…' : 'Valid entries save automatically. Completion is separate.' }}</p>
    </template>
    <UButton v-else variant="outline" class="min-h-11" :loading="busy" :aria-label="`Restore set ${set.set_num}${suffix}`" @click="toggleSkip">Restore draft</UButton>
    <p v-if="error" role="alert" class="text-xs text-red-400">{{ error }}</p>
  </li>
</template>
