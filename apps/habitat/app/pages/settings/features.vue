<script setup lang="ts">
const db = useDatabase()
const { settings: appSettings, set: setAppSetting } = useAppSettings()

const showHealthSetup = ref(false)
const creatingHealth = ref(false)

const healthSetup = reactive({
  enableSteps: true,
  stepGoal: 10000,
  enableMeals: true,
  meals: [
    { name: 'Breakfast', calories: 600 },
    { name: 'Lunch', calories: 600 },
    { name: 'Dinner', calories: 600 },
  ] as { name: string; calories: number }[],
  enableWater: true,
  waterGoal: 8,
  enableSleep: true,
  sleepGoal: 8,
})

function addMeal() {
  healthSetup.meals.push({ name: '', calories: 600 })
}
function removeMeal(i: number) {
  healthSetup.meals.splice(i, 1)
}

async function onHealthToggle(value: boolean) {
  setAppSetting('enableHealth', value)
  if (value && db.isAvailable) {
    const allHabits = await db.getHabits()
    if (!allHabits.some((h) => h.tags.includes('habitat-health'))) {
      showHealthSetup.value = true
    }
  }
}

async function confirmHealthSetup() {
  if (!db.isAvailable) return
  creatingHealth.value = true
  try {
    const base = { description: '', frequency: 'daily', annotations: {}, paused_until: null }
    if (healthSetup.enableSteps) {
      await db.createHabit({
        ...base,
        name: 'Steps',
        type: 'NUMERIC',
        target_value: healthSetup.stepGoal,
        color: '#ef4444',
        icon: 'i-heroicons-fire',
        tags: ['habitat-health', 'habitat-steps'],
      })
    }
    if (healthSetup.enableMeals) {
      for (const meal of healthSetup.meals) {
        if (!meal.name.trim()) continue
        await db.createHabit({
          ...base,
          name: meal.name.trim(),
          type: 'LIMIT',
          target_value: meal.calories,
          color: '#f59e0b',
          icon: 'i-heroicons-sparkles',
          tags: ['habitat-health', 'habitat-meals'],
        })
      }
    }
    if (healthSetup.enableWater) {
      await db.createHabit({
        ...base,
        name: 'Water',
        type: 'NUMERIC',
        target_value: healthSetup.waterGoal,
        color: '#0ea5e9',
        icon: 'i-heroicons-beaker',
        tags: ['habitat-health', 'habitat-water'],
      })
    }
    if (healthSetup.enableSleep) {
      await db.createHabit({
        ...base,
        name: 'Sleep',
        type: 'NUMERIC',
        target_value: healthSetup.sleepGoal,
        color: '#6366f1',
        icon: 'i-heroicons-moon',
        tags: ['habitat-health', 'habitat-sleep'],
      })
    }
    showHealthSetup.value = false
  } finally {
    creatingHealth.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center gap-2 mb-4">
      <NuxtLink to="/settings" class="sm:hidden p-1 -ml-1 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
        <UIcon name="i-heroicons-chevron-left" class="w-5 h-5" />
      </NuxtLink>
      <h2 class="text-xl font-bold">Features</h2>
    </header>

    <section class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Feature flags</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable Journalling</p>
            <p class="text-xs text-(--ui-text-dimmed)">Show Check-in, Scribbles, and Voice in the navigation.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableJournalling"
            @update:model-value="setAppSetting('enableJournalling', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable Health</p>
            <p class="text-xs text-(--ui-text-dimmed)">Track daily steps and meal calories.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableHealth"
            @update:model-value="onHealthToggle"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable TODOs</p>
            <p class="text-xs text-(--ui-text-dimmed)">Standalone task tracker with due dates, priorities, and recurring tasks.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableTodos"
            @update:model-value="setAppSetting('enableTodos', $event)"
          />
        </div>

        <div v-if="appSettings.enableTodos" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Enable "I'm Bored" Mode</p>
            <p class="text-xs text-(--ui-text-dimmed)">Magic 8-ball oracle that suggests activities from curated categories.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableBored"
            @update:model-value="setAppSetting('enableBored', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Context Filter</p>
            <p class="text-xs text-(--ui-text-dimmed)">Tag icon in the header lets you filter habits, todos, and bored suggestions by shared tags.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableContextFilter"
            @update:model-value="setAppSetting('enableContextFilter', $event)"
          />
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Timer & Focus</p>
            <p class="text-xs text-(--ui-text-dimmed)">Start button on TODOs and Bored activities with stopwatch, countdown, and Pomodoro modes.</p>
          </div>
          <USwitch
            :model-value="appSettings.enableTimer"
            @update:model-value="setAppSetting('enableTimer', $event)"
          />
        </div>

        <div v-if="appSettings.enableJournalling" class="flex items-center justify-between px-4 py-3.5">
          <div class="space-y-0.5">
            <p class="text-sm font-medium">Save transcriptions</p>
            <p class="text-xs text-(--ui-text-dimmed)">After recording, offer to save the speech-to-text transcript as a Scribble tagged <code class="text-(--ui-text-muted)">habitat-transcribed</code>.</p>
          </div>
          <USwitch
            :model-value="appSettings.saveTranscribedNotes"
            @update:model-value="setAppSetting('saveTranscribedNotes', $event)"
          />
        </div>

      </UCard>
    </section>

    <!-- Pomodoro -->
    <section v-if="appSettings.enableTimer" class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) px-1">Pomodoro</p>
      <UCard :ui="{ root: 'rounded-2xl', body: 'p-0 sm:p-0 divide-y divide-slate-800' }">

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm font-medium">Work block</p>
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="90"
              :value="appSettings.pomodoroWorkMinutes"
              class="w-14 px-2 py-1 text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg text-center"
              @change="setAppSetting('pomodoroWorkMinutes', +($event.target as HTMLInputElement).value)"
            />
            <span class="text-xs text-(--ui-text-dimmed)">min</span>
          </div>
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm font-medium">Short break</p>
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="60"
              :value="appSettings.pomodoroShortBreakMinutes"
              class="w-14 px-2 py-1 text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg text-center"
              @change="setAppSetting('pomodoroShortBreakMinutes', +($event.target as HTMLInputElement).value)"
            />
            <span class="text-xs text-(--ui-text-dimmed)">min</span>
          </div>
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm font-medium">Long break</p>
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="60"
              :value="appSettings.pomodoroLongBreakMinutes"
              class="w-14 px-2 py-1 text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg text-center"
              @change="setAppSetting('pomodoroLongBreakMinutes', +($event.target as HTMLInputElement).value)"
            />
            <span class="text-xs text-(--ui-text-dimmed)">min</span>
          </div>
        </div>

        <div class="flex items-center justify-between px-4 py-3.5">
          <p class="text-sm font-medium">Cycles before long break</p>
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="10"
              :value="appSettings.pomodoroCyclesBeforeLong"
              class="w-14 px-2 py-1 text-sm bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg text-center"
              @change="setAppSetting('pomodoroCyclesBeforeLong', +($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>

      </UCard>
    </section>

    <!-- Health setup modal -->
    <UModal v-model:open="showHealthSetup">
      <template #content>
        <div class="p-5 space-y-5">
          <div>
            <h3 class="text-lg font-semibold">Set up Health Tracking</h3>
            <p class="text-sm text-(--ui-text-muted) mt-0.5">Choose what you'd like to track. Habits are created in your habit list.</p>
          </div>

          <!-- Steps -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableSteps" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Steps</p>
                <p class="text-xs text-(--ui-text-dimmed)">Creates a daily NUMERIC habit with your step goal.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableSteps" class="ml-7">
              <UFormField label="Daily step goal">
                <UInput
                  v-model.number="healthSetup.stepGoal"
                  type="number"
                  min="1000"
                  step="500"
                  class="w-40"
                />
              </UFormField>
            </div>
          </div>

          <!-- Meals -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableMeals" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Meals</p>
                <p class="text-xs text-(--ui-text-dimmed)">Creates LIMIT habits for calorie tracking per meal.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableMeals" class="ml-7 space-y-2">
              <div v-for="(meal, i) in healthSetup.meals" :key="i" class="flex items-center gap-2">
                <UInput v-model="meal.name" placeholder="Meal name" class="flex-1" />
                <UInput
                  v-model.number="meal.calories"
                  type="number"
                  min="0"
                  step="50"
                  class="w-24"
                />
                <span class="text-xs text-(--ui-text-dimmed) shrink-0">kcal</span>
                <button class="text-slate-700 hover:text-red-400 transition-colors shrink-0" @click="removeMeal(i)">
                  <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
                </button>
              </div>
              <button class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1 mt-1" @click="addMeal">
                <UIcon name="i-heroicons-plus" class="w-3 h-3" /> Add meal
              </button>
            </div>
          </div>

          <!-- Water -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableWater" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Water</p>
                <p class="text-xs text-(--ui-text-dimmed)">Creates a daily NUMERIC habit to count glasses.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableWater" class="ml-7">
              <UFormField label="Daily glasses goal">
                <UInput
                  v-model.number="healthSetup.waterGoal"
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  class="w-32"
                />
              </UFormField>
            </div>
          </div>

          <!-- Sleep -->
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="healthSetup.enableSleep" type="checkbox" class="rounded" />
              <div>
                <p class="text-sm font-medium">Track Sleep</p>
                <p class="text-xs text-(--ui-text-dimmed)">Creates a daily NUMERIC habit for hours slept.</p>
              </div>
            </label>
            <div v-if="healthSetup.enableSleep" class="ml-7">
              <UFormField label="Sleep goal (hours)">
                <UInput
                  v-model.number="healthSetup.sleepGoal"
                  type="number"
                  min="1"
                  max="12"
                  step="0.5"
                  class="w-32"
                />
              </UFormField>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <UButton variant="ghost" color="neutral" @click="showHealthSetup = false">Skip</UButton>
            <UButton
              color="primary"
              :disabled="!healthSetup.enableSteps && !healthSetup.enableMeals && !healthSetup.enableWater && !healthSetup.enableSleep"
              :loading="creatingHealth"
              @click="confirmHealthSetup"
            >
              Create Habits
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
