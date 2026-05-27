<script setup lang="ts">
import type { AppProfile, AppTheme } from '~/composables/useAppSettings'

definePageMeta({ layout: false })

const { set: setAppSetting, settings, patch: patchSettings } = useAppSettings()
const { impact } = useHaptics()

const step = ref<1 | 2 | 3>(1)
const selectedTheme = ref<AppTheme>(settings.value.theme ?? 'habitat')

const selectedProfile = ref<AppProfile>('mindful')

const THEMES: { id: AppTheme; name: string; swatch: string }[] = [
  { id: 'habitat', name: 'Habitat', swatch: '#22d3ee' },
  { id: 'forest', name: 'Forest', swatch: '#208a65' },
  { id: 'ocean', name: 'Ocean', swatch: '#6366f1' },
]

const PROFILES: { id: AppProfile; name: string; description: string; icon: string }[] = [
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'A pure, distraction-free habit tracker.',
    icon: resolveIcon('sparkles'),
  },
  {
    id: 'journaler',
    name: 'Journaler',
    description: 'Focus on reflection, daily check-ins, and mental wellness.',
    icon: resolveIcon('book-open'),
  },
  {
    id: 'productivity',
    name: 'Productivity',
    description: 'Task management, pomodoro timers, and context filtering.',
    icon: resolveIcon('bolt'),
  },
  {
    id: 'mindful',
    name: 'Mindful Productivity',
    description: 'The perfect balance of reflection and execution.',
    icon: resolveIcon('scale'),
  },
]

function setThemeSelection(theme: AppTheme) {
  selectedTheme.value = theme
  document.documentElement.classList.add('theme-transitioning')
  setAppSetting('theme', theme)
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 250)
  void impact('light')
}

function selectProfile(profile: AppProfile) {
  selectedProfile.value = profile
  void impact('light')
}

async function startTracking() {
  void impact('heavy')

  // Atomic batch update to prevent multiple re-renders
  patchSettings({
    theme: selectedTheme.value,
    enableToday: true,
    autoShowBored: true,
    hasCompletedOnboarding: true,
    ...PROFILE_SETTINGS[selectedProfile.value],
  })

  // Final push to Home with history replacement
  await navigateTo('/', { replace: true })
}

function nextStep() {
  step.value = (step.value + 1) as 1 | 2 | 3
  void impact('medium')
}

function prevStep() {
  step.value = (step.value - 1) as 1 | 2 | 3
  void impact('light')
}

async function skipSetup() {
  void impact('medium')

  patchSettings({
    hasCompletedOnboarding: true,
    enableBored: false,
    enableContextFilter: false,
    enableHealth: false,
  })

  await navigateTo('/', { replace: true })
}

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
  void (logoSvgRef.value as HTMLElement | null)?.offsetWidth
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
</script>

<template>
  <div class="min-h-[100dvh] flex flex-col bg-(--ui-bg) text-(--ui-text) safe-area-bottom">
    <div class="flex-1 w-full max-w-md mx-auto px-6 relative flex flex-col justify-center overflow-x-hidden">
        
        <Transition
          mode="out-in"
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-4"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-4"
        >
          <!-- Step 1: Welcome -->
          <div v-if="step === 1" :key="1" class="space-y-12 flex flex-col items-center text-center py-12">
            
            <div class="flex flex-col items-center">
              <div class="relative flex items-center justify-center mb-8">
                <div class="absolute w-44 h-44 rounded-full bg-primary-500/10 blur-3xl" />
                <svg
                  ref="logoSvgRef"
                  class="plant-logo plant-logo-lg relative w-24 h-28 text-primary-400"
                  :class="{ 'sprout-anim': logoAnimating }"
                  viewBox="0 0 40 44"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  role="img"
                  aria-label="Habitat Logo"
                  @click="playLogoAnimation"
                  @animationend="onLogoAnimEnd"
                >
                  <line class="sprout-stem" x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="1" />
                  <path class="sprout-leaf-l" d="M 20,24 C 11,23 4,29 8,34 C 11,37 19,30 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
                  <path class="sprout-branch-r" d="M 20,24 C 26,20 32,14 30,8 C 28,5 20,13 20,24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
                  <path class="sprout-soil" d="M 8,40 C 12,37 28,37 32,40" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" pathLength="1" />
                </svg>
              </div>
              <h1 class="text-3xl font-extrabold tracking-tight mb-4">Welcome to Habitat</h1>
              <p class="text-(--ui-text-muted) leading-relaxed text-base">
                A mindful space to build habits, track tasks, and reflect.
              </p>
            </div>

            <div class="w-full space-y-4 pt-6">
              <button
                class="w-full flex flex-col items-center justify-center py-3 px-4 rounded-2xl bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:bg-primary-600 transition-all duration-200 active:scale-[0.97] cursor-pointer"
                @click="nextStep"
              >
                <span class="text-base font-bold tracking-tight">Get Started</span>
                <span class="text-[10px] uppercase font-bold opacity-70 mt-0.5 tracking-widest">Configure your experience</span>
              </button>

              <button
                class="w-full flex flex-col items-center justify-center py-3 px-4 rounded-2xl bg-(--ui-bg-elevated) hover:bg-(--ui-bg-muted) text-(--ui-text) border border-(--ui-border) transition-all duration-200 active:scale-[0.97] cursor-pointer"
                @click="skipSetup"
              >
                <span class="text-sm font-bold tracking-tight text-(--ui-text)">Skip Setup</span>
                <span class="text-[10px] uppercase font-bold text-(--ui-text-dimmed) mt-0.5 tracking-widest">Can't wait to dive in</span>
              </button>
            </div>
          </div>

          <!-- Step 2: Profiles -->
          <div v-else-if="step === 2" :key="2" class="space-y-6 py-12 flex flex-col justify-center min-h-[85vh]">
            <div class="text-center space-y-2 mb-6">
              <h1 class="text-2xl font-bold tracking-tight">How will you use Habitat?</h1>
              <p class="text-sm text-(--ui-text-muted)">
                We'll configure your workspace to fit your goals. You can always change this later.
              </p>
            </div>

            <div class="space-y-3">
              <button
                v-for="p in PROFILES"
                :key="p.id"
                class="w-full flex items-start gap-4 p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer"
                :class="selectedProfile === p.id 
                  ? 'border-primary-500 bg-primary-500/10 shadow-sm' 
                  : 'border-(--ui-border) bg-(--ui-bg-elevated) hover:border-(--ui-border-accented)'"
                @click="selectProfile(p.id)"
              >
                <div 
                  class="p-2.5 rounded-xl shrink-0 transition-colors"
                  :class="selectedProfile === p.id ? 'bg-primary-500 text-white' : 'bg-(--ui-bg-muted) text-(--ui-text-dimmed)'"
                >
                  <AppIcon :name="p.icon" class="w-6 h-6" />
                </div>
                <div>
                  <h3 
                    class="font-semibold"
                    :class="selectedProfile === p.id ? 'text-primary-500' : 'text-(--ui-text)'"
                  >
                    {{ p.name }}
                  </h3>
                  <p class="text-sm text-(--ui-text-muted) leading-snug mt-0.5">
                    {{ p.description }}
                  </p>
                </div>
              </button>
            </div>

            <div class="pt-2">
              <div class="flex gap-3 items-start px-1 py-3 mb-2 text-(--ui-text-dimmed)">
                <AppIcon name="light-bulb" class="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                <p class="text-[13px] font-medium leading-relaxed">
                  You can explore the Settings tab later to further customize your modules and activate Health tracking!
                </p>
              </div>

              <UButton
                color="primary"
                size="lg"
                class="w-full justify-center py-3 text-base rounded-2xl font-semibold cursor-pointer"
                @click="nextStep"
              >
                Continue
              </UButton>
              <button
                class="w-full py-3 text-sm text-(--ui-text-dimmed) hover:text-(--ui-text) transition-colors mt-1 font-medium cursor-pointer"
                @click="prevStep"
              >
                Back
              </button>
            </div>
          </div>

          <!-- Step 3: Finishing Touches / Theme -->
          <div v-else-if="step === 3" :key="3" class="space-y-8 flex flex-col text-center py-12">
            
            <div class="space-y-2">
              <h1 class="text-2xl font-bold tracking-tight">Finishing touches</h1>
              <p class="text-sm text-(--ui-text-muted)">Choose an accent theme.</p>
            </div>

            <div class="w-full flex justify-center gap-6 mt-4">
              <button
                v-for="t in THEMES"
                :key="t.id"
                class="flex flex-col items-center gap-2.5 cursor-pointer"
                @click="setThemeSelection(t.id)"
              >
                <div
                  class="w-14 h-14 rounded-full transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 flex items-center justify-center relative"
                  :class="selectedTheme === t.id
                    ? 'ring-4 ring-offset-[3px] ring-offset-(--ui-bg) ring-primary-500 scale-105 shadow-md'
                    : 'hover:scale-105 opacity-80 ring-1 ring-offset-0 ring-(--ui-border)'"
                  :style="{ background: t.swatch }"
                  :aria-label="`Select ${t.name} theme`"
                  :aria-pressed="selectedTheme === t.id"
                >
                  <AppIcon v-if="selectedTheme === t.id" name="check" class="w-6 h-6 text-white absolute" />
                </div>
                <span
                  class="text-sm transition-colors"
                  :class="selectedTheme === t.id ? 'font-bold text-primary-500' : 'font-medium text-(--ui-text-muted)'"
                >
                  {{ t.name }}
                </span>
              </button>
            </div>

            <!-- Pre-styled example habit component matching app/pages/index.vue -->
            <div class="w-full mt-8 max-w-sm mx-auto flex flex-col gap-2 pointer-events-none">
              <!-- Habit check item -->
              <div class="flex items-center gap-3 p-3 rounded-xl border bg-(--ui-bg-muted)/50 border-(--ui-border)/50 opacity-80">
                <div class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center bg-primary-500/15">
                  <AppIcon name="beaker" class="w-5 h-5 text-primary-500" />
                </div>
                <div class="flex-1 min-w-0 flex items-center">
                  <div class="min-w-0 pr-2 flex-1 text-left">
                    <p class="text-sm font-medium truncate line-through text-(--ui-text-dimmed)">Drink water</p>
                    <p class="text-xs text-(--ui-text-dimmed) mt-0.5">12 day streak</p>
                  </div>
                </div>
                <button class="w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center bg-primary-500 border-primary-500">
                  <AppIcon name="check" class="w-4 h-4 text-white" />
                </button>
              </div>

              <!-- Unchecked metric habit -->
              <div class="flex items-center gap-3 p-3 rounded-xl border bg-(--ui-bg-muted) border-(--ui-border)">
                <div class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center bg-primary-500/15">
                  <AppIcon name="book-open" class="w-5 h-5 text-primary-500" />
                </div>
                <div class="flex-1 min-w-0 flex items-center">
                  <div class="min-w-0 pr-2 flex-1 text-left">
                    <div class="flex items-center gap-1.5">
                      <p class="text-sm font-medium truncate text-(--ui-text)">Read Book</p>
                      <span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-500/15 text-primary-400"># Target</span>
                    </div>
                    <p class="text-xs text-(--ui-text-dimmed) mt-0.5">5 / 20</p>
                  </div>
                </div>
                <UButton size="xs" variant="soft" color="primary">Log</UButton>
              </div>
            </div>

            <div class="pt-8">
              <UButton
                color="primary"
                size="lg"
                class="w-full justify-center py-3 text-base rounded-2xl font-bold shadow-lg shadow-primary-500/20 cursor-pointer"
                @click="startTracking"
              >
                Start Tracking
              </UButton>
              <button
                class="w-full py-3 text-sm text-(--ui-text-dimmed) hover:text-(--ui-text) transition-colors mt-2 font-medium cursor-pointer"
                @click="prevStep"
              >
                Back
              </button>
            </div>

          </div>
        </Transition>

    </div>
  </div>
</template>
