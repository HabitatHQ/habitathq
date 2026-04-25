<script setup lang="ts">
import { type IconVariant, resolveIcon } from '~/utils/icons'

const props = withDefaults(
  defineProps<{
    /** Registry name (e.g., 'star') or raw icon class (e.g., 'i-heroicons-star') */
    name: string
    /** Icon variant: outline (default), solid, or micro */
    variant?: IconVariant
    /** Dynamic color — applied as inline style */
    color?: string
  }>(),
  { variant: 'outline' },
)

const resolved = computed(() => resolveIcon(props.name, props.variant))
const colorStyle = computed(() => (props.color ? { color: props.color } : undefined))
</script>

<template>
  <UIcon :name="resolved" :style="colorStyle" />
</template>
