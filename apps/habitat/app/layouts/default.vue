<script setup lang="ts">
import type { AppTheme } from '~/composables/useAppSettings'
import { useDragReorder } from '~/composables/useTabReorder'
import { buildPomodoroConfig } from '~/composables/useTimer'
import type { SearchResult } from '~/types/database'

const route = useRoute()
const { $dbError } = useNuxtApp()
const evictionDetected = useState('eviction-detected', () => false)
const opfsUnsupported = useState('opfs-unsupported', () => false)
const { settings, set: setAppSetting } = useAppSettings()
const colorMode = useColorMode()
const db = useDatabase()

// ── Timer interval ────────────────────────────────────────────────────────────

const timerComp = reactive(useTimer())
const { impact, selectionChanged } = useHaptics()

const showQuickFocusPicker = ref(false)
const quickFocusMinutes = ref(25)

function startQuickFocus(mode: 'stopwatch' | 'countdown' | 'pomodoro') {
  showQuickFocusPicker.value = false
  const secs = mode === 'countdown' ? quickFocusMinutes.value * 60 : 0
  timerComp.startTimer(
    'quick',
    'todo',
    'Quick Focus',
    mode,
    secs,
    buildPomodoroConfig(settings.value),
  )
  navigateTo('/focus')
}

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
  void impact('light')
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
    if (!timerComp.isActive) return
    const { overtime, phaseTransition } = timerComp.onTick()
    if (overtime) void impact('heavy')
    if (phaseTransition) void impact('medium')
  }, 1000)
})

function navLabel(item: { to: string; label: string }): string {
  return item.label
}

const enabledNavItems = computed(() =>
  ALL_NAV_ITEMS.filter((i) => {
    if (i.today && !settings.value.enableToday) return false
    if (i.health && !settings.value.enableHealth) return false
    if (i.journalling && !settings.value.enableJournalling) return false
    if (i.todos && !settings.value.enableTodos) return false
    if (i.bored && !(settings.value.enableTodos && settings.value.enableBored)) return false
    return true
  }),
)

const navItems = computed(() => {
  const order = settings.value.tabOrder
  const enabled = enabledNavItems.value
  if (!order.length) return enabled

  const sorted: typeof enabled = []
  for (const route of order) {
    const item = enabled.find((i) => i.to === route)
    if (item) sorted.push(item)
  }
  // Append newly-enabled items not yet in saved order
  for (const item of enabled) {
    if (!sorted.includes(item)) sorted.push(item)
  }
  return sorted
})

// ── Bottom nav long-press reorder mode ───────────────────────────────────────

const navReorderMode = ref(false)
const navContainerRef = ref<HTMLElement | null>(null)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
const LONG_PRESS_MS = 500

const { onPointerDown: navDragPointerDown } = useDragReorder(
  navItems,
  (newOrder) => {
    setAppSetting(
      'tabOrder',
      newOrder.map((i) => i.to),
    )
  },
  { orientation: 'horizontal' },
)

async function startDragFromLongPress(index: number, e: PointerEvent) {
  navReorderMode.value = true
  void impact('medium')
  // Wait for Vue to apply DOM changes before capturing element references
  await nextTick()
  if (navContainerRef.value) {
    navDragPointerDown(index, e, navContainerRef.value)
  }
}

function onNavPointerDown(index: number, e: PointerEvent) {
  // In reorder mode, immediately start dragging (prevent link navigation)
  if (navReorderMode.value && navContainerRef.value) {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    navDragPointerDown(index, e, navContainerRef.value)
    return
  }

  // Normal mode: start long-press detection
  const startX = e.clientX
  const startY = e.clientY
  const moveThreshold = 10

  function detectMove(me: PointerEvent) {
    if (
      Math.abs(me.clientX - startX) > moveThreshold ||
      Math.abs(me.clientY - startY) > moveThreshold
    ) {
      cancelLongPress()
    }
  }
  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    document.removeEventListener('pointermove', detectMove)
    document.removeEventListener('pointerup', cancelLongPress)
    document.removeEventListener('pointercancel', cancelLongPress)
  }

  document.addEventListener('pointermove', detectMove)
  document.addEventListener('pointerup', cancelLongPress)
  document.addEventListener('pointercancel', cancelLongPress)

  longPressTimer = setTimeout(() => {
    cancelLongPress()
    // Start drag immediately on the long-pressed tab
    startDragFromLongPress(index, e)
  }, LONG_PRESS_MS)
}

function exitNavReorderMode() {
  navReorderMode.value = false
}

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
  void logoSvgRef.value?.getBoundingClientRect() // force reflow so CSS animation restarts
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

// ── Global search ────────────────────────────────────────────────────────────

const showSearch = ref(false)
const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
const searchLoading = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

watch(searchQuery, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  if (!q.trim()) {
    searchResults.value = []
    return
  }
  searchDebounce = setTimeout(async () => {
    searchLoading.value = true
    try {
      searchResults.value = await db.searchGlobal(q.trim())
    } finally {
      searchLoading.value = false
    }
  }, 200)
})

function openSearch() {
  searchQuery.value = ''
  searchResults.value = []
  showSearch.value = true
  void impact('light')
}

function searchResultRoute(r: SearchResult): string {
  if (r.kind === 'habit') return `/habits/${r.id}`
  if (r.kind === 'todo') return '/todos'
  if (r.kind === 'scribble') return '/jots'
  if (r.kind === 'checkin') return `/checkin/${r.id}`
  return '/'
}

function closeSearch() {
  showSearch.value = false
  searchQuery.value = ''
  searchResults.value = []
}

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
  void impact('light')
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
        <AppIcon v-else name="tag" class="w-4 h-4 text-(--ui-text-muted)" aria-hidden="true" />
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
          @click="toggleContext(tag); selectionChanged()"
        >
          {{ tag }}
        </button>
        <!-- Clear all active filters without collapsing the strip -->
        <button
          v-if="anyActive"
          class="shrink-0 text-xs px-2 py-1 rounded-full border border-primary-500/40 text-primary-400 hover:bg-primary-500/10 transition-colors ml-1"
          aria-label="Clear context filter"
          @click="clearAll"
        >
          Clear
        </button>
      </div>

      <!-- Right: action buttons -->
      <div class="flex items-center gap-1 ml-auto shrink-0">
        <!-- Active timer chip -->
        <NuxtLink
          v-if="settings.enableTimer && timerComp.isActive"
          to="/focus"
          class="flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-colors overflow-hidden"
          :class="timerComp.isRunning
            ? 'border-primary-500/40 text-primary-400 bg-primary-500/10'
            : 'border-(--ui-border) text-(--ui-text-muted)'"
          aria-label="Timer running. Go to Focus mode"
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
          <span class="type-duration">{{ timerComp.displayTime }}</span>
        </NuxtLink>

        <!-- Quick Focus (if not active, or even if active to change?) we only show if not active? Actually it's an option 'where we added global search for quick focus modes' -->
        <div v-if="settings.enableTimer && !timerComp.isActive" class="relative">
          <UButton
            :icon="resolveIcon('clock')"
            variant="ghost"
            color="neutral"
            size="sm"
            class="min-h-[44px]"
            aria-label="Quick Focus"
            @click="showQuickFocusPicker = !showQuickFocusPicker; impact('light')"
          />
          <!-- Backdrop -->
          <div v-if="showQuickFocusPicker" class="fixed inset-0 z-40" @click="showQuickFocusPicker = false" />
          <!-- Dropdown -->
          <div
            v-if="showQuickFocusPicker"
            class="absolute right-0 top-full mt-1 bg-(--ui-bg) border border-(--ui-border) rounded-xl shadow-xl p-1 z-50 min-w-44 space-y-0.5"
          >
            <button
              class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2 text-(--ui-text)"
              @click="startQuickFocus('stopwatch')"
            >
              <AppIcon name="play" class="w-4 h-4" /> Stopwatch
            </button>
            <div class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) text-(--ui-text)">
              <AppIcon name="clock" class="w-4 h-4 shrink-0" />
              <div class="flex items-center gap-1">
                <button
                  aria-label="Decrease Quick Focus duration by 5 minutes"
                  class="min-w-[44px] min-h-[44px] rounded-md bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) transition-colors press-strong"
                  :class="{ 'opacity-30': quickFocusMinutes <= 5 }"
                  :disabled="quickFocusMinutes <= 5"
                  @click="quickFocusMinutes = Math.max(5, quickFocusMinutes - 5)"
                >
                  <AppIcon name="minus" class="w-3 h-3" />
                </button>
                <span class="w-10 text-center font-semibold type-numeric">{{ quickFocusMinutes }}</span>
                <button
                  aria-label="Increase Quick Focus duration by 5 minutes"
                  class="min-w-[44px] min-h-[44px] rounded-md bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) transition-colors press-strong"
                  :class="{ 'opacity-30': quickFocusMinutes >= 120 }"
                  :disabled="quickFocusMinutes >= 120"
                  @click="quickFocusMinutes = Math.min(120, quickFocusMinutes + 5)"
                >
                  <AppIcon name="plus" class="w-3 h-3" />
                </button>
              </div>
              <span class="text-(--ui-text-muted) text-xs">min</span>
              <button class="ml-auto text-primary-400 text-xs font-medium" @click="startQuickFocus('countdown')">Start</button>
            </div>
            <button
              class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2 text-(--ui-text)"
              @click="startQuickFocus('pomodoro')"
            >
              🍅 Pomodoro
            </button>
          </div>
        </div>

        <!-- Global search -->
        <UButton
          :icon="resolveIcon('magnifying-glass')"
          variant="ghost"
          color="neutral"
          size="sm"
          class="min-h-[44px]"
          aria-label="Search"
          @click="openSearch"
        />

        <!-- Context filter toggle (only when feature on and tags exist) -->
        <UButton
          v-if="settings.enableContextFilter && contextTags.length > 0"
          :icon="resolveIcon(showFilterStrip ? 'x-mark' : 'tag')"
          variant="ghost"
          color="neutral"
          size="sm"
          class="min-h-[44px]"
          :class="anyActive ? 'text-primary-400' : ''"
          :aria-label="showFilterStrip ? 'Close context filter' : 'Filter by context tag'"
          @click="toggleFilterStrip"
        />

        <!-- Dark / light mode toggle -->
        <UButton
          :icon="resolveIcon(colorMode.value === 'dark' ? 'sun' : 'moon')"
          variant="ghost"
          color="neutral"
          size="sm"
          class="min-h-[44px]"
          :aria-label="colorMode.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleColorMode"
        />

        <!-- Theme picker -->
        <div class="relative">
          <UButton
            :icon="resolveIcon('swatch')"
            variant="ghost"
            color="neutral"
            size="sm"
            class="min-h-[44px]"
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
              @click="setTheme(t.id); selectionChanged()"
            />
          </div>
        </div>

        <!-- Avatar menu -->
        <div class="relative">
          <button
            class="min-w-[44px] min-h-[44px] flex items-center justify-center transition-all duration-200"
            aria-label="Profile menu"
            @click="showAvatarMenu = !showAvatarMenu; impact('light')"
          >
            <span
              class="w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-200"
              :class="showAvatarMenu || isActive('/settings') || isActive('/insights') || isActive('/matrix')
                ? 'border-primary-500 bg-primary-500/15 text-primary-400'
                : 'border-(--ui-border-accented) text-(--ui-text-muted) hover:border-(--ui-border-accented) hover:text-(--ui-text)'"
            >
              <AppIcon name="user-circle" class="w-5 h-5" />
            </span>
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
              <AppIcon name="calendar-days" class="w-4 h-4" />
              Matrix
            </NuxtLink>
            <NuxtLink
              to="/insights"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="isActive('/insights')
                ? 'bg-primary-500/10 text-primary-400'
                : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
              @click="showAvatarMenu = false"
            >
              <AppIcon name="chart-bar" class="w-4 h-4" />
              Insights
            </NuxtLink>
            <NuxtLink
              to="/settings"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="isActive('/settings')
                ? 'bg-primary-500/10 text-primary-400'
                : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
              @click="showAvatarMenu = false"
            >
              <AppIcon name="cog-6-tooth" class="w-4 h-4" />
              Settings
            </NuxtLink>
          </div>
        </div>
      </div>
    </header>

    <!-- Global search modal -->
    <div
      v-if="showSearch"
      class="fixed inset-0 z-50 flex items-start justify-center pt-[10dvh]"
    >
      <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeSearch" />
      <div class="relative w-full max-w-md mx-4 bg-(--ui-bg-muted) border border-(--ui-border) rounded-2xl overflow-hidden shadow-2xl">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-(--ui-border)">
          <AppIcon name="magnifying-glass" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
          <!-- eslint-disable-next-line vuejs-accessibility/no-autofocus -->
          <input
            v-model="searchQuery"
            autofocus
            placeholder="Search habits, todos, jots, check-ins…"
            class="flex-1 bg-transparent text-sm text-(--ui-text) placeholder:text-(--ui-text-dimmed) outline-none"
            @keydown.escape="closeSearch"
          />
          <AppIcon v-if="searchLoading" name="arrow-path" class="w-4 h-4 animate-spin text-(--ui-text-dimmed) shrink-0" />
        </div>
        <ul v-if="searchResults.length" class="max-h-[60dvh] overflow-y-auto overscroll-contain divide-y divide-(--ui-border)/40">
          <li v-for="r in searchResults" :key="`${r.kind}-${r.id}`">
            <NuxtLink
              :to="searchResultRoute(r)"
              class="flex items-center gap-3 px-4 py-2.5 hover:bg-(--ui-bg-elevated) transition-colors"
              @click="closeSearch"
            >
              <AppIcon
                :name="r.kind === 'habit' ? (r.icon || 'star') : r.kind === 'todo' ? 'check-circle' : r.kind === 'scribble' ? 'document-text' : 'pencil-square'"
                class="w-4 h-4 shrink-0"
                :class="r.kind === 'habit' ? 'text-primary-400' : 'text-(--ui-text-dimmed)'"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm text-(--ui-text) truncate">{{ r.kind === 'habit' ? r.name : r.kind === 'todo' ? r.title : r.kind === 'scribble' ? (r.title || 'Untitled') : r.title }}</p>
                <p v-if="r.kind === 'scribble' && r.preview" class="text-xs text-(--ui-text-dimmed) truncate">{{ r.preview }}</p>
              </div>
              <span class="text-xs text-(--ui-text-dimmed) shrink-0 capitalize">{{ r.kind }}</span>
            </NuxtLink>
          </li>
        </ul>
        <div v-else-if="searchQuery.trim() && !searchLoading" class="px-4 py-8 text-center text-sm text-(--ui-text-dimmed)">
          No results for "{{ searchQuery }}"
        </div>
        <div v-else-if="!searchQuery.trim()" class="px-4 py-4 text-xs text-(--ui-text-dimmed) text-center">
          Type to search across all content
        </div>
      </div>
    </div>

    <UAlert
      v-if="opfsUnsupported"
      title="Browser not supported"
      description="Habitat requires the Origin Private File System (OPFS) API, which is not available in this browser. Please use a modern browser such as Chrome, Firefox, or Safari 17+."
      color="error"
      variant="soft"
      :icon="resolveIcon('exclamation-triangle')"
      class="rounded-none border-0 border-b border-red-900/50"
    />
    <UAlert
      v-if="$dbError"
      :description="$dbError"
      color="error"
      variant="soft"
      :icon="resolveIcon('exclamation-triangle')"
      class="rounded-none border-0 border-b border-red-900/50"
    />
    <UAlert
      v-if="evictionDetected"
      title="Storage may have been cleared"
      description="Your browser appears to have cleared on-device storage. If data is missing, use Export in Settings regularly to back up."
      color="warning"
      variant="soft"
      :icon="resolveIcon('exclamation-triangle')"
      :close-button="{ icon: resolveIcon('x-mark'), variant: 'ghost', color: 'neutral', size: 'sm' }"
      class="rounded-none border-0 border-b border-amber-900/50"
      @close="evictionDetected = false"
    />

    <main
      class="flex-1 p-4 pb-2"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(5.5rem + env(safe-area-inset-bottom))'
            : 'calc(4.5rem + env(safe-area-inset-bottom))',
            scrollPaddingBottom: settings.navExtraPadding
            ? 'calc(5.5rem + env(safe-area-inset-bottom))'
            : 'calc(4.5rem + env(safe-area-inset-bottom))' }
        : {}"
    >
      <slot />
    </main>

    <!-- Reorder mode backdrop -->
    <Transition name="swap">
      <div
        v-if="navReorderMode"
        class="fixed inset-0 z-20 bg-black/20 dark:bg-black/60 backdrop-blur-[2px]"
        @pointerdown="exitNavReorderMode"
      />
    </Transition>

    <!-- Reorder mode banner -->
    <Transition name="sheet-slide">
      <div
        v-if="navReorderMode"
        class="fixed z-40 inset-x-0 flex items-center justify-between px-4 py-2 bg-(--ui-bg-elevated) border-t border-(--ui-border)"
        :style="settings.stickyNav
          ? { bottom: settings.navExtraPadding
              ? 'calc(4.25rem + env(safe-area-inset-bottom))'
              : 'calc(3.25rem + env(safe-area-inset-bottom))' }
          : undefined"
      >
        <span class="text-xs text-(--ui-text-muted) flex items-center gap-1.5">
          <AppIcon name="arrows-right-left" class="w-4 h-4" />
          Drag to reorder tabs
        </span>
        <button
          class="text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors px-2 py-1 rounded-lg hover:bg-primary-500/10"
          @click="exitNavReorderMode"
        >
          Done
        </button>
      </div>
    </Transition>

    <nav
      ref="navContainerRef"
      class="border-t border-(--ui-border) py-1 flex justify-around overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] transition-shadow duration-300"
      :class="[
        settings.stickyNav ? 'fixed bottom-0 inset-x-0 z-30 bg-(--ui-bg)' : 'safe-area-bottom z-30',
        navReorderMode ? 'nav-wiggle shadow-[0_-10px_40px_rgba(0,0,0,0.6)]' : '',
      ]"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(1.25rem + env(safe-area-inset-bottom))'
            : 'env(safe-area-inset-bottom)' }
        : undefined"
    >
      <UButton
        v-for="(item, index) in navItems"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        :color="isActive(item.to) ? 'primary' : 'neutral'"
        variant="ghost"
        :ui="navItems.length > 5
          ? { base: 'flex-shrink-0 h-auto py-2.5 px-2.5 touch-none select-none' }
          : { base: 'flex-col gap-0.5 h-auto py-2 px-3 text-xs touch-none select-none' }"
        @pointerdown="(e: PointerEvent) => onNavPointerDown(index, e)"
        @click.capture="navReorderMode ? $event.preventDefault() : impact('light')"
      >
        <span v-if="navItems.length <= 5">{{ navLabel(item) }}</span>
      </UButton>
    </nav>
  </div>
</template>
