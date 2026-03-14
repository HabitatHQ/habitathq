<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description?: string
}>()
</script>

<template>
  <section class="flex flex-col items-center justify-center gap-4 py-12 text-center">
    <div class="w-16 h-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center">
      <UIcon :name="icon" class="w-8 h-8 text-(--ui-text-muted)" />
    </div>
    <div class="space-y-1">
      <p class="font-semibold text-(--ui-text)">{{ title }}</p>
      <p v-if="description" class="text-sm text-(--ui-text-dimmed)">{{ description }}</p>
    </div>
  </section>
</template>
