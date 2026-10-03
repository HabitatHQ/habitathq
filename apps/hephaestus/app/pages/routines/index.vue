<script setup lang="ts">
const routines = useRoutines()
const rows = ref(await routines.load())
</script>

<template>
  <article class="p-4 space-y-4">
    <header class="flex items-center justify-between"><h1 class="text-2xl font-bold">Saved routines</h1><UButton to="/routines/new" color="primary">Configure routine</UButton></header>
    <p class="text-sm text-(--ui-text-muted)">A routine is a configured, reusable copy of a template revision. Ad-hoc sessions do not create one.</p>
    <p v-if="rows.length === 0" class="rounded-xl bg-(--color-surface) p-4 text-sm">No saved routines yet. Configure one from a template.</p>
    <ul class="space-y-2"><li v-for="routine in rows" :key="routine.id" class="rounded-xl bg-(--color-surface) p-4"><NuxtLink :to="`/routines/${routine.id}`" class="font-semibold">{{ routine.name }}</NuxtLink><p class="text-xs text-(--ui-text-muted)">{{ routine.continuationPolicy === 'carry_forward' ? `Carry forward (${routine.deferralMode})` : 'Calendar-bound' }} · template revision {{ routine.adoptedTemplateRevisionId }}</p></li></ul>
  </article>
</template>
