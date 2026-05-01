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
    case 'Detraining':
      return 'text-zinc-400'
    default:
      return 'text-zinc-400'
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
    case 'Detraining':
      return 'bg-zinc-500'
    default:
      return 'bg-zinc-500'
  }
})
</script>

<template>
  <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <p class="text-xs text-zinc-500 uppercase tracking-wide">Readiness</p>
        <p class="text-2xl font-bold text-white">
          {{ readiness.score }}<span class="text-sm text-zinc-500 ml-1">/ 100</span>
        </p>
      </div>
      <span class="text-lg font-semibold" :class="labelColor">{{ readiness.label }}</span>
    </div>
    <!-- Score bar -->
    <div class="h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
      <div
        class="h-full rounded-full transition-all"
        :class="barColor"
        :style="{ width: `${readiness.score}%` }"
      />
    </div>
    <p class="text-xs text-zinc-400">{{ readiness.description }}</p>
  </div>
</template>
