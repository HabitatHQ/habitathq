<script setup lang="ts">
defineProps<{
  to: string
  label: string
}>()
</script>

<template>
  <div class="flex items-center gap-2 -mb-1">
    <UButton
      :icon="resolveIcon('arrow-left')"
      variant="ghost"
      color="neutral"
      size="sm"
      :to="to"
    />
    <span class="text-sm text-(--ui-text-dimmed)">{{ label }}</span>
  </div>
</template>
