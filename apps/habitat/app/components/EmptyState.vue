<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description?: string
}>()
</script>

<template>
  <AppEmptyState :icon="icon" :title="title" :description="description">
    <template v-if="$slots['actions']" #actions>
      <slot name="actions" />
    </template>
  </AppEmptyState>
</template>
