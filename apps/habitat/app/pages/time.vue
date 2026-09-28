<script setup lang="ts">
import type { FocusSession, Todo } from '~/types/database'

const db = useDatabase()
const timer = reactive(useTimer())
const sessions = ref<FocusSession[]>([])
const todos = ref<Todo[]>([])
const totalMinutes = computed(() =>
  Math.round(
    sessions.value
      .filter((s) => s.completed_at.slice(0, 10) === new Date().toISOString().slice(0, 10))
      .reduce((sum, s) => sum + s.duration_seconds, 0) / 60,
  ),
)
const titleFor = (session: FocusSession) =>
  todos.value.find((todo) => todo.id === session.todo_id)?.title ?? 'Deleted task'
onMounted(async () => {
  ;[sessions.value, todos.value] = await Promise.all([db.getFocusSessions(), db.getTodos()])
})
</script>
<template><div class="space-y-5"><header><p class="text-sm text-(--ui-text-dimmed)">Completed task focus</p><h1 class="text-2xl font-bold">Time</h1></header><AppCard><p class="text-xs text-(--ui-text-dimmed)">Today</p><p class="text-4xl font-bold type-duration">{{ totalMinutes }}m</p><UButton v-if="timer.isActive" to="/focus" size="sm" class="mt-2">Resume timer</UButton></AppCard><AppListSection title="Recent sessions"><EmptyState v-if="!sessions.length" icon="timer" title="No completed focus sessions" description="Finish a TODO from the focus timer to record time here." /><ul v-else class="space-y-2"><AppCard v-for="session in sessions" :key="session.id" tag="li"><div class="flex justify-between gap-2"><p class="font-medium">{{ titleFor(session) }}</p><p class="type-duration text-sm">{{ Math.round(session.duration_seconds / 60) }}m</p></div><p class="text-xs text-(--ui-text-dimmed)">{{ new Date(session.completed_at).toLocaleString() }}</p></AppCard></ul></AppListSection></div></template>
