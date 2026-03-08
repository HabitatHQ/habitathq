<script setup lang="ts">
const { settings, set } = useAppSettings()

const themes = [
  { label: 'Hephaestus', value: 'hephaestus' as const },
  { label: 'Forge', value: 'forge' as const },
  { label: 'Daylight', value: 'daylight' as const },
]
</script>

<template>
  <article class="p-4 space-y-6">
    <h1 class="text-2xl font-bold">Profile</h1>

    <!-- Theme -->
    <section aria-labelledby="theme-heading">
      <h2 id="theme-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
        Theme
      </h2>
      <ul role="list" class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <li v-for="theme in themes" :key="theme.value">
          <button
            class="flex items-center justify-between w-full px-4 py-3 text-sm"
            :aria-pressed="settings.theme === theme.value"
            @click="set('theme', theme.value)"
          >
            <span>{{ theme.label }}</span>
            <UIcon
              v-if="settings.theme === theme.value"
              name="i-heroicons-check"
              class="w-4 h-4 text-(--color-accent)"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </section>

    <!-- Units -->
    <section aria-labelledby="units-heading">
      <h2 id="units-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-2">
        Units
      </h2>
      <dl class="rounded-xl bg-(--color-surface) divide-y divide-(--ui-border)">
        <div class="flex items-center justify-between px-4 py-3 text-sm">
          <dt>Weight unit</dt>
          <dd class="flex gap-2">
            <UButton
              size="xs"
              :variant="settings.weightUnit === 'kg' ? 'solid' : 'ghost'"
              color="primary"
              :aria-pressed="settings.weightUnit === 'kg'"
              @click="set('weightUnit', 'kg')"
            >
              kg
            </UButton>
            <UButton
              size="xs"
              :variant="settings.weightUnit === 'lbs' ? 'solid' : 'ghost'"
              color="primary"
              :aria-pressed="settings.weightUnit === 'lbs'"
              @click="set('weightUnit', 'lbs')"
            >
              lbs
            </UButton>
          </dd>
        </div>
        <div class="flex items-center justify-between px-4 py-3 text-sm">
          <dt>Distance unit</dt>
          <dd class="flex gap-2">
            <UButton
              size="xs"
              :variant="settings.distanceUnit === 'km' ? 'solid' : 'ghost'"
              color="primary"
              :aria-pressed="settings.distanceUnit === 'km'"
              @click="set('distanceUnit', 'km')"
            >
              km
            </UButton>
            <UButton
              size="xs"
              :variant="settings.distanceUnit === 'mi' ? 'solid' : 'ghost'"
              color="primary"
              :aria-pressed="settings.distanceUnit === 'mi'"
              @click="set('distanceUnit', 'mi')"
            >
              mi
            </UButton>
          </dd>
        </div>
      </dl>
    </section>
  </article>
</template>
