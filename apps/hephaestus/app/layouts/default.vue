<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
})

const route = useRoute()

const navItems = [
  { to: '/', label: 'Today', icon: 'i-ph-sun' },
  { to: '/workout', label: 'Workout', icon: 'i-ph-barbell' },
  { to: '/exercises', label: 'Exercises', icon: 'i-ph-list-bullets' },
  { to: '/history', label: 'History', icon: 'i-ph-clock-counter-clockwise' },
  { to: '/profile', label: 'Profile', icon: 'i-ph-user' },
]

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <a href="#main-content" class="skip-link">Skip to training content</a>
    <main id="main-content" tabindex="-1" class="flex-1 pb-24 w-full max-w-3xl mx-auto">
      <slot />
    </main>

    <nav aria-label="Primary navigation" class="fixed bottom-0 left-0 right-0 safe-area-bottom bg-(--ui-bg) border-t border-(--ui-border) z-50">
      <ul role="list" class="flex items-center justify-around h-14">
        <li v-for="item in navItems" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="flex flex-col items-center justify-center gap-0.5 min-h-14 min-w-14 px-2 py-2 text-xs transition-colors"
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
