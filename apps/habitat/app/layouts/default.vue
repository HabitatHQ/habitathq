<script setup lang="ts">
const route = useRoute()
const { $dbError } = useNuxtApp()
const evictionDetected = useState('eviction-detected', () => false)
const { settings } = useAppSettings()

const ALL_NAV_ITEMS = [
  { to: '/',          icon: 'i-heroicons-home',           label: 'Today',    today: true },
  { to: '/week',      icon: 'i-heroicons-calendar-days',  label: 'Week',     week: true },
  { to: '/habits',    icon: 'i-heroicons-list-bullet',    label: 'Habits'   },
  { to: '/health',    icon: 'i-heroicons-heart',          label: 'Health',   health: true },
  { to: '/checkin',   icon: 'i-heroicons-pencil-square',  label: 'Check-in', journalling: true },
  { to: '/scribbles', icon: 'i-heroicons-pencil',         label: 'Scribbles', journalling: true },
  { to: '/voice',     icon: 'i-heroicons-microphone',     label: 'Voice',    journalling: true },
  { to: '/stats',     icon: 'i-heroicons-chart-bar',      label: 'Stats'    },
]

const navItems = computed(() =>
  ALL_NAV_ITEMS.filter(i => {
    if (i.today && !settings.value.enableToday) return false
    if (i.week && !settings.value.enableWeek) return false
    if (i.health && !settings.value.enableHealth) return false
    if (i.journalling && !settings.value.enableJournalling) return false
    return true
  }),
)

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <header class="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <!-- Plant sprout logo — fill-up animation runs once on page load -->
        <svg
          class="plant-logo w-6 h-[1.625rem]"
          viewBox="0 0 40 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <!-- Soil mound -->
          <path d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" />
          <!-- Stem -->
          <line x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
          <!-- Left leaf: leans down-left -->
          <path d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <!-- Right leaf: points upper-right -->
          <path d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="text-lg font-semibold tracking-tight">Habitat</span>
      </div>
      <div class="flex items-center gap-1">
        <UButton
          to="/settings"
          icon="i-heroicons-cog-6-tooth"
          variant="ghost"
          color="neutral"
          size="sm"
          :class="isActive('/settings') ? 'text-primary-400' : ''"
        />
        <UColorModeButton />
      </div>
    </header>

    <UAlert
      v-if="$dbError"
      :description="$dbError"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      class="rounded-none border-0 border-b border-red-900/50"
    />
    <UAlert
      v-if="evictionDetected"
      title="Storage may have been cleared"
      description="Your browser appears to have cleared on-device storage. If data is missing, use Export in Settings regularly to back up."
      color="warning"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      :close-button="{ icon: 'i-heroicons-x-mark', variant: 'ghost', color: 'neutral', size: 'sm' }"
      class="rounded-none border-0 border-b border-amber-900/50"
      @close="evictionDetected = false"
    />

    <main
      class="flex-1 p-4 pb-2"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding ? '80px' : '60px' }
        : {}"
    >
      <slot />
    </main>

    <nav
      class="border-t border-slate-800 px-1 py-1 flex justify-around"
      :class="[
        settings.stickyNav
          ? 'fixed bottom-0 inset-x-0 z-30 bg-slate-950'
          : 'safe-area-bottom',
        settings.navExtraPadding ? 'pb-5' : '',
      ]"
    >
      <UButton
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        :color="isActive(item.to) ? 'primary' : 'neutral'"
        variant="ghost"
        :ui="{ base: 'flex-col gap-0.5 h-auto py-2 px-3 text-xs' }"
      >
        {{ item.label }}
      </UButton>
    </nav>
  </div>
</template>
