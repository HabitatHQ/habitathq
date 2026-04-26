<script setup lang="ts">
const modelValue = defineModel<boolean>({ default: false })

defineProps<{
  title?: string
}>()

const slots = useSlots()
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
  >
    <div
      class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
      @click="modelValue = false"
    />
    <div
      class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[90dvh] overscroll-contain"
    >
      <!-- Title -->
      <div v-if="slots['title'] || title" class="px-5 pt-5 pb-0">
        <slot name="title">
          <h2 class="text-lg font-semibold">{{ title }}</h2>
        </slot>
      </div>

      <!-- Scrollable content -->
      <div class="overflow-y-auto flex-1 px-5 py-4 space-y-4">
        <slot />
      </div>

      <!-- Sticky footer -->
      <div
        v-if="slots['footer']"
        class="sticky bottom-0 bg-(--ui-bg-muted) border-t border-(--ui-border) px-5 py-4 sm:rounded-b-2xl"
      >
        <slot name="footer" />
        <div class="safe-area-bottom" aria-hidden="true" />
      </div>
      <div v-else class="safe-area-bottom" aria-hidden="true" />
    </div>
  </div>
</template>
