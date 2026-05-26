<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'card' | 'row' | 'circle' | 'text' | 'chart'
    count?: number
    height?: string
  }>(),
  {
    variant: 'card',
    count: 1,
  },
)

const variantClasses: Record<string, string> = {
  card: 'h-20 rounded-2xl',
  row: 'h-14 rounded-xl',
  circle: 'w-12 h-12 rounded-full',
  text: 'h-4 w-3/4 rounded',
  chart: 'rounded-2xl',
}
</script>

<template>
  <div class="space-y-3" role="status" aria-label="Loading">
    <div
      v-for="n in count"
      :key="n"
      class="bg-(--ui-bg-muted) animate-pulse"
      :class="variantClasses[variant]"
      :style="variant === 'chart' && height ? { height } : undefined"
    />
    <span class="sr-only">Loading...</span>
  </div>
</template>
