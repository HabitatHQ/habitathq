<script setup lang="ts">
/**
 * A titled list group — the canonical section header (uppercase, dimmed) plus a
 * `space-y-2` body slot. Replaces the header markup copy-pasted across list views
 * (jots date groups, checkin history, todos, bored categories, …).
 *
 * Put the list container in the default slot (add `stagger-list` for entrance):
 *   <AppListSection title="Today">
 *     <ul class="space-y-2 stagger-list"> … </ul>
 *   </AppListSection>
 */
defineProps<{ title: string }>()
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">
        {{ title }}
      </h3>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>
