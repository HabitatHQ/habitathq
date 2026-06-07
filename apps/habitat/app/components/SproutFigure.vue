<script setup lang="ts">
/**
 * SproutFigure — the shared plant figure (foliage parts + frost crystals), drawn
 * as an SVG <g> in the 0 0 40 44 unit space. Used by both SproutPlant (detail,
 * which adds the soil + svg wrapper + grow animation) and HabitGarden (stats,
 * which positions it over a shared ground line). No soil — that's caller context.
 *
 * Stroke colour comes from `currentColor` (the caller sets it per habit / frost).
 */
import { growthStage, type StreakStatus } from '~/lib/streak-engine'
import { crystalsFor, PARTS_BY_STAGE } from '~/utils/sprout-stages'

const props = withDefaults(
  defineProps<{
    level: number
    status?: StreakStatus
    /** Part-ids currently animating in (SproutPlant supplies these). */
    entering?: string[]
    /** Whole-figure pop on a stage advance. */
    popping?: boolean
  }>(),
  { status: 'active', entering: () => [], popping: false },
)

const stage = computed(() => growthStage(props.level))
const has = (id: string) => PARTS_BY_STAGE[stage.value]?.includes(id) ?? false
const enterCls = (id: string) => (props.entering.includes(id) ? 'enter' : '')
const crystals = computed(() => crystalsFor(props.status))
</script>

<template>
  <g class="figure" :class="{ pop: popping, frosted: status !== 'active' }">
    <g class="foliage">
      <!-- Dormant: resting seed -->
      <ellipse v-if="has('seedRest')" class="fill" :class="enterCls('seedRest')" cx="20" cy="37.5" rx="3.4" ry="2.4" fill="currentColor" />

      <!-- Seed (level 1): germinating sprout -->
      <g v-if="has('seed')" :class="enterCls('seed')">
        <path class="draw" d="M 20,39 C 17,35 15,35 15,33" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" pathLength="1" />
        <path class="draw" d="M 20,39 C 23,35 25,35 25,33" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" pathLength="1" />
        <ellipse class="fill" cx="20" cy="39" rx="2.4" ry="1.8" fill="currentColor" />
      </g>

      <!-- Stems -->
      <line v-if="has('stemMid')" class="draw" :class="enterCls('stemMid')" x1="20" y1="40" x2="20" y2="30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
      <line v-if="has('stemFull')" class="draw" :class="enterCls('stemFull')" x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />

      <!-- Leaves / branch -->
      <path v-if="has('smallLeaf')" class="draw" :class="enterCls('smallLeaf')" d="M 20,30 C 14,29 11,32 13,35 C 15,37 20,33 20,30" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
      <path v-if="has('leafL')" class="draw" :class="enterCls('leafL')" d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
      <path v-if="has('branchR')" class="draw" :class="enterCls('branchR')" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />

      <!-- Budding: closed bud -->
      <path v-if="has('bud')" class="draw" :class="enterCls('bud')" d="M 17.5,22 C 17.5,17 22.5,17 22.5,22 C 22.5,25 17.5,25 17.5,22 Z" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linejoin="round" pathLength="1" />

      <!-- Bloom: white daisy + amber eye + habit-colour hairline -->
      <g v-if="has('daisy')" :class="enterCls('daisy')">
        <ellipse
          v-for="i in 8"
          :key="i"
          class="fill"
          cx="20"
          cy="3.4"
          rx="1.7"
          ry="3"
          fill="#ffffff"
          stroke="currentColor"
          stroke-width="0.7"
          :transform="`rotate(${(i - 1) * 45} 20 8)`"
        />
        <circle class="fill" cx="20" cy="8" r="2.2" fill="#fbbf24" stroke="currentColor" stroke-width="0.6" />
      </g>
    </g>

    <!-- Frost crystals (frozen / thawing) -->
    <g v-if="crystals.length" stroke="#bae6fd" stroke-width="0.9" stroke-linecap="round">
      <g v-for="(pt, i) in crystals" :key="i">
        <line :x1="pt[0] - 2" :y1="pt[1]" :x2="pt[0] + 2" :y2="pt[1]" />
        <line :x1="pt[0]" :y1="pt[1] - 2" :x2="pt[0]" :y2="pt[1] + 2" />
        <line :x1="pt[0] - 1.4" :y1="pt[1] - 1.4" :x2="pt[0] + 1.4" :y2="pt[1] + 1.4" />
        <line :x1="pt[0] - 1.4" :y1="pt[1] + 1.4" :x2="pt[0] + 1.4" :y2="pt[1] - 1.4" />
      </g>
    </g>
  </g>
</template>

<style scoped>
.figure.frosted {
  opacity: 0.9;
}

/* Level-advance reward: whole figure pops. */
.figure.pop {
  transform-box: fill-box;
  transform-origin: 50% 95%;
  animation: sprout-pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* New stroked parts draw themselves in. */
.draw.enter,
.enter .draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: sprout-draw 0.32s ease forwards;
}

/* New filled parts (seed, petals, bloom eye) pop in. */
.fill.enter,
.enter .fill {
  transform-box: fill-box;
  transform-origin: center;
  animation: sprout-fill-pop 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes sprout-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes sprout-fill-pop {
  0% {
    transform: scale(0.2);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes sprout-pop {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(1.09);
  }
  100% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .figure * {
    animation: none !important;
    stroke-dashoffset: 0 !important;
  }
  .figure.pop {
    animation: none !important;
  }
}
:global(html.reduce-motion) .figure *,
:global(html.reduce-motion) .figure.pop {
  animation: none !important;
  stroke-dashoffset: 0 !important;
}
</style>
