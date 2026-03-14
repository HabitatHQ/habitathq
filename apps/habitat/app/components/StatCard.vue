<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
}>()
</script>

<template>
  <UCard :ui="{ root: 'rounded-2xl flex-1', body: 'p-3 sm:p-3 space-y-0.5' }">
    <p class="text-[11px] text-(--ui-text-dimmed)">{{ label }}</p>
    <p class="text-2xl font-bold text-(--ui-text)">{{ value }}</p>
  </UCard>
</template>
