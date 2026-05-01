<script setup lang="ts">
import { formatCountdown } from '~/lib/format'

const props = defineProps<{
  remaining: number
  total: number
  exerciseName?: string
}>()

const emit = defineEmits<{ skip: [] }>()

const ratio = computed(() => (props.total > 0 ? props.remaining / props.total : 0))

const colorClass = computed(() => {
  if (ratio.value > 0.6) return 'text-green-400'
  if (ratio.value > 0.3) return 'text-yellow-400'
  return 'text-red-400'
})
</script>

<template>
  <div
    class="fixed top-0 left-0 right-0 z-40 px-4 py-2 flex items-center gap-3 bg-(--color-surface-2) border-b border-(--ui-border)"
    role="status"
    aria-live="polite"
    :aria-label="`Rest timer: ${formatCountdown(remaining)} remaining`"
  >
    <UIcon name="i-heroicons-clock" class="w-5 h-5 shrink-0" :class="colorClass" aria-hidden="true" />
    <div class="flex-1 min-w-0">
      <p class="text-xs text-(--ui-text-muted) truncate">
        Rest{{ exerciseName ? ` · ${exerciseName}` : '' }}
      </p>
      <p class="text-sm font-bold tabular-nums" :class="colorClass">
        {{ formatCountdown(remaining) }}
      </p>
    </div>
    <button
      class="text-xs text-(--ui-text-muted) hover:text-(--ui-text) px-2 py-1 rounded-lg"
      @click="emit('skip')"
    >
      Skip
    </button>
  </div>
</template>
