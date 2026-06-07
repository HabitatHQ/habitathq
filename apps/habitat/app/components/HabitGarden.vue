<script setup lang="ts">
/**
 * HabitGarden — the Stats "garden": one sprout per habit on a shared ground line,
 * in habit order, each at its growth stage and habit colour; frozen/thawing
 * plants show a frosty tint. Tapping a plant reveals its name on the soil.
 * Capped with a "view all".
 *
 * Each plant is the shared SproutFigure (same art as the detail page), positioned
 * over a single shared ground line.
 */
import { growthStage, type StreakStatus } from '~/lib/streak-engine'

interface GardenPlant {
  id: string
  name: string
  color: string
  streak: number
  /** Drives the plant's growth stage (engine plantLevel). */
  level: number
  status: StreakStatus
}

const props = withDefaults(defineProps<{ plants: GardenPlant[]; cap?: number }>(), { cap: 8 })

const STAGE_NAMES = ['seed', 'seed', 'sprout', 'sapling', 'leafy', 'budding', 'bloom'] as const
const FROST = '#7dd3fc'
const W = 412
const ROW_H = 64
const BASE = 52 // baseline within a row
const MARGIN = 18
const SPAN = W - MARGIN * 2

const expanded = ref(false)
const selectedId = ref<string | null>(null)

const visible = computed(() => (expanded.value ? props.plants : props.plants.slice(0, props.cap)))
const hiddenCount = computed(() => props.plants.length - props.cap)

interface Placed extends GardenPlant {
  stage: number
  fill: string
  cx: number
  baseline: number
  hitW: number
  selected: boolean
}

const placed = computed<Placed[]>(() => {
  const out: Placed[] = []
  const v = visible.value
  for (let i = 0; i < v.length; i++) {
    const p = v[i]
    if (!p) continue
    const row = Math.floor(i / props.cap)
    const idxInRow = i % props.cap
    const n = Math.min(props.cap, v.length - row * props.cap)
    out.push({
      ...p,
      stage: growthStage(p.level),
      fill: p.status === 'active' ? p.color : FROST,
      cx: MARGIN + SPAN * ((idxInRow + 0.5) / n),
      baseline: row * ROW_H + BASE,
      hitW: SPAN / n,
      selected: selectedId.value === p.id,
    })
  }
  return out
})

const groundYs = computed(() => {
  const rows = Math.ceil(visible.value.length / props.cap)
  return Array.from({ length: rows }, (_, r) => r * ROW_H + BASE)
})
const svgHeight = computed(() => Math.max(1, groundYs.value.length) * ROW_H)
function groundPath(y: number): string {
  return `M ${MARGIN - 2},${y} C ${W * 0.33},${y - 3} ${W * 0.66},${y - 3} ${W - MARGIN + 2},${y}`
}

function tap(p: Placed) {
  // Toggle the name label only — the garden is a glanceable overview, not a nav.
  selectedId.value = selectedId.value === p.id ? null : p.id
}
function ariaLabel(p: Placed): string {
  const frost = p.status === 'frozen' ? ', frozen' : p.status === 'thawing' ? ', thawing' : ''
  return `${p.name}, ${p.streak}-day streak${frost} (${STAGE_NAMES[p.stage]})`
}
</script>

<template>
  <div>
    <svg
      :viewBox="`0 0 ${W} ${svgHeight}`"
      style="width: 100%; height: auto; display: block"
      class="garden"
    >
      <!-- ground line per row -->
      <path
        v-for="(y, r) in groundYs"
        :key="`g${r}`"
        :d="groundPath(y)"
        stroke="var(--ui-border-accented)"
        stroke-width="3"
        fill="none"
        stroke-linecap="round"
      />

      <!-- plants -->
      <g
        v-for="item in placed"
        :key="item.id"
        class="plant"
        role="button"
        tabindex="0"
        :aria-label="ariaLabel(item)"
        @click="tap(item)"
        @keydown.enter="tap(item)"
        @keydown.space.prevent="tap(item)"
      >
        <!-- enlarged hit target -->
        <rect
          :x="item.cx - item.hitW / 2"
          :y="item.baseline - 46"
          :width="item.hitW"
          :height="54"
          fill="transparent"
        />
        <!-- selection highlight -->
        <circle
          v-if="item.selected"
          :cx="item.cx"
          :cy="item.baseline - 10"
          r="17"
          :fill="item.fill"
          opacity="0.1"
        />

        <g :transform="`translate(${item.cx - 20}, ${item.baseline - 40})`" :style="{ color: item.fill }">
          <SproutFigure :level="item.level" :status="item.status" />
        </g>

        <!-- tap-to-reveal: habit name on the soil -->
        <text
          v-if="item.selected"
          :x="item.cx"
          :y="item.baseline + 11"
          text-anchor="middle"
          class="plant-label"
        >
          {{ item.name }}
        </text>
      </g>
    </svg>

    <div v-if="!expanded && hiddenCount > 0" class="text-center mt-1">
      <button type="button" class="text-xs font-semibold text-primary-400 hover:text-primary-300" @click="expanded = true">
        View all {{ plants.length }} →
      </button>
    </div>
    <div v-else-if="expanded && hiddenCount > 0" class="text-center mt-1">
      <button type="button" class="text-xs font-medium text-(--ui-text-dimmed) hover:text-(--ui-text-toned)" @click="expanded = false">
        Show less
      </button>
    </div>
  </div>
</template>

<style scoped>
.plant {
  cursor: pointer;
  outline: none;
}
.plant:focus-visible {
  outline: 2px solid var(--ui-border-accented);
  outline-offset: 2px;
  border-radius: 8px;
}
.plant-label {
  font-size: 6.5px;
  font-weight: 500;
  letter-spacing: 0.2px;
  fill: var(--ui-text-dimmed);
  opacity: 0.75;
}
</style>
