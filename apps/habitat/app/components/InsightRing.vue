<script setup lang="ts">
/** InsightRing — a soft circular gauge with centered value + caption. */
const props = withDefaults(
  defineProps<{
    pct: number
    center: string
    sub?: string
    color?: string
    size?: number
  }>(),
  { sub: '', color: '#22d3ee', size: 56 },
)

const R = 20
const CIRC = 2 * Math.PI * R
const offset = computed(() => CIRC * (1 - Math.max(0, Math.min(100, props.pct)) / 100))
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 58 58" :style="{ color }" aria-hidden="true">
    <circle cx="29" cy="29" :r="R" fill="none" stroke="var(--ui-bg-elevated)" stroke-width="5" />
    <circle
      cx="29"
      cy="29"
      :r="R"
      fill="none"
      stroke="currentColor"
      stroke-width="5"
      stroke-linecap="round"
      :stroke-dasharray="CIRC"
      :stroke-dashoffset="offset"
      transform="rotate(-90 29 29)"
    />
    <text x="29" y="30" text-anchor="middle" font-size="13" font-weight="800" fill="var(--ui-text)">
      {{ center }}
    </text>
    <text v-if="sub" x="29" y="40" text-anchor="middle" font-size="6.5" fill="var(--ui-text-dimmed)">
      {{ sub }}
    </text>
  </svg>
</template>
