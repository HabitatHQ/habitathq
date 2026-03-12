<script setup lang="ts">
// ─── Props & Emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  /** When true, renders a horizontal compact layout instead of the ring (for small viewports). */
  compact?: boolean
}>()

const emit = defineEmits<{
  select: [type: 'text' | 'voice' | 'image']
}>()

// ─── App settings (reduce-motion awareness) ──────────────────────────────────

const { settings } = useAppSettings()

function isMotionReduced(): boolean {
  if (!import.meta.client) return true
  if (settings.value.reduceMotion) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ─── Sprout animation (play once on mount) ───────────────────────────────────

const logoAnimating = ref(false)

onMounted(async () => {
  if (isMotionReduced()) return
  await nextTick()
  logoAnimating.value = true
})

// ─── Rotating prompt text with random transitions ────────────────────────────

const PHRASES = [
  'Plant a memory',
  'Jot down an important note',
  'Scribble an idea',
  'Capture a moment',
  'Record a thought',
  'Snap something beautiful',
  'Save it before it fades',
]

const currentPhrase = ref('')
const displayedText = ref('')
const transitionMode = ref<'fade' | 'typewriter'>('fade')
const textVisible = ref(true)

let phraseTimer: ReturnType<typeof setTimeout> | null = null
let typewriterTimer: ReturnType<typeof setInterval> | null = null
let lastIndex = -1

function pickRandom(): string {
  let idx: number
  do {
    idx = Math.floor(Math.random() * PHRASES.length)
  } while (idx === lastIndex && PHRASES.length > 1)
  lastIndex = idx
  return PHRASES[idx]!
}

function typewrite(text: string) {
  let i = 0
  displayedText.value = ''
  typewriterTimer = setInterval(() => {
    if (i < text.length) {
      displayedText.value = text.slice(0, i + 1)
      i++
    } else {
      if (typewriterTimer) clearInterval(typewriterTimer)
      typewriterTimer = null
    }
  }, 45)
}

function cyclePhrase() {
  const phrase = pickRandom()
  currentPhrase.value = phrase
  const mode = Math.random() < 0.5 ? 'fade' : 'typewriter'
  transitionMode.value = mode

  if (mode === 'fade') {
    textVisible.value = false
    setTimeout(() => {
      displayedText.value = phrase
      textVisible.value = true
    }, 400)
  } else {
    textVisible.value = true
    typewrite(phrase)
  }

  phraseTimer = setTimeout(cyclePhrase, 4500)
}

onMounted(() => {
  // Start immediately with the first phrase
  const first = pickRandom()
  currentPhrase.value = first
  displayedText.value = first
  textVisible.value = true
  phraseTimer = setTimeout(cyclePhrase, 3500)
})

onUnmounted(() => {
  if (phraseTimer) clearTimeout(phraseTimer)
  if (typewriterTimer) clearInterval(typewriterTimer)
})

// ─── Ring geometry ───────────────────────────────────────────────────────────

const RING_R = 90 // radius of the ring in SVG units
const CENTER = 110 // center of SVG viewport
const SVG_SIZE = CENTER * 2

// Icon positions at 120° intervals (270° = top, 30° = bottom-right, 150° = bottom-left)
const nodes = [
  {
    type: 'voice' as const,
    angle: 270,
    label: 'Voice',
    icon: 'i-heroicons-microphone',
    color: 'rose',
  },
  {
    type: 'text' as const,
    angle: 30,
    label: 'Scribble',
    icon: 'i-heroicons-pencil',
    color: 'amber',
  },
  {
    type: 'image' as const,
    angle: 150,
    label: 'Photograph',
    icon: 'i-heroicons-camera',
    color: 'sky',
  },
]

function nodePos(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: CENTER + RING_R * Math.cos(rad),
    y: CENTER + RING_R * Math.sin(rad),
  }
}

// ─── Compact mode icons (fallback for small viewports) ──────────────────────

const compactOptions = [
  {
    type: 'voice' as const,
    label: 'Voice',
    icon: 'i-heroicons-microphone',
    colorClasses: 'bg-rose-500/10 text-rose-400',
  },
  {
    type: 'text' as const,
    label: 'Scribble',
    icon: 'i-heroicons-pencil',
    colorClasses: 'bg-amber-500/10 text-amber-400',
  },
  {
    type: 'image' as const,
    label: 'Photograph',
    icon: 'i-heroicons-camera',
    colorClasses: 'bg-sky-500/10 text-sky-400',
  },
]
</script>

<template>
  <!-- ── Compact fallback (horizontal tiles) ──────────────────────────── -->
  <div v-if="compact" class="flex flex-col items-center gap-4">
    <div class="grid grid-cols-3 gap-3 w-full">
      <button
        v-for="opt in compactOptions"
        :key="opt.type"
        class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) active:opacity-70 transition-opacity"
        @click="emit('select', opt.type)"
      >
        <div class="w-10 h-10 rounded-full flex items-center justify-center" :class="opt.colorClasses">
          <UIcon :name="opt.icon" class="w-5 h-5" />
        </div>
        <span class="text-xs text-(--ui-text-toned)">{{ opt.label }}</span>
      </button>
    </div>
    <!-- Prompt text (compact) -->
    <p
      class="text-sm text-(--ui-text-dimmed) h-6 text-center transition-opacity duration-400"
      :class="textVisible ? 'opacity-100' : 'opacity-0'"
    >{{ displayedText }}</p>
  </div>

  <!-- ── Full ring ────────────────────────────────────────────────────── -->
  <div v-else class="flex flex-col items-center gap-5">
    <div class="jots-ring-container relative" :style="{ width: SVG_SIZE + 'px', height: SVG_SIZE + 'px' }">
      <!-- Ambient glow behind ring -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="w-44 h-44 rounded-full bg-primary-500/10 blur-3xl" />
      </div>

      <svg
        :width="SVG_SIZE"
        :height="SVG_SIZE"
        :viewBox="`0 0 ${SVG_SIZE} ${SVG_SIZE}`"
        class="relative z-10"
      >
        <!-- Base ring (subtle border) -->
        <circle
          :cx="CENTER"
          :cy="CENTER"
          :r="RING_R"
          fill="none"
          stroke="var(--ui-border)"
          stroke-width="2.5"
        />

        <!-- Rotating glow arc -->
        <circle
          class="ring-glow-arc"
          :cx="CENTER"
          :cy="CENTER"
          :r="RING_R"
          fill="none"
          stroke="url(#ringGlowGrad)"
          stroke-width="3.5"
          :stroke-dasharray="`${RING_R * 2 * Math.PI * 0.3} ${RING_R * 2 * Math.PI * 0.7}`"
          stroke-linecap="round"
        />

        <!-- Gradient definition for glow arc -->
        <defs>
          <linearGradient id="ringGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="var(--color-sky-400)" stop-opacity="1" />
            <stop offset="50%" stop-color="var(--color-amber-400)" stop-opacity="0.8" />
            <stop offset="100%" stop-color="var(--color-rose-400)" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <!-- Sprout logo (centred) -->
      <div class="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
        <svg
          class="plant-logo plant-logo-md w-14 h-16"
          :class="{ 'sprout-anim': logoAnimating }"
          viewBox="0 0 40 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Habitat"
        >
          <line class="sprout-stem" x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
          <path class="sprout-leaf-l" d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          <path class="sprout-branch-r" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          <path class="sprout-soil" d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" pathLength="1" />
        </svg>
      </div>

      <!-- Icon nodes -->
      <button
        v-for="node in nodes"
        :key="node.type"
        class="jots-ring-node absolute z-30 flex flex-col items-center gap-1"
        :style="{
          left: nodePos(node.angle).x + 'px',
          top:  nodePos(node.angle).y + 'px',
          transform: 'translate(-50%, -50%)',
        }"
        @click="emit('select', node.type)"
      >
        <div
          class="w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all duration-200 active:scale-90"
          :class="{
            'bg-rose-500/15 border-rose-500/40 hover:border-rose-400 hover:bg-rose-500/25': node.color === 'rose',
            'bg-amber-500/15 border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/25': node.color === 'amber',
            'bg-sky-500/15 border-sky-500/40 hover:border-sky-400 hover:bg-sky-500/25': node.color === 'sky',
          }"
        >
          <UIcon
            :name="node.icon"
            class="w-5 h-5"
            :class="{
              'text-rose-400': node.color === 'rose',
              'text-amber-400': node.color === 'amber',
              'text-sky-400': node.color === 'sky',
            }"
          />
        </div>
        <span class="text-[10px] font-medium text-(--ui-text-dimmed) whitespace-nowrap">{{ node.label }}</span>
      </button>
    </div>

    <!-- Rotating prompt text -->
    <p
      class="text-sm text-(--ui-text-dimmed) h-6 text-center transition-opacity duration-400"
      :class="textVisible ? 'opacity-100' : 'opacity-0'"
    >{{ displayedText }}</p>
  </div>
</template>

<style scoped>
/* Rotating glow arc around the ring */
.ring-glow-arc {
  transform-origin: center;
  animation: ring-glow-rotate 6s linear infinite;
}

@keyframes ring-glow-rotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Respect reduce-motion */
@media (prefers-reduced-motion: reduce) {
  .ring-glow-arc {
    animation: none;
  }
}

:global(html.reduce-motion) .ring-glow-arc {
  animation: none;
}
</style>
