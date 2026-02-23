<script setup lang="ts">
import type { BoredCategory, BoredOracleResult } from '~/types/database'

const db = useDatabase()

const categories = ref<BoredCategory[]>([])
const currentResult = ref<BoredOracleResult | null>(null)
const shaking = ref(false)
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
  await new Promise(r => setTimeout(r, 400))
  currentResult.value = await db.getBoredOracle([...excludedCategories.value], maxMinutes.value)
  shaking.value = false
}

async function markDone() {
  if (!currentResult.value) return
  if (currentResult.value.source === 'activity') {
    await db.markBoredActivityDone(currentResult.value.activity.id)
  } else {
    await db.toggleTodo(currentResult.value.todo.id)
  }
  currentResult.value = await db.getBoredOracle([...excludedCategories.value], maxMinutes.value)
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
    <div class="flex flex-col items-center gap-6 py-4">
      <button
        class="w-48 h-48 rounded-full relative cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        :class="shaking ? 'animate-shake' : ''"
        style="background: radial-gradient(circle at 35% 35%, #334155, #020617)"
        aria-label="Roll the oracle"
        @click="roll"
      >
        <!-- Gloss overlay -->
        <div class="absolute inset-0 rounded-full" style="background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.12) 0%, transparent 65%)" />
        <!-- Inner circle -->
        <div class="absolute inset-8 rounded-full flex flex-col items-center justify-center gap-1"
             style="background: radial-gradient(circle at 40% 40%, #1e1b4b, #030712)">
          <template v-if="currentResult && !shaking">
            <UIcon
              v-if="resultCategory"
              :name="resultCategory.icon"
              class="w-7 h-7"
              :style="{ color: resultCategory.color }"
            />
            <span v-if="resultCategory" class="text-xs font-medium text-center leading-tight px-2"
                  :style="{ color: resultCategory.color }">
              {{ resultCategory.name }}
            </span>
          </template>
          <span v-else class="text-4xl font-bold text-slate-400 select-none">?</span>
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
      <p v-if="categories.length === 0" class="text-slate-500 text-sm">
        No activities yet. <NuxtLink to="/bored/activities" class="text-primary-400 underline">Add some</NuxtLink> to get started.
      </p>
    </div>
  </div>
</template>

<style scoped>
@keyframes shake {
  0%   { transform: rotate(0deg) scale(1); }
  15%  { transform: rotate(-8deg) scale(1.05); }
  30%  { transform: rotate(8deg) scale(1.05); }
  45%  { transform: rotate(-6deg) scale(1.03); }
  60%  { transform: rotate(6deg) scale(1.03); }
  75%  { transform: rotate(-3deg) scale(1.01); }
  90%  { transform: rotate(3deg) scale(1.01); }
  100% { transform: rotate(0deg) scale(1); }
}

.animate-shake {
  animation: shake 0.5s ease-in-out;
}
</style>
