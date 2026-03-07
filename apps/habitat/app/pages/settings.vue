<script setup lang="ts">
const route = useRoute()

const SETTINGS_SECTIONS = [
  { to: '/settings/display', label: 'Display', icon: 'i-heroicons-swatch' },
  { to: '/settings/features', label: 'Features', icon: 'i-heroicons-squares-2x2' },
  { to: '/settings/notifications', label: 'Notifications', icon: 'i-heroicons-bell' },
  { to: '/settings/permissions', label: 'Permissions', icon: 'i-heroicons-shield-check' },
  { to: '/settings/data', label: 'Data', icon: 'i-heroicons-circle-stack' },
  { to: '/settings/more', label: 'More', icon: 'i-heroicons-ellipsis-horizontal-circle' },
]
</script>

<template>
  <div class="sm:flex sm:gap-6">

    <!-- Sidebar: desktop only -->
    <aside class="hidden sm:flex sm:flex-col sm:w-44 sm:shrink-0">
      <h2 class="text-2xl font-bold px-3 pb-3">Settings</h2>
      <nav class="sticky top-4 flex flex-col gap-0.5">
        <NuxtLink
          v-for="s in SETTINGS_SECTIONS"
          :key="s.to"
          :to="s.to"
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          :class="route.path.startsWith(s.to)
            ? 'bg-(--ui-bg-elevated) text-(--ui-text)'
            : 'text-(--ui-text-muted) hover:text-(--ui-text-toned) hover:bg-(--ui-bg-muted)'"
        >
          <UIcon :name="s.icon" class="w-4 h-4 shrink-0" />
          {{ s.label }}
        </NuxtLink>
        <p class="mt-4 px-3 text-[11px] text-(--ui-text-dimmed) leading-relaxed">
          Habits should fit your life — not the other way around. No streaks, no guilt. Just a quiet space to notice what matters.
        </p>
      </nav>
    </aside>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <NuxtPage />
    </div>

  </div>
</template>
