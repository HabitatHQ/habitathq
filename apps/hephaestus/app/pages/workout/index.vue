<script setup lang="ts">
import { formatDuration } from '~/lib/format'
import type { SetRow } from '~/types/database'

const { settings } = useAppSettings()
const workout = useWorkout()
const { exercises: exerciseLibrary, load: loadExercises } = useExercises()

const showAddSet = ref(false)
const activeWeId = ref<string | null>(null)
const lastSetForWe = ref<SetRow | null>(null)
const nextSetNum = ref(1)
const showFinishSheet = ref(false)
const moodRating = ref<number | null>(null)
const energyRating = ref<number | null>(null)
const workoutNotes = ref('')
const summary = ref<Awaited<ReturnType<typeof workout.finishWorkout>> | null>(null)
const showExercisePicker = ref(false)
const exerciseSearch = ref('')

// Load exercises
onMounted(async () => {
  await loadExercises()
})

// Computed exercise name for the AddSet sheet
const activeExercise = computed(() => {
  if (!activeWeId.value) return null
  const we = workout.workoutExercises.value.find((e) => e.id === activeWeId.value)
  if (!we) return null
  return exerciseLibrary.value.find((e) => e.id === we.exercise_id) ?? null
})

const filteredExercises = computed(() => {
  const q = exerciseSearch.value.trim()
  if (!q) return exerciseLibrary.value.slice(0, 30)
  const lower = q.toLowerCase()
  return exerciseLibrary.value.filter((e) => e.name.toLowerCase().includes(lower)).slice(0, 20)
})

function openAddSet(weId: string) {
  const sets = workout.sets.value.get(weId) ?? []
  const lastCompleted = [...sets].reverse().find((s) => s.completed === 1) ?? null
  lastSetForWe.value = lastCompleted
  nextSetNum.value = sets.filter((s) => s.completed === 1).length + 1
  activeWeId.value = weId
  showAddSet.value = true
}

async function handleSetConfirm(partial: Partial<SetRow>) {
  if (!activeWeId.value) return
  showAddSet.value = false
  await workout.logSet(activeWeId.value, partial)
}

async function handleStartEmpty() {
  await workout.startWorkout()
}

async function handleFinish() {
  showFinishSheet.value = false
  summary.value = await workout.finishWorkout({
    moodRating: moodRating.value ?? undefined,
    energyRating: energyRating.value ?? undefined,
    notes: workoutNotes.value || undefined,
  })
}

async function addExercise(exerciseId: string) {
  showExercisePicker.value = false
  exerciseSearch.value = ''
  await workout.addExercise(exerciseId)
}

const ratingIcons = ['😴', '😐', '🙂', '💪', '🔥']
</script>

<template>
  <div class="min-h-screen">
    <!-- ── No Active Workout ───────────────────────────────────────────── -->
    <article v-if="!workout.activeWorkout.value && !summary.value" class="p-4 space-y-6">
      <h1 class="text-2xl font-bold mt-2">Workout</h1>
      <p class="text-(--ui-text-muted)">Ready to train? Start a session below.</p>
      <section aria-label="Start workout">
        <UButton size="xl" color="primary" class="w-full" @click="handleStartEmpty">
          <UIcon name="i-heroicons-bolt" class="w-5 h-5" aria-hidden="true" />
          Start Empty Session
        </UButton>
      </section>
    </article>

    <!-- ── Post-workout Summary ───────────────────────────────────────── -->
    <article v-else-if="summary" class="p-4 space-y-6">
      <header>
        <h1 class="text-2xl font-bold">Session Complete 🏋️</h1>
      </header>
      <section aria-labelledby="summary-heading" class="grid grid-cols-2 gap-3">
        <h2 id="summary-heading" class="sr-only">Workout summary</h2>
        <CommonStatCard label="Duration" :value="formatDuration(summary.durationSec)" />
        <CommonStatCard label="Working Sets" :value="String(summary.totalSets)" />
        <CommonStatCard label="Volume" :value="`${Math.round(summary.totalVolume)} kg`" />
        <CommonStatCard
          label="PRs"
          :value="String(summary.newPRs.length)"
          :accent="summary.newPRs.length > 0"
        />
      </section>

      <ul v-if="summary.newPRs.length > 0" role="list" class="space-y-2">
        <li v-for="pr in summary.newPRs" :key="pr.id" class="flex items-center gap-2 text-sm">
          <UIcon name="i-heroicons-trophy" class="w-4 h-4 text-yellow-400" aria-hidden="true" />
          <span class="font-medium">New {{ pr.record_type.toUpperCase() }} PR</span>
          <span class="text-(--ui-text-muted)">{{ Math.round(pr.value * 10) / 10 }} kg</span>
        </li>
      </ul>

      <UButton color="primary" class="w-full" @click="summary = null">
        Done
      </UButton>
    </article>

    <!-- ── Active Workout ─────────────────────────────────────────────── -->
    <article v-else class="pb-24">
      <!-- Rest timer -->
      <WorkoutRestTimer
        v-if="workout.restTimer.value.active"
        :remaining="workout.restTimer.value.remaining"
        :total="workout.workoutExercises.value.find(e => e.id === workout.restTimer.value.exerciseId)?.rest_seconds ?? 120"
        :exercise-name="exerciseLibrary.find(e => e.id === workout.workoutExercises.value.find(we => we.id === workout.restTimer.value.exerciseId)?.exercise_id)?.name"
        @skip="workout.stopRestTimer()"
      />

      <!-- Workout header -->
      <header
        class="sticky top-0 z-30 bg-(--color-surface-2)/95 backdrop-blur border-b border-(--ui-border) px-4 py-3 flex items-center justify-between"
        :class="workout.restTimer.value.active ? 'mt-14' : ''"
      >
        <div>
          <p class="text-xs text-(--ui-text-muted)">Active Session</p>
          <p class="font-bold tabular-nums">⏱ {{ formatDuration(workout.elapsedSeconds.value) }}</p>
        </div>
        <UButton
          color="primary"
          size="sm"
          @click="showFinishSheet = true"
        >
          Finish
        </UButton>
      </header>

      <!-- Exercise blocks -->
      <div class="p-4 space-y-4">
        <WorkoutExerciseBlock
          v-for="we in workout.workoutExercises.value"
          :key="we.id"
          :workout-exercise="we"
          :exercise="exerciseLibrary.find(e => e.id === we.exercise_id)!"
          :sets="workout.sets.value.get(we.id) ?? []"
          :unit="settings.weightUnit"
          @add-set="openAddSet"
          @tap-set="(s) => openAddSet(we.id)"
        />

        <!-- Add exercise button -->
        <UButton
          variant="ghost"
          color="primary"
          class="w-full border-2 border-dashed border-(--ui-border) rounded-xl h-12"
          @click="showExercisePicker = true"
        >
          <UIcon name="i-heroicons-plus" class="w-5 h-5" aria-hidden="true" />
          Add Exercise
        </UButton>
      </div>
    </article>

    <!-- ── Add Set Sheet ───────────────────────────────────────────────── -->
    <WorkoutAddSetSheet
      :open="showAddSet"
      :exercise-name="activeExercise?.name ?? ''"
      :set-num="nextSetNum"
      :last-set="lastSetForWe"
      :unit="settings.weightUnit"
      @close="showAddSet = false"
      @confirm="handleSetConfirm"
    />

    <!-- ── Exercise Picker Sheet ──────────────────────────────────────── -->
    <Transition name="slide-up">
      <div
        v-if="showExercisePicker"
        class="fixed inset-0 z-50 bg-(--color-bg) flex flex-col"
        role="dialog"
        aria-label="Add exercise"
        aria-modal="true"
      >
        <header class="flex items-center gap-3 p-4 border-b border-(--ui-border)">
          <button
            class="text-(--ui-text-muted)"
            aria-label="Close exercise picker"
            @click="showExercisePicker = false; exerciseSearch = ''"
          >
            <UIcon name="i-heroicons-x-mark" class="w-6 h-6" aria-hidden="true" />
          </button>
          <input
            v-model="exerciseSearch"
            type="search"
            placeholder="Search exercises…"
            class="flex-1 bg-transparent text-lg outline-none"
            aria-label="Search exercises"
            autofocus
          />
        </header>
        <ul role="list" class="overflow-y-auto flex-1 divide-y divide-(--ui-border)">
          <li v-for="ex in filteredExercises" :key="ex.id">
            <button
              class="w-full text-left px-4 py-3 hover:bg-(--color-surface) transition-colors"
              @click="addExercise(ex.id)"
            >
              <p class="font-medium text-sm">{{ ex.name }}</p>
              <p class="text-xs text-(--ui-text-muted) capitalize">
                {{ ex.equipment }} · {{ ex.movement }}
              </p>
            </button>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- ── Finish Sheet ───────────────────────────────────────────────── -->
    <Transition name="slide-up">
      <div
        v-if="showFinishSheet"
        class="fixed inset-0 z-50 bg-black/50"
        role="presentation"
        @click.self="showFinishSheet = false"
      >
        <div
          class="absolute bottom-0 left-0 right-0 bg-(--color-surface) rounded-t-2xl p-6 space-y-5 safe-area-bottom"
          role="dialog"
          aria-label="Finish workout"
          aria-modal="true"
        >
          <h2 class="text-xl font-bold">Finish Workout?</h2>

          <!-- Mood -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-(--ui-text-muted)">How did you feel?</p>
            <div class="flex justify-between">
              <button
                v-for="(icon, i) in ratingIcons"
                :key="i"
                class="text-2xl w-10 h-10 rounded-xl transition-all"
                :class="moodRating === i + 1 ? 'bg-(--color-accent)/20 scale-110' : 'opacity-50'"
                :aria-pressed="moodRating === i + 1"
                :aria-label="`Mood rating ${i + 1}`"
                @click="moodRating = i + 1"
              >
                {{ icon }}
              </button>
            </div>
          </div>

          <!-- Notes -->
          <textarea
            v-model="workoutNotes"
            rows="2"
            placeholder="Session notes (optional)…"
            class="w-full bg-(--color-surface-2) rounded-xl px-3 py-2 text-sm resize-none"
            aria-label="Session notes"
          />

          <div class="flex gap-3">
            <UButton variant="ghost" color="neutral" class="flex-1" @click="showFinishSheet = false">
              Cancel
            </UButton>
            <UButton color="primary" class="flex-1" @click="handleFinish">
              Save Workout
            </UButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
