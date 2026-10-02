<script setup lang="ts">
import type { ReadinessResult } from '~/lib/readiness'

const props = defineProps<{
  readiness: ReadinessResult
}>()

const labelColor = computed(() => {
  switch (props.readiness.label) {
    case 'High':
      return 'text-green-400'
    case 'Moderate':
      return 'text-yellow-400'
    case 'Low':
      return 'text-red-400'
    default:
      return 'text-(--ui-text-muted)'
  }
})

const barColor = computed(() => {
  switch (props.readiness.label) {
    case 'High':
      return 'bg-green-500'
    case 'Moderate':
      return 'bg-yellow-500'
    case 'Low':
      return 'bg-red-500'
    default:
      return 'bg-zinc-500'
  }
})
</script>

<template>
  <div class="bg-(--color-surface) border border-(--ui-border) rounded-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <p class="text-xs text-(--ui-text-muted) uppercase tracking-wide">Readiness</p>
        <p class="text-2xl font-bold text-(--ui-text)">
          {{ readiness.score ?? '—' }}<span v-if="readiness.score !== null" class="text-sm text-(--ui-text-muted) ml-1">/ 100</span>
        </p>
      </div>
      <span class="text-lg font-semibold" :class="labelColor">{{ readiness.label }}</span>
    </div>
    <p v-if="readiness.score !== null" class="h-2 bg-(--color-surface-2) rounded-full overflow-hidden mb-3">
      <span
        class="block h-full rounded-full transition-all"
        :class="barColor"
        :style="{ width: `${readiness.score}%` }"
      />
    </p>
    <p class="text-xs text-(--ui-text-muted)">{{ readiness.description }}</p>
  </div>
</template>
