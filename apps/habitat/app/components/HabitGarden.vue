<script setup lang="ts">
/**
 * HabitGarden — the Stats "garden": one sprout per habit on a shared ground line,
 * in habit order, each at its own growth stage and in its habit colour. At-risk
 * plants wilt; broken streaks show a faint resting seed. Tapping a plant reveals
 * its name on the soil; tapping again opens the habit. Capped with a "view all".
 *
 * Reuses the SproutPlant line-art vocabulary (viewBox unit space) but draws every
 * plant in one SVG over a shared ground, which the per-plant component can't do.
 */
import { growthStage, type StreakStatus } from '~/lib/streak-engine'

interface GardenPlant {
  id: string
  name: string
  color: string
  streak: number
  status: StreakStatus
}

const props = withDefaults(defineProps<{ plants: GardenPlant[]; cap?: number }>(), { cap: 8 })
const emit = defineEmits<{ open: [id: string] }>()

const STAGE_NAMES = ['dormant', 'seed', 'sprout', 'sapling', 'leafy', 'budding', 'bloom'] as const
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
  wilt: boolean
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
      stage: growthStage(p.streak, p.status),
      fill: p.status === 'at_risk' ? '#f59e0b' : p.color,
      cx: MARGIN + SPAN * ((idxInRow + 0.5) / n),
      baseline: row * ROW_H + BASE,
      hitW: SPAN / n,
      selected: selectedId.value === p.id,
      wilt: p.status === 'at_risk',
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
  if (selectedId.value === p.id) emit('open', p.id)
  else selectedId.value = p.id
}
function ariaLabel(p: Placed): string {
  const risk = p.status === 'at_risk' ? ', at risk' : ''
  return `${p.name}, ${p.streak}-day streak${risk} (${STAGE_NAMES[p.stage]})`
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
          <g :class="{ wilt: item.wilt }">
            <!-- dormant -->
            <ellipse v-if="item.stage === 0" cx="20" cy="38.5" rx="3.2" ry="2.2" fill="currentColor" />

            <!-- seed (stage 1) -->
            <template v-else-if="item.stage === 1">
              <path d="M 20,39 C 17,35 15,35 15,33" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" />
              <path d="M 20,39 C 23,35 25,35 25,33" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" />
              <ellipse cx="20" cy="39" rx="2.4" ry="1.8" fill="currentColor" />
            </template>

            <!-- sprout (stage 2) -->
            <template v-else-if="item.stage === 2">
              <line x1="20" y1="40" x2="20" y2="30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              <path d="M 20,30 C 14,29 11,32 13,35 C 15,37 20,33 20,30" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </template>

            <!-- sapling+ (stages 3–6) -->
            <template v-else>
              <line x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
              <path d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              <path v-if="item.stage >= 4" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              <path v-if="item.stage === 5" d="M 17.5,22 C 17.5,17 22.5,17 22.5,22 C 22.5,25 17.5,25 17.5,22 Z" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linejoin="round" />
              <template v-if="item.stage === 6">
                <ellipse
                  v-for="i in 8"
                  :key="i"
                  cx="20"
                  cy="3.4"
                  rx="1.7"
                  ry="3"
                  fill="#ffffff"
                  stroke="currentColor"
                  stroke-width="0.7"
                  :transform="`rotate(${(i - 1) * 45} 20 8)`"
                />
                <circle cx="20" cy="8" r="2.2" fill="#fbbf24" stroke="currentColor" stroke-width="0.6" />
              </template>
            </template>
          </g>
        </g>

        <!-- tap-to-reveal: habit name on the soil -->
        <text
          v-if="item.selected"
          :x="item.cx"
          :y="item.baseline + 13"
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
.wilt {
  transform: rotate(7deg);
  transform-box: fill-box;
  transform-origin: 50% 100%;
  opacity: 0.72;
}
.plant-label {
  font-size: 9.5px;
  font-weight: 600;
  fill: var(--ui-text-toned);
}
</style>
