<script setup lang="ts">
import type { WorkoutActivityIntent, WorkoutSetIntent } from '~/lib/workout-storage'
import type { ExerciseRow, SetRow, WorkoutExerciseRow } from '~/types/database'

const props = defineProps<{
  groupLabel: string
  groupName?: string
  groupType: string
  transitionRest: number // seconds between exercises within a round
  roundRest: number // seconds after completing a full round
  exercises: Array<{
    we: WorkoutExerciseRow
    exercise: ExerciseRow
    sets: SetRow[]
  }>
  unit?: 'kg' | 'lbs'
  setIntents?: Readonly<Record<string, Readonly<WorkoutSetIntent>>>
  activityIntents?: Readonly<Record<string, Readonly<WorkoutActivityIntent>>>
  skippedSetIds?: ReadonlySet<string>
  prescribed?: boolean
}>()

const emit = defineEmits<{
  addSet: [weId: string]
  tapSet: [set: SetRow]
}>()

const unit = computed(() => props.unit ?? 'kg')

const groupTypeLabel: Record<string, string> = {
  superset: 'Superset',
  giant_set: 'Giant Set',
  circuit: 'Circuit',
  pre_exhaust: 'Pre-exhaust',
}

function workingSets(ex: (typeof props.exercises)[number]) {
  return ex.sets.filter((s) => s.completed === 1 && s.is_warmup === 0)
}

// Rounds completed = all exercises have at least this many working sets
const roundsCompleted = computed(() => {
  if (props.exercises.length === 0) return 0
  return Math.min(...props.exercises.map((ex) => workingSets(ex).length))
})
</script>

<template>
  <section
    class="rounded-xl bg-(--color-surface) overflow-hidden border border-(--color-accent)/25"
    :aria-labelledby="`group-hd-${groupLabel}`"
  >
    <!-- Group header -->
    <header
      class="flex items-center gap-2 px-4 py-2.5 border-b border-(--color-accent)/25"
      style="background: color-mix(in srgb, var(--color-accent) 8%, transparent)"
    >
      <span
        class="w-5 h-5 rounded-full text-(--color-accent) text-[11px] font-bold flex items-center justify-center shrink-0 ring-1 ring-(--color-accent)/50"
        aria-hidden="true"
      >{{ groupLabel }}</span>
      <span :id="`group-hd-${groupLabel}`" class="text-xs font-semibold text-(--color-accent)">
        {{ groupName ?? groupTypeLabel[groupType] ?? groupType }}
      </span>
      <span
        v-if="roundsCompleted > 0"
        class="ml-auto text-xs text-(--ui-text-muted)"
        aria-live="polite"
        :aria-label="`${roundsCompleted} round${roundsCompleted !== 1 ? 's' : ''} completed`"
      >
        {{ roundsCompleted }}× done
      </span>
    </header>

    <!-- Stacked exercises -->
    <ul role="list" class="divide-y divide-(--ui-border)/60">
      <li v-for="(ex, idx) in exercises" :key="ex.we.id">
        <!-- Step indicator + exercise -->
        <div class="flex items-stretch">
          <!-- Left step rail -->
          <div class="flex flex-col items-center pt-4 pb-0 pl-4 pr-3 shrink-0">
            <span
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0"
              :class="workingSets(ex).length > 0
                ? 'bg-(--color-accent)/20 border-(--color-accent)/60 text-(--color-accent)'
                : 'border-(--ui-border) text-(--ui-text-muted)'"
              :aria-label="String.fromCharCode(65 + idx)"
            >
              {{ String.fromCharCode(65 + idx) }}
            </span>
            <!-- Connector line to next -->
            <div
              v-if="idx < exercises.length - 1"
              class="w-px flex-1 mt-1"
              :class="workingSets(ex).length > 0 ? 'bg-(--color-accent)/30' : 'bg-(--ui-border)/60'"
              aria-hidden="true"
            />
          </div>

          <!-- Exercise content -->
          <div class="flex-1 min-w-0 px-3 py-3">
            <div class="flex items-start gap-2">
              <ExerciseAvatar
                :icon="ex.exercise.icon"
                :movement="ex.exercise.movement"
                aria-hidden="true"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold leading-tight truncate">{{ ex.exercise.name }}</p>
                <p class="mt-1 text-xs text-(--ui-text-muted)">
                  {{ workingSets(ex).length }} working set{{ workingSets(ex).length === 1 ? '' : 's' }}
                </p>
                <p v-if="activityIntents?.[ex.we.id]" class="mt-1 text-xs text-(--ui-text-muted)">
                  <span v-if="activityIntents[ex.we.id]?.durationSec !== null && activityIntents[ex.we.id]?.durationSec !== undefined">
                    Activity target: {{ activityIntents[ex.we.id]?.durationSec }} sec
                  </span>
                  <span v-if="activityIntents[ex.we.id]?.distanceM !== null && activityIntents[ex.we.id]?.distanceM !== undefined">
                    {{ activityIntents[ex.we.id]?.distanceM }} m
                  </span>
                </p>
              </div>
              <UButton
                size="xs"
                color="primary"
                class="shrink-0 mt-0.5"
                :aria-label="`Log set for ${ex.exercise.name}`"
                @click="emit('addSet', ex.we.id)"
              >
                + Set
              </UButton>
            </div>
            <ul class="divide-y divide-(--ui-border)/30" :aria-label="`Sets for ${ex.exercise.name}`">
              <WorkoutSetRow
                v-for="set in ex.sets"
                :key="set.id"
                :set="set"
                :unit="unit"
                :logging-mode="ex.we.logging_mode"
                :exercise-name="ex.exercise.name"
                :intent="setIntents?.[set.id] ?? null"
                :skipped="skippedSetIds?.has(set.id) ?? false"
                :prescribed="prescribed ?? false"
                @tap="emit('tapSet', $event)"
              />
            </ul>
          </div>
        </div>
      </li>
    </ul>

    <!-- Rest guide footer -->
    <footer
      class="flex items-center gap-4 px-4 py-2 border-t border-(--ui-border)/60 text-xs text-(--ui-text-muted)"
      style="background: color-mix(in srgb, var(--color-surface-2) 60%, transparent)"
    >
      <span class="flex items-center gap-1">
        <UIcon name="i-ph-arrows-left-right" class="w-3 h-3" aria-hidden="true" />
        {{ transitionRest > 0 ? `${transitionRest}s between` : 'No rest between' }}
      </span>
      <span class="ml-auto flex items-center gap-1">
        <UIcon name="i-ph-clock" class="w-3 h-3" aria-hidden="true" />
        {{ roundRest }}s after round
      </span>
    </footer>
  </section>
</template>
