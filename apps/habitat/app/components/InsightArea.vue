<script setup lang="ts">
/**
 * InsightArea — a soft gradient area chart for a trend series (Calm-style, not a
 * spiky sparkline). Neutral by default. Reusable across insight surfaces.
 */
const props = withDefaults(
  defineProps<{
    /** Ordered values (skip nulls before passing). */
    values: number[]
    color?: string
    height?: number
  }>(),
  { color: '#2dd4bf', height: 56 },
)

const W = 100
const uid = `ia-${Math.random().toString(36).slice(2, 9)}`

const paths = computed(() => {
  const v = props.values
  const h = props.height
  const first = v[0]
  if (first === undefined) return { line: '', fill: '' }
  if (v.length === 1) {
    const y = (h / 2).toFixed(1)
    return { line: `M 0 ${y} L ${W} ${y}`, fill: `M 0 ${y} L ${W} ${y} L ${W} ${h} L 0 ${h} Z` }
  }
  const min = Math.min(...v)
  const max = Math.max(...v)
  const span = max - min || 1
  const x = (i: number) => (i / (v.length - 1)) * W
  const y = (val: number) => h - 5 - ((val - min) / span) * (h - 12)
  let line = `M 0 ${y(first).toFixed(1)}`
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1]
    const b = v[i]
    if (a === undefined || b === undefined) continue
    const xm = (x(i - 1) + x(i)) / 2
    line += ` C ${xm.toFixed(1)} ${y(a).toFixed(1)}, ${xm.toFixed(1)} ${y(b).toFixed(1)}, ${x(i).toFixed(1)} ${y(b).toFixed(1)}`
  }
  return { line, fill: `${line} L ${W} ${h} L 0 ${h} Z` }
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${W} ${height}`"
    preserveAspectRatio="none"
    class="w-full block"
    :style="{ height: `${height}px`, color }"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.32" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="paths.fill" :fill="`url(#${uid})`" />
    <path
      :d="paths.line"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
