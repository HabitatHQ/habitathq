<script setup lang="ts">
const route = useRoute()

const navItems = [
  { to: '/', label: 'Today', icon: 'i-heroicons-sun' },
  { to: '/workout', label: 'Workout', icon: 'i-heroicons-bolt' },
  { to: '/exercises', label: 'Exercises', icon: 'i-heroicons-list-bullet' },
  { to: '/history', label: 'History', icon: 'i-heroicons-clock' },
  { to: '/profile', label: 'Profile', icon: 'i-heroicons-user' },
]

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <main class="flex-1 pb-20">
      <slot />
    </main>

    <nav aria-label="Primary navigation" class="fixed bottom-0 left-0 right-0 safe-area-bottom bg-(--ui-bg) border-t border-(--ui-border) z-50">
      <ul role="list" class="flex items-center justify-around h-14">
        <li v-for="item in navItems" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors"
            :class="
              isActive(item.to)
                ? 'text-(--color-accent)'
                : 'text-(--ui-text-muted) hover:text-(--ui-text)'
            "
            :aria-current="isActive(item.to) ? 'page' : undefined"
          >
            <UIcon :name="item.icon" class="w-6 h-6" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
