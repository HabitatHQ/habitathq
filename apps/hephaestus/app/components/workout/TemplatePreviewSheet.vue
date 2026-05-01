<script setup lang="ts">
import type { TemplateExerciseWithName } from '~/composables/useTemplates'
import { estimateTemplateDuration } from '~/lib/template-stats'
import type { TemplateRow } from '~/types/database'

interface Props {
  open: boolean
  template: TemplateRow
  exercises: TemplateExerciseWithName[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  start: [{ scaleFactor: number; excludedIds: string[] }]
}>()

const scaleFactor = ref(1.0)
const excludedIds = ref<Set<string>>(new Set())

const totalSets = computed(() => props.exercises.reduce((a, e) => a + (e.sets_planned ?? 3), 0))
const estimatedSecs = computed(() =>
  estimateTemplateDuration(props.exercises.length, totalSets.value, 120),
)

function formatDuration(secs: number): string {
  const m = Math.round(secs / 60)
  return `~${m} min`
}

function toggleExercise(id: string) {
  if (excludedIds.value.has(id)) {
    excludedIds.value.delete(id)
  } else {
    excludedIds.value.add(id)
  }
}

function handleStart() {
  emit('start', {
    scaleFactor: scaleFactor.value,
    excludedIds: [...excludedIds.value],
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
  <Transition name="slide-up">
    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-50 bg-(--ui-bg) rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col"
      role="dialog"
      :aria-label="`Preview: ${template.name}`"
      aria-modal="true"
    >
      <div class="flex-none p-4 border-b border-(--ui-border) flex items-center justify-between">
        <div>
          <h2 class="font-bold">{{ template.name }}</h2>
          <p class="text-xs text-(--ui-text-muted)">
            {{ exercises.length }} exercises · {{ formatDuration(estimatedSecs) }}
          </p>
        </div>
        <button class="text-(--ui-text-muted)" aria-label="Close" @click="emit('close')">
          <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
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

        <!-- Exercise list -->
        <ul role="list" class="space-y-2">
          <li
            v-for="ex in exercises"
            :key="ex.id"
            class="rounded-xl bg-(--color-surface) p-3 flex items-center gap-3"
            :class="excludedIds.has(ex.id) ? 'opacity-40' : ''"
          >
            <input
              type="checkbox"
              :id="`ex-chk-${ex.id}`"
              :checked="!excludedIds.has(ex.id)"
              class="accent-(--color-accent)"
              :aria-label="`Include ${ex.exercise_name}`"
              @change="toggleExercise(ex.id)"
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
        <UButton color="primary" size="lg" class="w-full" @click="handleStart">
          <UIcon name="i-heroicons-bolt" class="w-5 h-5" aria-hidden="true" />
          Start Workout
        </UButton>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
