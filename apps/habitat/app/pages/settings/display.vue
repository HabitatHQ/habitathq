<script setup lang="ts">
import type { AppTheme } from '~/composables/useAppSettings'
import { useDragReorder } from '~/composables/useTabReorder'

const colorMode = useColorMode()
const { settings: appSettings, set: setAppSetting } = useAppSettings()

const THEMES: { id: AppTheme; name: string; swatch: string }[] = [
  { id: 'habitat', name: 'Habitat', swatch: '#22d3ee' },
  { id: 'forest', name: 'Forest', swatch: '#208a65' },
  { id: 'ocean', name: 'Ocean', swatch: '#6366f1' },
]

function setTheme(theme: AppTheme) {
  if (!import.meta.client) return
  document.documentElement.classList.add('theme-transitioning')
  setAppSetting('theme', theme)
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 250)
}

// ── Tab order ───────────────────────────────────────────────────────────────

interface NavItem {
  to: string
  icon: string
  label: string
  today?: boolean
  health?: boolean
  journalling?: boolean
  todos?: boolean
  bored?: boolean
}

const ALL_NAV_ITEMS: NavItem[] = [
  { to: '/', icon: 'i-heroicons-home', label: 'Today', today: true },
  { to: '/habits', icon: 'i-heroicons-list-bullet', label: 'Habits' },
  { to: '/health', icon: 'i-heroicons-heart', label: 'Health', health: true },
  { to: '/todos', icon: 'i-heroicons-check-circle', label: 'TODOs', todos: true },
  { to: '/bored', icon: 'i-heroicons-face-smile', label: 'Bored', bored: true },
  { to: '/checkin', icon: 'i-heroicons-pencil-square', label: 'Check-in', journalling: true },
  { to: '/jots', icon: 'i-heroicons-document-text', label: 'Jots', journalling: true },
]

function isNavEnabled(item: NavItem): boolean {
  if (item.today && !appSettings.value.enableToday) return false
  if (item.health && !appSettings.value.enableHealth) return false
  if (item.journalling && !appSettings.value.enableJournalling) return false
  if (item.todos && !appSettings.value.enableTodos) return false
  if (item.bored && !(appSettings.value.enableTodos && appSettings.value.enableBored)) return false
  return true
}

const orderedNavItems = computed<NavItem[]>(() => {
  const order = appSettings.value.tabOrder
  const enabled = ALL_NAV_ITEMS.filter(isNavEnabled)
  if (!order.length) return enabled

  const sorted: NavItem[] = []
  for (const route of order) {
    const item = enabled.find((i) => i.to === route)
    if (item) sorted.push(item)
  }
  for (const item of enabled) {
    if (!sorted.includes(item)) sorted.push(item)
  }
  return sorted
})

const tabOrderContainerRef = ref<HTMLElement | null>(null)

const { onPointerDown } = useDragReorder(
  orderedNavItems,
  (newOrder) => {
    setAppSetting('tabOrder', newOrder.map((i) => i.to))
  },
  { orientation: 'vertical' },
)

const hasCustomOrder = computed(() => appSettings.value.tabOrder.length > 0)

function resetTabOrder() {
  setAppSetting('tabOrder', [])
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center gap-2 mb-4">
      <NuxtLink to="/settings" class="sm:hidden p-1 -ml-1 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </NuxtLink>
      <h2 class="text-xl font-bold">Display</h2>
    </header>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Appearance</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <!-- Theme swatches -->
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm font-medium">Theme</p>
          <div class="flex gap-2.5 items-center">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="w-8 h-8 rounded-full transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="appSettings.theme === t.id
                ? 'ring-2 ring-offset-2 ring-offset-(--ui-bg-muted) ring-primary-500 scale-110'
                : 'opacity-70 hover:opacity-100 hover:scale-105'"
              :style="{ background: t.swatch }"
              :title="t.name"
              :aria-label="`${t.name} theme`"
              :aria-pressed="appSettings.theme === t.id"
              @click="setTheme(t.id)"
            />
          </div>
        </div>

        <!-- Color mode toggle -->
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm font-medium">Color mode</p>
          <div class="flex bg-(--ui-bg-elevated) rounded-lg p-0.5 gap-0.5">
            <button
              class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              :class="colorMode.value !== 'dark' ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
              @click="colorMode.preference = 'light'"
            >Light</button>
            <button
              class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              :class="colorMode.value === 'dark' ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
              @click="colorMode.preference = 'dark'"
            >Dark</button>
          </div>
        </div>

        <!-- Reduce motion -->
        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Reduce motion</p>
            <p class="text-xs text-(--ui-text-dimmed)">Disables animations and transitions.</p>
          </div>
          <USwitch
            :model-value="appSettings.reduceMotion"
            @update:model-value="setAppSetting('reduceMotion', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">24-hour time</p>
            <p class="text-xs text-(--ui-text-dimmed)">Show times as 17:34 instead of 5:34 PM.</p>
          </div>
          <USwitch
            :model-value="appSettings.use24HourTime"
            @update:model-value="setAppSetting('use24HourTime', $event)"
          />
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Layout</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Sticky bottom bar</p>
            <p class="text-xs text-(--ui-text-dimmed)">Keep the nav bar fixed at the bottom when scrolling.</p>
          </div>
          <USwitch
            :model-value="appSettings.stickyNav"
            @update:model-value="setAppSetting('stickyNav', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Extra bottom padding</p>
            <p class="text-xs text-(--ui-text-dimmed)">Add space below the nav for Android gesture buttons.</p>
          </div>
          <USwitch
            :model-value="appSettings.navExtraPadding"
            @update:model-value="setAppSetting('navExtraPadding', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Extra top padding</p>
            <p class="text-xs text-(--ui-text-dimmed)">Add space above the header for the status bar.</p>
          </div>
          <USwitch
            :model-value="appSettings.headerExtraPadding"
            @update:model-value="setAppSetting('headerExtraPadding', $event)"
          />
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Navigation</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Today tab</p>
            <p class="text-xs text-(--ui-text-dimmed)">Show daily progress and log habits for today.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableToday"
            @update:model-value="setAppSetting('enableToday', $event)"
          />
        </div>

      </UCard>
    </section>

    <!-- Tab Order -->
    <section class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">Tab Order</p>
        <button
          v-if="hasCustomOrder"
          class="text-xs text-primary-400 hover:text-primary-300 transition-colors"
          @click="resetTabOrder"
        >
          Reset to default
        </button>
      </div>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0' }">
        <div ref="tabOrderContainerRef" class="divide-y divide-slate-800">
          <div
            v-for="(item, index) in orderedNavItems"
            :key="item.to"
            class="flex items-center gap-3 px-4 py-3 select-none"
          >
            <!-- Drag handle -->
            <button
              class="touch-none cursor-grab active:cursor-grabbing p-1 -ml-1 text-(--ui-text-dimmed) hover:text-(--ui-text-muted) transition-colors"
              aria-label="Drag to reorder"
              @pointerdown="(e: PointerEvent) => tabOrderContainerRef && onPointerDown(index, e, tabOrderContainerRef)"
            >
              <UIcon name="i-heroicons-bars-3" class="w-4 h-4" />
            </button>
            <!-- Tab icon + label -->
            <UIcon :name="item.icon" class="w-5 h-5 text-(--ui-text-muted)" />
            <span class="text-sm font-medium">{{ item.label }}</span>
          </div>
        </div>
      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Matrix view</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm text-(--ui-text-muted)">Days to show (mobile)</p>
          <div class="flex items-center gap-2">
            <button
              class="w-7 h-7 rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
              @click="setAppSetting('weekDays', Math.max(3, (appSettings.weekDays || 3) - 1))"
            >−</button>
            <span class="w-4 text-center text-sm font-medium tabular-nums">{{ appSettings.weekDays || 3 }}</span>
            <button
              class="w-7 h-7 rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border-accented) text-(--ui-text-toned) flex items-center justify-center text-sm"
              @click="setAppSetting('weekDays', Math.min(7, (appSettings.weekDays || 3) + 1))"
            >+</button>
          </div>
        </div>

        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm text-(--ui-text-muted)">Newest day first</p>
          <USwitch
            :model-value="appSettings.matrixReverseDays"
            @update:model-value="setAppSetting('matrixReverseDays', $event)"
          />
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Habits page</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show tags</p>
            <p class="text-xs text-(--ui-text-dimmed)">Display habit tags in the habits list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showTagsOnHabits"
            @update:model-value="setAppSetting('showTagsOnHabits', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show annotations</p>
            <p class="text-xs text-(--ui-text-dimmed)">Display key:value metadata in the habits list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showAnnotationsOnHabits"
            @update:model-value="setAppSetting('showAnnotationsOnHabits', $event)"
          />
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Today page</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show tags</p>
            <p class="text-xs text-(--ui-text-dimmed)">Display habit tags in today's list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showTagsOnToday"
            @update:model-value="setAppSetting('showTagsOnToday', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Show annotations</p>
            <p class="text-xs text-(--ui-text-dimmed)">Display key:value metadata in today's list.</p>
          </div>
          <USwitch
            :model-value="appSettings.showAnnotationsOnToday"
            @update:model-value="setAppSetting('showAnnotationsOnToday', $event)"
          />
        </div>

      </UCard>
    </section>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Log entries</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="px-4 py-3 pb-4 space-y-2">
          <p class="text-sm font-medium">Input mode</p>
          <p class="text-xs text-(--ui-text-dimmed) mb-2">How numeric values are applied when logging a habit.</p>
          <div class="flex gap-2">
            <button
              class="flex-1 py-2 px-3 rounded-xl text-xs font-medium border transition-colors"
              :class="appSettings.logInputMode === 'increment'
                ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                : 'bg-(--ui-bg-elevated) border-(--ui-border-accented) text-(--ui-text-muted)'"
              @click="setAppSetting('logInputMode', 'increment')"
            >
              Add to total
            </button>
            <button
              class="flex-1 py-2 px-3 rounded-xl text-xs font-medium border transition-colors"
              :class="appSettings.logInputMode === 'absolute'
                ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                : 'bg-(--ui-bg-elevated) border-(--ui-border-accented) text-(--ui-text-muted)'"
              @click="setAppSetting('logInputMode', 'absolute')"
            >
              Set total
            </button>
          </div>
        </div>

      </UCard>
    </section>
  </div>
</template>
