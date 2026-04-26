<script setup lang="ts">
import { resolveIcon } from '~/utils/icons'

const props = defineProps<{
  /** Registry name (e.g., 'star') or raw icon class (e.g., 'i-lucide-star') */
  name: string
  /** Dynamic color — applied as inline style */
  color?: string
}>()

const resolved = computed(() => resolveIcon(props.name))
const colorStyle = computed(() => (props.color ? { color: props.color } : undefined))
</script>

<template>
  <UIcon :name="resolved" :style="colorStyle" />
</template>
