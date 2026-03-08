<script setup lang="ts">
import type { ExerciseRow, SetRow, WorkoutExerciseRow } from '~/types/database'

const props = defineProps<{
  workoutExercise: WorkoutExerciseRow
  exercise: ExerciseRow
  sets: SetRow[]
  unit?: 'kg' | 'lbs'
}>()

const emit = defineEmits<{
  addSet: [weId: string]
  tapSet: [set: SetRow]
}>()

const unit = computed(() => props.unit ?? 'kg')
const completedCount = computed(() => props.sets.filter((s) => s.completed === 1).length)
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
          {{ exercise.equipment }} · {{ workingCount }} working set{{ workingCount !== 1 ? 's' : '' }}
        </p>
      </div>
      <UButton size="xs" variant="ghost" color="primary" @click="emit('addSet', workoutExercise.id)">
        <UIcon name="i-heroicons-plus" class="w-4 h-4" aria-hidden="true" />
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
        @tap="emit('tapSet', $event)"
      />
    </ul>
  </section>
</template>
