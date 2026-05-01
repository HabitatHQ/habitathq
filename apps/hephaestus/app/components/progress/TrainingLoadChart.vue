<script setup lang="ts">
const props = defineProps<{
  data: Array<{ week: string; volume: number; sets: number }>
}>()

const maxVolume = computed(() =>
  props.data.length > 0 ? Math.max(...props.data.map((d) => d.volume), 1) : 1,
)

const svgWidth = 300
const svgHeight = 120
const padding = { top: 10, right: 10, bottom: 20, left: 40 }

const chartWidth = svgWidth - padding.left - padding.right
const chartHeight = svgHeight - padding.top - padding.bottom

function xPos(i: number) {
  return padding.left + (i / Math.max(props.data.length - 1, 1)) * chartWidth
}

function yPos(volume: number) {
  return padding.top + chartHeight - (volume / maxVolume.value) * chartHeight
}

const pathD = computed(() => {
  if (props.data.length === 0) return ''
  return props.data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(d.volume)}`).join(' ')
})

const areaD = computed(() => {
  if (props.data.length === 0) return ''
  const baseline = padding.top + chartHeight
  return `${pathD.value} L ${xPos(props.data.length - 1)} ${baseline} L ${xPos(0)} ${baseline} Z`
})
</script>

<template>
  <div class="w-full">
    <svg
      :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
      class="w-full h-auto"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <!-- Zone band: optimal 0.8-1.3 ACWR (visual guide) -->
      <rect
        :x="padding.left"
        :y="padding.top"
        :width="chartWidth"
        :height="chartHeight"
        fill="rgb(34 197 94 / 0.05)"
      />
      <!-- Area fill -->
      <path v-if="areaD" :d="areaD" fill="rgb(249 115 22 / 0.15)" />
      <!-- Line -->
      <path
        v-if="pathD"
        :d="pathD"
        fill="none"
        stroke="#f97316"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- Dots -->
      <circle
        v-for="(d, i) in data"
        :key="d.week"
        :cx="xPos(i)"
        :cy="yPos(d.volume)"
        r="3"
        fill="#f97316"
      />
      <!-- X axis labels (every other week) -->
      <text
        v-for="(d, i) in data"
        v-show="i % 2 === 0"
        :key="`label-${d.week}`"
        :x="xPos(i)"
        :y="svgHeight - 4"
        text-anchor="middle"
        font-size="8"
        fill="#71717a"
      >
        {{ d.week.slice(-3) }}
      </text>
    </svg>
    <p v-if="data.length === 0" class="text-center text-zinc-500 text-sm py-4">No training data yet</p>
  </div>
</template>
