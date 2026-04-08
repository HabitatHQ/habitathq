<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

definePageMeta({
  layout: false,
})

const timerComp = reactive(useTimer())
const { impact } = useHaptics()
const db = useDatabase()
const toast = useToast()

const hasTimer = computed(() => timerComp.isActive)

let localTimerInterval: ReturnType<typeof setInterval> | null = null

// Redirect if no timer is active and they somehow navigated here directly
onMounted(() => {
  if (!timerComp.isActive) {
    navigateTo('/')
    return
  }

  localTimerInterval = setInterval(() => {
    const { overtime, phaseTransition } = timerComp.onTick()
    if (overtime) void impact('heavy')
    if (phaseTransition) void impact('medium')
  }, 1000)
})

onUnmounted(() => {
  if (localTimerInterval) clearInterval(localTimerInterval)
})

// Time formatting for header "12:17 PM -> 12:54 PM"
const timeRange = computed(() => {
  if (!timerComp.timer || timerComp.timer.startedAt === null) return ''
  if (timerComp.timer.mode === 'stopwatch') return 'Ongoing session'

  const start = new Date(timerComp.timer.startedAt)
  const end = new Date(start.getTime() + timerComp.timer.durationSeconds * 1000)

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${formatTime(start)} → ${formatTime(end)}`
})

const progress = computed(() => {
  if (!timerComp.timer) return 0
  if (timerComp.timer.mode === 'stopwatch') {
    return ((timerComp.currentElapsed % 60) / 60) * 100
  }
  const p = (timerComp.currentElapsed / timerComp.timer.durationSeconds) * 100
  return Math.min(100, Math.max(0, p))
})

// SVG Circle properties
const radius = 120
const circumference = 2 * Math.PI * radius
const strokeDashoffset = computed(() => {
  let pc = progress.value / 100
  if (timerComp.timer?.mode === 'stopwatch') {
    // Fill the ring as seconds go by instead of depleting
    return circumference * (1 - pc)
  }
  // Deplete the bar as time progresses for countdown/pomodoro
  return circumference * pc
})

const endModalTitle = computed(() => {
  if (timerComp.timer?.itemId === 'quick') return 'End Quick Focus?'
  return 'End Focus Session?'
})

const endModalDescription = computed(() => {
  if (timerComp.timer?.itemId === 'quick') {
    return 'Are you sure you want to stop this timer?'
  }
  return 'You can mark this task as done, or casually end the timer early.'
})

const centerEmoji = computed(() => {
  const mode = timerComp.timer?.mode
  if (mode === 'pomodoro') return '🍅'
  if (mode === 'stopwatch') return '⏱️'
  return '⏳'
})

function minimize() {
  void impact('light')
  navigateTo('/')
}

const showEndConfirm = ref(false)

function checkEnd() {
  void impact('light')
  showEndConfirm.value = true
}

async function confirmEnd() {
  timerComp.stopTimer()
  showEndConfirm.value = false
  void impact('medium')
  navigateTo('/')
}

async function confirmDone() {
  const itemId = timerComp.timer?.itemId
  const itemType = timerComp.timer?.itemType
  timerComp.stopTimer()
  showEndConfirm.value = false
  void impact('heavy')

  if (itemId && itemType) {
    try {
      if (itemType === 'todo') {
        await db.toggleTodo(itemId)
        toast.add({ title: 'Task marked done', color: 'success', duration: 2000 })
      } else if (itemType === 'bored') {
        await db.markBoredActivityDone(itemId)
        toast.add({ title: 'Activity completed', color: 'success', duration: 2000 })
      }
    } catch (e) {
      logError('[confirmDone]', e)
      toast.add({ title: 'Failed to complete task', color: 'error' })
    }
  }
  navigateTo('/')
}

function playPause() {
  void impact('light')
  if (timerComp.isRunning) {
    timerComp.pauseTimer()
  } else {
    timerComp.resumeTimer()
  }
}

function addOneMinute() {
  void impact('light')
  timerComp.addTime(60)
}
</script>

<template>
  <div class="fixed inset-0 bg-(--ui-bg) text-(--ui-text) flex flex-col items-center justify-between z-50 overflow-hidden" style="padding-top: max(1rem, env(safe-area-inset-top)); padding-bottom: max(2rem, env(safe-area-inset-bottom))">
    
    <!-- Top Action Bar -->
    <header class="w-full px-4 flex items-center justify-between shrink-0">
      <UButton
        icon="i-heroicons-chevron-down"
        variant="ghost"
        color="neutral"
        size="lg"
        class="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
        aria-label="Minimize"
        @click="minimize"
      />
      <UButton
        icon="i-heroicons-x-mark"
        variant="ghost"
        color="neutral"
        size="lg"
        class="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
        aria-label="End session"
        @click="checkEnd"
      />
    </header>

    <!-- Main Content -->
    <main v-if="hasTimer" class="flex-1 flex flex-col items-center justify-center w-full px-6 pb-4">
      
      <div class="space-y-1 text-center mb-8">
        <h1 class="text-4xl font-serif font-bold tracking-tight text-(--ui-text) leading-tight line-clamp-2">
          {{ timerComp.timer?.itemTitle || 'Quick Focus' }}
        </h1>
        <p class="text-[13px] font-medium tracking-wide uppercase text-(--ui-text-dimmed)">
          {{ timeRange }}
        </p>
      </div>

      <div class="relative flex items-center justify-center mb-10 mt-2">
        <!-- SVG Progress Circle -->
        <svg
          class="w-[280px] h-[280px] transform -rotate-90"
          viewBox="0 0 300 300"
        >
          <!-- Background track -->
          <circle
            cx="150"
            cy="150"
            :r="radius"
            fill="none"
            class="text-primary-500/15 stroke-current"
            stroke-width="20"
          />
          <!-- Progress arc -->
          <circle
            cx="150"
            cy="150"
            :r="radius"
            fill="none"
            class="text-primary-500 stroke-current transition-all duration-1000 ease-linear"
            stroke-width="20"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="strokeDashoffset"
          />
        </svg>

        <!-- Inner Content (Emoji) -->
        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div 
             class="w-32 h-32 rounded-full flex items-center justify-center"
             :class="{ 
               'bg-orange-50 dark:bg-orange-900/20': timerComp.timer?.mode !== 'pomodoro', 
               'bg-red-50 dark:bg-red-900/20': timerComp.timer?.mode === 'pomodoro' 
             }"
          >
             <span class="text-6xl filter drop-shadow-sm" :class="{ 'animate-pulse': timerComp.timer?.mode === 'stopwatch' && timerComp.isRunning }">
               {{ centerEmoji }}
             </span>
          </div>
        </div>
      </div>

      <div class="text-center space-y-8 w-full mt-auto">
        <div 
          class="text-[4rem] font-light tabular-nums tracking-tight font-serif leading-none"
          :class="timerComp.isOvertime ? 'text-red-400 animate-pulse' : 'text-(--ui-text)'"
        >
          {{ timerComp.displayTime }}
        </div>

        <div class="flex items-center justify-center gap-5">
          <button
            v-if="timerComp.timer?.mode !== 'stopwatch'"
            class="px-5 py-3 rounded-full font-semibold bg-(--ui-bg-elevated) hover:bg-(--ui-bg-muted) active:scale-95 transition-all text-sm shadow-xs border border-(--ui-border) pointer-events-auto"
            @click="addOneMinute"
          >
            + 1 min
          </button>
          
          <button
            class="w-16 h-16 rounded-full bg-(--ui-text) text-(--ui-bg) flex items-center justify-center shadow-lg active:scale-90 transition-all pointer-events-auto"
            aria-label="Play/Pause"
            @click="playPause"
          >
            <UIcon :name="timerComp.isRunning ? 'i-heroicons-pause-16-solid' : 'i-heroicons-play-16-solid'" class="w-8 h-8" />
          </button>
        </div>
      </div>
    </main>

    <!-- Modal for End/Done -->
    <UModal v-model:open="showEndConfirm" :title="endModalTitle" :description="endModalDescription">
      <template #content>
        <div class="p-6 text-center space-y-5">
          <div class="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-2">
            <UIcon name="i-heroicons-stop-circle" class="w-6 h-6" />
          </div>
          <h3 class="text-lg font-bold text-(--ui-text)">{{ endModalTitle }}</h3>
          <p class="text-sm text-(--ui-text-muted)">
            {{ endModalDescription }}
          </p>
          <div class="flex flex-col gap-2 pt-2">
            <UButton v-if="timerComp.timer?.itemId !== 'quick'" color="success" size="lg" block @click="confirmDone">
              Mark Task Done
            </UButton>
            <UButton color="error" size="lg" block @click="confirmEnd">
              Just End Timer
            </UButton>
            <UButton variant="ghost" color="neutral" block @click="showEndConfirm = false">
              Cancel
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
