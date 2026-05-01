<script setup lang="ts">
import { formatDuration } from '~/lib/format'
import type { ExerciseRow, SetRow, TemplateGroupRow, WorkoutExerciseRow } from '~/types/database'

const { settings } = useAppSettings()
const workout = useWorkout()
const { exercises: exerciseLibrary, load: loadExercises } = useExercises()
const { templates, load: loadTemplates } = useTemplates()

const recentTemplates = computed(() => templates.value.slice(0, 3))

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
const showFailureRestPrompt = ref(false)
const showWarmupSuggestions = ref(false)
const activeWorkingWeight = ref<number | null>(null)

// app.vue loads exercises after seeding; call here as fallback for direct navigation.
// rpc() now waits for DB ready internally, so this is always safe.
onMounted(() => {
  loadExercises()
  loadTemplates()
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
  if (!q) return exerciseLibrary.value
  const lower = q.toLowerCase()
  return exerciseLibrary.value.filter((e) => e.name.toLowerCase().includes(lower))
})

const addSetExtraProps = computed(() => ({
  ...(activeExercise.value?.movement == null
    ? {}
    : { exerciseMovement: activeExercise.value.movement }),
  ...(activeExercise.value?.icon == null ? {} : { exerciseIcon: activeExercise.value.icon }),
}))

// Group workout exercises into solo blocks and superset group blocks
type Block =
  | { type: 'solo'; we: WorkoutExerciseRow }
  | { type: 'group'; label: string; group: TemplateGroupRow | undefined }

const blocks = computed((): Block[] => {
  const result: Block[] = []
  const seenGroups = new Set<string>()
  for (const we of workout.workoutExercises.value) {
    if (we.superset_group) {
      if (!seenGroups.has(we.superset_group)) {
        seenGroups.add(we.superset_group)
        result.push({
          type: 'group',
          label: we.superset_group,
          group: workout.templateGroups.value.get(we.superset_group),
        })
      }
    } else {
      result.push({ type: 'solo', we })
    }
  }
  return result
})

function groupExercises(label: string) {
  return workout.workoutExercises.value
    .filter((we) => we.superset_group === label)
    .map((we) => ({
      we,
      exercise: exerciseLibrary.value.find((e) => e.id === we.exercise_id) as ExerciseRow,
      sets: [...(workout.sets.value.get(we.id) ?? [])],
    }))
}

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
  if (partial.failure_flag === 1 && !partial.is_warmup && settings.value.showFailurePrompt) {
    showFailureRestPrompt.value = true
  }
  // Track working weight for warmup suggestions
  if (!partial.is_warmup && partial.weight_kg != null) {
    activeWorkingWeight.value = partial.weight_kg
  }
}

function handleSuggestWarmups() {
  showAddSet.value = false
  showWarmupSuggestions.value = true
}

async function handleLogWarmup(weightKg: number) {
  if (!activeWeId.value) return
  showWarmupSuggestions.value = false
  showAddSet.value = true
  await workout.logSet(activeWeId.value, {
    weight_kg: weightKg,
    reps: 12,
    is_warmup: 1,
  })
}

async function handleStartEmpty() {
  await workout.startWorkout()
}

async function handleStartFromTemplate(templateId: string) {
  await workout.startWorkout(templateId)
}

async function handleFinish() {
  showFinishSheet.value = false
  summary.value = await workout.finishWorkout({
    ...(moodRating.value == null ? {} : { moodRating: moodRating.value }),
    ...(energyRating.value == null ? {} : { energyRating: energyRating.value }),
    ...(workoutNotes.value ? { notes: workoutNotes.value } : {}),
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
    <!-- summary is a top-level ref — auto-unwrapped in templates, so use !summary not !summary.value -->
    <article v-if="!workout.activeWorkout.value && !summary" class="p-4 space-y-6">
      <h1 class="text-2xl font-bold mt-2">Workout</h1>

      <!-- Templates -->
      <section aria-labelledby="templates-heading">
        <div class="flex items-center justify-between mb-3">
          <h2
            id="templates-heading"
            class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)"
          >
            Templates
          </h2>
          <div class="flex items-center gap-3">
            <NuxtLink to="/templates" class="text-xs text-(--color-accent)">All</NuxtLink>
            <NuxtLink to="/templates/new" class="text-xs text-(--ui-text-muted)">New</NuxtLink>
          </div>
        </div>

        <div
          v-if="recentTemplates.length === 0"
          class="rounded-xl bg-(--color-surface) px-4 py-5 text-center text-(--ui-text-muted)"
        >
          <p class="text-sm">No templates yet.</p>
          <NuxtLink to="/templates/new" class="text-xs text-(--color-accent) mt-1 inline-block">
            Create one →
          </NuxtLink>
        </div>

        <ul v-else role="list" class="space-y-2">
          <li v-for="t in recentTemplates" :key="t.id">
            <button
              class="w-full rounded-xl bg-(--color-surface) px-4 py-3 text-left flex items-center justify-between gap-3"
              @click="handleStartFromTemplate(t.id)"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium">{{ t.name }}</p>
                <p v-if="t.description" class="text-xs text-(--ui-text-muted) truncate">
                  {{ t.description }}
                </p>
              </div>
              <UIcon
                name="i-heroicons-play"
                class="w-5 h-5 text-(--color-accent) shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
      </section>

      <!-- Empty session -->
      <section aria-label="Start empty workout">
        <UButton variant="outline" color="neutral" size="lg" class="w-full" @click="handleStartEmpty">
          <UIcon name="i-heroicons-plus" class="w-5 h-5" aria-hidden="true" />
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
        :total="workout.restTimer.value.total"
        :exercise-name="exerciseLibrary.find(e => e.id === workout.workoutExercises.value.find(we => we.id === workout.restTimer.value.exerciseId)?.exercise_id)?.name ?? ''"
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
        <template
          v-for="block in blocks"
          :key="block.type === 'solo' ? block.we.id : `group-${block.label}`"
        >
          <WorkoutExerciseBlock
            v-if="block.type === 'solo'"
            :workout-exercise="block.we"
            :exercise="exerciseLibrary.find(e => e.id === block.we.exercise_id)!"
            :sets="[...(workout.sets.value.get(block.we.id) ?? [])]"
            :unit="settings.weightUnit"
            @add-set="openAddSet"
            @tap-set="() => openAddSet(block.we.id)"
          />
          <WorkoutSupersetCard
            v-else
            :group-label="block.label"
            v-bind="block.group?.name != null ? { groupName: block.group.name } : {}"
            :group-type="block.group?.group_type ?? 'superset'"
            :transition-rest="block.group?.transition_rest_sec ?? 0"
            :round-rest="block.group?.rest_after_round_sec ?? 120"
            :exercises="groupExercises(block.label)"
            :unit="settings.weightUnit"
            @add-set="openAddSet"
          />
        </template>

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
      v-bind="addSetExtraProps"
      :set-num="nextSetNum"
      :last-set="lastSetForWe"
      :unit="settings.weightUnit"
      :show-warmup-suggestions="settings.showWarmupSuggestions"
      @close="showAddSet = false"
      @confirm="handleSetConfirm"
      @suggest-warmups="handleSuggestWarmups"
    />

    <!-- ── Warmup Suggestions Sheet ────────────────────────────────────── -->
    <WorkoutWarmupSuggestions
      :open="showWarmupSuggestions"
      :working-weight="activeWorkingWeight"
      :unit="settings.weightUnit"
      :ramps="[...settings.warmupRamps]"
      @close="showWarmupSuggestions = false"
      @log-warmup="handleLogWarmup"
    />

    <!-- ── Failure Rest Prompt ──────────────────────────────────────────── -->
    <Transition name="fade">
      <div
        v-if="showFailureRestPrompt"
        class="fixed bottom-20 left-4 right-4 z-[90] rounded-xl bg-(--color-surface) border border-(--ui-border) p-4 flex items-center gap-3 shadow-lg"
        role="alert"
        aria-live="polite"
      >
        <UIcon name="i-heroicons-fire" class="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
        <p class="flex-1 text-sm font-medium">Failure logged — take extra rest?</p>
        <UButton
          size="xs"
          color="primary"
          @click="workout.addRestTime(60); showFailureRestPrompt = false"
        >
          +60s
        </UButton>
        <button
          class="text-(--ui-text-muted)"
          aria-label="Dismiss"
          @click="showFailureRestPrompt = false"
        >
          <UIcon name="i-heroicons-x-mark" class="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </Transition>

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
              class="w-full text-left px-4 py-3 hover:bg-(--color-surface) transition-colors flex items-center gap-3"
              @click="addExercise(ex.id)"
            >
              <ExerciseAvatar :icon="ex.icon" :movement="ex.movement" />
              <div class="min-w-0">
                <p class="font-medium text-sm">{{ ex.name }}</p>
                <p class="text-xs text-(--ui-text-muted) capitalize">
                  {{ ex.equipment }} · {{ ex.movement }}
                </p>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </Transition>

    <!-- ── Finish Sheet ───────────────────────────────────────────────── -->
    <Transition name="slide-up">
      <div
        v-if="showFinishSheet"
        class="fixed inset-0 z-[100] bg-black/50"
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

          <!-- Energy -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-(--ui-text-muted)">Energy level?</p>
            <div class="flex justify-between">
              <button
                v-for="(icon, i) in ratingIcons"
                :key="i"
                class="text-2xl w-10 h-10 rounded-xl transition-all"
                :class="energyRating === i + 1 ? 'bg-(--color-accent)/20 scale-110' : 'opacity-50'"
                :aria-pressed="energyRating === i + 1"
                :aria-label="`Energy rating ${i + 1}`"
                @click="energyRating = i + 1"
              >
                {{ icon }}
              </button>
            </div>
          </div>

          <!-- Notes -->
          <textarea
            v-if="settings.showSessionNotes"
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
