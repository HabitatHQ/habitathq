<script setup lang="ts">
import type { AppTheme } from '~/composables/useAppSettings'

const route = useRoute()
const { $dbError } = useNuxtApp()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { settings, set: setAppSetting } = useAppSettings()
const colorMode = useColorMode()
const db = useDatabase()

// ── Timer interval ────────────────────────────────────────────────────────────

const timerComp = reactive(useTimer())
const { impact } = useHaptics()

let timerInterval: ReturnType<typeof setInterval> | null = null
let labelTimeout: ReturnType<typeof setTimeout> | null = null
const showTimerLabel = ref(false)

watch(
  () => timerComp.timer,
  (newTimer) => {
    if (labelTimeout) {
      clearTimeout(labelTimeout)
      labelTimeout = null
    }
    if (newTimer) {
      showTimerLabel.value = true
      labelTimeout = setTimeout(() => {
        showTimerLabel.value = false
      }, 3000)
    } else {
      showTimerLabel.value = false
    }
  },
)

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (labelTimeout) clearTimeout(labelTimeout)
})

// ── Context filter ────────────────────────────────────────────────────────────

const {
  contextTags,
  anyActive,
  toggleContext,
  clearAll,
  isActive: isTagActive,
  loadContextTags,
} = useContextFilter()
const showFilterStrip = ref(false)
const filterStripVisible = computed(
  () => settings.value.enableContextFilter && contextTags.value.length > 0 && showFilterStrip.value,
)

function toggleFilterStrip() {
  showFilterStrip.value = !showFilterStrip.value
  if (!showFilterStrip.value) clearAll()
}

// Keep strip shown while a context is active
watch(anyActive, (val) => {
  if (val) showFilterStrip.value = true
})

// Load cross-type tags once per session
watch(
  () => settings.value.enableContextFilter,
  (val) => {
    if (val) void loadContextTags(db)
  },
)

const isDesktop = ref(false)

onMounted(() => {
  const mq = window.matchMedia('(min-width: 640px)')
  isDesktop.value = mq.matches
  mq.addEventListener('change', (e) => {
    isDesktop.value = e.matches
  })
  if (settings.value.enableContextFilter) void loadContextTags(db)

  timerInterval = setInterval(() => {
    const { overtime, phaseTransition } = timerComp.onTick()
    if (overtime) void impact('heavy')
    if (phaseTransition) void impact('medium')
  }, 1000)
})

function navLabel(item: { to: string; label: string }): string {
  if (item.to === '/matrix') return isDesktop.value ? 'Month' : 'Week'
  return item.label
}

const ALL_NAV_ITEMS = [
  { to: '/', icon: 'i-heroicons-home', label: 'Today', today: true },
  { to: '/habits', icon: 'i-heroicons-list-bullet', label: 'Habits' },
  { to: '/health', icon: 'i-heroicons-heart', label: 'Health', health: true },
  { to: '/todos', icon: 'i-heroicons-check-circle', label: 'TODOs', todos: true },
  { to: '/bored', icon: 'i-heroicons-face-smile', label: 'Bored', bored: true },
  { to: '/checkin', icon: 'i-heroicons-pencil-square', label: 'Check-in', journalling: true },
  { to: '/jots', icon: 'i-heroicons-document-text', label: 'Jots', journalling: true },
]

const navItems = computed(() =>
  ALL_NAV_ITEMS.filter((i) => {
    if (i.today && !settings.value.enableToday) return false

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
const showAvatarMenu = ref(false)

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
      class="border-b border-(--ui-border) px-4 pb-3 flex items-center gap-2"
      :style="{ paddingTop: settings.headerExtraPadding
        ? 'calc(1.25rem + env(safe-area-inset-top))'
        : 'calc(0.75rem + env(safe-area-inset-top))' }"
    >
      <!-- Left: logo + title (or tag icon when filter strip is open) -->
      <div class="flex items-center gap-2 shrink-0">
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
        <span v-if="!filterStripVisible" class="text-lg font-semibold tracking-tight">Habitat</span>
        <UIcon v-else name="i-heroicons-tag" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
      </div>

      <!-- Middle: context filter chip strip (flex-1, only when strip open) -->
      <div
        v-if="filterStripVisible"
        role="group"
        aria-label="Context filter"
        class="flex-1 flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        <button
          v-for="tag in contextTags"
          :key="tag"
          class="shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors"
          :class="isTagActive(tag)
            ? 'bg-primary-500/15 border-primary-500 text-primary-400'
            : 'border-(--ui-border) text-(--ui-text-muted) hover:border-(--ui-border-muted) hover:text-(--ui-text)'"
          :aria-pressed="isTagActive(tag)"
          @click="toggleContext(tag)"
        >
          {{ tag }}
        </button>
      </div>

      <!-- Right: action buttons -->
      <div class="flex items-center gap-1 ml-auto shrink-0">
        <!-- Active timer chip -->
        <NuxtLink
          v-if="settings.enableTimer && timerComp.isActive"
          :to="timerComp.timer?.itemType === 'todo' ? '/todos' : '/bored'"
          class="flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-colors overflow-hidden"
          :class="timerComp.isRunning
            ? 'border-primary-500/40 text-primary-400 bg-primary-500/10'
            : 'border-(--ui-border) text-(--ui-text-muted)'"
          :aria-label="`Timer: ${timerComp.displayTime}. Go to ${timerComp.timer?.itemType}`"
        >
          <span :class="{ 'animate-pulse': timerComp.isRunning }" aria-hidden="true">⏱</span>
          <Transition
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 max-w-0"
            enter-to-class="opacity-100 max-w-[7rem]"
            leave-active-class="transition-all duration-300 ease-in"
            leave-from-class="opacity-100 max-w-[7rem]"
            leave-to-class="opacity-0 max-w-0"
          >
            <span
              v-if="showTimerLabel"
              class="font-sans truncate whitespace-nowrap"
              style="max-width: 7rem"
            >{{ timerComp.timer?.itemTitle }}</span>
          </Transition>
          <span class="font-mono">{{ timerComp.displayTime }}</span>
        </NuxtLink>

        <!-- Context filter toggle (only when feature on and tags exist) -->
        <UButton
          v-if="settings.enableContextFilter && contextTags.length > 0"
          :icon="showFilterStrip ? 'i-heroicons-x-mark' : 'i-heroicons-tag'"
          variant="ghost"
          color="neutral"
          size="sm"
          :class="anyActive ? 'text-primary-400' : ''"
          :aria-label="showFilterStrip ? 'Close context filter' : 'Filter by context tag'"
          @click="toggleFilterStrip"
        />

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

        <!-- Avatar menu -->
        <div class="relative">
          <button
            class="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 border-2"
            :class="showAvatarMenu || isActive('/settings') || isActive('/stats') || isActive('/matrix')
              ? 'border-primary-500 bg-primary-500/15 text-primary-400'
              : 'border-(--ui-border-accented) text-(--ui-text-muted) hover:border-(--ui-border-accented) hover:text-(--ui-text)'"
            aria-label="Profile menu"
            @click="showAvatarMenu = !showAvatarMenu"
          >
            <UIcon name="i-heroicons-user-circle" class="w-5 h-5" />
          </button>
          <!-- Backdrop -->
          <div
            v-if="showAvatarMenu"
            class="fixed inset-0 z-40"
            @click="showAvatarMenu = false"
          />
          <!-- Dropdown -->
          <div
            v-if="showAvatarMenu"
            class="absolute right-0 top-full mt-1 w-44 bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl p-1.5 z-50 shadow-lg space-y-0.5"
          >
            <NuxtLink
              to="/matrix"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="isActive('/matrix')
                ? 'bg-primary-500/10 text-primary-400'
                : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
              @click="showAvatarMenu = false"
            >
              <UIcon name="i-heroicons-calendar-days" class="w-4 h-4" />
              Matrix
            </NuxtLink>
            <NuxtLink
              to="/stats"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="isActive('/stats')
                ? 'bg-primary-500/10 text-primary-400'
                : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
              @click="showAvatarMenu = false"
            >
              <UIcon name="i-heroicons-chart-bar" class="w-4 h-4" />
              Stats
            </NuxtLink>
            <NuxtLink
              to="/settings"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="isActive('/settings')
                ? 'bg-primary-500/10 text-primary-400'
                : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
              @click="showAvatarMenu = false"
            >
              <UIcon name="i-heroicons-cog-6-tooth" class="w-4 h-4" />
              Settings
            </NuxtLink>
          </div>
        </div>
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
