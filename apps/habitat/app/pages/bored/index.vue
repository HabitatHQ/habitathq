<script setup lang="ts">
import type { BoredCategory, BoredOracleResult } from '~/types/database'

const db = useDatabase()

const categories = ref<BoredCategory[]>([])
const currentResult = ref<BoredOracleResult | null>(null)
const shaking = ref(false)
const marking = ref(false)
const hasRolled = ref(false)
const excludedCategories = ref<string[]>([])
const maxMinutes = ref<number | null>(null)

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
    excludedCategories.value = excludedCategories.value.filter(x => x !== id)
  } else {
    excludedCategories.value = [...excludedCategories.value, id]
  }
}

async function roll() {
  if (shaking.value) return
  shaking.value = true
  hasRolled.value = true
  await new Promise(r => setTimeout(r, 650))
  currentResult.value = await db.getBoredOracle([...excludedCategories.value], maxMinutes.value)
  shaking.value = false
}

async function markDone() {
  if (!currentResult.value || marking.value) return
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
  const mins = currentResult.value.source === 'activity'
    ? currentResult.value.activity.estimated_minutes
    : currentResult.value.todo.estimated_minutes
  if (!mins) return null
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60 * 10) / 10}h`
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
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'"
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
          ? 'border-slate-700 text-slate-500 bg-slate-900'
          : 'border-transparent text-white'"
        :style="excludedCategories.includes(cat.id) ? {} : { backgroundColor: cat.color + '33', borderColor: cat.color + '88', color: cat.color }"
        @click="toggleCategory(cat.id)"
      >
        <UIcon :name="cat.icon" class="w-3.5 h-3.5" />
        {{ cat.name }}
      </button>
    </div>

    <!-- 8-ball oracle -->
    <div class="flex flex-col items-center gap-5 py-4">
      <button
        class="ball select-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-4 focus-visible:ring-offset-slate-950"
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
          <div v-if="currentResult && !shaking" class="result-content">
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

      <p class="text-sm text-slate-500 text-center">
        {{ shaking ? 'Consulting the oracle…' : currentResult ? 'Tap to roll again' : 'Tap to get a suggestion' }}
      </p>
    </div>

    <!-- Suggestion card -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
    >
      <div v-if="currentResult && !shaking" class="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
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
            <span v-if="resultEstimate" class="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              <UIcon name="i-heroicons-clock" class="w-3 h-3" />
              {{ resultEstimate }}
            </span>
            <span v-if="currentResult.source === 'todo'" class="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300">
              from TODOs
            </span>
          </div>
        </div>

        <!-- Description -->
        <p v-if="resultDescription" class="text-sm text-slate-400">{{ resultDescription }}</p>

        <!-- Tags -->
        <div v-if="resultTags.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in resultTags"
            :key="tag"
            class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400"
          >
            {{ tag }}
          </span>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 pt-1">
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
        </div>
      </div>
    </Transition>

    <!-- Empty state after roll -->
    <div v-if="currentResult === null && !shaking" class="text-center py-4">
      <p v-if="hasRolled" class="text-slate-500 text-sm">
        Nothing matches your current filters. Try adjusting categories or time.
      </p>
      <p v-else-if="categories.length === 0" class="text-slate-500 text-sm">
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
</style>
