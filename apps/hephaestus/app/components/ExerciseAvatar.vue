<script setup lang="ts">
import { movementColors, resolveExerciseIcon } from '~/lib/exercise-icons'
import type { MovementPattern } from '~/types/database'

const props = defineProps<{
  icon?: string | null
  movement: MovementPattern
  /** Size class override — defaults to w-8 h-8 */
  size?: string
}>()

const colors = computed(() => movementColors[props.movement])
const iconName = computed(() => resolveExerciseIcon(props.icon, props.movement))
const sizeClass = computed(() => props.size ?? 'w-8 h-8')
</script>

<template>
  <div
    class="shrink-0 rounded-full flex items-center justify-center"
    :class="[sizeClass, colors.bg]"
    aria-hidden="true"
  >
    <UIcon :name="iconName" class="w-4 h-4" :class="colors.text" />
  </div>
</template>
