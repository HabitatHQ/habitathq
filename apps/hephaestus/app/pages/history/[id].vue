<script setup lang="ts">
import { useHistoryCorrection } from '~/composables/useHistoryCorrection'
import { formatDuration, formatWeight } from '~/lib/format'
import { buildWorkoutCard } from '~/lib/workout-card'
import type { ExerciseRow, SetRow, WorkoutExerciseRow, WorkoutRow } from '~/types/database'
import type { FieldComparison, HistoryCorrectionDraft } from '~/types/history-correction'

const route = useRoute()
const workoutId = String(route.params['id'] ?? '')

const db = useDatabase()
const correction = useHistoryCorrection(workoutId)
const editingCorrection = ref(false)
const correctionPreview = computed(() => correction.preview.value)
const { settings } = useAppSettings()
const correctionFieldLabels = {
  weightKg: 'Load',
  reps: 'Reps',
  rpe: 'RPE',
  rir: 'RIR',
  durationSec: 'Duration',
  distanceM: 'Distance',
}
function comparisonValue(field: FieldComparison['field'], value: number | null) {
  if (value === null) return 'Not recorded'
  return field === 'weightKg'
    ? formatWeight(value, settings.value.weightUnit)
    : field === 'durationSec'
      ? formatDuration(value)
      : field === 'distanceM'
        ? `${value} m`
        : String(value)
}
function comparisonTarget(field: FieldComparison) {
  const target = field.target
  if (!target) return 'No captured target'
  const minimum = comparisonValue(field.field, target.minimum)
  return target.kind === 'range'
    ? `${minimum}–${comparisonValue(field.field, target.maximum ?? target.minimum)}`
    : target.kind === 'minimum'
      ? `At least ${minimum}`
      : minimum
}

const workout = ref<WorkoutRow | null>(null)
const exercises = ref<Array<{ exercise: ExerciseRow; sets: SetRow[] }>>([])
const runResult = ref<{ distance_m: number | null; duration_sec: number | null } | null>(null)
const loading = ref(true)
const notFound = ref(false)

watch(
  db.status,
  async (s) => {
    if (s === 'ready') await loadData()
  },
  { immediate: true },
)

async function loadData() {
  loading.value = true
  notFound.value = false
  try {
    const [workoutRows, weRows] = await Promise.all([
      db.query<WorkoutRow>('SELECT * FROM workouts WHERE id = ?', [workoutId]),
      db.query<
        WorkoutExerciseRow & {
          exercise_name: string
          exercise_movement: string
          exercise_icon: string | null
          exercise_muscles: string
          exercise_slug: string
          exercise_equipment: string
          exercise_equipment_sub: string
          exercise_is_custom: number
          exercise_created_at: string
          exercise_logging_mode: string
        }
      >(
        `SELECT we.*,
                e.name AS exercise_name,
                e.movement AS exercise_movement,
                e.icon AS exercise_icon,
                e.muscles AS exercise_muscles,
                e.slug AS exercise_slug,
                e.equipment AS exercise_equipment,
                e.equipment_sub AS exercise_equipment_sub,
                e.is_custom AS exercise_is_custom,
                e.created_at AS exercise_created_at,
                e.logging_mode AS exercise_logging_mode
         FROM workout_exercises we
         JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = ? AND we.removed_at IS NULL
         ORDER BY we.order_num`,
        [workoutId],
      ),
    ])

    if (!workoutRows[0]) {
      notFound.value = true
      return
    }
    workout.value = workoutRows[0]
    runResult.value =
      (
        await db.query<{ distance_m: number | null; duration_sec: number | null }>(
          'SELECT distance_m,duration_sec FROM runs WHERE workout_id=?',
          [workoutId],
        )
      )[0] ?? null

    // Single query for all sets — join back to workout_exercise_id to group them
    const allSets = await db.query<SetRow & { we_id: string }>(
      `SELECT s.*, we.id AS we_id
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND we.removed_at IS NULL AND s.removed_at IS NULL
       ORDER BY we.order_num, s.set_num`,
      [workoutId],
    )

    const setsByWeId = new Map<string, SetRow[]>()
    for (const s of allSets) {
      const weId = s.we_id
      if (!setsByWeId.has(weId)) setsByWeId.set(weId, [])
      setsByWeId.get(weId)?.push(s)
    }

    exercises.value = weRows.map((we) => ({
      exercise: {
        id: we.exercise_id,
        name: we.exercise_name,
        slug: we.exercise_slug,
        equipment: we.exercise_equipment as ExerciseRow['equipment'],
        equipment_sub: we.exercise_equipment_sub as ExerciseRow['equipment_sub'],
        movement: we.exercise_movement as ExerciseRow['movement'],
        muscles: we.exercise_muscles,
        muscles_sec: '[]',
        cues: null,
        icon: we.exercise_icon,
        is_custom: we.exercise_is_custom as 0 | 1,
        logging_mode: we.exercise_logging_mode as ExerciseRow['logging_mode'],
        created_at: we.exercise_created_at,
      } satisfies ExerciseRow,
      sets: setsByWeId.get(we.id) ?? [],
    }))
  } finally {
    loading.value = false
  }
}

const durationFormatted = computed(() => {
  if (!workout.value?.ended_at) return null
  const secs = Math.round(
    (new Date(workout.value.ended_at).getTime() - new Date(workout.value.started_at).getTime()) /
      1000,
  )
  return formatDuration(secs)
})

const totalSets = computed(() =>
  exercises.value.reduce(
    (total, block) =>
      total + block.sets.filter((s) => s.is_warmup === 0 && s.completed === 1).length,
    0,
  ),
)

const workoutDate = computed(() => {
  if (!workout.value) return ''
  return new Date(`${workout.value.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
})

const workoutCard = computed(() => {
  if (!workout.value?.ended_at) return null
  const distance =
    runResult.value?.distance_m ??
    exercises.value
      .flatMap((block) => block.sets)
      .filter((set) => set.completed === 1)
      .reduce((sum, set) => sum + (set.distance_m ?? 0), 0)
  return buildWorkoutCard({
    date: workout.value.date,
    sessionType: workout.value.session_type,
    durationMinutes: Math.max(
      0,
      (new Date(workout.value.ended_at).getTime() - new Date(workout.value.started_at).getTime()) /
        60000,
    ),
    exerciseCount: exercises.value.length,
    workingSets: totalSets.value,
    volumeKg: null,
    distanceMeters: distance > 0 ? distance : null,
  })
})

function downloadWorkoutCard() {
  if (!workoutCard.value) return
  const url = URL.createObjectURL(
    new Blob([workoutCard.value.svg], { type: 'image/svg+xml;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `workout-summary-${workout.value?.date ?? 'completed'}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
}

function moodEmoji(rating: number | null): string {
  if (rating === null) return '—'
  return ['😞', '😕', '😐', '🙂', '😄'][rating - 1] ?? '—'
}
async function reviewCorrection(
  draft: Omit<HistoryCorrectionDraft, 'workoutId' | 'expectedVersion'>,
) {
  try {
    await correction.review(draft)
  } catch (error) {
    correction.error.value = error instanceof Error ? error.message : String(error)
  }
}

async function applyCorrection() {
  try {
    const result = await correction.apply()
    workout.value = result.detail.workout
    editingCorrection.value = false
    await loadData()
  } catch (error) {
    correction.error.value = error instanceof Error ? error.message : String(error)
  }
}

function openCorrection() {
  void correction
    .load()
    .then(() => {
      editingCorrection.value = true
    })
    .catch((error: unknown) => {
      correction.error.value = error instanceof Error ? error.message : String(error)
    })
}
</script>

<template>
  <div>
    <header
      class="sticky top-0 z-10 bg-(--color-bg)/95 backdrop-blur border-b border-(--ui-border) px-4 py-3 flex items-center gap-3"
    >
      <NuxtLink to="/history" aria-label="Back to history">
        <UIcon name="i-ph-arrow-left" class="text-xl text-(--ui-text-muted)" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-lg font-bold flex-1">Workout Detail</h1>
    </header>

    <article class="pb-8">
      <!-- Loading -->
      <div
        v-if="loading"
        role="status"
        aria-label="Loading workout"
        aria-live="polite"
        class="flex items-center justify-center py-20"
      >
        <UIcon name="i-ph-spinner" class="animate-spin text-3xl text-(--ui-text-muted)" aria-hidden="true" />
        <span class="sr-only">Loading workout…</span>
      </div>

      <!-- Not found -->
      <div
        v-else-if="notFound"
        role="alert"
        class="px-4 py-20 text-center text-(--ui-text-muted)"
      >
        <p class="text-sm">Workout not found.</p>
        <NuxtLink to="/history" class="mt-3 inline-block text-sm text-(--color-accent) underline">
          Go to history
        </NuxtLink>
      </div>

      <div v-else-if="workout" class="px-4 py-4 space-y-4">
        <UButton v-if="workout.ended_at" size="sm" variant="outline" @click="openCorrection">Correct workout</UButton>
        <p v-if="correction.error.value" role="alert" class="text-red-500">{{ correction.error.value }}</p>
        <HistoryCorrectionPanel
          v-if="editingCorrection && correction.detail.value"
          :workout-id="workoutId"
          :detail="correction.detail.value"
          @review="reviewCorrection"
          @change="correction.preview.value = null"
          @cancel="editingCorrection = false"
        >
          <template #preview>
            <div v-if="correctionPreview" class="rounded-lg border border-(--ui-border) p-3 text-sm">
              <p>Performed date: {{ correctionPreview.before.date }} → {{ correctionPreview.after.date }}</p>
              <p v-if="correctionPreview.before.title !== correctionPreview.after.title">Title: {{ correctionPreview.before.title ?? 'Untitled' }} → {{ correctionPreview.after.title ?? 'Untitled' }}</p>
              <p>Appointment credit: {{ correctionPreview.appointment.beforeId ?? 'none' }} → {{ correctionPreview.appointment.afterId ?? 'none' }}</p>
              <p>Removed activities/sets: {{ correctionPreview.impact.removedActivities }}/{{ correctionPreview.impact.removedSets }}</p>
              <p>Added activities/result rows: {{ correctionPreview.impact.addedActivities }}/{{ correctionPreview.impact.addedSets }}</p>
              <p>Qualified workout credit: {{ correctionPreview.credit.before.qualifies ? 'yes' : 'no' }} → {{ correctionPreview.credit.after.qualifies ? 'yes' : 'no' }}; applicable frequency goals {{ correctionPreview.credit.before.goalIds.length }} → {{ correctionPreview.credit.after.goalIds.length }}. Rotation position is unchanged.</p>
              <p v-if="correction.detail.value.run" >Manual run result: {{ correctionPreview.run.before?.distanceM ?? 'unknown' }} m/{{ correctionPreview.run.before?.durationSec ?? 'unknown' }} s → {{ correctionPreview.run.after?.distanceM ?? 'unknown' }} m/{{ correctionPreview.run.after?.durationSec ?? 'unknown' }} s</p>
              <div v-for="comparison in correctionPreview.comparisons" :key="comparison.setId" class="mt-2 border-t border-(--ui-border) pt-2">
                <p class="font-medium">{{ comparison.exerciseName }} · Set {{ comparison.setNumber }}</p>
                <p v-for="field in comparison.fields" :key="field.field">{{ correctionFieldLabels[field.field] }}: {{ comparisonValue(field.field,field.actual) }} / {{ comparisonTarget(field) }} · {{ field.status }}</p>
              </div>
              <div class="mt-2 flex gap-2"><UButton :loading="correction.saving.value" @click="applyCorrection">Apply reviewed correction</UButton><UButton color="neutral" variant="outline" @click="correction.preview.value = null">Back</UButton></div>
            </div>
          </template>
        </HistoryCorrectionPanel>
        <!-- Date -->
        <p class="text-xs text-(--ui-text-muted)">
          <time :datetime="workout.date">{{ workoutDate }}</time>
        </p>

        <!-- Key stats -->
        <section aria-labelledby="stats-heading" class="bg-(--color-surface) rounded-xl p-4">
          <h2 id="stats-heading" class="text-xs text-(--ui-text-muted) uppercase tracking-wide mb-3">Summary</h2>
          <div class="grid grid-cols-2 gap-3 text-center">
            <div>
              <p class="text-xl font-bold tabular-nums">{{ durationFormatted ?? '—' }}</p>
              <p class="text-xs text-(--ui-text-muted)">Duration</p>
            </div>
            <div>
              <p class="text-xl font-bold tabular-nums">{{ totalSets }}</p>
              <p class="text-xs text-(--ui-text-muted)">Completed working sets</p>
            </div>
          </div>

          <dl class="flex gap-4 mt-3 pt-3 border-t border-(--ui-border) text-sm">
            <div class="flex gap-1 items-center">
              <dt class="text-(--ui-text-muted) text-xs">Mood</dt>
              <dd aria-label="Mood rating">{{ moodEmoji(workout.mood_rating) }}</dd>
            </div>
            <div class="flex gap-1 items-center">
              <dt class="text-(--ui-text-muted) text-xs">Energy</dt>
              <dd class="font-semibold">{{ workout.energy_rating ?? '—' }}</dd>
            </div>
            <div v-if="workout.environment" class="ml-auto">
              <dt class="sr-only">Environment</dt>
              <dd class="text-xs text-(--ui-text-muted) capitalize">
                {{ workout.environment.replace('_', ' ') }}
              </dd>
            </div>
          </dl>

          <p v-if="workout.notes" class="mt-3 text-sm text-(--ui-text-muted) italic">{{ workout.notes }}</p>
        </section>

        <section v-if="workoutCard" aria-labelledby="card-heading" class="rounded-xl bg-(--color-surface) p-4">
          <h2 id="card-heading" class="text-sm font-semibold">Workout summary card</h2>
          <p class="mt-1 text-xs text-(--ui-text-muted)">
            The image contains workout totals only; notes and identifying details are excluded.
          </p>
          <UButton class="mt-3" icon="i-ph-image" @click="downloadWorkoutCard">Download summary image</UButton>
          <p class="mt-3 text-sm" aria-label="Text alternative for workout summary card">
            {{ workoutCard.textAlternative }}
          </p>
        </section>

        <!-- Exercises -->
        <ul role="list" class="space-y-3">
          <li
            v-for="block in exercises"
            :key="block.exercise.id"
          >
            <section
              :aria-labelledby="`ex-heading-${block.exercise.id}`"
              class="bg-(--color-surface) rounded-xl overflow-hidden"
            >
              <header class="flex items-center gap-3 px-4 py-3 border-b border-(--ui-border)">
                <ExerciseAvatar
                  :icon="block.exercise.icon"
                  :movement="block.exercise.movement"
                  aria-hidden="true"
                />
                <h3 :id="`ex-heading-${block.exercise.id}`" class="text-sm font-semibold">
                  {{ block.exercise.name }}
                </h3>
              </header>

              <div class="px-4 py-2" role="table" :aria-label="`Sets for ${block.exercise.name}`">
                <div class="grid grid-cols-4 text-[10px] text-(--ui-text-muted) uppercase pb-1" role="row">
                  <span role="columnheader">Set</span>
                  <span role="columnheader" class="text-right">Weight</span>
                  <span role="columnheader" class="text-right">Reps</span>
                  <span role="columnheader" class="text-right">RPE</span>
                </div>
                <div
                  v-for="s in block.sets.filter((s) => s.completed === 1)"
                  :key="s.id"
                  class="grid grid-cols-4 py-1 text-sm border-t border-(--ui-border)/50"
                  role="row"
                >
                  <span role="cell" class="text-(--ui-text-muted)">
                    {{ s.is_warmup ? 'W' : s.set_num }}
                  </span>
                  <span role="cell" class="text-right">
                    {{ s.weight_kg !== null ? `${s.weight_kg} kg` : '—' }}
                  </span>
                  <span role="cell" class="text-right">{{ s.reps ?? '—' }}</span>
                  <span role="cell" class="text-right text-(--ui-text-muted)">{{ s.rpe ?? '—' }}</span>
                </div>
                <p
                  v-if="block.sets.filter((s) => s.completed === 1).length === 0"
                  class="text-sm text-(--ui-text-muted) py-2"
                >
                  No completed sets
                </p>
              </div>
            </section>
          </li>
        </ul>
      </div>
    </article>
  </div>
</template>
