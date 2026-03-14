<script setup lang="ts">
defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
  >
    <div
      class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
      @click="emit('close')"
    />
    <div
      class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto overscroll-contain scroll-shadow"
    >
      <slot />
      <div class="safe-area-bottom" aria-hidden="true" />
    </div>
  </div>
</template>
