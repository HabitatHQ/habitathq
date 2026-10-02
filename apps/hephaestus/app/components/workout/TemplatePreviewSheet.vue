<script setup lang="ts">
import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import { estimateTemplateDuration } from '~/lib/template-stats'
import type { SessionType, TemplateRow } from '~/types/database'

interface Props {
  open: boolean
  template: TemplateRow
  exercises: TemplateExerciseWithName[]
}

const props = defineProps<Props>()
const modalFocus = useModalFocus(() => props.open)
const emit = defineEmits<{
  close: []
  start: [{ scaleFactor: number; excludedExerciseIds: string[]; sessionType: SessionType }]
}>()

const scaleFactor = ref(1.0)
const excludedExerciseIds = ref<Set<string>>(new Set())

const sessionTypeOptions = computed<
  Array<{ value: SessionType; label: string; description: string; disabled: boolean }>
>(() => {
  const hasCardio = props.exercises.some((ex) => ex.exercise_movement === 'cardio')
  return [
    { value: 'gym', label: 'Strength', description: 'Resistance sets and reps.', disabled: false },
    {
      value: 'conditioning',
      label: 'Conditioning',
      description: 'Work/rest intervals, circuits, AMRAP.',
      disabled: !hasCardio,
    },
    {
      value: 'mobility',
      label: 'Mobility',
      description: 'Bodyweight, holds, and recovery work.',
      disabled: !hasCardio,
    },
  ]
})
const sessionType = ref<SessionType>('gym')
watch(sessionTypeOptions, (options) => {
  if (!options.find((opt) => opt.value === sessionType.value && !opt.disabled)) {
    sessionType.value = 'gym'
  }
})

const totalSets = computed(() => props.exercises.reduce((a, e) => a + (e.sets_planned ?? 3), 0))
const estimatedSecs = computed(() =>
  estimateTemplateDuration(props.exercises.length, totalSets.value, 120),
)
const remainingCount = computed(
  () => props.exercises.filter((ex) => !excludedExerciseIds.value.has(ex.exercise_id)).length,
)
const hasDuplicateExercise = computed(() => {
  const ids = props.exercises.map((ex) => ex.exercise_id)
  return ids.length !== new Set(ids).size
})

function formatDuration(secs: number): string {
  const m = Math.round(secs / 60)
  return `~${m} min`
}

function toggleExercise(exerciseId: string) {
  if (excludedExerciseIds.value.has(exerciseId)) {
    excludedExerciseIds.value.delete(exerciseId)
  } else {
    excludedExerciseIds.value.add(exerciseId)
  }
}

function handleStart() {
  if (remainingCount.value === 0) return
  emit('start', {
    scaleFactor: scaleFactor.value,
    excludedExerciseIds: [...excludedExerciseIds.value],
    sessionType: sessionType.value,
  })
}

const scalePercent = computed({
  get: () => Math.round(scaleFactor.value * 100),
  set: (v: number) => {
    scaleFactor.value = v / 100
  },
})
</script>

<template>
  <UModal
    :open="open"
    :content="modalFocus"
    :title="`Preview: ${template.name}`"
    description="Adjust the planned workload and choose exercises for this workout."
    @update:open="value => { if (!value) emit('close') }"
  >
    <template #content>
      <div class="bg-(--ui-bg) max-h-[85dvh] flex flex-col">
      <div class="flex-none p-4 border-b border-(--ui-border) flex items-center justify-between">
        <div>
          <h2 class="font-bold">{{ template.name }}</h2>
          <p class="text-xs text-(--ui-text-muted)">
            {{ exercises.length }} exercises · {{ formatDuration(estimatedSecs) }}
          </p>
        </div>
        <button class="text-(--ui-text-muted)" aria-label="Close" @click="emit('close')">
        <UIcon name="i-ph-x" class="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <!-- Scale slider -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Scale</p>
            <span class="text-sm font-bold text-(--color-accent)">{{ scalePercent }}%</span>
          </div>
          <input
            v-model.number="scalePercent"
            type="range"
            min="50"
            max="150"
            step="5"
            class="w-full accent-(--color-accent)"
            aria-label="Scale factor"
          />
        </div>

        <fieldset class="space-y-2">
          <legend class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">Session type</legend>
          <label
            v-for="option in sessionTypeOptions"
            :key="option.value"
            class="flex gap-3 rounded-xl border border-(--ui-border) p-3"
            :class="option.disabled ? 'opacity-40' : ''"
          >
            <input
              v-model="sessionType"
              type="radio"
              name="template-session-type"
              :value="option.value"
              :disabled="option.disabled"
              class="accent-(--color-accent)"
            />
            <span>
              <span class="block text-sm font-medium">{{ option.label }}</span>
              <span class="block text-xs text-(--ui-text-muted)">{{ option.description }}</span>
            </span>
          </label>
        </fieldset>

        <p v-if="hasDuplicateExercise" class="text-xs text-amber-500" role="status">
          This template repeats an exercise. Excluding it excludes every occurrence.
        </p>

        <!-- Exercise list -->
        <ul role="list" class="space-y-2">
          <li
            v-for="ex in exercises"
            :key="ex.id"
            class="rounded-xl bg-(--color-surface) p-3 flex items-center gap-3"
            :class="excludedExerciseIds.has(ex.exercise_id) ? 'opacity-40' : ''"
          >
            <input
              type="checkbox"
              :id="`ex-chk-${ex.id}`"
              :checked="!excludedExerciseIds.has(ex.exercise_id)"
              class="accent-(--color-accent)"
              :aria-label="`Include ${ex.exercise_name}`"
              @change="toggleExercise(ex.exercise_id)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ ex.exercise_name }}</p>
              <p class="text-xs text-(--ui-text-muted)">
                {{ ex.sets_planned }} × {{ ex.reps_planned }}
                <template v-if="scaleFactor !== 1.0 && ex.rpe_target == null">
                  · scaled
                </template>
              </p>
            </div>
          </li>
        </ul>
      </div>

      <div class="flex-none p-4 border-t border-(--ui-border)">
        <UButton color="primary" size="lg" class="w-full" :disabled="remainingCount === 0" @click="handleStart">
          <UIcon name="i-ph-lightning" class="w-5 h-5" aria-hidden="true" />
          Start Workout
        </UButton>
      </div>
      </div>
    </template>
  </UModal>
</template>

