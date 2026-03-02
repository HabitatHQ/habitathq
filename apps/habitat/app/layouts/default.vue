<script setup lang="ts">
import type { AppTheme } from '~/composables/useAppSettings'

const route = useRoute()
const { $dbError } = useNuxtApp()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { settings, set: setAppSetting } = useAppSettings()
const colorMode = useColorMode()

const isDesktop = ref(false)

onMounted(() => {
  const mq = window.matchMedia('(min-width: 640px)')
  isDesktop.value = mq.matches
  mq.addEventListener('change', (e) => {
    isDesktop.value = e.matches
  })
})

function navLabel(item: { to: string; label: string }): string {
  if (item.to === '/matrix') return isDesktop.value ? 'Month' : 'Week'
  return item.label
}

const ALL_NAV_ITEMS = [
  { to: '/', icon: 'i-heroicons-home', label: 'Today', today: true },
  { to: '/matrix', icon: 'i-heroicons-calendar-days', label: 'Week', week: true },
  { to: '/habits', icon: 'i-heroicons-list-bullet', label: 'Habits' },
  { to: '/health', icon: 'i-heroicons-heart', label: 'Health', health: true },
  { to: '/todos', icon: 'i-heroicons-check-circle', label: 'TODOs', todos: true },
  { to: '/bored', icon: 'i-heroicons-face-smile', label: 'Bored', bored: true },
  { to: '/checkin', icon: 'i-heroicons-pencil-square', label: 'Check-in', journalling: true },
  { to: '/jots', icon: 'i-heroicons-document-text', label: 'Jots', journalling: true },
  { to: '/stats', icon: 'i-heroicons-chart-bar', label: 'Stats' },
]

const navItems = computed(() =>
  ALL_NAV_ITEMS.filter((i) => {
    if (i.today && !settings.value.enableToday) return false
    if (i.week && !settings.value.enableWeek) return false
    if (i.health && !settings.value.enableHealth) return false
    if (i.journalling && !settings.value.enableJournalling) return false
    if (i.todos && !settings.value.enableTodos) return false
    if (i.bored && !(settings.value.enableTodos && settings.value.enableBored)) return false
    return true
  }),
)

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

// ── Logo sprout animation ────────────────────────────────────────────────────

const logoSvgRef = ref<SVGElement | null>(null)
const logoAnimating = ref(false)
const logoQueued = ref(false)

function isMotionReduced(): boolean {
  if (!import.meta.client) return true
  if (settings.value.reduceMotion) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function startLogoAnim() {
  logoAnimating.value = false
  await nextTick()
  void logoSvgRef.value?.offsetWidth // force reflow so CSS animation restarts
  logoAnimating.value = true
}

function playLogoAnimation() {
  if (isMotionReduced()) return
  if (logoAnimating.value) {
    logoQueued.value = true
    return
  }
  startLogoAnim()
}

function onLogoAnimEnd(e: AnimationEvent) {
  // Only act when the last path (soil arc) finishes
  if (!(e.target as Element).classList.contains('sprout-soil')) return
  if (logoQueued.value) {
    logoQueued.value = false
    startLogoAnim()
  } else {
    logoAnimating.value = false
  }
}

onMounted(() => {
  nextTick(playLogoAnimation)
})

// ── Theme picker ─────────────────────────────────────────────────────────────

const THEMES: { id: AppTheme; name: string; swatch: string }[] = [
  { id: 'habitat', name: 'Habitat', swatch: '#22d3ee' },
  { id: 'forest', name: 'Forest', swatch: '#208a65' },
  { id: 'ocean', name: 'Ocean', swatch: '#6366f1' },
]

const showThemePicker = ref(false)

function setTheme(theme: AppTheme) {
  if (!import.meta.client) return
  document.documentElement.classList.add('theme-transitioning')
  setAppSetting('theme', theme)
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 250)
  showThemePicker.value = false
}

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg) text-(--ui-text) flex flex-col">
    <header
      class="border-b border-(--ui-border) px-4 pb-3 flex items-center justify-between"
      :style="{ paddingTop: settings.headerExtraPadding
        ? 'calc(1.25rem + env(safe-area-inset-top))'
        : 'calc(0.75rem + env(safe-area-inset-top))' }"
    >
      <div class="flex items-center gap-2">
        <!-- Plant sprout logo — stroke-dashoffset draw animation on tap/mount -->
        <svg
          ref="logoSvgRef"
          class="plant-logo w-6 h-[1.625rem]"
          :class="{ 'sprout-anim': logoAnimating }"
          viewBox="0 0 40 44"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Habitat"
          @click="playLogoAnimation"
          @animationend="onLogoAnimEnd"
        >
          <!-- Stem (draws 1st) -->
          <line class="sprout-stem" x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
          <!-- Left leaf (draws 2nd) -->
          <path class="sprout-leaf-l" d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          <!-- Right branch (draws 3rd) -->
          <path class="sprout-branch-r" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          <!-- Soil mound (draws last, 4th) -->
          <path class="sprout-soil" d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" pathLength="1" />
        </svg>
        <span class="text-lg font-semibold tracking-tight">Habitat</span>
      </div>
      <div class="flex items-center gap-1">
        <!-- Dark / light mode toggle -->
        <UButton
          :icon="colorMode.value === 'dark' ? 'i-heroicons-sun' : 'i-heroicons-moon'"
          variant="ghost"
          color="neutral"
          size="sm"
          :aria-label="colorMode.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleColorMode"
        />

        <!-- Theme picker -->
        <div class="relative">
          <UButton
            icon="i-heroicons-swatch"
            variant="ghost"
            color="neutral"
            size="sm"
            aria-label="Change theme"
            @click="showThemePicker = !showThemePicker"
          />
          <!-- Backdrop -->
          <div
            v-if="showThemePicker"
            class="fixed inset-0 z-40"
            @click="showThemePicker = false"
          />
          <!-- Swatch picker dropdown -->
          <div
            v-if="showThemePicker"
            class="absolute right-0 top-full mt-1 bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl p-2.5 flex gap-2 z-50 shadow-lg"
          >
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="w-7 h-7 rounded-full transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="settings.theme === t.id
                ? 'ring-2 ring-offset-2 ring-offset-(--ui-bg-muted) ring-primary-500 scale-110'
                : 'hover:scale-110 opacity-80 hover:opacity-100'"
              :style="{ background: t.swatch }"
              :title="t.name"
              :aria-label="`Switch to ${t.name} theme`"
              :aria-pressed="settings.theme === t.id"
              @click="setTheme(t.id)"
            />
          </div>
        </div>

        <UButton
          to="/settings"
          icon="i-heroicons-cog-6-tooth"
          variant="ghost"
          color="neutral"
          size="sm"
          :class="isActive('/settings') ? 'text-primary-400' : ''"
        />
      </div>
    </header>

    <UAlert
      v-if="opfsUnsupported"
      title="Browser not supported"
      description="Habitat requires the Origin Private File System (OPFS) API, which is not available in this browser. Please use a modern browser such as Chrome, Firefox, or Safari 17+."
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      class="rounded-none border-0 border-b border-red-900/50"
    />
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
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(5.5rem + env(safe-area-inset-bottom))'
            : 'calc(4.5rem + env(safe-area-inset-bottom))' }
        : {}"
    >
      <slot />
    </main>

    <nav
      class="border-t border-(--ui-border) py-1 flex justify-around overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      :class="settings.stickyNav ? 'fixed bottom-0 inset-x-0 z-30 bg-(--ui-bg)' : 'safe-area-bottom'"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(1.25rem + env(safe-area-inset-bottom))'
            : 'env(safe-area-inset-bottom)' }
        : undefined"
    >
      <UButton
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        :color="isActive(item.to) ? 'primary' : 'neutral'"
        variant="ghost"
        :ui="navItems.length > 5
          ? { base: 'flex-shrink-0 h-auto py-2.5 px-2.5' }
          : { base: 'flex-col gap-0.5 h-auto py-2 px-3 text-xs' }"
      >
        <span v-if="navItems.length <= 5">{{ navLabel(item) }}</span>
      </UButton>
    </nav>
  </div>
</template>
