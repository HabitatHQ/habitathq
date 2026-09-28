<script setup lang="ts">
import type { Completion, Scribble, Todo } from '~/types/database'

type CalendarView = 'month' | 'week'

const db = useDatabase()
const now = new Date()
const today = now.toISOString().slice(0, 10)
const calendarView = ref<CalendarView>('month')
const cursor = ref(new Date(now.getFullYear(), now.getMonth(), 1))
const selected = ref(today)
const todos = ref<Todo[]>([])
const notes = ref<Scribble[]>([])
const completions = ref<Completion[]>([])
const loading = ref(true)

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dateFor(key: string) {
  return new Date(`${key}T12:00:00`)
}

function startOfWeek(date: Date) {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  return start
}

function daysFrom(start: Date, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return dateKey(date)
  })
}

const visibleDays = computed(() => {
  if (calendarView.value === 'week') return daysFrom(startOfWeek(cursor.value), 7)
  const monthStart = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1)
  monthStart.setDate(1 - monthStart.getDay())
  return daysFrom(monthStart, 42)
})

const periodTitle = computed(() => {
  if (calendarView.value === 'month') {
    return cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const [first, last] = [visibleDays.value[0], visibleDays.value.at(-1)]
  if (!first || !last) return ''
  const start = dateFor(first)
  const end = dateFor(last)
  const month = start.toLocaleDateString(undefined, { month: 'short' })
  const endMonth = end.toLocaleDateString(undefined, { month: 'short' })
  return `${month} ${start.getDate()} – ${endMonth} ${end.getDate()}`
})

const selectedTodos = computed(() =>
  todos.value.filter((todo) => todo.due_date === selected.value && !todo.archived_at),
)
const selectedNotes = computed(() =>
  notes.value.filter((note) => note.entry_date === selected.value),
)
const selectedHabits = computed(() =>
  completions.value.filter((completion) => completion.date === selected.value),
)

function isCurrentMonth(date: string) {
  return dateFor(date).getMonth() === cursor.value.getMonth()
}

function taskCount(date: string) {
  return todos.value.filter((todo) => !todo.is_done && todo.due_date === date).length
}

function noteCount(date: string) {
  return notes.value.filter((note) => note.entry_date === date).length
}

function completionCount(date: string) {
  return completions.value.filter((completion) => completion.date === date).length
}

async function loadPeriod() {
  const first = visibleDays.value[0]
  const last = visibleDays.value.at(-1)
  if (!first || !last) return
  completions.value = await db.getCompletionsForDateRange(first, last)
}

async function selectView(nextView: CalendarView) {
  if (calendarView.value === nextView) return
  calendarView.value = nextView
  const selectedDate = dateFor(selected.value)
  cursor.value =
    nextView === 'month'
      ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
      : selectedDate
  await loadPeriod()
}

async function movePeriod(direction: -1 | 1) {
  const next = new Date(cursor.value)
  if (calendarView.value === 'month') next.setMonth(next.getMonth() + direction)
  else next.setDate(next.getDate() + direction * 7)
  cursor.value = next
  await loadPeriod()
}

async function goToToday() {
  selected.value = today
  const date = dateFor(today)
  cursor.value =
    calendarView.value === 'month' ? new Date(date.getFullYear(), date.getMonth(), 1) : date
  await loadPeriod()
}

onMounted(async () => {
  ;[todos.value, notes.value] = await Promise.all([db.getTodos(), db.getScribbles()])
  await loadPeriod()
  loading.value = false
})
</script>

<template>
  <div class="space-y-5 pb-24">
    <header>
      <p class="text-sm text-(--ui-text-dimmed)">A record of your effort and reflections</p>
      <h1 class="text-3xl font-bold tracking-tight">Calendar</h1>
    </header>

    <section class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3 shadow-sm">
      <div class="mb-4 flex items-center justify-between gap-3">
        <UButton :icon="resolveIcon('chevron-left')" color="neutral" variant="ghost" aria-label="Previous period" @click="movePeriod(-1)" />
        <button type="button" class="text-sm font-bold text-(--ui-text)" @click="goToToday">{{ periodTitle }}</button>
        <UButton :icon="resolveIcon('chevron-right')" color="neutral" variant="ghost" aria-label="Next period" @click="movePeriod(1)" />
      </div>

      <div class="mb-4 flex rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-1" role="tablist" aria-label="Calendar view">
        <button
          v-for="view in ['month', 'week'] as CalendarView[]"
          :key="view"
          type="button"
          role="tab"
          :aria-selected="calendarView === view"
          class="flex-1 rounded-lg py-1.5 text-sm font-semibold capitalize transition-colors"
          :class="calendarView === view ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed)'"
          @click="selectView(view)"
        >
          {{ view }}
        </button>
      </div>

      <div class="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">
        <span v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="pb-2">{{ day }}</span>
      </div>
      <div class="grid grid-cols-7 gap-1" :class="calendarView === 'week' ? 'sm:gap-2' : ''" aria-label="Calendar dates">
        <button
          v-for="date in visibleDays"
          :key="date"
          type="button"
          class="relative flex flex-col rounded-xl p-1.5 text-left transition-colors"
          :class="[
            calendarView === 'week' ? 'min-h-28 sm:min-h-36' : 'min-h-14 sm:min-h-20',
            date === selected ? 'bg-primary-500 text-white shadow-sm' : date === today ? 'bg-primary-500/10 text-(--ui-text)' : 'text-(--ui-text)',
            calendarView === 'month' && !isCurrentMonth(date) && date !== selected ? 'opacity-35' : 'hover:bg-(--ui-bg-muted)',
          ]"
          :aria-label="dateFor(date).toLocaleDateString()"
          @click="selected = date"
        >
          <span class="text-sm font-bold">{{ dateFor(date).getDate() }}</span>
          <span v-if="calendarView === 'week'" class="mt-1 hidden text-[11px] font-medium sm:block" :class="date === selected ? 'text-white/75' : 'text-(--ui-text-dimmed)'">{{ taskCount(date) ? `${taskCount(date)} task${taskCount(date) === 1 ? '' : 's'}` : 'Open' }}</span>
          <span class="mt-auto flex gap-1"><i v-if="completionCount(date)" class="h-1.5 w-1.5 rounded-full" :class="date === selected ? 'bg-white' : 'bg-emerald-500'" /><i v-if="taskCount(date)" class="h-1.5 w-1.5 rounded-full" :class="date === selected ? 'bg-white/75' : 'bg-amber-500'" /><i v-if="noteCount(date)" class="h-1.5 w-1.5 rounded-full" :class="date === selected ? 'bg-white/55' : 'bg-primary-500'" /></span>
        </button>
      </div>
    </section>

    <section class="overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated)">
      <div class="border-b border-(--ui-border) px-4 py-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">{{ dateFor(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }}</p>
        <h2 class="mt-0.5 text-lg font-bold">Day details</h2>
      </div>
      <div v-if="loading" class="p-4"><AppSkeleton variant="row" :count="3" /></div>
      <div v-else class="space-y-2 p-3">
        <AppCard v-if="selectedHabits.length" class="border-emerald-500/20 bg-emerald-500/5"><div class="flex items-center gap-3"><span class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500"><AppIcon name="check" class="h-4 w-4" /></span><div><p class="font-semibold">{{ selectedHabits.length }} habit {{ selectedHabits.length === 1 ? 'completion' : 'completions' }}</p><p class="text-xs text-(--ui-text-dimmed)">Progress you logged on this day</p></div></div></AppCard>
        <AppCard v-for="todo in selectedTodos" :key="todo.id" class="transition-colors hover:bg-(--ui-bg-muted)"><div class="flex items-center gap-3"><span class="h-2.5 w-2.5 rounded-full" :class="todo.is_done ? 'bg-emerald-500' : todo.priority === 'high' ? 'bg-red-500' : 'bg-amber-500'" /><div class="min-w-0 flex-1"><p class="truncate font-semibold" :class="todo.is_done ? 'text-(--ui-text-dimmed) line-through' : ''">{{ todo.title }}</p><p class="mt-0.5 text-xs text-(--ui-text-dimmed)">{{ todo.scheduled_time || 'Any time' }}<template v-if="todo.estimated_minutes"> · {{ todo.estimated_minutes }} min</template></p></div></div></AppCard>
        <AppCard v-for="note in selectedNotes" :key="note.id" tag="NuxtLink" :to="`/jots/edit-${note.id}`" class="transition-colors hover:bg-(--ui-bg-muted)"><div class="flex items-start gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-500"><AppIcon name="document-text" class="h-4 w-4" /></span><div class="min-w-0"><p class="font-semibold">{{ note.title || 'Untitled note' }}</p><p class="mt-0.5 truncate text-xs text-(--ui-text-dimmed)">{{ note.content }}</p></div></div></AppCard>
        <div v-if="!selectedTodos.length && !selectedNotes.length && !selectedHabits.length" class="px-5 py-8 text-center"><p class="font-semibold">A quiet day</p><p class="mt-1 text-sm text-(--ui-text-dimmed)">Add a note to remember what mattered.</p></div>
        <UButton :to="`/jots/new?date=${selected}`" variant="soft" color="primary" block :icon="resolveIcon('plus')">Add a note for this day</UButton>
      </div>
    </section>
    <p class="flex justify-center gap-3 text-xs text-(--ui-text-dimmed)"><span><i class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />Habits</span><span><i class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />Tasks</span><span><i class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-500" />Notes</span></p>
  </div>
</template>
