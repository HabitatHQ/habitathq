<script setup lang="ts">
import type { EquipmentProfile } from '~/lib/equipment'
import { formatDuration, formatWeight } from '~/lib/format'
import { sessionLabel } from '~/lib/history'
import { historicalWeightSuggestion } from '~/lib/progression'
import type { WorkoutSummary } from '~/lib/workout-storage'
import type {
  ExerciseRow,
  SessionType,
  SetRow,
  TemplateGroupRow,
  WorkoutExerciseRow,
} from '~/types/database'

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
const summary = ref<WorkoutSummary | null>(null)
const showExercisePicker = ref(false)
const exerciseSearch = ref('')
const showFailureRestPrompt = ref(false)
const showWarmupSuggestions = ref(false)
const activeWorkingWeight = ref<number | null>(null)
const editingSet = ref<SetRow | null>(null)
const sessionType = ref<SessionType>('gym')
const runDistanceKm = ref<number | null>(null)
const runDurationSec = ref<number | null>(null)
const requestError = ref('')
const equipmentProfiles = useEquipmentProfiles()
const currentEquipmentProfile = ref<EquipmentProfile | null>(null)
const suggestedWeightKg = ref<number | null>(null)
const suggestionReason = ref<string | null>(null)
let profileLoad = 0

const recoveryLabel = computed(() => {
  const activeWorkout = workout.activeWorkout.value
  if (!activeWorkout) return ''
  const template = activeWorkout.template_id
    ? templates.value.find((item) => item.id === activeWorkout.template_id)
    : undefined
  return template?.name ?? sessionLabel(activeWorkout)
})

const recoveryStartedAt = computed(() => {
  const startedAt = workout.activeWorkout.value?.started_at
  if (!startedAt) return ''
  const date = new Date(startedAt)
  return Number.isNaN(date.getTime())
    ? 'start time unavailable'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
})

function syncRunFields() {
  runDistanceKm.value =
    workout.runData.value?.distance_m == null ? null : workout.runData.value.distance_m / 1000
  runDurationSec.value = workout.runData.value?.duration_sec ?? null
}
// Load the shared exercise/template data and explicitly offer recovery for any unfinished session.
onMounted(async () => {
  await Promise.all([loadExercises(), loadTemplates()])
  try {
    await workout.hydrateActiveWorkout()
  } catch (error) {
    requestError.value =
      error instanceof Error ? error.message : 'Workout database is unavailable in this tab.'
  }
  syncRunFields()
})

// Computed exercise name for the AddSet sheet
const activeExercise = computed(() => {
  if (!activeWeId.value) return null
  const we = workout.workoutExercises.value.find((e) => e.id === activeWeId.value)
  if (!we) return null
  return exerciseLibrary.value.find((e) => e.id === we.exercise_id) ?? null
})
watch(
  [activeExercise, workout.sessionIntensityModifier],
  async ([exercise, intensityModifier]) => {
    const currentLoad = ++profileLoad
    if (!exercise) {
      currentEquipmentProfile.value = null
      suggestedWeightKg.value = null
      suggestionReason.value = null
      return
    }
    const [profile, history] = await Promise.all([
      equipmentProfiles.get(exercise.id),
      workout.loadProgressionHistory(exercise.id),
    ])
    if (currentLoad !== profileLoad) return
    currentEquipmentProfile.value = profile
    const suggestion = historicalWeightSuggestion({
      ...history,
      intensityModifier,
      equipmentProfile: profile,
    })
    suggestedWeightKg.value = suggestion.weightKg
    suggestionReason.value = suggestion.reason
  },
  { immediate: true },
)

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
  loggingMode: activeExercise.value?.logging_mode ?? 'strength',
  equipmentProfile: currentEquipmentProfile.value,
  suggestedWeightKg: suggestedWeightKg.value,
  ...(suggestionReason.value == null ? {} : { suggestionReason: suggestionReason.value }),
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
function openEditSet(set: SetRow) {
  const exerciseId = set.workout_exercise_id
  editingSet.value = set
  activeWeId.value = exerciseId
  lastSetForWe.value = set
  nextSetNum.value = set.set_num
  showAddSet.value = true
}

function openAddSet(weId: string) {
  const currentSets = workout.sets.value.get(weId) ?? []
  editingSet.value = null
  lastSetForWe.value = [...currentSets].reverse().find((set) => set.completed === 1) ?? null
  nextSetNum.value = currentSets.filter((set) => set.completed === 1).length + 1
  activeWeId.value = weId
  showAddSet.value = true
}

async function handleSetConfirm(partial: Partial<SetRow>) {
  if (!activeWeId.value) return
  try {
    if (partial.id) await workout.updateSet(partial.id, partial)
    else await workout.logSet(activeWeId.value, partial)
    showAddSet.value = false
    editingSet.value = null
    if (
      !partial.id &&
      partial.failure_flag === 1 &&
      !partial.is_warmup &&
      settings.value.showFailurePrompt
    )
      showFailureRestPrompt.value = true
    if (!partial.is_warmup && partial.weight_kg != null)
      activeWorkingWeight.value = partial.weight_kg
    requestError.value = ''
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not save this set.'
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
  requestError.value = ''
  try {
    await workout.startWorkout(undefined, { sessionType: sessionType.value })
    syncRunFields()
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not start this session.'
  }
}

async function handleStartFromTemplate(templateId: string) {
  requestError.value = ''
  try {
    await workout.startWorkout(templateId, { sessionType: sessionType.value })
    syncRunFields()
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not start this session.'
  }
}

async function handleResume() {
  try {
    await workout.resumeWorkout()
    requestError.value = ''
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not resume this session.'
  }
}

async function handleDiscard() {
  try {
    await workout.discardWorkout()
    syncRunFields()
    requestError.value = ''
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not discard this session.'
  }
}

async function saveRunData(): Promise<boolean> {
  try {
    await workout.saveRunData({
      distance_m: runDistanceKm.value == null ? null : runDistanceKm.value * 1000,
      duration_sec: runDurationSec.value,
    })
    requestError.value = ''
    return true
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : 'Could not save run details.'
    return false
  }
}

async function handleFinish() {
  try {
    if (workout.activeWorkout.value?.session_type === 'run' && !(await saveRunData())) return
    showFinishSheet.value = false
    summary.value = await workout.finishWorkout({
      ...(moodRating.value == null ? {} : { moodRating: moodRating.value }),
      ...(energyRating.value == null ? {} : { energyRating: energyRating.value }),
      ...(workoutNotes.value ? { notes: workoutNotes.value } : {}),
    })
    syncRunFields()
    requestError.value = ''
  } catch (error) {
    requestError.value =
      error instanceof Error ? error.message : 'Could not finish this session; it is still active.'
  }
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
    <article v-if="workout.recoverySession.value && workout.hasActiveWorkout.value" class="p-4 space-y-5">
      <h1 class="text-2xl font-bold mt-2">Unfinished session</h1>
      <p class="text-sm text-(--ui-text-muted)">
        {{ recoveryLabel }} · started {{ recoveryStartedAt }}
      </p>
      <p class="text-sm">Your exercises, sets, and elapsed time are saved. Resume this session or discard it before starting another.</p>
      <div class="grid grid-cols-2 gap-3">
        <UButton color="primary" @click="handleResume">Resume</UButton>
        <UButton variant="outline" color="neutral" @click="handleDiscard">Discard</UButton>
      </div>
      <p v-if="requestError" role="alert" class="text-sm text-red-400">{{ requestError }}</p>
    </article>
    <article v-else-if="!workout.hasActiveWorkout.value && !summary" class="p-4 space-y-6">
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
                name="i-ph-play"
                class="w-5 h-5 text-(--color-accent) shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
      </section>

      <!-- Empty session -->
      <section aria-label="Start empty workout">
        <label for="session-type" class="sr-only">Session type</label>
        <select id="session-type" v-model="sessionType" class="mb-3 w-full rounded-xl bg-(--color-surface-2) px-3 py-3">
          <option value="gym">Strength / hypertrophy</option>
          <option value="run">Run / cardio</option>
          <option value="conditioning">Conditioning / intervals</option>
          <option value="mobility">Mobility / recovery</option>
        </select>
        <p v-if="requestError" role="alert" class="mb-3 text-sm text-red-400">{{ requestError }}</p>
        <p v-if="workout.writerUnavailable.value" class="mb-3 text-sm text-amber-300">
          Another tab owns the local database. Close it or use its active workout before continuing.
        </p>
        <UButton v-if="workout.writerUnavailable.value" variant="outline" class="mb-3 w-full" @click="workout.hydrateActiveWorkout()">
          Check for an active session
        </UButton>
        <UButton variant="outline" color="neutral" size="lg" class="w-full" @click="handleStartEmpty">
          <UIcon name="i-ph-plus" class="w-5 h-5" aria-hidden="true" />
          Start Empty Session
        </UButton>
      </section>
    </article>

    <!-- ── Post-workout Summary ───────────────────────────────────────── -->
    <article v-else-if="summary" class="p-4 space-y-6">
      <header>
        <h1 class="text-2xl font-bold">Session Complete — {{ summary.sessionType === 'gym' ? 'Strength' : summary.sessionType === 'other' ? 'Other' : summary.sessionType }}</h1>
      </header>
      <section aria-labelledby="summary-heading" class="grid grid-cols-2 gap-3">
        <h2 id="summary-heading" class="sr-only">Workout summary</h2>
        <CommonStatCard v-if="summary.sessionType === 'run'" label="Distance" :value="`${(summary.distanceM / 1000).toFixed(2)} km`" />
        <CommonStatCard v-else :label="summary.sessionType === 'gym' ? 'Working Sets' : 'Logged Sets'" :value="String(summary.totalSets)" />
        <CommonStatCard v-if="summary.sessionType === 'gym'" label="Volume" :value="`${Math.round(summary.totalVolume)} kg`" />
        <CommonStatCard
          v-if="summary.sessionType === 'gym'"
          label="PRs"
          :value="String(summary.newPRs.length)"
          :accent="summary.newPRs.length > 0"
        />
      </section>

      <ul v-if="summary.newPRs.length > 0" role="list" class="space-y-2">
        <li v-for="pr in summary.newPRs" :key="pr.id" class="flex items-center gap-2 text-sm">
          <UIcon name="i-ph-trophy" class="w-4 h-4 text-yellow-400" aria-hidden="true" />
          <span class="font-medium">{{ exerciseLibrary.find((exercise) => exercise.id === pr.exercise_id)?.name ?? 'Unknown exercise' }} · New {{ pr.record_type.toUpperCase() }} PR</span>
          <span class="text-(--ui-text-muted)">{{ pr.record_type === 'reps' ? `${pr.value} reps` : formatWeight(pr.value, settings.weightUnit) }}</span>
        </li>
      </ul>

      <UButton color="primary" class="w-full" @click="summary = null">
        Done
      </UButton>
    </article>

    <!-- ── Active Workout ─────────────────────────────────────────────── -->
    <article v-else-if="workout.hasActiveWorkout.value" class="pb-24">
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
      <p v-if="requestError" role="alert" class="mx-4 mt-3 text-sm text-red-400">{{ requestError }}</p>
      <section v-if="workout.activeWorkout.value?.session_type === 'run'" class="mx-4 mt-4 rounded-xl bg-(--color-surface) p-4 space-y-3" aria-labelledby="run-entry-heading">
        <h2 id="run-entry-heading" class="font-semibold">Manual run details</h2>
        <label class="block text-sm" for="run-distance">Distance (km)</label>
        <input id="run-distance" v-model.number="runDistanceKm" type="number" min="0" step="0.01" class="w-full rounded-lg bg-(--color-surface-2) p-3" />
        <label class="block text-sm" for="run-duration">Duration (seconds)</label>
        <input id="run-duration" v-model.number="runDurationSec" type="number" min="0" step="1" class="w-full rounded-lg bg-(--color-surface-2) p-3" />
        <UButton variant="outline" class="w-full" @click="async () => { await saveRunData() }">Save run details</UButton>
      </section>

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
            @tap-set="openEditSet"
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
            @tap-set="openEditSet"
          />
        </template>

        <!-- Add exercise button -->
        <UButton
          variant="ghost"
          color="primary"
          class="w-full border-2 border-dashed border-(--ui-border) rounded-xl h-12"
          @click="showExercisePicker = true"
        >
          <UIcon name="i-ph-plus" class="w-5 h-5" aria-hidden="true" />
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
      :editing-set="editingSet"
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
        <UIcon name="i-ph-fire" class="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
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
          <UIcon name="i-ph-x" class="w-4 h-4" aria-hidden="true" />
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
            <UIcon name="i-ph-x" class="w-6 h-6" aria-hidden="true" />
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
