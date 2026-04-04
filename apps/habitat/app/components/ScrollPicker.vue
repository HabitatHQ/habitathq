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

let isScrolling = false
let scrollTimeout: ReturnType<typeof setTimeout> | null = null
let lastSnappedIndex = -1

// Scroll to selected value on mount and when modelValue changes externally
function scrollToIndex(index: number, behavior: ScrollBehavior = 'auto') {
  const el = containerRef.value
  if (!el) return
  const targetTop = index * ITEM_HEIGHT
  isScrolling = true
  el.scrollTo({ top: targetTop, behavior })
  // Release scroll lock after animation
  if (scrollTimeout) clearTimeout(scrollTimeout)
  scrollTimeout = setTimeout(
    () => {
      isScrolling = false
    },
    behavior === 'smooth' ? 350 : 50,
  )
}

function onScroll() {
  if (isScrolling) return
  const el = containerRef.value
  if (!el) return
  const scrollTop = el.scrollTop
  const index = Math.round(scrollTop / ITEM_HEIGHT)
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

// Opacity for items at distance from center
function itemOpacity(index: number): number {
  const dist = Math.abs(index - selectedIndex.value)
  if (dist === 0) return 1
  if (dist === 1) return 0.45
  if (dist === 2) return 0.22
  return 0.1
}

function itemScale(index: number): string {
  const dist = Math.abs(index - selectedIndex.value)
  if (dist === 0) return 'scale(1.05)'
  if (dist === 1) return 'scale(0.92)'
  return 'scale(0.85)'
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
  nextTick(() => {
    lastSnappedIndex = selectedIndex.value
    scrollToIndex(selectedIndex.value)
  })
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
  <div class="scroll-picker" :style="{ '--item-h': ITEM_HEIGHT + 'px', '--visible': visibleItems }">
    <!-- Scroll container -->
    <div
      ref="containerRef"
      class="scroll-picker__track"
      @scroll.passive="onScroll"
    >
      <!-- Top spacer -->
      <div class="scroll-picker__spacer" />

      <!-- Items -->
      <div
        v-for="(val, i) in options"
        :key="val"
        class="scroll-picker__item"
        :class="{ 'scroll-picker__item--selected': i === selectedIndex }"
        :style="{
          opacity: itemOpacity(i),
          transform: itemScale(i),
        }"
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
  transition: opacity 0.12s ease, transform 0.12s ease;
  will-change: opacity, transform;
  cursor: pointer;
}

.scroll-picker__value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--ui-text-dimmed);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  transition: font-size 0.15s ease, color 0.15s ease, font-weight 0.1s ease;
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
