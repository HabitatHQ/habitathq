<script setup lang="ts">
defineProps<{
  /** Icon registry name */
  icon: string
  /** Dynamic color applied to the icon via inline style */
  iconColor?: string
  /** Inline backgroundColor for the circle (e.g. `habit.color + '22'`) */
  bgColor?: string
  /** Tailwind class for the circle background (e.g. `bg-primary-500/10`) */
  bgClass?: string
}>()
</script>

<template>
  <div
    class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
    :class="bgClass"
    :style="bgColor ? { backgroundColor: bgColor } : undefined"
  >
    <AppIcon v-if="iconColor" :name="icon" :color="iconColor" class="w-5 h-5" />
    <AppIcon v-else :name="icon" class="w-5 h-5" />
  </div>
</template>
