<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    unit?: string
    visibleItems?: number
    color?: string
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    unit: '',
    visibleItems: 3,
    color: 'primary',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const { selectionChanged } = useHaptics()

// Generate the list of selectable values
const options = computed(() => {
  const list: number[] = []
  // Use a tolerance to avoid floating-point drift with fractional steps
  const tolerance = props.step / 100
  for (let v = props.min; v <= props.max + tolerance; v += props.step) {
    list.push(Math.round(v * 1000) / 1000)
  }
  return list
})

// Index of the currently selected value
const selectedIndex = computed(() => {
  const idx = options.value.findIndex((v) => Math.abs(v - props.modelValue) < props.step / 2)
  return idx >= 0 ? idx : 0
})

const containerRef = ref<HTMLElement | null>(null)
const ITEM_HEIGHT = 52 // px per row — slightly taller for touch comfort

// Live scroll position (px) — drives the continuous 3D wheel transform.
const scrollTop = ref(0)

let isScrolling = false
let scrollTimeout: ReturnType<typeof setTimeout> | null = null
let rafId = 0
let lastSnappedIndex = -1

// Respect reduced-motion: fall back to a flat list (no 3D tilt).
function motionReduced(): boolean {
  if (!import.meta.client) return true
  if (document.documentElement.classList.contains('reduce-motion')) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
const flat = ref(false)

// Scroll to selected value on mount and when modelValue changes externally
function scrollToIndex(index: number, behavior: ScrollBehavior = 'auto') {
  const el = containerRef.value
  if (!el) return
  const targetTop = index * ITEM_HEIGHT
  isScrolling = true
  el.scrollTo({ top: targetTop, behavior })
  if (scrollTimeout) clearTimeout(scrollTimeout)
  scrollTimeout = setTimeout(
    () => {
      isScrolling = false
    },
    behavior === 'smooth' ? 350 : 50,
  )
}

function onScroll() {
  const el = containerRef.value
  if (!el) return
  // Track position for the 3D transform (rAF-throttled to one update per frame).
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    scrollTop.value = el.scrollTop
  })

  if (isScrolling) return
  const index = Math.round(el.scrollTop / ITEM_HEIGHT)
  const clamped = Math.max(0, Math.min(index, options.value.length - 1))
  if (clamped !== lastSnappedIndex) {
    lastSnappedIndex = clamped
    const val = options.value[clamped]
    if (val !== undefined && val !== props.modelValue) {
      emit('update:modelValue', val)
      void selectionChanged()
    }
  }
}

// Format display value — show decimals only if needed, add commas for thousands
function formatValue(v: number): string {
  if (props.step >= 1) return v.toLocaleString('en-US')
  if (props.step >= 0.1) return v.toFixed(1)
  return v.toFixed(2)
}

// Continuous iOS-style wheel transform based on distance from the visual centre.
function itemStyle(i: number): Record<string, string> {
  const center = scrollTop.value / ITEM_HEIGHT
  const dist = i - center
  const ad = Math.abs(dist)
  const opacity = String(Math.max(0.06, 1 - ad * 0.26))
  const scale = Math.max(0.78, 1 - ad * 0.05)
  // Far rows (barely visible) and reduced-motion skip the heavy 3D rotation.
  if (flat.value || ad > 6) {
    return { opacity, transform: `scale(${scale})` }
  }
  const angle = Math.max(-72, Math.min(72, -dist * 22))
  return {
    opacity,
    transform: `translateZ(${(-ad * 8).toFixed(1)}px) rotateX(${angle.toFixed(1)}deg) scale(${scale})`,
  }
}

// Click on an item to select it directly
function selectItem(index: number) {
  const val = options.value[index]
  if (val !== undefined && val !== props.modelValue) {
    emit('update:modelValue', val)
    void selectionChanged()
  }
  lastSnappedIndex = index
  scrollToIndex(index, 'smooth')
}

onMounted(() => {
  flat.value = motionReduced()
  nextTick(() => {
    lastSnappedIndex = selectedIndex.value
    scrollToIndex(selectedIndex.value)
    scrollTop.value = selectedIndex.value * ITEM_HEIGHT
  })
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (scrollTimeout) clearTimeout(scrollTimeout)
})

watch(
  () => props.modelValue,
  () => {
    const idx = selectedIndex.value
    if (idx !== lastSnappedIndex) {
      lastSnappedIndex = idx
      scrollToIndex(idx, 'smooth')
    }
  },
)
</script>

<template>
  <div class="scroll-picker" :style="{ '--item-h': `${ITEM_HEIGHT}px`, '--visible': visibleItems }">
    <!-- Scroll container -->
    <div ref="containerRef" class="scroll-picker__track" @scroll.passive="onScroll">
      <!-- Top spacer -->
      <div class="scroll-picker__spacer" />

      <!-- Items -->
      <div
        v-for="(val, i) in options"
        :key="val"
        class="scroll-picker__item"
        :class="{ 'scroll-picker__item--selected': i === selectedIndex }"
        :style="itemStyle(i)"
        @click="selectItem(i)"
      >
        <span class="scroll-picker__value">{{ formatValue(val) }}</span>
        <span v-if="unit && i === selectedIndex" class="scroll-picker__unit">{{ unit }}</span>
      </div>

      <!-- Bottom spacer -->
      <div class="scroll-picker__spacer" />
    </div>

    <!-- Center highlight bar -->
    <div class="scroll-picker__highlight" />

    <!-- Fade gradients -->
    <div class="scroll-picker__fade-top" />
    <div class="scroll-picker__fade-bottom" />
  </div>
</template>

<style scoped>
.scroll-picker {
  position: relative;
  width: 100%;
  height: calc(var(--item-h) * (var(--visible) * 2 + 1));
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.scroll-picker__track {
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  /* Constrain the gesture to vertical so a diagonal swipe never drags the sheet
     sideways, and stop overscroll from chaining to the page behind. */
  touch-action: pan-y;
  overscroll-behavior: contain;
  /* 3D wheel */
  perspective: 820px;
  transform-style: preserve-3d;
  /* Hide scrollbar */
  scrollbar-width: none;
  -ms-overflow-style: none;
  position: relative;
  z-index: 1;
}

.scroll-picker__track::-webkit-scrollbar {
  display: none;
}

.scroll-picker__spacer {
  height: calc(var(--item-h) * var(--visible));
  flex-shrink: 0;
}

.scroll-picker__item {
  height: var(--item-h);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  scroll-snap-align: center;
  backface-visibility: hidden;
  transform-origin: center center;
  cursor: pointer;
}

.scroll-picker__value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--ui-text-dimmed);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  transition: color 0.15s ease, font-weight 0.1s ease;
}

.scroll-picker__item--selected .scroll-picker__value {
  font-size: 1.625rem;
  font-weight: 800;
  color: var(--ui-text);
}

.scroll-picker__unit {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ui-text-muted);
  text-transform: lowercase;
}

.scroll-picker__highlight {
  position: absolute;
  left: 4px;
  right: 4px;
  top: calc(var(--item-h) * var(--visible));
  height: var(--item-h);
  border-radius: 14px;
  background: var(--ui-bg-elevated);
  border: 1.5px solid color-mix(in srgb, var(--ui-color-primary-500) 30%, var(--ui-border-accented));
  pointer-events: none;
  z-index: 0;
  box-shadow: 0 0 12px -4px color-mix(in srgb, var(--ui-color-primary-500) 20%, transparent);
}

.scroll-picker__fade-top,
.scroll-picker__fade-bottom {
  position: absolute;
  left: 0;
  right: 0;
  height: calc(var(--item-h) * var(--visible) * 0.65);
  pointer-events: none;
  z-index: 2;
}

.scroll-picker__fade-top {
  top: 0;
  background: linear-gradient(to bottom, var(--ui-bg-muted) 10%, transparent 100%);
}

.scroll-picker__fade-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--ui-bg-muted) 10%, transparent 100%);
}
</style>
