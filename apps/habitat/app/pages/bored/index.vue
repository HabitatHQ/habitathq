<script setup lang="ts">
import type { TimerMode } from '~/composables/useTimer'
import type { BoredCategory, BoredOracleResult } from '~/types/database'

const db = useDatabase()
const { settings } = useAppSettings()
const eggs = useEasterEggs()

// ── Timer ─────────────────────────────────────────────────────────────────────

const timer = reactive(useTimer())
const modeMenuOpen = ref(false)
const modeMenuMinutes = ref(25)
let longPressTimeout: ReturnType<typeof setTimeout> | null = null
let longPressActivated = false

function startLongPress() {
  longPressActivated = false
  longPressTimeout = setTimeout(() => {
    longPressActivated = true
    modeMenuMinutes.value = getBoredEstimate() ?? 25
    modeMenuOpen.value = true
  }, 600)
}

function cancelLongPress() {
  if (longPressTimeout) {
    clearTimeout(longPressTimeout)
    longPressTimeout = null
  }
}

function pomodoroConfig() {
  return {
    workSeconds: settings.value.pomodoroWorkMinutes * 60,
    shortBreakSeconds: settings.value.pomodoroShortBreakMinutes * 60,
    longBreakSeconds: settings.value.pomodoroLongBreakMinutes * 60,
    cyclesBeforeLong: settings.value.pomodoroCyclesBeforeLong,
  }
}

function getBoredItemId(): string {
  if (!currentResult.value) return ''
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.id
    : currentResult.value.todo.id
}

function getBoredItemType(): 'todo' | 'bored' {
  return currentResult.value?.source === 'todo' ? 'todo' : 'bored'
}

function getBoredTitle(): string {
  if (!currentResult.value) return ''
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.title
    : currentResult.value.todo.title
}

function getBoredEstimate(): number | null {
  if (!currentResult.value) return null
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.estimated_minutes
    : currentResult.value.todo.estimated_minutes
}

function handleBoredStart() {
  if (longPressActivated) return
  if (!currentResult.value) return
  const est = getBoredEstimate()
  if (est) {
    timer.startTimer(
      getBoredItemId(),
      getBoredItemType(),
      getBoredTitle(),
      'countdown',
      est * 60,
      pomodoroConfig(),
    )
    modeMenuOpen.value = false
  } else {
    modeMenuMinutes.value = 25
    modeMenuOpen.value = true
  }
}

function startBoredMode(mode: TimerMode) {
  if (!currentResult.value) return
  const secs = mode === 'countdown' ? modeMenuMinutes.value * 60 : 0
  timer.startTimer(
    getBoredItemId(),
    getBoredItemType(),
    getBoredTitle(),
    mode,
    secs,
    pomodoroConfig(),
  )
  modeMenuOpen.value = false
}

async function finishBoredTimerAndDone() {
  timer.stopTimer()
  await markDone()
}

const categories = ref<BoredCategory[]>([])
const currentResult = ref<BoredOracleResult | null>(null)
const shaking = ref(false)
const marking = ref(false)
const hasRolled = ref(false)
const excludedCategories = ref<string[]>([])
const maxMinutes = ref<number | null>(null)

// ── Easter egg session state ─────────────────────────────
const habitatRolls = ref(0)
const forestRolls = ref(0)
const oceanRolls = ref(0)
const consecutiveCat = ref({ id: '', count: 0 })
const eggActive = ref<string | null>(null)
const midnightRoll = ref(false)

onMounted(async () => {
  categories.value = await db.getBoredCategories()
})

const timeFilters = [
  { label: 'Any', value: null },
  { label: '< 15m', value: 15 },
  { label: '< 30m', value: 30 },
  { label: '< 1h', value: 60 },
]

function toggleCategory(id: string) {
  if (excludedCategories.value.includes(id)) {
    excludedCategories.value = excludedCategories.value.filter((x) => x !== id)
  } else {
    excludedCategories.value = [...excludedCategories.value, id]
  }
}

function isMotionReduced(): boolean {
  if (!import.meta.client) return true
  if (settings.value.reduceMotion) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function eggHabEight() {
  if (oracle.value !== 'habitat' || habitatRolls.value !== 8 || eggs.isFound('hab-eight')) return
  eggs.discover('hab-eight')
  eggActive.value = 'hab-eight'
  await new Promise((r) => setTimeout(r, 600))
  eggActive.value = null
}

async function eggHabCertain() {
  if (oracle.value !== 'habitat') return
  const catId = currentResult.value?.category?.id ?? ''
  if (catId && catId === consecutiveCat.value.id) {
    consecutiveCat.value = { id: catId, count: consecutiveCat.value.count + 1 }
  } else {
    consecutiveCat.value = { id: catId, count: catId ? 1 : 0 }
  }
  if (consecutiveCat.value.count !== 3 || eggs.isFound('hab-certain')) return
  eggs.discover('hab-certain')
  eggActive.value = 'hab-certain'
  await new Promise((r) => setTimeout(r, 200))
  eggActive.value = null
}

async function eggForThirteenth() {
  if (oracle.value !== 'forest' || forestRolls.value !== 13 || eggs.isFound('for-thirteenth'))
    return
  eggs.discover('for-thirteenth')
  eggActive.value = 'for-thirteenth'
  await new Promise((r) => setTimeout(r, 1800))
  eggActive.value = null
}

async function eggOceSummon() {
  if (oracle.value !== 'ocean' || oceanRolls.value !== 10 || eggs.isFound('oce-summon')) return
  eggs.discover('oce-summon')
  eggActive.value = 'oce-summon'
  await new Promise((r) => setTimeout(r, 1600))
  eggActive.value = null
}

async function roll() {
  if (shaking.value) return
  midnightRoll.value = false
  hasRolled.value = true

  const isMidnight = import.meta.client ? new Date().getHours() === 0 : false

  shaking.value = true
  if (!isMotionReduced()) {
    await new Promise((r) => setTimeout(r, 650))
  }

  if (oracle.value === 'habitat') habitatRolls.value++
  else if (oracle.value === 'forest') forestRolls.value++
  else oceanRolls.value++

  await eggHabEight()

  currentResult.value = await db.getBoredOracle([...excludedCategories.value], maxMinutes.value)

  await eggHabCertain()
  await eggForThirteenth()
  await eggOceSummon()

  if (isMidnight && !eggs.isFound('any-midnight')) {
    eggs.discover('any-midnight')
    midnightRoll.value = true
  }

  shaking.value = false
}

async function markDone() {
  if (!currentResult.value || marking.value) return
  if (timer.timer?.itemId === getBoredItemId()) timer.stopTimer()
  marking.value = true
  try {
    if (currentResult.value.source === 'activity') {
      await db.markBoredActivityDone(currentResult.value.activity.id)
    } else {
      await db.toggleTodo(currentResult.value.todo.id)
    }
    currentResult.value = await db.getBoredOracle([...excludedCategories.value], maxMinutes.value)
  } finally {
    marking.value = false
  }
}

const resultTitle = computed(() => {
  if (!currentResult.value) return ''
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.title
    : currentResult.value.todo.title
})

const resultDescription = computed(() => {
  if (!currentResult.value) return ''
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.description
    : currentResult.value.todo.description
})

const resultEstimate = computed(() => {
  if (!currentResult.value) return null
  const mins =
    currentResult.value.source === 'activity'
      ? currentResult.value.activity.estimated_minutes
      : currentResult.value.todo.estimated_minutes
  if (!mins) return null
  return mins < 60 ? `${mins}m` : `${Math.round((mins / 60) * 10) / 10}h`
})

const resultCategory = computed(() => {
  if (!currentResult.value) return null
  return currentResult.value.category
})

const resultTags = computed(() => {
  if (!currentResult.value) return []
  return currentResult.value.source === 'activity'
    ? currentResult.value.activity.tags
    : currentResult.value.todo.tags
})

const oracle = computed(() => settings.value.theme)

const ORACLE_COPY: Record<string, { rolling: string; again: string; idle: string }> = {
  forest: {
    rolling: 'The stone awakens…',
    again: 'Tap to seek again',
    idle: 'Tap to read the runes',
  },
  ocean: {
    rolling: 'The depths stir…',
    again: 'Tap to ask again',
    idle: 'Tap to consult the deep',
  },
  habitat: {
    rolling: 'Consulting the oracle…',
    again: 'Tap to roll again',
    idle: 'Tap to get a suggestion',
  },
}

const oracleHint = computed(() => {
  if (midnightRoll.value && currentResult.value) return 'Something ancient answered instead'
  const copy = ORACLE_COPY[oracle.value] ?? ORACLE_COPY['habitat']
  if (shaking.value) return copy.rolling
  if (currentResult.value) return copy.again
  return copy.idle
})
</script>

<template>
  <div class="max-w-lg mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">I'm Bored</h1>
      <UButton to="/bored/activities" variant="ghost" color="neutral" size="sm" icon="i-heroicons-cog-6-tooth">
        Manage
      </UButton>
    </div>

    <!-- Time filter -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="tf in timeFilters"
        :key="String(tf.value)"
        class="px-3 py-1 rounded-full text-sm font-medium transition-colors"
        :class="maxMinutes === tf.value
          ? 'bg-primary-600 text-white'
          : 'bg-(--ui-bg-elevated) text-(--ui-text-toned) hover:bg-(--ui-bg-accented)'"
        @click="maxMinutes = tf.value"
      >
        {{ tf.label }}
      </button>
    </div>

    <!-- Category chips -->
    <div v-if="categories.length" class="flex gap-2 flex-wrap">
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border"
        :class="excludedCategories.includes(cat.id)
          ? 'border-(--ui-border-accented) text-(--ui-text-dimmed) bg-(--ui-bg-muted)'
          : 'border-transparent text-white'"
        :style="excludedCategories.includes(cat.id) ? {} : { backgroundColor: cat.color + '33', borderColor: cat.color + '88', color: cat.color }"
        @click="toggleCategory(cat.id)"
      >
        <UIcon :name="cat.icon" class="w-3.5 h-3.5" />
        {{ cat.name }}
      </button>
    </div>

    <!-- Oracle -->
    <div class="flex flex-col items-center gap-5 py-4">
      <!-- 8-ball (Habitat theme) -->
      <button
        v-if="oracle === 'habitat'"
        class="ball select-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-4 focus-visible:ring-offset-(--ui-bg)"
        :class="{ 'ball-shake': shaking }"
        aria-label="Roll the oracle"
        @click="roll"
      >
        <!-- Secondary soft highlight -->
        <div class="ball-glow" />
        <!-- Primary specular hot spot -->
        <div class="ball-specular" />
        <!-- Rim light (bottom-right) -->
        <div class="ball-rim" />

        <!-- Window: metallic ring + deep liquid interior -->
        <div class="ball-window">
          <div v-if="eggActive === 'hab-eight'" class="egg-eight">8</div>
          <div v-else-if="eggActive === 'hab-certain'" class="egg-certain-flash" />
          <div v-else-if="currentResult && !shaking" class="result-content">
            <UIcon
              v-if="resultCategory"
              :name="resultCategory.icon"
              class="w-8 h-8 shrink-0"
              :style="{ color: resultCategory.color }"
            />
            <span
              v-if="resultCategory"
              class="text-[10px] font-semibold tracking-wide text-center leading-tight px-1.5"
              :style="{ color: resultCategory.color }"
            >
              {{ resultCategory.name }}
            </span>
          </div>
          <span v-else class="idle-question">?</span>
        </div>
      </button>

      <!-- Moss stone (Forest theme) -->
      <button
        v-else-if="oracle === 'forest'"
        class="moss-stone select-none outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-4 focus-visible:ring-offset-(--ui-bg)"
        :class="{ 'stone-rumble': shaking, 'egg-thirteenth': eggActive === 'for-thirteenth' }"
        aria-label="Tap the moss stone"
        @click="roll"
      >
        <!-- Moss patches -->
        <div class="moss-patch moss-patch-1" />
        <div class="moss-patch moss-patch-2" />
        <div class="moss-patch moss-patch-3" />

        <!-- Carved face: recessed circle where the result appears -->
        <div class="stone-face">
          <span v-if="eggActive === 'for-thirteenth'" class="rune-ancient">ᚱ</span>
          <div v-else-if="currentResult && !shaking" class="rune-result">
            <UIcon
              v-if="resultCategory"
              :name="resultCategory.icon"
              class="w-8 h-8 shrink-0"
              :style="{ color: resultCategory.color }"
            />
            <span
              v-if="resultCategory"
              class="text-[10px] font-semibold tracking-wide text-center leading-tight px-1.5"
              :style="{ color: resultCategory.color }"
            >
              {{ resultCategory.name }}
            </span>
          </div>
          <span v-else class="rune-idle">ᛟ</span>
        </div>
      </button>

      <!-- Jellyfish (Ocean theme) -->
      <button
        v-else
        class="jellyfish-orb select-none outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-4 focus-visible:ring-offset-(--ui-bg)"
        aria-label="Consult the jellyfish"
        @click="roll"
      >
        <!-- Ambient floor glow -->
        <div class="ocean-floor-glow" />

        <!-- Floating bubbles -->
        <div class="bubble bubble-1" />
        <div class="bubble bubble-2" />
        <div class="bubble bubble-3" />

        <!-- Kraken sucker (oce-summon egg) -->
        <div v-if="eggActive === 'oce-summon'" class="kraken-sucker" />

        <!-- Jellyfish body: bell + tentacles move together -->
        <div class="jellyfish" :class="{ 'jelly-startled': shaking }">
          <div class="jelly-bell">
            <div class="jelly-specular" />
            <div class="jelly-rim-glow" />
            <div class="jelly-face">
              <div v-if="currentResult && !shaking" class="jelly-result">
                <UIcon
                  v-if="resultCategory"
                  :name="resultCategory.icon"
                  class="w-7 h-7 shrink-0"
                  :style="{ color: resultCategory.color }"
                />
                <span
                  v-if="resultCategory"
                  class="text-[9px] font-semibold tracking-wide text-center leading-tight px-1"
                  :style="{ color: resultCategory.color }"
                >
                  {{ resultCategory.name }}
                </span>
              </div>
              <span v-else class="jelly-idle-symbol">✦</span>
            </div>
          </div>
          <div class="tentacles">
            <div class="tentacle t-1" />
            <div class="tentacle t-2" />
            <div class="tentacle t-3" />
            <div class="tentacle t-4" />
            <div class="tentacle t-5" />
            <div class="tentacle t-6" />
          </div>
        </div>
      </button>

      <p class="text-sm text-(--ui-text-dimmed) text-center">
        {{ oracleHint }}
      </p>
    </div>

    <!-- Suggestion card -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
    >
      <div v-if="currentResult && !shaking" class="bg-(--ui-bg-muted) border border-(--ui-border) rounded-2xl p-5 space-y-4">
        <!-- Title + badges -->
        <div class="space-y-2">
          <h2 class="text-lg font-semibold leading-snug">{{ resultTitle }}</h2>
          <div class="flex flex-wrap gap-2">
            <span
              v-if="resultCategory"
              class="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
              :style="{ backgroundColor: resultCategory.color + '22', color: resultCategory.color }"
            >
              <UIcon :name="resultCategory.icon" class="w-3 h-3" />
              {{ resultCategory.name }}
            </span>
            <span v-if="resultEstimate" class="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-toned)">
              <UIcon name="i-heroicons-clock" class="w-3 h-3" />
              {{ resultEstimate }}
            </span>
            <span v-if="currentResult.source === 'todo'" class="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300">
              from TODOs
            </span>
          </div>
        </div>

        <!-- Description -->
        <p v-if="resultDescription" class="text-sm text-(--ui-text-muted)">{{ resultDescription }}</p>

        <!-- Tags -->
        <div v-if="resultTags.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in resultTags"
            :key="tag"
            class="text-xs px-2 py-0.5 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-muted)"
          >
            {{ tag }}
          </span>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap gap-2 pt-1">
          <!-- Timer controls when this item is being timed -->
          <template v-if="settings.enableTimer && timer.timer?.itemId === getBoredItemId()">
            <time
              class="text-sm font-mono self-center"
              :class="timer.isOvertime ? 'text-red-400 animate-pulse' : 'text-(--ui-text)'"
            >{{ timer.displayTime }}</time>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              :icon="timer.isRunning ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :aria-label="timer.isRunning ? 'Pause timer' : 'Resume timer'"
              @click="timer.isRunning ? timer.pauseTimer() : timer.resumeTimer()"
            />
            <UButton
              size="sm"
              variant="soft"
              color="success"
              icon="i-heroicons-check"
              :loading="marking"
              @click="finishBoredTimerAndDone"
            >Done</UButton>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-x-mark"
              aria-label="Stop timer"
              @click="timer.stopTimer()"
            />
          </template>

          <!-- Default action buttons (no active timer for this item) -->
          <template v-else>
            <UButton
              variant="soft"
              color="success"
              size="sm"
              icon="i-heroicons-check"
              :loading="marking"
              @click="markDone"
            >
              Done
            </UButton>

            <!-- Start timer button -->
            <div v-if="settings.enableTimer && !shaking" class="relative">
              <div v-if="modeMenuOpen" class="fixed inset-0 z-40" @click="modeMenuOpen = false" />
              <UButton
                size="sm"
                variant="soft"
                color="neutral"
                icon="i-heroicons-play"
                @click="handleBoredStart"
                @pointerdown="startLongPress"
                @pointerup="cancelLongPress"
                @pointerleave="cancelLongPress"
                @pointermove="cancelLongPress"
              >Start</UButton>
              <div
                v-if="modeMenuOpen"
                role="menu"
                class="absolute bottom-full left-0 mb-1 bg-(--ui-bg) border border-(--ui-border) rounded-xl shadow-xl p-1 z-50 min-w-44 space-y-0.5"
              >
                <button
                  role="menuitem"
                  class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2"
                  @click="startBoredMode('stopwatch')"
                >
                  <UIcon name="i-heroicons-play" class="w-4 h-4" /> Stopwatch
                </button>
                <div role="menuitem" class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted)">
                  <UIcon name="i-heroicons-clock" class="w-4 h-4 shrink-0" />
                  <input
                    v-model.number="modeMenuMinutes"
                    type="number"
                    min="1"
                    max="480"
                    class="w-14 px-1.5 py-0.5 text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded text-center"
                    aria-label="Countdown minutes"
                    @click.stop
                  />
                  <span class="text-(--ui-text-muted) text-xs">min</span>
                  <button class="ml-auto text-primary-400 text-xs font-medium" @click="startBoredMode('countdown')">Start</button>
                </div>
                <button
                  role="menuitem"
                  class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2"
                  @click="startBoredMode('pomodoro')"
                >
                  🍅 Pomodoro
                </button>
              </div>
            </div>

            <UButton
              variant="soft"
              color="neutral"
              size="sm"
              icon="i-heroicons-arrow-path"
              @click="roll"
            >
              Roll again
            </UButton>
            <UButton
              v-if="currentResult.source === 'todo'"
              to="/todos"
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-heroicons-arrow-right"
            >
              View TODO
            </UButton>
            <UButton
              v-else
              to="/bored/activities"
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-heroicons-arrow-right"
            >
              View all
            </UButton>
          </template>
        </div>
      </div>
    </Transition>

    <!-- Empty state after roll -->
    <div v-if="currentResult === null && !shaking" class="text-center py-4">
      <p v-if="hasRolled" class="text-(--ui-text-dimmed) text-sm">
        Nothing matches your current filters. Try adjusting categories or time.
      </p>
      <p v-else-if="categories.length === 0" class="text-(--ui-text-dimmed) text-sm">
        No activities yet. <NuxtLink to="/bored/activities" class="text-primary-400 underline">Add some</NuxtLink> to get started.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* ── Sphere body ───────────────────────────────────────── */
.ball {
  position: relative;
  width: 13rem;
  height: 13rem;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;

  /* Multi-stop sphere gradient: dark core, subtle depth */
  background:
    radial-gradient(circle at 30% 27%, rgba(255,255,255,0.10) 0%, transparent 30%),
    radial-gradient(circle at 66% 70%, rgba(99,102,241,0.15) 0%, transparent 42%),
    radial-gradient(ellipse at 48% 52%, #111827 0%, #050d1f 55%, #000 100%);

  /* Layered shadows: deep ground shadow + inner rim glow */
  box-shadow:
    0 30px 70px rgba(0,0,0,0.9),
    0 10px 22px rgba(0,0,0,0.65),
    inset 0 -4px 10px rgba(79,70,229,0.13),
    inset 0 2px 4px rgba(255,255,255,0.06),
    0 0 0 1px rgba(255,255,255,0.04);

  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.ball:active:not(.ball-shake) {
  transform: scale(0.965);
  box-shadow:
    0 14px 35px rgba(0,0,0,0.9),
    0 5px 12px rgba(0,0,0,0.65),
    inset 0 -3px 8px rgba(79,70,229,0.1),
    inset 0 2px 3px rgba(255,255,255,0.05);
}

/* ── Lighting layers (absolutely positioned within ball) ─ */

/* Secondary: large, soft fill highlight */
.ball-glow {
  position: absolute;
  top: 3%;
  left: 5%;
  width: 56%;
  height: 48%;
  border-radius: 50%;
  background: radial-gradient(ellipse at 38% 32%,
    rgba(255,255,255,0.07) 0%,
    transparent 68%
  );
  pointer-events: none;
}

/* Primary: tight specular hot spot */
.ball-specular {
  position: absolute;
  top: 7%;
  left: 11%;
  width: 34%;
  height: 28%;
  border-radius: 50%;
  background: radial-gradient(ellipse at 38% 32%,
    rgba(255,255,255,0.65) 0%,
    rgba(255,255,255,0.24) 28%,
    rgba(255,255,255,0.05) 55%,
    transparent 78%
  );
  filter: blur(2.5px);
  pointer-events: none;
}

/* Rim: indigo-violet glow, bottom-right edge */
.ball-rim {
  position: absolute;
  bottom: -12%;
  right: -12%;
  width: 60%;
  height: 60%;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%,
    rgba(99,102,241,0.26) 0%,
    rgba(139,92,246,0.09) 48%,
    transparent 70%
  );
  pointer-events: none;
  animation: rim-breathe 4s ease-in-out infinite;
}

/* ── Window: metallic ring + liquid interior ───────────── */
.ball-window {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44%;
  aspect-ratio: 1;
  border-radius: 50%;

  /*
   * Gradient-border technique:
   * - padding-box = the deep blue "liquid" interior
   * - border-box  = the metallic ring (the border itself)
   */
  border: 4px solid transparent;
  background:
    radial-gradient(circle at 36% 30%, #1d2478, #0a0d30 52%, #040510 100%) padding-box,
    linear-gradient(145deg, #64748b 0%, #334155 28%, #1e293b 50%, #2d3748 72%, #64748b 100%) border-box;

  box-shadow:
    0 4px 18px rgba(0,0,0,0.88),
    inset 0 2px 10px rgba(0,0,0,0.92);

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* ── Content ───────────────────────────────────────────── */
.idle-question {
  font-size: 2rem;
  font-weight: 800;
  color: rgba(148,163,184,0.55);
  user-select: none;
  line-height: 1;
  animation: float-idle 3s ease-in-out infinite;
}

.result-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  animation: reveal 0.4s cubic-bezier(0.34, 1.4, 0.64, 1) both;
}

/* ── Animations ────────────────────────────────────────── */

/* Physical shake: translate + rotate + scale sinusoid */
@keyframes shake {
  0%   { transform: translate(0,    0)    rotate(0deg)  scale(1);     }
  8%   { transform: translate(-8px,-5px)  rotate(-7deg) scale(1.05);  }
  17%  { transform: translate(10px, 4px)  rotate(8deg)  scale(1.07);  }
  25%  { transform: translate(-9px, 7px)  rotate(-6deg) scale(1.06);  }
  33%  { transform: translate(8px, -8px)  rotate(7deg)  scale(1.07);  }
  42%  { transform: translate(-7px, 5px)  rotate(-5deg) scale(1.05);  }
  50%  { transform: translate(6px, -4px)  rotate(5deg)  scale(1.04);  }
  58%  { transform: translate(-5px, 3px)  rotate(-3deg) scale(1.03);  }
  67%  { transform: translate(4px, -3px)  rotate(3deg)  scale(1.02);  }
  75%  { transform: translate(-3px, 2px)  rotate(-2deg) scale(1.01);  }
  83%  { transform: translate(2px, -2px)  rotate(1deg)  scale(1.005); }
  92%  { transform: translate(-1px, 1px)  rotate(-1deg) scale(1);     }
  100% { transform: translate(0,    0)    rotate(0deg)  scale(1);     }
}

/* Idle "?" floats gently */
@keyframes float-idle {
  0%, 100% { transform: translateY(0);    opacity: 0.55; }
  50%       { transform: translateY(-3px); opacity: 0.85; }
}

/* Result materialises with spring overshoot + blur clear */
@keyframes reveal {
  from { opacity: 0; transform: scale(0.6) translateY(6px); filter: blur(3px); }
  to   { opacity: 1; transform: scale(1)   translateY(0);   filter: blur(0);   }
}

/* Rim light breathes slowly */
@keyframes rim-breathe {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 1;   }
}

.ball-shake {
  animation: shake 0.65s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

/* ── Moss Stone (Forest theme) ──────────────────────────── */
.moss-stone {
  position: relative;
  width: 13rem;
  height: 11.5rem;
  /* Irregular natural stone silhouette */
  border-radius: 52% 48% 56% 44% / 44% 52% 48% 56%;
  cursor: pointer;
  overflow: hidden;

  background:
    radial-gradient(ellipse at 28% 25%, rgba(55, 90, 50, 0.4) 0%, transparent 45%),
    radial-gradient(ellipse at 72% 68%, rgba(30, 65, 35, 0.35) 0%, transparent 40%),
    radial-gradient(ellipse at 50% 50%, #222b1e 0%, #181f14 55%, #0f1a0b 100%);

  box-shadow:
    0 25px 60px rgba(0, 0, 0, 0.85),
    0 10px 25px rgba(0, 0, 0, 0.6),
    inset 0 -4px 12px rgba(0, 0, 0, 0.5),
    inset 0 2px 5px rgba(80, 140, 70, 0.06);

  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.moss-stone:active:not(.stone-rumble) {
  transform: scale(0.97);
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.85),
    0 5px 15px rgba(0, 0, 0, 0.6),
    inset 0 -3px 8px rgba(0, 0, 0, 0.5);
}

/* ── Moss patches ───────────────────────────────────────── */
.moss-patch {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.moss-patch-1 {
  top: 5%;
  left: 8%;
  width: 38%;
  height: 32%;
  background: radial-gradient(ellipse at 40% 40%,
    rgba(32, 138, 101, 0.65) 0%,
    rgba(32, 138, 101, 0.25) 45%,
    transparent 70%
  );
  filter: blur(4px);
  animation: moss-sway 5s ease-in-out infinite;
}

.moss-patch-2 {
  bottom: 8%;
  right: 6%;
  width: 44%;
  height: 36%;
  background: radial-gradient(ellipse at 55% 55%,
    rgba(32, 138, 101, 0.55) 0%,
    rgba(20, 100, 70, 0.2) 50%,
    transparent 74%
  );
  filter: blur(5px);
  animation: moss-sway 7s ease-in-out infinite reverse;
}

.moss-patch-3 {
  top: 55%;
  left: 2%;
  width: 28%;
  height: 38%;
  background: radial-gradient(ellipse at 45% 45%,
    rgba(32, 138, 101, 0.4) 0%,
    transparent 65%
  );
  filter: blur(3px);
  animation: moss-sway 6s ease-in-out infinite 1s;
}

/* ── Carved face ────────────────────────────────────────── */
.stone-face {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44%;
  aspect-ratio: 1;
  border-radius: 50%;

  border: 3px solid transparent;
  background:
    radial-gradient(circle at 50% 45%, #0b160a, #060f05 70%) padding-box,
    linear-gradient(145deg, #3a6e3a 0%, #204d20 30%, #122a12 55%, #204d20 80%, #4a7e4a 100%) border-box;

  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.85),
    inset 0 2px 10px rgba(0, 0, 0, 0.95);

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* ── Rune content ───────────────────────────────────────── */
.rune-idle {
  font-size: 1.8rem;
  color: rgba(32, 138, 101, 0.5);
  user-select: none;
  line-height: 1;
  animation: rune-pulse 3.5s ease-in-out infinite;
}

.rune-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  animation: rune-ignite 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) both;
}

/* ── Moss stone animations ──────────────────────────────── */
@keyframes stone-rumble {
  0%   { transform: translate(0,    0)    rotate(0deg);  }
  8%   { transform: translate(-6px,-4px)  rotate(-3deg); }
  17%  { transform: translate(8px,  3px)  rotate(3deg);  }
  25%  { transform: translate(-6px, 5px)  rotate(-3deg); }
  33%  { transform: translate(7px, -6px)  rotate(4deg);  }
  42%  { transform: translate(-5px, 4px)  rotate(-3deg); }
  50%  { transform: translate(5px, -3px)  rotate(3deg);  }
  58%  { transform: translate(-4px, 3px)  rotate(-2deg); }
  67%  { transform: translate(3px, -2px)  rotate(2deg);  }
  75%  { transform: translate(-2px, 2px)  rotate(-1deg); }
  83%  { transform: translate(2px, -1px)  rotate(1deg);  }
  92%  { transform: translate(-1px, 1px)  rotate(0deg);  }
  100% { transform: translate(0,    0)    rotate(0deg);  }
}

@keyframes rune-pulse {
  0%, 100% {
    opacity: 0.45;
    text-shadow: 0 0 8px rgba(32, 138, 101, 0.3);
  }
  50% {
    opacity: 0.9;
    text-shadow:
      0 0 12px rgba(32, 138, 101, 0.9),
      0 0 28px rgba(32, 138, 101, 0.5);
  }
}

@keyframes rune-ignite {
  from { opacity: 0; transform: scale(0.55) translateY(5px); filter: blur(3px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   filter: blur(0);   }
}

@keyframes moss-sway {
  0%, 100% { opacity: 0.85; transform: scale(1);    }
  50%       { opacity: 1;    transform: scale(1.04); }
}

.stone-rumble {
  animation: stone-rumble 0.65s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

/* ── Jellyfish Orb (Ocean theme) ────────────────────────── */
.jellyfish-orb {
  position: relative;
  width: 13rem;
  height: 13rem;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;

  /* Deep ocean looking through a porthole */
  background:
    radial-gradient(ellipse at 50% 88%, rgba(34, 211, 238, 0.07) 0%, transparent 55%),
    radial-gradient(ellipse at 50% 50%, #041520 0%, #020c14 60%, #010810 100%);

  box-shadow:
    0 30px 70px rgba(0, 0, 0, 0.95),
    0 10px 22px rgba(0, 0, 0, 0.7),
    inset 0 0 50px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.04);

  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.jellyfish-orb:active {
  transform: scale(0.965);
}

/* Faint caustic glow rising from below */
.ocean-floor-glow {
  position: absolute;
  bottom: -10%;
  left: 50%;
  transform: translateX(-50%);
  width: 70%;
  height: 50%;
  background: radial-gradient(ellipse at 50% 100%,
    rgba(34, 211, 238, 0.06) 0%,
    transparent 65%
  );
  pointer-events: none;
}

/* ── Bubbles ─────────────────────────────────────────────── */
.bubble {
  position: absolute;
  border-radius: 50%;
  background: rgba(34, 211, 238, 0.2);
  border: 1px solid rgba(34, 211, 238, 0.35);
  pointer-events: none;
}

.bubble-1 { width: 5px;  height: 5px;  left: 33%; bottom: 14%; animation: bubble-rise 4.5s ease-in infinite 0.8s; }
.bubble-2 { width: 3px;  height: 3px;  left: 61%; bottom: 22%; animation: bubble-rise 6s   ease-in infinite 2.5s; }
.bubble-3 { width: 4px;  height: 4px;  left: 48%; bottom: 17%; animation: bubble-rise 5s   ease-in infinite 4s;   }

/* ── Jellyfish body wrapper ──────────────────────────────── */
.jellyfish {
  position: absolute;
  top: 15%;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: jelly-float 3s ease-in-out infinite;
}

.jellyfish.jelly-startled {
  animation: jelly-startled-anim 0.65s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

/* ── Bell ────────────────────────────────────────────────── */
.jelly-bell {
  position: relative;
  width: 6rem;
  height: 4.5rem;
  border-radius: 50% 50% 45% 45% / 60% 60% 38% 38%;

  background:
    radial-gradient(ellipse at 35% 25%, rgba(255, 255, 255, 0.07) 0%, transparent 40%),
    radial-gradient(ellipse at 50% 50%,
      rgba(99, 102, 241, 0.48) 0%,
      rgba(79, 70, 229, 0.28) 40%,
      rgba(49, 46, 129, 0.12) 70%,
      transparent 100%
    );

  box-shadow:
    0 0 24px rgba(99, 102, 241, 0.5),
    0 0 50px rgba(99, 102, 241, 0.22),
    inset 0 -5px 16px rgba(34, 211, 238, 0.2);
}

/* Specular highlight on bell dome */
.jelly-specular {
  position: absolute;
  top: 8%;
  left: 12%;
  width: 32%;
  height: 28%;
  border-radius: 50%;
  background: radial-gradient(ellipse,
    rgba(255, 255, 255, 0.38) 0%,
    rgba(255, 255, 255, 0.1) 45%,
    transparent 70%
  );
  filter: blur(2px);
  pointer-events: none;
}

/* Bioluminescent rim at bell base */
.jelly-rim-glow {
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 35%;
  background: radial-gradient(ellipse at 50% 100%,
    rgba(34, 211, 238, 0.65) 0%,
    rgba(99, 102, 241, 0.28) 42%,
    transparent 70%
  );
  border-radius: 0 0 50% 50%;
  filter: blur(4px);
  pointer-events: none;
  animation: rim-breathe 3s ease-in-out infinite;
}

/* Result / idle zone inside the bell */
.jelly-face {
  position: absolute;
  bottom: 12%;
  left: 50%;
  transform: translateX(-50%);
  width: 70%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

/* ── Tentacles ───────────────────────────────────────────── */
.tentacles {
  display: flex;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  margin-top: -1px;
}

.tentacle {
  width: 1.5px;
  border-radius: 2px;
  background: linear-gradient(
    to bottom,
    rgba(99, 102, 241, 0.55),
    rgba(99, 102, 241, 0.15) 65%,
    transparent
  );
}

.t-1 { height: 3.4rem; animation: tentacle-sway 2.8s ease-in-out infinite 0s;   }
.t-2 { height: 4.6rem; animation: tentacle-sway 3.2s ease-in-out infinite 0.4s; }
.t-3 { height: 5.1rem; animation: tentacle-sway 2.6s ease-in-out infinite 0.8s; }
.t-4 { height: 4.9rem; animation: tentacle-sway 3.5s ease-in-out infinite 0.2s; }
.t-5 { height: 3.8rem; animation: tentacle-sway 2.9s ease-in-out infinite 0.6s; }
.t-6 { height: 4.3rem; animation: tentacle-sway 3.1s ease-in-out infinite 1.0s; }

/* ── Idle symbol + result ────────────────────────────────── */
.jelly-idle-symbol {
  font-size: 1.5rem;
  color: rgba(34, 211, 238, 0.55);
  user-select: none;
  line-height: 1;
  animation: jelly-symbol-pulse 3.5s ease-in-out infinite;
}

.jelly-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  animation: bio-emerge 0.45s cubic-bezier(0.34, 1.4, 0.64, 1) both;
}

/* ── Jellyfish animations ────────────────────────────────── */

/* Idle swim pulse: squish vertically on contract */
@keyframes jelly-float {
  0%, 100% { transform: translateX(-50%) translateY(0)    scaleX(1)    scaleY(1);    }
  40%       { transform: translateX(-50%) translateY(-4px) scaleX(0.95) scaleY(1.05); }
  70%       { transform: translateX(-50%) translateY(-2px) scaleX(1.01) scaleY(0.99); }
}

/* Startled: rapid pump sequence */
@keyframes jelly-startled-anim {
  0%   { transform: translateX(-50%) translateY(0)    scaleX(1)    scaleY(1);    }
  10%  { transform: translateX(-50%) translateY(-7px) scaleX(0.80) scaleY(1.20); }
  22%  { transform: translateX(-50%) translateY(3px)  scaleX(1.12) scaleY(0.90); }
  33%  { transform: translateX(-50%) translateY(-5px) scaleX(0.85) scaleY(1.15); }
  47%  { transform: translateX(-50%) translateY(2px)  scaleX(1.07) scaleY(0.94); }
  60%  { transform: translateX(-50%) translateY(-3px) scaleX(0.93) scaleY(1.07); }
  73%  { transform: translateX(-50%) translateY(1px)  scaleX(1.03) scaleY(0.97); }
  85%  { transform: translateX(-50%) translateY(-1px) scaleX(0.98) scaleY(1.02); }
  100% { transform: translateX(-50%) translateY(0)    scaleX(1)    scaleY(1);    }
}

@keyframes tentacle-sway {
  0%, 100% { transform: translateX(0)    rotate(0deg);    }
  25%       { transform: translateX(2px)  rotate(1.5deg);  }
  75%       { transform: translateX(-2px) rotate(-1.5deg); }
}

@keyframes bubble-rise {
  0%   { transform: translateY(0)     translateX(0);    opacity: 0.6; }
  50%  { transform: translateY(-45px) translateX(3px);  opacity: 0.8; }
  100% { transform: translateY(-90px) translateX(-2px); opacity: 0;   }
}

@keyframes jelly-symbol-pulse {
  0%, 100% { opacity: 0.45; text-shadow: 0 0 8px rgba(34, 211, 238, 0.3); }
  50%       { opacity: 0.9;  text-shadow: 0 0 12px rgba(34, 211, 238, 0.9), 0 0 28px rgba(34, 211, 238, 0.5); }
}

@keyframes bio-emerge {
  from { opacity: 0; transform: scale(0.55) translateY(4px); filter: blur(4px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   filter: blur(0);   }
}

/* ── Easter eggs ─────────────────────────────────────────── */

/* hab-eight: glowing "8" in ball window */
.egg-eight {
  font-size: 2rem;
  font-weight: 900;
  color: white;
  text-shadow:
    0 0 10px rgba(255, 255, 255, 0.9),
    0 0 30px rgba(255, 255, 255, 0.6),
    0 0 60px rgba(200, 200, 255, 0.4);
  animation: egg-eight-pulse 0.6s ease-in-out both;
  user-select: none;
  line-height: 1;
}

@keyframes egg-eight-pulse {
  0%   { opacity: 0; transform: scale(0.5); }
  30%  { opacity: 1; transform: scale(1.2); }
  70%  { opacity: 1; transform: scale(1);   }
  100% { opacity: 0; transform: scale(0.8); }
}

/* hab-certain: white flash overlay filling the ball window */
.egg-certain-flash {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.85);
  animation: egg-flash 0.2s ease-out both;
  pointer-events: none;
}

@keyframes egg-flash {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}

/* for-thirteenth: amber glow on moss stone */
.moss-stone.egg-thirteenth {
  box-shadow:
    0 25px 60px rgba(0, 0, 0, 0.85),
    0 10px 25px rgba(0, 0, 0, 0.6),
    inset 0 -4px 12px rgba(0, 0, 0, 0.5),
    0 0 30px rgba(251, 191, 36, 0.6),
    0 0 70px rgba(251, 191, 36, 0.3);
  animation: egg-thirteenth-glow 1.8s ease-in-out both;
}

@keyframes egg-thirteenth-glow {
  0% {
    box-shadow:
      0 25px 60px rgba(0,0,0,0.85),
      0 10px 25px rgba(0,0,0,0.6),
      inset 0 -4px 12px rgba(0,0,0,0.5),
      0 0 0px rgba(251,191,36,0);
  }
  25% {
    box-shadow:
      0 25px 60px rgba(0,0,0,0.85),
      0 10px 25px rgba(0,0,0,0.6),
      inset 0 -4px 12px rgba(0,0,0,0.5),
      0 0 30px rgba(251,191,36,0.6),
      0 0 70px rgba(251,191,36,0.3);
  }
  75% {
    box-shadow:
      0 25px 60px rgba(0,0,0,0.85),
      0 10px 25px rgba(0,0,0,0.6),
      inset 0 -4px 12px rgba(0,0,0,0.5),
      0 0 30px rgba(251,191,36,0.6),
      0 0 70px rgba(251,191,36,0.3);
  }
  100% {
    box-shadow:
      0 25px 60px rgba(0,0,0,0.85),
      0 10px 25px rgba(0,0,0,0.6),
      inset 0 -4px 12px rgba(0,0,0,0.5),
      0 0 0px rgba(251,191,36,0);
  }
}

/* for-thirteenth: amber elder rune in stone face */
.rune-ancient {
  font-size: 1.8rem;
  color: #fbbf24;
  user-select: none;
  line-height: 1;
  animation: rune-ancient-glow 1.8s ease-in-out both;
}

@keyframes rune-ancient-glow {
  0%   { opacity: 0; text-shadow: 0 0 0px rgba(251, 191, 36, 0); }
  20%  { opacity: 1; text-shadow: 0 0 12px rgba(251, 191, 36, 0.9), 0 0 30px rgba(251, 191, 36, 0.6); }
  75%  { opacity: 1; text-shadow: 0 0 12px rgba(251, 191, 36, 0.9), 0 0 30px rgba(251, 191, 36, 0.6); }
  100% { opacity: 0; text-shadow: 0 0 0px rgba(251, 191, 36, 0); }
}

/* oce-summon: kraken sucker rises from porthole bottom */
.kraken-sucker {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: radial-gradient(
    circle at 40% 35%,
    rgba(99, 102, 241, 0.5),
    rgba(49, 46, 129, 0.85) 55%,
    rgba(15, 12, 50, 0.97)
  );
  border: 2px solid rgba(99, 102, 241, 0.65);
  box-shadow:
    0 0 14px rgba(99, 102, 241, 0.55),
    inset 0 0 10px rgba(0, 0, 0, 0.8);
  animation: sucker-emerge 1.6s ease-in-out both;
  pointer-events: none;
}

.kraken-sucker::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2px solid rgba(99, 102, 241, 0.28);
  pointer-events: none;
}

.kraken-sucker::after {
  content: '';
  position: absolute;
  inset: -16px;
  border-radius: 50%;
  border: 1.5px solid rgba(99, 102, 241, 0.14);
  pointer-events: none;
}

@keyframes sucker-emerge {
  0%   { transform: translateX(-50%) translateY(110%); opacity: 0; }
  15%  { transform: translateX(-50%) translateY(15%);  opacity: 1; }
  70%  { transform: translateX(-50%) translateY(15%);  opacity: 1; }
  100% { transform: translateX(-50%) translateY(110%); opacity: 0; }
}
</style>
