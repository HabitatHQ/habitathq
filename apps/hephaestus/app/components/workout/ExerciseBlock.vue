<script setup lang="ts">
import type { WorkoutActivityIntent, WorkoutSetIntent } from '~/lib/workout-storage'
import type { ExerciseRow, SetRow, WorkoutExerciseRow } from '~/types/database'

const props = defineProps<{
  workoutExercise: WorkoutExerciseRow
  exercise: ExerciseRow
  sets: SetRow[]
  unit?: 'kg' | 'lbs'
  setIntents?: Readonly<Record<string, Readonly<WorkoutSetIntent>>>
  activityIntent?: Readonly<WorkoutActivityIntent> | null
  skippedSetIds?: ReadonlySet<string>
  prescribed?: boolean
}>()

const emit = defineEmits<{
  addSet: [weId: string]
  tapSet: [set: SetRow]
}>()

const unit = computed(() => props.unit ?? 'kg')
const loggingMode = computed(() => props.workoutExercise.logging_mode)
const workingCount = computed(
  () => props.sets.filter((s) => s.completed === 1 && s.is_warmup === 0).length,
)
</script>

<template>
  <section
    class="rounded-xl bg-(--color-surface) overflow-hidden"
    :class="workoutExercise.superset_group ? 'border-l-4 border-(--color-accent)' : ''"
    :aria-labelledby="`ex-${workoutExercise.id}`"
  >
    <!-- Exercise header -->
    <header class="flex items-center justify-between px-4 pt-3 pb-1">
      <div class="min-w-0">
        <h3
          :id="`ex-${workoutExercise.id}`"
          class="font-semibold truncate text-sm"
        >
          {{ exercise.name }}
          <span
            v-if="workoutExercise.superset_group"
            class="ml-1 text-xs font-bold text-(--color-accent) uppercase"
          >
            {{ workoutExercise.superset_group }}
          </span>
        </h3>
        <p class="text-xs text-(--ui-text-muted) capitalize">
          {{ exercise.equipment }} · {{ workingCount }} {{ loggingMode === 'strength' ? 'working sets' : 'completed entries' }}
        </p>
        <p v-if="activityIntent && (activityIntent.durationSec !== null || activityIntent.distanceM !== null)" class="mt-1 text-xs text-(--ui-text-muted)">
          Activity target:
          <span v-if="activityIntent.durationSec !== null">{{ activityIntent.durationSec }} sec</span>
          <span v-if="activityIntent.distanceM !== null"> {{ activityIntent.distanceM }} m</span>
        </p>
      </div>
      <UButton
        size="xs"
        variant="ghost"
        color="primary"
        aria-label="+ Set"
        @click="emit('addSet', workoutExercise.id)"
      >
        <UIcon name="i-ph-plus" class="w-4 h-4" aria-hidden="true" />
        Set
      </UButton>
    </header>

    <!-- Sets list -->
    <ul role="list" class="px-4 pb-3 space-y-0 divide-y divide-(--ui-border)/30">
      <WorkoutSetRow
        v-for="set in sets"
        :key="set.id"
        :set="set"
        :unit="unit"
        :logging-mode="loggingMode"
        :exercise-name="exercise.name"
        :intent="setIntents?.[set.id] ?? null"
        :skipped="skippedSetIds?.has(set.id) ?? false"
        :prescribed="prescribed ?? false"
        @tap="emit('tapSet', $event)"
      />
    </ul>
  </section>
</template>
