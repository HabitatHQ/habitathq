<script setup lang="ts">
import type { HabitWithSchedule, Todo } from '~/types/database'

type ViewMode = 'day' | 'week'
type AgendaItem = {
  id: string
  label: string
  time: string
  duration: number | null
  kind: 'todo' | 'habit'
  color: string
  priority?: Todo['priority']
  done?: boolean
  todo?: Todo
}

const db = useDatabase()
const today = new Date().toISOString().slice(0, 10)
const selectedDate = ref(today)
const mode = ref<ViewMode>('day')
const todos = ref<Todo[]>([])
const habits = ref<HabitWithSchedule[]>([])
const loading = ref(true)

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}
function dateFor(key: string) {
  return new Date(`${key}T12:00:00`)
}
function move(days: number) {
  const date = dateFor(selectedDate.value)
  date.setDate(date.getDate() + days)
  selectedDate.value = dateKey(date)
}
const visibleDays = computed(() => {
  const start = dateFor(selectedDate.value)
  if (mode.value === 'week') start.setDate(start.getDate() - start.getDay())
  return Array.from({ length: mode.value === 'week' ? 7 : 1 }, (_, index) => {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    return dateKey(date)
  })
})
function isHabitScheduled(habit: HabitWithSchedule, date: string) {
  const schedule = habit.schedule
  if (!schedule?.due_time) return false
  if (schedule.schedule_type === 'DAILY') return true
  if (schedule.schedule_type === 'SPECIFIC_DAYS')
    return schedule.days_of_week?.includes(dateFor(date).getDay()) ?? false
  return true
}
function agendaFor(date: string): AgendaItem[] {
  const scheduledTodos = todos.value
    .filter((todo) => !todo.archived_at && todo.due_date === date && todo.scheduled_time)
    .map(
      (todo): AgendaItem => ({
        id: todo.id,
        label: todo.title,
        time: todo.scheduled_time ?? '',
        duration: todo.estimated_minutes,
        kind: 'todo',
        color:
          todo.priority === 'high' ? '#ef4444' : todo.priority === 'medium' ? '#f59e0b' : '#64748b',
        priority: todo.priority,
        done: todo.is_done,
        todo,
      }),
    )
  const timedHabits = habits.value
    .filter((habit) => isHabitScheduled(habit, date))
    .map(
      (habit): AgendaItem => ({
        id: `habit-${habit.id}`,
        label: habit.name,
        time: habit.schedule?.due_time ?? '',
        duration: null,
        kind: 'habit',
        color: habit.color,
      }),
    )
  return [...scheduledTodos, ...timedHabits].sort((a, b) => a.time.localeCompare(b.time))
}
const dayAgenda = computed(() => agendaFor(selectedDate.value))
const plannedTodos = computed(() =>
  todos.value.filter((todo) => !todo.archived_at && todo.due_date === selectedDate.value),
)
const completeCount = computed(() => plannedTodos.value.filter((todo) => todo.is_done).length)
const unscheduled = computed(() =>
  todos.value.filter((todo) => !todo.archived_at && !todo.is_done && !todo.scheduled_time),
)
const title = computed(() =>
  mode.value === 'week'
    ? 'This week'
    : dateFor(selectedDate.value).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
)
async function toggleTodo(todo: Todo) {
  await db.toggleTodo(todo.id)
  todos.value = await db.getTodos()
}
onMounted(async () => {
  ;[todos.value, habits.value] = await Promise.all([db.getTodos(), db.getHabits()])
  loading.value = false
})
</script>

<template>
  <div class="space-y-5 pb-24">
    <header class="flex items-end justify-between gap-4"><div><p class="text-sm text-(--ui-text-dimmed)">Make room for what matters</p><h1 class="text-3xl font-bold tracking-tight">Plan</h1></div><div class="flex rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) p-1" role="tablist" aria-label="Plan view"><button v-for="view in ['day', 'week'] as ViewMode[]" :key="view" type="button" role="tab" :aria-selected="mode === view" class="rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition-colors" :class="mode === view ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed)'" @click="mode = view">{{ view }}</button></div></header>
    <section class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3 shadow-sm"><div class="flex items-center justify-between gap-2"><UButton :icon="resolveIcon('chevron-left')" color="neutral" variant="ghost" aria-label="Previous period" @click="move(mode === 'week' ? -7 : -1)" /><button type="button" class="rounded-lg px-3 py-2 text-center" @click="selectedDate = today"><p class="text-sm font-bold text-(--ui-text)">{{ title }}</p><p v-if="mode === 'day'" class="text-xs text-(--ui-text-dimmed)">{{ completeCount }} of {{ plannedTodos.length }} tasks complete</p><p v-else class="text-xs text-(--ui-text-dimmed)">Tap a day to make it your focus</p></button><UButton :icon="resolveIcon('chevron-right')" color="neutral" variant="ghost" aria-label="Next period" @click="move(mode === 'week' ? 7 : 1)" /></div></section>
    <AppSkeleton v-if="loading" variant="row" :count="5" />
    <template v-else-if="mode === 'day'">
      <section class="overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated)"><div class="flex items-center justify-between border-b border-(--ui-border) px-4 py-3"><div><h2 class="font-semibold">Today’s timeline</h2><p class="text-xs text-(--ui-text-dimmed)">Timed habits and tasks, in order</p></div><span class="rounded-full bg-primary-500/10 px-2.5 py-1 text-xs font-semibold text-primary-500">{{ dayAgenda.length }} planned</span></div><div v-if="dayAgenda.length" class="divide-y divide-(--ui-border)"><div v-for="item in dayAgenda" :key="item.id" class="group grid grid-cols-[3.5rem_1fr] gap-3 px-4 py-3"><p class="pt-2 text-right font-mono text-xs font-semibold text-(--ui-text-dimmed)">{{ item.time }}</p><button v-if="item.todo" type="button" class="relative flex min-h-14 w-full items-center gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg) px-3 text-left transition-colors hover:bg-(--ui-bg-muted)" :class="item.done ? 'opacity-60' : ''" @click="toggleTodo(item.todo)"><span class="h-8 w-1 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" /><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold" :class="item.done ? 'line-through text-(--ui-text-dimmed)' : 'text-(--ui-text)'">{{ item.label }}</span><span class="mt-0.5 block text-xs text-(--ui-text-dimmed)">{{ item.duration }} min · {{ item.priority }} priority</span></span><span class="flex h-5 w-5 items-center justify-center rounded-full border" :class="item.done ? 'border-primary-500 bg-primary-500 text-white' : 'border-(--ui-border)'"><AppIcon v-if="item.done" name="check" class="h-3.5 w-3.5" /></span></button><div v-else class="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-(--ui-border) bg-(--ui-bg-muted)/45 px-3"><span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: item.color }" /><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-(--ui-text)">{{ item.label }}</span><span class="mt-0.5 block text-xs text-(--ui-text-dimmed)">Habit reminder</span></span><AppIcon name="sparkles" class="h-4 w-4 text-(--ui-text-dimmed)" /></div></div></div><div v-else class="px-6 py-12 text-center"><AppIcon name="clock" class="mx-auto h-7 w-7 text-(--ui-text-dimmed)" /><p class="mt-3 font-semibold">Open time</p><p class="mt-1 text-sm text-(--ui-text-dimmed)">Schedule a task from its edit sheet to make a plan.</p></div></section>
      <section v-if="unscheduled.length" class="space-y-2"><div class="flex items-end justify-between px-1"><div><h2 class="font-semibold">Backlog</h2><p class="text-xs text-(--ui-text-dimmed)">Unscheduled tasks waiting for a place</p></div><span class="text-sm font-semibold text-(--ui-text-dimmed)">{{ unscheduled.length }}</span></div><ul class="space-y-2"><AppCard v-for="todo in unscheduled" :key="todo.id" tag="li" class="flex items-center gap-3"><span class="h-2.5 w-2.5 rounded-full" :class="todo.priority === 'high' ? 'bg-red-500' : todo.priority === 'medium' ? 'bg-amber-500' : 'bg-slate-400'" /><div class="min-w-0 flex-1"><p class="truncate font-semibold">{{ todo.title }}</p><p class="text-xs text-(--ui-text-dimmed)">{{ todo.due_date ? `Due ${todo.due_date}` : 'No due date' }}</p></div></AppCard></ul></section>
    </template>
    <section v-else class="grid gap-3 sm:grid-cols-7"><button v-for="day in visibleDays" :key="day" type="button" class="min-h-44 rounded-2xl border p-3 text-left transition-colors hover:bg-(--ui-bg-elevated)" :class="day === selectedDate ? 'border-primary-400 bg-primary-500/5 ring-1 ring-primary-500/20' : 'border-(--ui-border) bg-(--ui-bg-elevated)'" @click="selectedDate = day; mode = 'day'"><p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">{{ dateFor(day).toLocaleDateString(undefined, { weekday: 'short' }) }}</p><p class="mt-0.5 text-xl font-bold">{{ dateFor(day).getDate() }}</p><div class="mt-4 space-y-2"><div v-for="item in agendaFor(day).slice(0, 4)" :key="item.id" class="flex items-center gap-2 text-xs"><span class="h-2 w-2 rounded-full" :style="{ backgroundColor: item.color }" /><span class="w-9 shrink-0 font-mono text-(--ui-text-dimmed)">{{ item.time }}</span><span class="truncate font-medium">{{ item.label }}</span></div><p v-if="!agendaFor(day).length" class="pt-4 text-xs text-(--ui-text-dimmed)">Open time</p><p v-if="agendaFor(day).length > 4" class="text-xs text-(--ui-text-dimmed)">+{{ agendaFor(day).length - 4 }} more</p></div></button></section>
  </div>
</template>
