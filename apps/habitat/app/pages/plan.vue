<script setup lang="ts">
import type { HabitWithSchedule, Todo } from '~/types/database'

const db = useDatabase()
const today = new Date().toISOString().slice(0, 10)
const selectedDate = ref(today)
const mode = ref<'day' | 'week'>('day')
const todos = ref<Todo[]>([])
const habits = ref<HabitWithSchedule[]>([])
const loading = ref(true)

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10)
}
function move(days: number) {
  const d = new Date(`${selectedDate.value}T12:00:00`)
  d.setDate(d.getDate() + days)
  selectedDate.value = dateKey(d)
}
const days = computed(() => {
  const start = new Date(`${selectedDate.value}T12:00:00`)
  start.setDate(start.getDate() - (mode.value === 'week' ? start.getDay() : 0))
  return Array.from({ length: mode.value === 'week' ? 7 : 1 }, (_, index) => {
    const d = new Date(start)
    d.setDate(d.getDate() + index)
    return dateKey(d)
  })
})
function tasksFor(day: string) {
  return todos.value
    .filter((t) => !t.archived_at && !t.is_done && t.due_date === day)
    .sort((a, b) => (a.scheduled_time ?? '99:99').localeCompare(b.scheduled_time ?? '99:99'))
}
function habitsFor(day: string) {
  const dow = new Date(`${day}T12:00:00`).getDay()
  return habits.value.filter((h) => {
    const s = h.schedule
    return s?.due_time && (s.schedule_type !== 'SPECIFIC_DAYS' || s.days_of_week?.includes(dow))
  })
}
const unscheduled = computed(() =>
  todos.value.filter((t) => !t.archived_at && !t.is_done && !t.scheduled_time),
)
async function toggle(todo: Todo) {
  await db.toggleTodo(todo.id)
  todos.value = await db.getTodos()
}
onMounted(async () => {
  ;[todos.value, habits.value] = await Promise.all([db.getTodos(), db.getHabits()])
  loading.value = false
})
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-end justify-between gap-3"><div><p class="text-sm text-(--ui-text-dimmed)">Make space for what matters</p><h1 class="text-2xl font-bold">Plan</h1></div><div class="flex rounded-lg bg-(--ui-bg-elevated) p-0.5"><button v-for="item in ['day', 'week'] as const" :key="item" class="px-3 py-1.5 text-sm capitalize rounded-md" :class="mode === item ? 'bg-(--ui-bg) shadow-sm' : 'text-(--ui-text-dimmed)'" @click="mode = item">{{ item }}</button></div></header>
    <div class="flex items-center justify-between"><UButton :icon="resolveIcon('chevron-left')" color="neutral" variant="ghost" aria-label="Previous period" @click="move(mode === 'week' ? -7 : -1)" /><button class="font-semibold" @click="selectedDate = today">{{ mode === 'day' ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : 'This week' }}</button><UButton :icon="resolveIcon('chevron-right')" color="neutral" variant="ghost" aria-label="Next period" @click="move(mode === 'week' ? 7 : 1)" /></div>
    <div v-if="loading"><AppSkeleton variant="row" :count="4" /></div>
    <div v-else class="grid gap-3" :class="mode === 'week' ? 'sm:grid-cols-7' : ''">
      <section v-for="day in days" :key="day" class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-3 min-h-56">
        <p class="text-xs font-semibold text-(--ui-text-muted)">{{ new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }}</p>
        <div v-for="habit in habitsFor(day)" :key="habit.id" class="flex gap-2 text-xs text-(--ui-text-dimmed)"><span class="type-code">{{ habit.schedule?.due_time }}</span><span>{{ habit.name }}</span></div>
        <button v-for="todo in tasksFor(day)" :key="todo.id" class="w-full text-left rounded-xl border-l-4 bg-(--ui-bg) p-2.5" :class="todo.priority === 'high' ? 'border-red-500' : todo.priority === 'medium' ? 'border-amber-500' : 'border-slate-500'" @click="toggle(todo)"><span class="block text-xs text-(--ui-text-dimmed)">{{ todo.scheduled_time || 'Any time' }} · {{ todo.estimated_minutes ?? 0 }}m</span><span class="text-sm font-medium">{{ todo.title }}</span></button>
        <p v-if="!tasksFor(day).length && !habitsFor(day).length" class="pt-6 text-center text-xs text-(--ui-text-dimmed)">Open time</p>
      </section>
    </div>
    <AppListSection v-if="unscheduled.length" title="Unscheduled"><ul class="space-y-2"><AppCard v-for="todo in unscheduled" :key="todo.id" tag="li"><p class="font-medium">{{ todo.title }}</p><p class="text-xs text-(--ui-text-dimmed)">Assign a start time from Tasks</p></AppCard></ul></AppListSection>
  </div>
</template>
