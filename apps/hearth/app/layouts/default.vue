<script setup lang="ts">
import type { AppTheme } from '~/composables/useAppSettings'

const route = useRoute()
const { $dbError } = useNuxtApp()
const { settings, set: setAppSetting } = useAppSettings()
const colorMode = useColorMode()

// ── Navigation items ──────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'i-heroicons-home' },
  { to: '/transactions', label: 'Transactions', icon: 'i-heroicons-list-bullet' },
  { to: '/envelopes', label: 'Envelopes', icon: 'i-heroicons-archive-box' },
  { to: '/reports', label: 'Reports', icon: 'i-heroicons-chart-bar' },
  { to: '/chores', label: 'Chores', icon: 'i-heroicons-check-circle' },
] as const

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

// ── Logo flame animation ───────────────────────────────────────────────────

const logoRef = ref<SVGElement | null>(null)
const logoAnimating = ref(false)

function isMotionReduced() {
  if (!import.meta.client) return true
  if (settings.value.reduceMotion) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function playFlameAnim() {
  if (isMotionReduced() || logoAnimating.value) return
  logoAnimating.value = true
  await new Promise<void>((r) => setTimeout(r, 1200))
  logoAnimating.value = false
}

onMounted(() => {
  nextTick(playFlameAnim)
})

// ── Theme / color mode ────────────────────────────────────────────────────

const THEMES: { id: AppTheme; name: string; swatch: string }[] = [
  { id: 'hearth', name: 'Hearth', swatch: '#f59e0b' },
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

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header
      class="border-b border-(--ui-border) px-4 pb-3 flex items-center gap-2"
      :style="{
        paddingTop: settings.headerExtraPadding
          ? 'calc(1.25rem + env(safe-area-inset-top))'
          : 'calc(0.75rem + env(safe-area-inset-top))'
      }"
    >
      <!-- Logo + wordmark -->
      <div class="flex items-center gap-2 shrink-0">
        <svg
          ref="logoRef"
          class="hearth-logo w-6 h-7"
          :class="{ 'flame-anim': logoAnimating }"
          viewBox="0 0 40 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Hearth"
          @click="playFlameAnim"
        >
          <!-- Flame shape -->
          <path
            d="M20 4 C20 4 32 14 32 26 C32 33.2 26.6 39 20 39 C13.4 39 8 33.2 8 26 C8 14 20 4 20 4Z"
            stroke="currentColor"
            stroke-width="2.5"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <!-- Inner flame -->
          <path
            d="M20 16 C20 16 26 22 26 28 C26 31.3 23.3 34 20 34 C16.7 34 14 31.3 14 28 C14 22 20 16 20 16Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
          />
          <!-- Base / hearth -->
          <path
            d="M10 43 C14 40 26 40 30 43"
            stroke="currentColor"
            stroke-width="3"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
        <span class="text-lg font-semibold tracking-tight">Hearth</span>
      </div>

      <!-- Right actions -->
      <div class="flex items-center gap-1 ml-auto shrink-0">

        <!-- Dark / light toggle -->
        <UButton
          :icon="colorMode.value === 'dark' ? 'i-heroicons-sun' : 'i-heroicons-moon'"
          variant="ghost"
          color="neutral"
          size="sm"
          class="min-h-[44px] min-w-[44px]"
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
            class="min-h-[44px] min-w-[44px]"
            aria-label="Change theme"
            @click="showThemePicker = !showThemePicker"
          />
          <div v-if="showThemePicker" class="fixed inset-0 z-40" role="button" aria-label="Close theme picker" tabindex="-1" @click="showThemePicker = false" />
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

        <!-- Avatar / settings menu -->
        <div class="relative">
          <button
            class="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 border-2 min-h-[44px] min-w-[44px]"
            :class="showAvatarMenu || isActive('/settings')
              ? 'border-primary-500 bg-primary-500/15 text-primary-400'
              : 'border-(--ui-border-accented) text-(--ui-text-muted) hover:border-(--ui-border-accented) hover:text-(--ui-text)'"
            aria-label="Account menu"
            @click="showAvatarMenu = !showAvatarMenu"
          >
            <UIcon name="i-heroicons-user-circle" class="w-5 h-5" />
          </button>
          <div v-if="showAvatarMenu" class="fixed inset-0 z-40" role="button" aria-label="Close menu" tabindex="-1" @click="showAvatarMenu = false" />
          <ul
            v-if="showAvatarMenu"
            class="absolute right-0 top-full mt-1 w-44 bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl p-1.5 z-50 shadow-lg space-y-0.5"
          >
            <li>
              <NuxtLink
                to="/household"
                class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                :class="isActive('/household')
                  ? 'bg-primary-500/10 text-primary-400'
                  : 'text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
                @click="showAvatarMenu = false"
              >
                <UIcon name="i-heroicons-user-group" class="w-4 h-4" />
                Household
              </NuxtLink>
            </li>
            <li>
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
            </li>
          </ul>
        </div>
      </div>
    </header>

    <!-- ── DB error banner ─────────────────────────────────────────────────── -->
    <UAlert
      v-if="$dbError"
      :description="$dbError"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      class="rounded-none border-0 border-b border-red-900/50"
    />

    <!-- ── Main content ────────────────────────────────────────────────────── -->
    <main
      class="flex-1 overflow-y-auto"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(5.5rem + env(safe-area-inset-bottom))'
            : 'calc(4.5rem + env(safe-area-inset-bottom))' }
        : {}"
    >
      <slot />
    </main>

    <!-- ── Bottom navigation ───────────────────────────────────────────────── -->
    <nav
      class="border-t border-(--ui-border) py-1 flex justify-around"
      :class="settings.stickyNav ? 'fixed bottom-0 inset-x-0 z-30 bg-(--ui-bg)' : 'safe-area-bottom'"
      :style="settings.stickyNav
        ? { paddingBottom: settings.navExtraPadding
            ? 'calc(1.25rem + env(safe-area-inset-bottom))'
            : 'env(safe-area-inset-bottom)' }
        : undefined"
      aria-label="Main navigation"
    >
      <UButton
        v-for="item in NAV_ITEMS"
        :key="item.to"
        :to="item.to"
        :icon="item.icon"
        :color="isActive(item.to) ? 'primary' : 'neutral'"
        variant="ghost"
        :ui="{ base: 'flex-col gap-0.5 h-auto py-2 px-3 text-xs min-h-[44px]' }"
        :aria-label="item.label"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <span>{{ item.label }}</span>
      </UButton>
    </nav>

  </div>
</template>
