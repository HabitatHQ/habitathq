<script setup lang="ts">
import type {
  AppointmentCandidate,
  HistoryCorrectionDetail,
  HistoryCorrectionDraft,
  HistorySetValues,
} from '~/types/history-correction'

const props = defineProps<{ workoutId: string; detail: HistoryCorrectionDetail }>()
const emit = defineEmits<{
  review: [draft: Omit<HistoryCorrectionDraft, 'workoutId' | 'expectedVersion'>]
  change: []
  cancel: []
}>()
const db = useDatabase()
const title = ref(String(props.detail.workout.title ?? ''))
const performedDate = ref(String(props.detail.workout.date ?? ''))
function localTime(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}
const startedAt = ref(localTime(props.detail.workout.started_at))
const endedAt = ref(props.detail.workout.ended_at ? localTime(props.detail.workout.ended_at) : '')
const exerciseOptions = ref<Array<{ id: string; name: string }>>([])
const appointmentOptions = ref<AppointmentCandidate[]>([])
const appointmentId = ref(props.detail.appointmentId ?? '')
const runDistance = ref(
  props.detail.run?.distance_m == null ? '' : String(props.detail.run.distance_m),
)
const runDuration = ref(
  props.detail.run?.duration_sec == null ? '' : String(props.detail.run.duration_sec),
)
const activities = ref(
  props.detail.activities.map(({ activity, sets }) => ({
    id: activity.id,
    exerciseId: activity.exercise_id,
    removed: activity.removed_at !== null,
    sets: sets.map((set) => ({
      id: set.id,
      isNew: false,
      setNumber: set.set_num,
      skipped: props.detail.skippedSetIds.includes(set.id),
      removed: set.removed_at !== null,
      weightKg: set.weight_kg == null ? '' : String(set.weight_kg),
      reps: set.reps == null ? '' : String(set.reps),
      rpe: set.rpe == null ? '' : String(set.rpe),
      rir: set.rir == null ? '' : String(set.rir),
      durationSec: set.duration_sec == null ? '' : String(set.duration_sec),
      distanceM: set.distance_m == null ? '' : String(set.distance_m),
      notes: set.notes ?? '',
      completed: set.completed === 1,
      isWarmup: set.is_warmup === 1,
    })),
  })),
)
const newExerciseId = ref('')
const newSets = ref<
  Array<Record<'weightKg' | 'reps' | 'rpe' | 'rir' | 'durationSec' | 'distanceM' | 'notes', string>>
>([{ weightKg: '', reps: '', rpe: '', rir: '', durationSec: '', distanceM: '', notes: '' }])
const pending = ref(false)
const intentBySet = new Map(props.detail.intentSets.map((intent) => [intent.set_id, intent]))
watch(
  [
    title,
    performedDate,
    startedAt,
    endedAt,
    appointmentId,
    runDistance,
    runDuration,
    activities,
    newExerciseId,
    newSets,
  ],
  () => emit('change'),
  { deep: true },
)

watch(
  () => db.status.value,
  async (status) => {
    if (status !== 'ready') return
    exerciseOptions.value = await db.query<{ id: string; name: string }>(
      'SELECT id,name FROM exercises ORDER BY name COLLATE NOCASE,id',
    )
    appointmentOptions.value = await db.history('HISTORY_APPOINTMENT_CANDIDATES', {
      workoutId: props.workoutId,
    })
  },
  { immediate: true },
)

function optionalNumber(value: string | number): number | null {
  return typeof value === 'number' ? value : value.trim() === '' ? null : Number(value)
}
interface HistoryResultDraft {
  weightKg: string
  reps: string
  rpe: string
  rir: string
  durationSec: string
  distanceM: string
  notes: string
  completed?: boolean
  isWarmup?: boolean
}
function valuesFrom(source: HistoryResultDraft): HistorySetValues {
  return {
    weightKg: optionalNumber(source.weightKg),
    reps: optionalNumber(source.reps),
    rpe: optionalNumber(source.rpe),
    rir: optionalNumber(source.rir),
    durationSec: optionalNumber(source.durationSec),
    distanceM: optionalNumber(source.distanceM),
    notes: source.notes,
    completed: source.completed === true,
    isWarmup: source.isWarmup === true,
  }
}
function addSet() {
  newSets.value.push({
    weightKg: '',
    reps: '',
    rpe: '',
    rir: '',
    durationSec: '',
    distanceM: '',
    notes: '',
  })
}
function addActualSet(activityId: string) {
  const activity = activities.value.find((item) => item.id === activityId)
  if (!activity) return
  activity.sets.push({
    id: crypto.randomUUID(),
    isNew: true,
    setNumber: Math.max(0, ...activity.sets.map((set) => set.setNumber)) + 1,
    skipped: false,
    removed: false,
    weightKg: '',
    reps: '',
    rpe: '',
    rir: '',
    durationSec: '',
    distanceM: '',
    notes: '',
    completed: true,
    isWarmup: false,
  })
}
function submit() {
  pending.value = true
  const draft: Omit<HistoryCorrectionDraft, 'workoutId' | 'expectedVersion'> = {
    title: title.value.trim() || null,
    performedDate: performedDate.value,
    startedAt:
      startedAt.value === localTime(props.detail.workout.started_at)
        ? props.detail.workout.started_at
        : startedAt.value
          ? new Date(startedAt.value).toISOString()
          : '',
    endedAt:
      props.detail.workout.ended_at && endedAt.value === localTime(props.detail.workout.ended_at)
        ? props.detail.workout.ended_at
        : endedAt.value
          ? new Date(endedAt.value).toISOString()
          : '',
    appointmentId: appointmentId.value || null,
    activities: activities.value.map((activity) => ({
      id: activity.id,
      exerciseId: activity.exerciseId,
      removed: activity.removed,
      sets: activity.sets
        .filter((set) => !set.isNew)
        .map((set) => ({ id: set.id, removed: set.removed, values: valuesFrom(set) })),
      addSets: activity.sets.filter((set) => set.isNew && !set.removed).map(valuesFrom),
    })),
    addActivities: newExerciseId.value
      ? [
          {
            exerciseId: newExerciseId.value,
            sets: newSets.value.map((set) => ({
              ...valuesFrom(set),
              completed: true,
              isWarmup: false,
            })),
          },
        ]
      : [],
  }
  if (props.detail.run?.manual_entry === 1) {
    draft.run = {
      distanceM: optionalNumber(runDistance.value),
      durationSec: optionalNumber(runDuration.value),
    }
  }
  emit('review', draft)
  pending.value = false
}
</script>

<template>
  <section aria-labelledby="history-correction-title" class="rounded-xl border border-(--ui-border) bg-(--color-surface) p-4 space-y-3">
    <h2 id="history-correction-title" class="font-semibold">Correct workout facts</h2>
    <p class="text-xs text-(--ui-text-muted)">Changes affect performed records and credit; captured intent and your mood, energy, notes, rotations, and progression stay unchanged.</p>
    <label class="block text-sm">Title<input v-model="title" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2" maxlength="160"></label>
    <label class="block text-sm">Performed local date<input v-model="performedDate" type="date" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"></label>
    <label class="block text-sm">Start time<input v-model="startedAt" type="datetime-local" step="1" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"></label>
    <label class="block text-sm">Finish time<input v-model="endedAt" type="datetime-local" step="1" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"></label>

    <label class="block text-sm">Appointment credit
      <select v-model="appointmentId" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2">
        <option value="">Unlink appointment</option>
        <option v-for="appointment in appointmentOptions" :key="appointment.id" :value="appointment.id" :disabled="appointment.protected">{{ appointment.planName }} · {{ appointment.routineName }} · {{ appointment.plannedDate }} · {{ appointment.status }}{{ appointment.protected ? ' · protected' : '' }}</option>
      </select>
    </label>

    <fieldset v-if="detail.run?.manual_entry === 1" class="space-y-2 rounded-lg border border-(--ui-border) p-3">
      <legend class="px-1 text-sm font-medium">Manual run results</legend>
      <label class="block text-sm">Distance (m)<input v-model="runDistance" type="number" min="0" step="any" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"></label>
      <label class="block text-sm">Duration (s)<input v-model="runDuration" type="number" min="0" step="1" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"></label>
    </fieldset>

    <details v-for="(activity, index) in activities" :key="activity.id" class="rounded-lg border border-(--ui-border) p-3">
      <summary class="cursor-pointer font-medium">{{ exerciseOptions.find((exercise) => exercise.id === activity.exerciseId)?.name ?? `Actual activity ${index + 1}` }} · {{ activity.removed ? 'removed' : 'included' }}</summary>
      <label class="mt-3 block text-sm">Correct exercise identity
        <select v-model="activity.exerciseId" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2">
          <option v-for="exercise in exerciseOptions" :key="exercise.id" :value="exercise.id">{{ exercise.name }}</option>
        </select>
      </label>
      <label class="mt-2 flex items-center gap-2 text-sm"><input v-model="activity.removed" type="checkbox">Exclude this performed activity</label>
      <details v-for="set in activity.sets" :key="set.id" class="mt-3 rounded border border-(--ui-border) p-2">
        <summary class="cursor-pointer text-sm">Set {{ set.setNumber }} · {{ set.isNew ? 'added actual' : set.skipped ? 'skipped' : set.removed ? 'removed' : 'included' }}</summary>
        <p class="mt-1 text-xs text-(--ui-text-muted)">{{ intentBySet.has(set.id) ? 'The review compares this result with its original captured targets.' : 'Extra actual work—no captured target.' }}</p>
        <label class="mt-2 flex items-center gap-2 text-sm"><input v-model="set.removed" type="checkbox">Exclude this actual set/result</label>
        <label class="mt-2 flex items-center gap-2 text-sm"><input v-model="set.completed" type="checkbox">Performed result (completion)</label>
        <label class="mt-2 flex items-center gap-2 text-sm"><input v-model="set.isWarmup" type="checkbox">Warm-up (excluded from lifting credit)</label>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="text-xs">Weight kg<input v-model="set.weightKg" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
          <label class="text-xs">Reps<input v-model="set.reps" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
          <label class="text-xs">RPE<input v-model="set.rpe" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
          <label class="text-xs">RIR<input v-model="set.rir" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
          <label class="text-xs">Duration (s)<input v-model="set.durationSec" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
          <label class="text-xs">Distance (m)<input v-model="set.distanceM" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        </div>
        <label class="mt-2 block text-xs">Actual notes<textarea v-model="set.notes" rows="2" class="mt-1 w-full rounded border border-(--ui-border) bg-(--color-bg) p-2" /></label>
      </details>
      <UButton class="mt-3" size="sm" variant="outline" @click="addActualSet(activity.id)">Add actual result row</UButton>
    </details>
    <div class="space-y-2 rounded-lg border border-(--ui-border) p-3">
      <label class="block text-sm">Add performed activity
        <select v-model="newExerciseId" class="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--color-bg) p-2"><option value="">No new activity</option><option v-for="exercise in exerciseOptions" :key="exercise.id" :value="exercise.id">{{ exercise.name }}</option></select>
      </label>
      <div v-if="newExerciseId" v-for="(set, index) in newSets" :key="index" class="grid grid-cols-2 gap-2">
        <label class="text-xs">Weight kg<input v-model="set.weightKg" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="text-xs">Reps<input v-model="set.reps" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="text-xs">RPE<input v-model="set.rpe" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="text-xs">RIR<input v-model="set.rir" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="text-xs">Duration (s)<input v-model="set.durationSec" type="number" min="0" step="1" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="text-xs">Distance (m)<input v-model="set.distanceM" type="number" min="0" step="any" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
        <label class="col-span-2 text-xs">Notes<input v-model="set.notes" class="w-full rounded border border-(--ui-border) bg-(--color-bg) p-2"></label>
      </div>
      <UButton v-if="newExerciseId" size="sm" variant="outline" @click="addSet">Add result row</UButton>
    </div>
    <div class="flex gap-2"><UButton :loading="pending" @click="submit">Review correction</UButton><UButton color="neutral" variant="outline" @click="emit('cancel')">Cancel</UButton></div>
    <slot name="preview" />
  </section>
</template>
