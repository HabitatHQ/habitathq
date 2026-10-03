<script setup lang="ts">
defineProps<{
  label: string
  openLabel?: string
  defaultOpen?: boolean
}>()
</script>

<template>
  <AppCollapsible
    :label="label"
    :default-open="defaultOpen"
    v-bind="openLabel === undefined ? {} : { openLabel }"
  >
    <slot />
  </AppCollapsible>
</template>
