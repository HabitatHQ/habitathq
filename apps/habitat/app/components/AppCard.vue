<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** When provided, renders as <NuxtLink> and enables navigable styling */
    to?: string
    /** HTML tag when `to` is not provided (or the list element to wrap a link in) */
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

const NuxtLink = resolveComponent('NuxtLink')

// The visual card is a <NuxtLink> when `to` is set, otherwise the given tag.
// A navigable card inside a list still needs a real <li>: an <a> can't also be
// the list item, so when BOTH `to` and tag="li" are set we wrap the link in one
// (otherwise the <ul> would receive an <a> child directly — invalid markup).
const cardEl = computed(() => (props.to ? NuxtLink : props.tag))
const wrapInListItem = computed(() => props.to != null && props.tag === 'li')

const cardClass = computed(() => [
  'flex gap-3 p-3 rounded-xl border transition-colors',
  props.align === 'start' ? 'items-start' : 'items-center',
  props.completed
    ? 'border-primary-500/40 bg-primary-500/5'
    : 'bg-(--ui-bg-muted) border-(--ui-border)',
  props.to && 'hover:border-(--ui-border-accented) active:opacity-80 cursor-pointer',
  props.dimmed && 'opacity-40',
])
</script>

<template>
  <li v-if="wrapInListItem">
    <component :is="NuxtLink" :to="to" :class="cardClass">
      <slot />
    </component>
  </li>
  <component v-else :is="cardEl" :to="to" :class="cardClass">
    <slot />
  </component>
</template>
