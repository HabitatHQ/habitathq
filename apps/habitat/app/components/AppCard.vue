<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** When provided, renders as <NuxtLink> and enables navigable styling */
    to?: string
    /** HTML tag when `to` is not provided */
    tag?: string
    /** Applies the completed-state border/bg tint */
    completed?: boolean
    /** Applies opacity-40 (e.g. context-filter mismatch) */
    dimmed?: boolean
    /** Cross-axis alignment — `start` for multi-line items, `center` (default) for single-line rows */
    align?: 'center' | 'start'
  }>(),
  { tag: 'div', completed: false, dimmed: false, align: 'center' },
)

const component = computed(() => (props.to ? resolveComponent('NuxtLink') : props.tag))
</script>

<template>
  <component
    :is="component"
    :to="to"
    class="flex gap-3 p-3 rounded-xl border transition-colors"
    :class="[
      align === 'start' ? 'items-start' : 'items-center',
      completed
        ? 'border-primary-500/40 bg-primary-500/5'
        : 'bg-(--ui-bg-muted) border-(--ui-border)',
      to && 'hover:border-(--ui-border-accented) active:opacity-80 cursor-pointer',
      dimmed && 'opacity-40',
    ]"
  >
    <slot />
  </component>
</template>
