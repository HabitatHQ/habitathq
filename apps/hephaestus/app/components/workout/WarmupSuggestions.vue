<script setup lang="ts">
import { warmupWeightSuggestions } from '~/lib/set-schemes'

const props = defineProps<{
  open: boolean
  workingWeight: number | null
  unit?: 'kg' | 'lbs'
  ramps?: number[]
}>()

const emit = defineEmits<{
  close: []
  logWarmup: [weight: number]
}>()

const effectiveRamps = computed(() => props.ramps ?? [40, 60, 80])
const effectiveUnit = computed(() => props.unit ?? 'kg')

const suggestions = computed<Array<{ pct: number; weight: number }>>(() => {
  if (props.workingWeight === null) return []
  const weights = warmupWeightSuggestions(props.workingWeight, effectiveRamps.value)
  return effectiveRamps.value.map((pct, i) => ({ pct, weight: weights[i] ?? 0 }))
})
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
        aria-label="Warm-up Suggestions"
        aria-modal="true"
      >
        <header class="flex items-center justify-between">
          <h2 class="font-semibold">Warm-up Suggestions</h2>
          <button
            class="text-(--ui-text-muted) hover:text-(--ui-text)"
            aria-label="Close"
            @click="emit('close')"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        <!-- No working set yet -->
        <p
          v-if="workingWeight === null"
          class="text-sm text-(--ui-text-muted) text-center py-4"
        >
          Log a working set first to see suggestions.
        </p>

        <!-- Suggestions list -->
        <ul v-else role="list" class="space-y-2">
          <li
            v-for="{ pct, weight } in suggestions"
            :key="pct"
            class="flex items-center justify-between rounded-xl bg-(--color-surface-2) px-4 py-3"
          >
            <span class="text-sm">
              <span class="font-bold text-(--color-accent)">{{ pct }}%</span>
              &mdash;
              <span class="font-semibold">{{ weight }}{{ effectiveUnit }}</span>
              <span class="text-(--ui-text-muted)"> &times; 10–15 reps</span>
            </span>
            <UButton
              size="sm"
              color="primary"
              variant="soft"
              @click="emit('logWarmup', weight)"
            >
              Log
            </UButton>
          </li>
        </ul>
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
