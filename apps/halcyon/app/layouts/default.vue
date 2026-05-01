<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const navItems = [
  { label: 'Home', icon: 'i-heroicons-home', to: '/' },
  { label: 'Contacts', icon: 'i-heroicons-users', to: '/contacts' },
  { label: 'Journal', icon: 'i-heroicons-book-open', to: '/journal' },
  { label: 'Search', icon: 'i-heroicons-magnifying-glass', to: '/search' },
  { label: 'Settings', icon: 'i-heroicons-cog-6-tooth', to: '/settings' },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <!-- Main content -->
    <main class="flex-1 overflow-y-auto pb-20 pt-safe">
      <slot />
    </main>

    <!-- Bottom navigation -->
    <nav
      class="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 pb-safe"
    >
      <div class="flex items-stretch h-14">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors"
          :class="isActive(item.to)
            ? 'text-violet-400'
            : 'text-zinc-500 hover:text-zinc-300'"
        >
          <UIcon :name="item.icon" class="size-5" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>
