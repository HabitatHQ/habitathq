<script setup lang="ts">
import type { FailureType, MovementPattern, SetRow } from '~/types/database'

const props = defineProps<{
  open: boolean
  exerciseName: string
  exerciseMovement?: MovementPattern
  exerciseIcon?: string | null
  setNum: number
  lastSet: SetRow | null
  unit?: 'kg' | 'lbs'
  showWarmupSuggestions?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [partial: Partial<SetRow>]
  suggestWarmups: []
}>()

const unit = computed(() => props.unit ?? 'kg')

const weight = ref<number | null>(props.lastSet?.weight_kg ?? null)
const reps = ref<number | null>(props.lastSet?.reps ?? null)
const rpe = ref<number | null>(props.lastSet?.rpe ?? null)
const rir = ref<number | null>(null)
const isWarmup = ref(false)
const notes = ref('')
const isFailure = ref(false)
const failureType = ref<FailureType | null>(null)
const partialReps = ref<number | null>(null)

const failureOptions: { value: FailureType; label: string }[] = [
  { value: 'muscular', label: 'Muscular' },
  { value: 'technical', label: 'Technical' },
  { value: 'near_failure', label: 'Near failure' },
]

// Auto-set RIR to 0 on failure
watch(isFailure, (val) => {
  if (val) rir.value = 0
})

// Reset when sheet opens
watch(
  () => props.open,
  (open) => {
    if (open) {
      weight.value = props.lastSet?.weight_kg ?? null
      reps.value = props.lastSet?.reps ?? null
      rpe.value = null
      rir.value = null
      isWarmup.value = false
      notes.value = ''
      isFailure.value = false
      failureType.value = null
      partialReps.value = null
    }
  },
)

function nudge(field: 'weight' | 'reps' | 'rpe', delta: number) {
  if (field === 'weight') weight.value = Math.max(0, (weight.value ?? 0) + delta)
  else if (field === 'reps') reps.value = Math.max(1, (reps.value ?? 0) + delta)
  else if (field === 'rpe') {
    const next = Math.round(((rpe.value ?? 6) + delta) * 2) / 2
    rpe.value = Math.min(10, Math.max(6, next))
  }
}

function handleConfirm() {
  emit('confirm', {
    weight_kg: weight.value,
    reps: reps.value,
    rpe: rpe.value,
    rir: rir.value,
    is_warmup: isWarmup.value ? 1 : 0,
    notes: notes.value || null,
    failure_flag: isFailure.value ? 1 : 0,
    failure_type: isFailure.value ? failureType.value : null,
    partial_reps: isFailure.value ? partialReps.value || null : null,
  })
}
</script>

<template>
  <!-- Single root prevents Vue fragment-anchor issues with transitions -->
  <div>
  <!-- Backdrop -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 z-[100]"
      role="presentation"
      @click="emit('close')"
    />
  </Transition>

  <!-- Sheet -->
  <Transition name="slide-up">
    <div
      v-if="open"
      class="fixed bottom-0 left-0 right-0 z-[100] rounded-t-2xl bg-(--color-surface) safe-area-bottom p-6 space-y-5"
      role="dialog"
      :aria-label="`Log Set ${setNum} · ${exerciseName}`"
      aria-modal="true"
    >
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0">
          <ExerciseAvatar
            v-if="exerciseMovement"
            :icon="exerciseIcon ?? null"
            :movement="exerciseMovement"
          />
          <h2 class="font-semibold">
            Set {{ setNum }} · <span class="text-(--ui-text-muted)">{{ exerciseName }}</span>
          </h2>
        </div>
        <button
          class="text-(--ui-text-muted) hover:text-(--ui-text)"
          aria-label="Close"
          @click="emit('close')"
        >
          <UIcon name="i-heroicons-x-mark" class="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

      <!-- Set type: Warmup | Working -->
      <div class="flex rounded-xl bg-(--color-surface-2) p-0.5" role="group" aria-label="Set type">
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
        v-if="isWarmup && setNum > 1 && props.showWarmupSuggestions !== false"
        size="xs"
        variant="ghost"
        color="neutral"
        class="w-full"
        @click="emit('suggestWarmups')"
      >
        <UIcon name="i-heroicons-fire" class="w-4 h-4" aria-hidden="true" />
        Suggest warm-ups
      </UButton>

      <!-- Weight + Reps -->
      <div class="grid grid-cols-2 gap-4">
        <!-- Weight -->
        <div class="space-y-2">
          <label class="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wider">
            Weight ({{ unit }})
          </label>
          <div class="flex items-center gap-2">
            <button
              class="w-9 h-9 rounded-full bg-(--color-surface-2) text-lg font-bold flex items-center justify-center"
              aria-label="Decrease weight"
              @click="nudge('weight', -2.5)"
            >
              −
            </button>
            <input
              v-model.number="weight"
              type="number"
              step="2.5"
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

      <!-- RPE (optional) -->
      <div class="grid grid-cols-2 gap-4">
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
      <div v-if="!isWarmup" class="space-y-3">
        <button
          class="flex items-center gap-2 text-sm font-medium"
          :class="isFailure ? 'text-red-400' : 'text-(--ui-text-muted)'"
          :aria-pressed="isFailure"
          aria-label="Toggle failure set"
          @click="isFailure = !isFailure"
        >
          <UIcon
            :name="isFailure ? 'i-heroicons-x-circle' : 'i-heroicons-x-circle'"
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
        :disabled="weight === null || reps === null"
        @click="handleConfirm"
      >
        <UIcon name="i-heroicons-check" class="w-5 h-5" aria-hidden="true" />
        Log Set
      </UButton>
    </div>
  </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
