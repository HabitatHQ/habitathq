<script setup lang="ts">
import type { EquipmentProfile } from '~/lib/equipment'
import { fromKilograms, roundToAvailableLoad, toKilograms } from '~/lib/equipment'
import type { FailureType, LoggingMode, MovementPattern, SetRow } from '~/types/database'

const props = defineProps<{
  open: boolean
  exerciseName: string
  exerciseMovement?: MovementPattern
  exerciseIcon?: string | null
  setNum: number
  lastSet: SetRow | null
  editingSet?: SetRow | null
  unit?: 'kg' | 'lbs'
  equipmentProfile?: EquipmentProfile | null
  suggestedWeightKg?: number | null
  suggestionReason?: string
  loggingMode?: LoggingMode
  showWarmupSuggestions?: boolean
}>()
const modalFocus = useModalFocus(() => props.open)

const emit = defineEmits<{
  close: []
  confirm: [partial: Partial<SetRow>]
  suggestWarmups: []
}>()

const unit = computed(() => props.unit ?? 'kg')
const weight = ref<number | null>(null)
const reps = ref<number | null>(null)
const rpe = ref<number | null>(null)
const rir = ref<number | null>(null)
const isWarmup = ref(false)
const notes = ref('')
const isFailure = ref(false)
const failureType = ref<FailureType | null>(null)
const partialReps = ref<number | null>(null)
const distanceM = ref<number | null>(null)
const durationSec = ref<number | null>(null)
const loggingMode = computed(() => props.loggingMode ?? 'strength')

const failureOptions: { value: FailureType; label: string }[] = [
  { value: 'muscular', label: 'Muscular' },
  { value: 'technical', label: 'Technical' },
  { value: 'near_failure', label: 'Near failure' },
]

const displayedWeight = computed({
  get: () => (weight.value == null ? null : fromKilograms(weight.value, unit.value)),
  set: (value: number | null) => {
    weight.value = value == null ? null : toKilograms(value, unit.value)
  },
})

const loadSuggestion = computed(() => {
  if (props.suggestedWeightKg == null) return null
  if (!props.equipmentProfile) return props.suggestedWeightKg
  return roundToAvailableLoad(props.suggestedWeightKg, props.equipmentProfile)
})

// Auto-set RIR to 0 on failure
watch(isFailure, (val) => {
  if (val) rir.value = 0
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const source = props.editingSet ?? props.lastSet
    weight.value = source?.weight_kg ?? loadSuggestion.value
    reps.value = source?.reps ?? null
    rpe.value = source?.rpe ?? null
    rir.value = source?.rir ?? null
    distanceM.value = source?.distance_m ?? null
    durationSec.value = source?.duration_sec ?? null
    isWarmup.value = source?.is_warmup === 1
    notes.value = source?.notes ?? ''
    isFailure.value = source?.failure_flag === 1
    failureType.value = source?.failure_type ?? null
    partialReps.value = source?.partial_reps ?? null
  },
)

function nudge(field: 'weight' | 'reps' | 'rpe', delta: number) {
  if (field === 'weight') {
    const displayValue = displayedWeight.value ?? 0
    displayedWeight.value = Math.max(0, displayValue + delta)
  } else if (field === 'reps') reps.value = Math.max(1, (reps.value ?? 0) + delta)
  else if (field === 'rpe') {
    const next = Math.round(((rpe.value ?? 6) + delta) * 2) / 2
    rpe.value = Math.min(10, Math.max(6, next))
  }
}

function handleConfirm() {
  emit('confirm', {
    ...(props.editingSet ? { id: props.editingSet.id } : {}),
    ...(loggingMode.value === 'strength'
      ? {
          weight_kg: weight.value,
          reps: reps.value,
          rpe: rpe.value,
          rir: rir.value,
          is_warmup: isWarmup.value ? 1 : 0,
          failure_flag: isFailure.value ? 1 : 0,
          failure_type: isFailure.value ? failureType.value : null,
          partial_reps: isFailure.value ? partialReps.value || null : null,
        }
      : {
          distance_m: distanceM.value,
          duration_sec: durationSec.value,
        }),
    notes: notes.value || null,
  })
}
</script>

<template>
  <UModal
    :open="open"
    :content="modalFocus"
    :title="`${props.editingSet ? 'Edit' : 'Log'} Set ${setNum} · ${exerciseName}`"
    description="Enter this set's resistance, distance, or duration."
    @update:open="value => { if (!value) emit('close') }"
  >
    <template #content>
      <div class="safe-area-bottom p-6 space-y-5 max-h-[85dvh] overflow-y-auto">
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0">
          <ExerciseAvatar
            v-if="exerciseMovement"
            :icon="exerciseIcon ?? null"
            :movement="exerciseMovement"
          />
          <h2 class="font-semibold">
            {{ props.editingSet ? 'Edit' : 'Set' }} {{ setNum }} · <span class="text-(--ui-text-muted)">{{ exerciseName }}</span>
          </h2>
        </div>
        <button
          class="text-(--ui-text-muted) hover:text-(--ui-text)"
          aria-label="Close"
          @click="emit('close')"
        >
          <UIcon name="i-ph-x" class="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

      <!-- Set type: Warmup | Working -->
      <div v-if="loggingMode === 'strength'" class="flex rounded-xl bg-(--color-surface-2) p-0.5" role="group" aria-label="Set type">
        <button
          class="flex-1 py-1.5 text-sm font-medium rounded-[10px] transition-colors"
          :class="isWarmup
            ? 'bg-(--color-surface) text-(--color-accent) shadow-sm'
            : 'text-(--ui-text-muted)'"
          :aria-pressed="isWarmup"
          @click="isWarmup = true"
        >
          Warmup
        </button>
        <button
          class="flex-1 py-1.5 text-sm font-medium rounded-[10px] transition-colors"
          :class="!isWarmup
            ? 'bg-(--color-surface) text-(--ui-text) shadow-sm'
            : 'text-(--ui-text-muted)'"
          :aria-pressed="!isWarmup"
          @click="isWarmup = false"
        >
          Working
        </button>
      </div>

      <!-- Suggest warm-ups (warmup mode, not first set) -->
      <UButton
        v-if="loggingMode === 'strength' && isWarmup && setNum > 1 && props.showWarmupSuggestions !== false"
        size="xs"
        variant="ghost"
        color="neutral"
        class="w-full"
        @click="emit('suggestWarmups')"
      >
        <UIcon name="i-ph-fire" class="w-4 h-4" aria-hidden="true" />
        Suggest warm-ups
      </UButton>

      <!-- Weight + Reps -->
      <div v-if="loggingMode === 'strength'" class="grid grid-cols-2 gap-4">
        <!-- Weight -->
        <div class="space-y-2">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
            Weight ({{ unit }})
          </label>
          <p v-if="loadSuggestion != null" class="text-xs text-(--ui-text-muted)">
            Suggested {{ fromKilograms(loadSuggestion, unit).toFixed(1) }} {{ unit }}
            <span v-if="props.suggestionReason">· {{ props.suggestionReason }}</span>
            <button class="underline ml-1" type="button" @click="displayedWeight = fromKilograms(loadSuggestion, unit)">
              Use suggestion
            </button>
          </p>
          <div class="flex items-center gap-2">
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
              aria-label="Decrease weight"
              @click="nudge('weight', -2.5)"
            >
              −
            </button>
            <input
              v-model.number="displayedWeight"
              type="number"
              step="any"
              min="0"
              class="flex-1 text-center text-xl font-bold bg-transparent border-b border-(--ui-border) py-1"
              aria-label="Weight"
            />
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
              aria-label="Increase weight"
              @click="nudge('weight', 2.5)"
            >
              +
            </button>
          </div>
        </div>

        <!-- Reps -->
        <div class="space-y-2">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
            Reps
          </label>
          <div class="flex items-center gap-2">
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
              aria-label="Decrease reps"
              @click="nudge('reps', -1)"
            >
              −
            </button>
            <input
              v-model.number="reps"
              type="number"
              step="1"
              min="1"
              class="flex-1 text-center text-xl font-bold bg-transparent border-b border-(--ui-border) py-1"
              aria-label="Reps"
            />
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
              aria-label="Increase reps"
              @click="nudge('reps', 1)"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div v-if="loggingMode !== 'strength'" class="grid grid-cols-2 gap-4">
        <label class="text-xs font-medium text-(--ui-text-muted)" for="set-distance">
          Distance (m)
          <input id="set-distance" v-model.number="distanceM" type="number" min="0" step="any" class="mt-1 w-full text-center text-lg bg-transparent border-b border-(--ui-border) py-1" />
        </label>
        <label class="text-xs font-medium text-(--ui-text-muted)" for="set-duration">
          Duration (seconds)
          <input id="set-duration" v-model.number="durationSec" type="number" min="0" step="1" class="mt-1 w-full text-center text-lg bg-transparent border-b border-(--ui-border) py-1" />
        </label>
      </div>

      <!-- RPE (optional) -->
      <div v-if="loggingMode === 'strength'" class="grid grid-cols-2 gap-4">
        <div class="space-y-2">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
            RPE (optional)
          </label>
          <div class="flex items-center gap-2">
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-sm font-bold flex items-center justify-center"
              aria-label="Decrease RPE"
              @click="nudge('rpe', -0.5)"
            >
              −
            </button>
            <input
              v-model.number="rpe"
              type="number"
              step="0.5"
              min="6"
              max="10"
              placeholder="—"
              class="flex-1 text-center text-lg font-bold bg-transparent border-b border-(--ui-border) py-1"
              aria-label="RPE"
            />
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-sm font-bold flex items-center justify-center"
              aria-label="Increase RPE"
              @click="nudge('rpe', 0.5)"
            >
              +
            </button>
          </div>
        </div>
        <div class="space-y-2">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
            RIR (optional)
          </label>
          <input
            v-model.number="rir"
            type="number"
            step="1"
            min="0"
            max="5"
            placeholder="—"
            class="w-full text-center text-lg font-bold bg-transparent border-b border-(--ui-border) py-1"
            aria-label="Reps in reserve"
          />
        </div>
      </div>

      <!-- Notes -->
      <input
        v-model="notes"
        type="text"
        placeholder="Note (optional)"
        class="w-full text-sm bg-transparent border-b border-(--ui-border) py-1"
        aria-label="Note"
      />

      <!-- Failure section — working sets only -->
      <div v-if="loggingMode === 'strength' && !isWarmup" class="space-y-3">
        <button
          class="flex items-center gap-2 text-sm font-medium"
          :class="isFailure ? 'text-red-400' : 'text-(--ui-text-muted)'"
          :aria-pressed="isFailure"
          aria-label="Toggle failure set"
          @click="isFailure = !isFailure"
        >
          <UIcon
            :name="isFailure ? 'i-ph-x-circle' : 'i-ph-x-circle'"
            class="w-4 h-4"
            aria-hidden="true"
          />
          Failure set
        </button>

        <div v-if="isFailure" class="space-y-3 pl-1">
          <!-- Failure type -->
          <div class="flex rounded-xl bg-(--color-surface-2) p-0.5" role="group" aria-label="Failure type">
            <button
              v-for="opt in failureOptions"
              :key="opt.value"
              class="flex-1 py-1.5 text-xs font-medium rounded-[10px] transition-colors"
              :class="failureType === opt.value
                ? 'bg-(--color-surface) text-red-400 shadow-sm'
                : 'text-(--ui-text-muted)'"
              :aria-pressed="failureType === opt.value"
              @click="failureType = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- Partial reps -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
              Partial reps (optional)
            </label>
            <input
              v-model.number="partialReps"
              type="number"
              step="1"
              min="0"
              placeholder="—"
              class="w-full text-center text-lg font-bold bg-transparent border-b border-(--ui-border) py-1"
              aria-label="Partial reps"
            />
          </div>
        </div>
      </div>

      <!-- Submit -->
      <UButton
        color="primary"
        size="lg"
        class="w-full"
        :disabled="loggingMode === 'strength' ? weight === null || reps === null : distanceM === null && durationSec === null"
        @click="handleConfirm"
      >
        <UIcon name="i-ph-check" class="w-5 h-5" aria-hidden="true" />
        {{ props.editingSet ? 'Save Changes' : 'Log Set' }}
      </UButton>
      </div>
    </template>
  </UModal>
</template>
