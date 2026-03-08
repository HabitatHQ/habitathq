<script setup lang="ts">
defineProps<{
  label: string
  value: string
  sub?: string
  accent?: boolean
}>()
</script>

<template>
  <div
    class="rounded-xl bg-(--color-surface) p-4 space-y-1"
    :class="accent ? 'ring-1 ring-(--color-accent)' : ''"
  >
    <p class="text-xs text-(--ui-text-muted) uppercase tracking-wider">{{ label }}</p>
    <p class="text-2xl font-bold tabular-nums" :class="accent ? 'text-(--color-accent)' : ''">
      {{ value }}
    </p>
    <p v-if="sub" class="text-xs text-(--ui-text-muted)">{{ sub }}</p>
  </div>
</template>
