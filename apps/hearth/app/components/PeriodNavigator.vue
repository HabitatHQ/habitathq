<script setup lang="ts">
defineProps<{
  period: string
  isCurrentPeriod: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <div class="flex items-center justify-between">
    <button
      class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
      aria-label="Previous month"
      @click="emit('prev')"
    >
      <AppIcon name="chevron-left" class="w-5 h-5" />
    </button>
    <h1 class="text-xs font-semibold text-(--ui-text-muted) tracking-wide uppercase">
      {{ formatPeriod(period) }}
    </h1>
    <button
      class="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors"
      :class="isCurrentPeriod ? 'text-(--ui-text-dimmed) cursor-default' : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
      :disabled="isCurrentPeriod"
      aria-label="Next month"
      @click="emit('next')"
    >
      <AppIcon name="chevron-right" class="w-5 h-5" />
    </button>
  </div>
</template>
