<script setup lang="ts">
import type { FocusSessionSummary, Todo } from '~/types/database'

const { settings } = useAppSettings()
const db = useDatabase()
const { selectionChanged } = useHaptics()

type TabKey = 'habits' | 'tasks' | 'focus' | 'checkins'
const tab = ref<TabKey>('habits')
const tabs = computed<{ key: TabKey; label: string }[]>(() => {
  const list: { key: TabKey; label: string }[] = [{ key: 'habits', label: 'Habits' }]
  if (settings.value.enableTodos) {
    list.push({ key: 'tasks', label: 'Tasks' }, { key: 'focus', label: 'Focus' })
  }
  if (settings.value.enableJournalling) list.push({ key: 'checkins', label: 'Check-ins' })
  return list
})
const todos = ref<Todo[]>([])
const focusSummary = ref<FocusSessionSummary>({ session_count: 0, total_seconds: 0 })
const completedTodos = computed(() =>
  todos.value.filter((todo) => todo.is_done && !todo.archived_at),
)
const openTodos = computed(() => todos.value.filter((todo) => !todo.is_done && !todo.archived_at))
const scheduledTodos = computed(() => openTodos.value.filter((todo) => todo.scheduled_time))
const focusMinutes = computed(() => Math.round(focusSummary.value.total_seconds / 60))
const averageFocusMinutes = computed(() =>
  focusSummary.value.session_count
    ? Math.round(focusMinutes.value / focusSummary.value.session_count)
    : 0,
)
function selectTab(nextTab: TabKey) {
  if (tab.value === nextTab) return
  tab.value = nextTab
  void selectionChanged()
}
onMounted(async () => {
  ;[todos.value, focusSummary.value] = await Promise.all([
    db.getTodos(),
    db.getFocusSessionSummary(),
  ])
})
</script>

<template>
  <div class="space-y-5">
    <header>
      <p class="text-sm text-(--ui-text-dimmed)">Notice the patterns, then adjust</p>
      <h2 class="text-3xl font-bold tracking-tight">Insights</h2>
    </header>

    <!-- Tabs -->
    <div
      v-if="tabs.length > 1"
      class="flex gap-1 p-1 rounded-full bg-(--ui-bg-elevated) border border-(--ui-border)"
      role="group"
      aria-label="Insights view"
    >
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        class="min-h-11 flex-1 text-sm font-semibold py-1.5 rounded-full transition-colors"
        :class="tab === tb.key ? 'bg-(--ui-bg-muted) text-(--ui-text)' : 'text-(--ui-text-dimmed)'"
        :aria-pressed="tab === tb.key"
        @click="selectTab(tb.key)"
      >
        {{ tb.label }}
      </button>
    </div>

    <!-- Habits stays mounted (v-show) to preserve its loaded state across tabs -->
    <HabitInsights v-show="tab === 'habits'" />
    <section v-if="tab === 'tasks'" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Completed</p>
          <p class="mt-1 text-3xl font-bold type-duration">{{ completedTodos.length }}</p>
          <p class="text-xs text-(--ui-text-dimmed)">tasks kept moving</p>
        </div>
        <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Scheduled</p>
          <p class="mt-1 text-3xl font-bold type-duration">{{ scheduledTodos.length }}</p>
          <p class="text-xs text-(--ui-text-dimmed)">still on the plan</p>
        </div>
      </div>
      <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="font-semibold">Your task rhythm</p>
            <p class="mt-1 text-sm text-(--ui-text-dimmed)">
              {{ openTodos.length }} open task<span v-if="openTodos.length !== 1">s</span> waiting
              for attention.
            </p>
          </div>
          <span
            class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500"
            ><AppIcon name="check" class="h-5 w-5"
          /></span>
        </div>
      </div>
    </section>
    <section v-else-if="tab === 'focus'" class="space-y-4">
      <section class="rounded-3xl bg-primary-500 p-5 text-white shadow-lg shadow-primary-500/20">
        <p class="text-sm font-medium text-white/75">Completed focus time</p>
        <p class="mt-2 text-5xl font-bold type-duration">{{ focusMinutes }}m</p>
        <p class="mt-2 text-sm text-white/75">
          Across {{ focusSummary.session_count }} session<span v-if="focusSummary.session_count !== 1">s</span>
        </p>
      </section>
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Average</p>
          <p class="mt-1 text-3xl font-bold type-duration">{{ averageFocusMinutes }}m</p>
          <p class="text-xs text-(--ui-text-dimmed)">per session</p>
        </div>
        <div class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Finished</p>
          <p class="mt-1 text-3xl font-bold type-duration">{{ focusSummary.session_count }}</p>
          <p class="text-xs text-(--ui-text-dimmed)">work blocks</p>
        </div>
      </div>
      <p class="px-1 text-sm text-(--ui-text-dimmed)">
        Only time attached to a completed TODO is included, so this stays a record of finished work.
      </p>
    </section>
    <CheckinInsights v-if="tab === 'checkins'" />
  </div>
</template>
