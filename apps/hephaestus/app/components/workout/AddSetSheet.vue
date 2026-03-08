<script setup lang="ts">
import type { SetRow } from '~/types/database'

const props = defineProps<{
  open: boolean
  exerciseName: string
  setNum: number
  lastSet: SetRow | null
  unit?: 'kg' | 'lbs'
}>()

const emit = defineEmits<{
  close: []
  confirm: [partial: Partial<SetRow>]
}>()

const unit = computed(() => props.unit ?? 'kg')

const weight = ref<number | null>(props.lastSet?.weight_kg ?? null)
const reps = ref<number | null>(props.lastSet?.reps ?? null)
const rpe = ref<number | null>(props.lastSet?.rpe ?? null)
const rir = ref<number | null>(null)
const isWarmup = ref(false)
const notes = ref('')

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
  })
}
</script>

<template>
  <!-- Backdrop -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 z-50"
      role="presentation"
      @click="emit('close')"
    />
  </Transition>

  <!-- Sheet -->
  <Transition name="slide-up">
    <div
      v-if="open"
      class="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-(--color-surface) safe-area-bottom p-6 space-y-5"
      role="dialog"
      :aria-label="`Log Set ${setNum} · ${exerciseName}`"
      aria-modal="true"
    >
      <header class="flex items-center justify-between">
        <h2 class="font-semibold">
          Set {{ setNum }} · <span class="text-(--ui-text-muted)">{{ exerciseName }}</span>
        </h2>
        <button
          class="text-(--ui-text-muted) hover:text-(--ui-text)"
          aria-label="Close"
          @click="emit('close')"
        >
          <UIcon name="i-heroicons-x-mark" class="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

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

      <!-- Warmup toggle + Notes -->
      <div class="flex items-center gap-3">
        <button
          class="px-3 py-1.5 text-sm rounded-full border transition-colors"
          :class="
            isWarmup
              ? 'border-(--color-accent) text-(--color-accent) bg-(--color-accent-dim)/20'
              : 'border-(--ui-border) text-(--ui-text-muted)'
          "
          :aria-pressed="isWarmup"
          @click="isWarmup = !isWarmup"
        >
          Warmup
        </button>
        <input
          v-model="notes"
          type="text"
          placeholder="Note (optional)"
          class="flex-1 text-sm bg-transparent border-b border-(--ui-border) py-1"
          aria-label="Note"
        />
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
</style>
