<script setup lang="ts">
/**
 * SproutPlant — the growing-sprout streak visual.
 *
 * Renders the Habitat sprout at one of 6 growth stages driven by streak length,
 * plus wilt (at-risk) and dormant (broken) states. Line-art reuses the app logo
 * vocabulary (viewBox 0 0 40 44). When a completion advances the stage, the new
 * part(s) draw in and the whole plant gives a subtle pop — unless reduced motion
 * is requested, in which case it swaps instantly.
 *
 * Pure presentational: the parent supplies streak + status from the streak engine.
 */
import type { StreakStatus } from '~/lib/streak-engine'

const props = withDefaults(
  defineProps<{
    streak: number
    status: StreakStatus
    /** Habit colour. Defaults to inherited text colour. */
    color?: string
    /** Rendered width in px (height scales 44/40). */
    size?: number
    /** Enable the stage-advance reward animation. */
    animate?: boolean
  }>(),
  { color: 'currentColor', size: 80, animate: true },
)

const THRESHOLDS = [1, 3, 7, 14, 30, 60] as const
const STAGE_NAMES = ['dormant', 'seed', 'sprout', 'sapling', 'leafy', 'budding', 'bloom'] as const

const stage = computed(() => {
  if (props.status === 'broken' || props.streak < 1) return 0
  // THRESHOLDS is ascending, so the stage is the count of thresholds reached (1–6).
  let s = 0
  for (const t of THRESHOLDS) if (props.streak >= t) s++
  return s
})

// Which part-ids are present at each stage (cumulative). Drives enter-animation.
const PARTS_BY_STAGE: Record<number, string[]> = {
  0: ['soil', 'seedRest'],
  1: ['soil', 'seed'],
  2: ['soil', 'stemMid', 'smallLeaf'],
  3: ['soil', 'stemFull', 'leafL'],
  4: ['soil', 'stemFull', 'leafL', 'branchR'],
  5: ['soil', 'stemFull', 'leafL', 'branchR', 'bud'],
  6: ['soil', 'stemFull', 'leafL', 'branchR', 'daisy'],
}

const has = (id: string) => PARTS_BY_STAGE[stage.value]?.includes(id) ?? false

const entering = ref(new Set<string>())
const popping = ref(false)
let mounted = false
let timer: ReturnType<typeof setTimeout> | undefined

const enterCls = (id: string) => (entering.value.has(id) ? 'enter' : '')

watch(stage, (ns, os) => {
  if (!mounted || !props.animate || ns <= os) return
  const before = new Set(PARTS_BY_STAGE[os] ?? [])
  entering.value = new Set((PARTS_BY_STAGE[ns] ?? []).filter((id) => !before.has(id)))
  popping.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    entering.value = new Set()
    popping.value = false
  }, 420)
})

onMounted(() => {
  mounted = true
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const ariaLabel = computed(() => {
  const name = STAGE_NAMES[stage.value]
  if (props.status === 'broken') return 'Streak plant: dormant seed, no active streak'
  const risk = props.status === 'at_risk' ? ', at risk — do not miss twice' : ''
  return `Streak plant: ${name} stage, ${props.streak}-day streak${risk}`
})
</script>

<template>
  <svg
    class="sprout"
    viewBox="0 0 40 44"
    :style="{ color, width: `${size}px`, height: `${(size * 44) / 40}px` }"
    role="img"
    :aria-label="ariaLabel"
  >
    <g class="canvas" :class="{ pop: popping }">
      <!-- Soil (always present, stays flat) -->
      <path
        class="draw soil"
        :class="enterCls('soil')"
        d="M 8,40 C 12,37 28,37 32,40"
        stroke="currentColor"
        stroke-width="3"
        fill="none"
        stroke-linecap="round"
        pathLength="1"
      />

      <!-- Foliage: droops + fades when at-risk -->
      <g class="foliage" :class="{ wilt: status === 'at_risk' }">
        <!-- Dormant: resting seed -->
        <ellipse
          v-if="has('seedRest')"
          class="fill"
          :class="enterCls('seedRest')"
          cx="20"
          cy="37.5"
          rx="3.4"
          ry="2.4"
          fill="currentColor"
        />

        <!-- Seed (day 1): germinating sprout -->
        <g v-if="has('seed')" :class="enterCls('seed')">
          <path
            class="draw"
            d="M 20,39 C 17,35 15,35 15,33"
            stroke="currentColor"
            stroke-width="2.2"
            fill="none"
            stroke-linecap="round"
            pathLength="1"
          />
          <path
            class="draw"
            d="M 20,39 C 23,35 25,35 25,33"
            stroke="currentColor"
            stroke-width="2.2"
            fill="none"
            stroke-linecap="round"
            pathLength="1"
          />
          <ellipse class="fill" cx="20" cy="39" rx="2.4" ry="1.8" fill="currentColor" />
        </g>

        <!-- Stems -->
        <line
          v-if="has('stemMid')"
          class="draw"
          :class="enterCls('stemMid')"
          x1="20"
          y1="40"
          x2="20"
          y2="30"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          pathLength="1"
        />
        <line
          v-if="has('stemFull')"
          class="draw"
          :class="enterCls('stemFull')"
          x1="20"
          y1="40"
          x2="20"
          y2="24"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          pathLength="1"
        />

        <!-- Leaves / branch -->
        <path
          v-if="has('smallLeaf')"
          class="draw"
          :class="enterCls('smallLeaf')"
          d="M 20,30 C 14,29 11,32 13,35 C 15,37 20,33 20,30"
          stroke="currentColor"
          stroke-width="2.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength="1"
        />
        <path
          v-if="has('leafL')"
          class="draw"
          :class="enterCls('leafL')"
          d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24"
          stroke="currentColor"
          stroke-width="2.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength="1"
        />
        <path
          v-if="has('branchR')"
          class="draw"
          :class="enterCls('branchR')"
          d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24"
          stroke="currentColor"
          stroke-width="2.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
          pathLength="1"
        />

        <!-- Budding: closed bud -->
        <path
          v-if="has('bud')"
          class="draw"
          :class="enterCls('bud')"
          d="M 17.5,22 C 17.5,17 22.5,17 22.5,22 C 22.5,25 17.5,25 17.5,22 Z"
          stroke="currentColor"
          stroke-width="2.2"
          fill="none"
          stroke-linejoin="round"
          pathLength="1"
        />

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
    </g>
  </svg>
</template>

<style scoped>
.foliage {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.4s ease;
}

/* At-risk: gentle droop + fade (soil stays flat — it's outside .foliage). */
.foliage.wilt {
  transform: rotate(7deg);
  opacity: 0.7;
}

/* Stage-advance reward: whole plant pops. */
.canvas.pop {
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

/* ── Reduced motion: everything resolves instantly ──────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .sprout *,
  .canvas.pop,
  .foliage {
    animation: none !important;
    transition: none !important;
    stroke-dashoffset: 0 !important;
  }
}
:global(html.reduce-motion) .sprout *,
:global(html.reduce-motion) .canvas.pop,
:global(html.reduce-motion) .foliage {
  animation: none !important;
  transition: none !important;
  stroke-dashoffset: 0 !important;
}
</style>
