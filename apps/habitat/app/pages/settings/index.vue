<script setup lang="ts">
const SETTINGS_SECTIONS = [
  {
    to: '/settings/display',
    label: 'Display',
    icon: 'i-heroicons-swatch',
    description: 'Theme, color mode, layout options',
  },
  {
    to: '/settings/features',
    label: 'Features',
    icon: 'i-heroicons-squares-2x2',
    description: 'Feature flags and Pomodoro config',
  },
  {
    to: '/settings/notifications',
    label: 'Notifications',
    icon: 'i-heroicons-bell',
    description: 'Reminders, test notification, log',
  },
  {
    to: '/settings/permissions',
    label: 'Permissions',
    icon: 'i-heroicons-shield-check',
    description: 'Install, media, battery, storage',
  },
  {
    to: '/settings/data',
    label: 'Data',
    icon: 'i-heroicons-circle-stack',
    description: 'Export, import, and clear data',
  },
  {
    to: '/settings/more',
    label: 'More',
    icon: 'i-heroicons-ellipsis-horizontal-circle',
    description: 'About, diagnostics, danger zone',
  },
]

onMounted(() => {
  if (window.matchMedia('(min-width: 640px)').matches) {
    navigateTo('/settings/display', { replace: true })
  }
})
</script>

<template>
  <div class="space-y-4">
    <header class="sm:hidden">
      <p class="text-sm text-(--ui-text-dimmed)">Preferences</p>
      <h2 class="text-2xl font-bold">Settings</h2>
    </header>

    <nav class="space-y-1 sm:hidden">
      <NuxtLink
        v-for="s in SETTINGS_SECTIONS"
        :key="s.to"
        :to="s.to"
        class="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-(--ui-bg-elevated) hover:bg-(--ui-bg-accented) transition-colors"
      >
        <div class="w-9 h-9 rounded-xl bg-(--ui-bg) flex items-center justify-center shrink-0">
          <UIcon :name="s.icon" class="w-4.5 h-4.5 text-(--ui-text-muted)" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-(--ui-text)">{{ s.label }}</p>
          <p class="text-xs text-(--ui-text-dimmed) truncate">{{ s.description }}</p>
        </div>
        <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
      </NuxtLink>
    </nav>

    <p class="sm:hidden text-xs text-(--ui-text-dimmed) text-center leading-relaxed px-4 pb-2">
      Habitat is built around the idea that habits should fit your life — not the other way around.
      There are no streaks to protect, no daily guilt. Just a quiet space to notice what you do,
      and gently do more of what matters.
    </p>
  </div>
</template>
