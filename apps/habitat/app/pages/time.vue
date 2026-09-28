<script setup lang="ts">
import type { FocusSession, Todo } from '~/types/database'

const db = useDatabase()
const timer = reactive(useTimer())
const sessions = ref<FocusSession[]>([])
const todos = ref<Todo[]>([])
const today = new Date().toISOString().slice(0, 10)
const todaySessions = computed(() =>
  sessions.value.filter((session) => session.completed_at.slice(0, 10) === today),
)
const totalMinutes = computed(() =>
  Math.round(todaySessions.value.reduce((sum, session) => sum + session.duration_seconds, 0) / 60),
)
const totalLabel = computed(() =>
  totalMinutes.value >= 60
    ? `${Math.floor(totalMinutes.value / 60)}h ${totalMinutes.value % 60}m`
    : `${totalMinutes.value}m`,
)
const averageMinutes = computed(() =>
  sessions.value.length
    ? Math.round(
        sessions.value.reduce((sum, session) => sum + session.duration_seconds, 0) /
          sessions.value.length /
          60,
      )
    : 0,
)
const titleFor = (session: FocusSession) =>
  todos.value.find((todo) => todo.id === session.todo_id)?.title ?? 'Completed task'
function displayDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
onMounted(async () => {
  ;[sessions.value, todos.value] = await Promise.all([db.getFocusSessions(), db.getTodos()])
})
</script>

<template>
  <div class="space-y-5 pb-4"><header><p class="text-sm text-(--ui-text-dimmed)">Time that ended in a completed task</p><h1 class="text-3xl font-bold tracking-tight">Focus time</h1></header><section class="overflow-hidden rounded-3xl bg-primary-500 p-5 text-white shadow-lg shadow-primary-500/20"><div class="flex items-start justify-between gap-4"><div><p class="text-sm font-medium text-white/75">Today’s focused work</p><p class="mt-2 text-5xl font-bold tracking-tight type-duration">{{ totalLabel }}</p><p class="mt-2 text-sm text-white/75">{{ todaySessions.length }} completed session<span v-if="todaySessions.length !== 1">s</span></p></div><span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><AppIcon name="timer" class="h-6 w-6" /></span></div><UButton v-if="timer.isActive" to="/focus" color="neutral" variant="solid" class="mt-5 bg-white text-primary-600 hover:bg-white/90">Resume active timer</UButton><p v-else class="mt-5 border-t border-white/15 pt-4 text-sm text-white/80">Focus time is recorded only when you finish a TODO from the timer.</p></section><div class="grid grid-cols-2 gap-3"><AppCard><p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Sessions</p><p class="mt-1 text-2xl font-bold type-duration">{{ sessions.length }}</p><p class="text-xs text-(--ui-text-dimmed)">all time</p></AppCard><AppCard><p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">Average</p><p class="mt-1 text-2xl font-bold type-duration">{{ averageMinutes }}m</p><p class="text-xs text-(--ui-text-dimmed)">per session</p></AppCard></div><section class="space-y-2"><div class="flex items-end justify-between px-1"><div><h2 class="font-semibold">Session history</h2><p class="text-xs text-(--ui-text-dimmed)">Only completed work is kept here</p></div><span v-if="sessions.length" class="text-sm font-semibold text-(--ui-text-dimmed)">{{ sessions.length }}</span></div><EmptyState v-if="!sessions.length" icon="timer" title="No completed focus sessions" description="Start a timer on a TODO, then complete it to record your effort." /><ul v-else class="divide-y divide-(--ui-border) overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated)"><li v-for="session in sessions" :key="session.id" class="flex items-center gap-3 px-4 py-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-500"><AppIcon name="timer" class="h-4 w-4" /></span><div class="min-w-0 flex-1"><p class="truncate font-semibold">{{ titleFor(session) }}</p><p class="text-xs text-(--ui-text-dimmed)">{{ displayDate(session.completed_at) }}</p></div><span class="font-mono text-sm font-bold type-duration">{{ Math.round(session.duration_seconds / 60) }}m</span></li></ul></section></div>
</template>
