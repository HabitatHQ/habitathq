<script setup lang="ts">
defineProps<{
  to: string
  label: string
  title?: boolean
}>()
</script>

<template>
  <div class="flex items-center gap-2" :class="title ? 'justify-between' : ''">
    <NuxtLink :to="to" class="flex items-center gap-2 group">
      <UButton
        :icon="resolveIcon('arrow-left')"
        variant="ghost"
        color="neutral"
        size="sm"
        tabindex="-1"
        as="span"
      />
      <span
        :class="title
          ? 'text-xl font-bold text-(--ui-text)'
          : 'text-sm text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted) transition-colors'"
      >{{ label }}</span>
    </NuxtLink>
    <slot />
  </div>
</template>
