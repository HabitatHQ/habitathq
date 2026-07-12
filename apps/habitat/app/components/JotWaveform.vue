<script setup lang="ts">
// Seekable voice-note waveform — the interactive bar strip shared by the list
// and grid jot views. Owns the pointer/keyboard seek interaction; the parent
// owns audio state and passes the current `fraction` + precomputed `bars`,
// reacting to `seek`/`nudge`/`toggle`.
defineProps<{
  bars: number[]
  fraction: number
  barCount: number
  /** 'row' = thin inline strip (list); 'block' = tall thumbnail (grid). */
  variant: 'row' | 'block'
}>()

const emit = defineEmits<{
  /** Absolute seek position, 0..1. */
  seek: [fraction: number]
  /** Relative keyboard nudge, e.g. ±0.05. */
  nudge: [delta: number]
  /** Play/pause request (Enter key). */
  toggle: []
}>()

function seekFromEvent(el: HTMLElement, clientX: number) {
  const rect = el.getBoundingClientRect()
  emit('seek', (clientX - rect.left) / rect.width)
}

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  seekFromEvent(el, e.clientX)
}

function onPointerMove(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) seekFromEvent(el, e.clientX)
}
</script>

<template>
  <div
    class="flex items-center cursor-pointer touch-none select-none min-h-[44px]"
    :class="variant === 'row'
      ? 'h-8 gap-[2px] py-[6px]'
      : 'relative h-24 justify-between px-3 overflow-hidden bg-(--ui-bg-elevated)'"
    role="slider"
    tabindex="0"
    aria-label="Seek voice note"
    :aria-valuenow="Math.round(fraction * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @keydown.left.prevent="emit('nudge', -0.05)"
    @keydown.right.prevent="emit('nudge', 0.05)"
    @keydown.enter.prevent="emit('toggle')"
  >
    <span
      v-for="(h, i) in bars"
      :key="i"
      class="rounded-full"
      :class="[
        variant === 'row' ? 'flex-1' : 'w-[3px]',
        (i + 0.5) / barCount <= fraction ? 'bg-primary-400' : 'bg-(--ui-text-dimmed)',
      ]"
      :style="{ height: `${h}%` }"
    />
    <slot />
  </div>
</template>
