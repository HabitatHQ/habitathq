<script setup lang="ts">
/**
 * SproutPlant — the detail-page growing-sprout: an <svg> with soil + the shared
 * SproutFigure. Stage is driven by `level` (engine plantLevel); `status` adds the
 * frost treatment. A level advance draws in the new part(s) + a subtle pop
 * (handled by SproutFigure), unless reduced motion is requested.
 */
import { growthStage, type StreakStatus } from '~/lib/streak-engine'
import { enteringParts } from '~/utils/sprout-stages'

const props = withDefaults(
  defineProps<{
    level: number
    status?: StreakStatus
    /** Habit colour. Defaults to inherited text colour. */
    color?: string
    /** Streak count — for the aria label only. */
    streak?: number
    /** Rendered width in px (height scales 44/40). */
    size?: number
    /** Enable the level-advance reward animation. */
    animate?: boolean
  }>(),
  { status: 'active', color: 'currentColor', size: 80, animate: true },
)

const FROST = '#7dd3fc'
const STAGE_NAMES = ['seed', 'seed', 'sprout', 'sapling', 'leafy', 'budding', 'bloom'] as const

const stage = computed(() => growthStage(props.level))
const plantColor = computed(() => (props.status === 'frozen' ? FROST : props.color))

const entering = ref<string[]>([])
const popping = ref(false)
let mounted = false
let timer: ReturnType<typeof setTimeout> | undefined

watch(stage, (ns, os) => {
  if (!mounted || !props.animate || ns <= os) return
  entering.value = enteringParts(os, ns)
  popping.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    entering.value = []
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
  const frost =
    props.status === 'frozen' ? ', frozen' : props.status === 'thawing' ? ', thawing' : ''
  const count = props.streak == null ? '' : `, ${props.streak}-day streak`
  return `Streak plant: ${name} stage${count}${frost}`
})
</script>

<template>
  <svg
    class="sprout"
    viewBox="0 0 40 44"
    :style="{ color: plantColor, width: `${size}px`, height: `${(size * 44) / 40}px` }"
    role="img"
    :aria-label="ariaLabel"
  >
    <!-- Soil (stays flat) -->
    <path
      d="M 8,40 C 12,37 28,37 32,40"
      stroke="currentColor"
      stroke-width="3"
      fill="none"
      stroke-linecap="round"
    />
    <SproutFigure :level="level" :status="status" :entering="entering" :popping="popping" />
  </svg>
</template>
