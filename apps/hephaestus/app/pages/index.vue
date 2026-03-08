<script setup lang="ts">
const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
</script>

<template>
  <article class="p-4 space-y-6">
    <header class="pt-safe-top">
      <h1 class="text-2xl font-bold">Today</h1>
      <time class="text-sm text-(--ui-text-muted)">{{ today }}</time>
    </header>

    <!-- Planned workout -->
    <section aria-labelledby="planned-heading">
      <h2 id="planned-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
        Planned Workout
      </h2>
      <p class="rounded-xl bg-(--color-surface) p-4 text-center text-(--ui-text-muted)">
        No workout planned — set up a training block in Profile.
      </p>
    </section>

    <!-- Quick start -->
    <section aria-label="Quick start">
      <UButton size="xl" color="primary" class="w-full" to="/workout">
        <UIcon name="i-heroicons-bolt" class="w-5 h-5" aria-hidden="true" />
        Start Workout
      </UButton>
    </section>

    <!-- Recent activity -->
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
        Recent Activity
      </h2>
      <p class="rounded-xl bg-(--color-surface) p-4 text-center text-(--ui-text-muted)">
        No recent workouts. Log your first session!
      </p>
    </section>
  </article>
</template>
