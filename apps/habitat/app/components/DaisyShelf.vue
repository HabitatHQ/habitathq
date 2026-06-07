<script setup lang="ts">
/**
 * DaisyShelf — the permanent harvest. One daisy per best 30-day milestone
 * (engine `daisies`). Renders a row of daisy icons (capped) with a count.
 */
const props = withDefaults(
  defineProps<{
    count: number
    /** Hairline colour (usually the habit colour). */
    color?: string
    /** Max icons before collapsing to “+N”. */
    cap?: number
  }>(),
  { color: 'currentColor', cap: 10 },
)

const shown = computed(() => Math.min(props.count, props.cap))
const overflow = computed(() => Math.max(0, props.count - props.cap))
const petals = [0, 1, 2, 3, 4, 5, 6, 7]
</script>

<template>
  <div v-if="count > 0" class="flex items-center gap-1.5 flex-wrap">
    <svg
      v-for="n in shown"
      :key="n"
      viewBox="0 0 24 24"
      class="w-5 h-5 shrink-0"
      :style="{ color }"
      aria-hidden="true"
    >
      <ellipse
        v-for="p in petals"
        :key="p"
        cx="12"
        cy="6.4"
        rx="2"
        ry="3.4"
        fill="#ffffff"
        stroke="currentColor"
        stroke-width="0.8"
        :transform="`rotate(${p * 45} 12 12)`"
      />
      <circle cx="12" cy="12" r="2.7" fill="#fbbf24" stroke="currentColor" stroke-width="0.7" />
    </svg>
    <span v-if="overflow > 0" class="text-xs font-medium text-(--ui-text-dimmed) tabular-nums">
      +{{ overflow }}
    </span>
  </div>
</template>
