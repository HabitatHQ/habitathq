<script setup lang="ts">
defineProps<{
  label: string
  openLabel?: string
  defaultOpen?: boolean
}>()
</script>

<template>
  <AppCollapsible :label="label" :open-label="openLabel" :default-open="defaultOpen">
    <slot />
  </AppCollapsible>
</template>
