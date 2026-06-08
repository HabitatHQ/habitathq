<script setup lang="ts">
const { settings } = useAppSettings()

type TabKey = 'habits' | 'checkins'
const tab = ref<TabKey>('habits')
const tabs = computed<{ key: TabKey; label: string }[]>(() => {
  const list: { key: TabKey; label: string }[] = [{ key: 'habits', label: 'Habits' }]
  if (settings.value.enableJournalling) list.push({ key: 'checkins', label: 'Check-ins' })
  return list
})
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-(--ui-text-dimmed)">Overview</p>
      <h2 class="text-2xl font-bold">Insights</h2>
    </header>

    <!-- Tabs -->
    <div
      v-if="tabs.length > 1"
      class="flex gap-1 p-1 rounded-full bg-(--ui-bg-elevated) border border-(--ui-border)"
    >
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        class="flex-1 text-sm font-semibold py-1.5 rounded-full transition-colors"
        :class="tab === tb.key ? 'bg-(--ui-bg-muted) text-(--ui-text)' : 'text-(--ui-text-dimmed)'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
      </button>
    </div>

    <!-- Habits stays mounted (v-show) to preserve its loaded state across tabs -->
    <HabitInsights v-show="tab === 'habits'" />
    <CheckinInsights v-if="tab === 'checkins'" />
  </div>
</template>
