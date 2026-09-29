<script setup lang="ts">
import type { BoredCategory, Completion, HabitWithSchedule, Scribble, Todo } from '~/types/database'
import { hasCalendarNoteTag } from '~/utils/jots-helpers'
import {
  calendarDateFromQuery,
  calendarNotePrompt,
  dateForKey,
  daysFrom,
  expandTodoOccurrences,
  plannerDateKey,
  startOfWeek,
} from '~/utils/planner'

type CalendarView = 'day' | 'week' | 'month'
type AgendaItem = {
  id: string
  label: string
  time: string
  todo?: Todo
  color: string
  duration: number | null
}
type CalendarNotePayload = Pick<
  Scribble,
  'title' | 'content' | 'tags' | 'annotations' | 'entry_date'
>

const db = useDatabase()
const route = useRoute()
const { impact, selectionChanged, notification } = useHaptics()
const { suggest: suggestTags } = useTagSuggestions('todo')
const toast = useToast()
const calendarViews: CalendarView[] = ['day', 'week', 'month']
const today = plannerDateKey(new Date())
const calendarView = ref<CalendarView>('day')
const selected = ref(calendarDateFromQuery(route.query['date'], today))
const cursor = ref(dateForKey(selected.value))
const todos = ref<Todo[]>([])
const notes = ref<Scribble[]>([])
const completions = ref<Completion[]>([])
const habits = ref<HabitWithSchedule[]>([])
const boredCategories = ref<BoredCategory[]>([])
const loading = ref(true)
const showTodoModal = ref(false)
const editingTodo = ref<Todo | null>(null)
const formDefaultDate = ref('')
const showNoteSheet = ref(false)
const editingNote = ref<Scribble | null>(null)
const savingNote = ref(false)

const visibleDays = computed(() => {
  if (calendarView.value === 'day') return [selected.value]
  if (calendarView.value === 'week') return daysFrom(startOfWeek(cursor.value), 7)
  const first = new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1)
  first.setDate(1 - first.getDay())
  return daysFrom(first, 42)
})
const periodTitle = computed(() => {
  if (calendarView.value === 'day')
    return dateForKey(selected.value).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  const first = visibleDays.value[0]
  const last = visibleDays.value.at(-1)
  if (!first || !last) return ''
  if (calendarView.value === 'month')
    return cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const start = dateForKey(first)
  const end = dateForKey(last)
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
})
const todosByDate = computed(() => {
  const first = visibleDays.value[0] ?? selected.value
  const last = visibleDays.value.at(-1) ?? selected.value
  const map = new Map<string, Todo[]>()
  for (const todo of todos.value) {
    if (todo.archived_at) continue
    for (const date of expandTodoOccurrences(todo, first, last)) {
      const items = map.get(date) ?? []
      items.push(todo)
      map.set(date, items)
    }
  }
  for (const items of map.values())
    items.sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''))
  return map
})
const selectedTodos = computed(() => todosByDate.value.get(selected.value) ?? [])
const selectedNotes = computed(() =>
  notes.value.filter((note) => note.entry_date === selected.value && hasCalendarNoteTag(note.tags)),
)
const selectedHabits = computed(() =>
  completions.value.filter((completion) => completion.date === selected.value),
)
const notePrompt = computed(() => calendarNotePrompt(selected.value))
function agendaFor(date: string) {
  const tasks: AgendaItem[] = (todosByDate.value.get(date) ?? [])
    .filter((todo) => todo.scheduled_time)
    .map((todo) => ({
      id: todo.id,
      label: todo.title,
      time: todo.scheduled_time ?? '',
      todo,
      duration: todo.estimated_minutes,
      color: priorityColor(todo),
    }))
  const reminders: AgendaItem[] = habits.value
    .filter((habit) => isHabitDue(habit, date))
    .map((habit) => ({
      id: `habit-${habit.id}`,
      label: habit.name,
      time: habit.schedule?.due_time ?? '',
      duration: null,
      color: habit.color,
    }))
  return [...tasks, ...reminders].sort((a, b) => a.time.localeCompare(b.time))
}
const scheduledAgenda = computed(() => agendaFor(selected.value))
const untimedDue = computed(() => selectedTodos.value.filter((todo) => !todo.scheduled_time))
const backlog = computed(() =>
  todos.value.filter((todo) => !todo.archived_at && !todo.is_done && !todo.due_date),
)

function priorityColor(todo: Todo) {
  return todo.priority === 'high' ? '#ef4444' : todo.priority === 'medium' ? '#f59e0b' : '#64748b'
}
function isHabitDue(habit: HabitWithSchedule, date: string) {
  const schedule = habit.schedule
  if (!schedule?.due_time) return false
  return (
    schedule.schedule_type !== 'SPECIFIC_DAYS' ||
    schedule.days_of_week?.includes(dateForKey(date).getDay()) === true
  )
}
function isCurrentMonth(date: string) {
  return dateForKey(date).getMonth() === cursor.value.getMonth()
}
function noteCount(date: string) {
  return notes.value.filter((note) => note.entry_date === date && hasCalendarNoteTag(note.tags))
    .length
}
function completionCount(date: string) {
  return completions.value.filter((completion) => completion.date === date).length
}
function taskCount(date: string) {
  return (todosByDate.value.get(date) ?? []).filter((todo) => !todo.is_done).length
}
function selectDate(date: string) {
  selected.value = date
  cursor.value = dateForKey(date)
  if (calendarView.value !== 'day') calendarView.value = 'day'
  void impact('light')
}
async function selectView(view: CalendarView) {
  if (calendarView.value === view) return
  calendarView.value = view
  cursor.value = dateForKey(selected.value)
  await loadCompletions()
  void selectionChanged()
}
async function movePeriod(direction: -1 | 1) {
  const next = new Date(cursor.value)
  if (calendarView.value === 'month') next.setMonth(next.getMonth() + direction)
  else if (calendarView.value === 'week') next.setDate(next.getDate() + direction * 7)
  else next.setDate(next.getDate() + direction)
  cursor.value = next
  if (calendarView.value === 'day') selected.value = plannerDateKey(next)
  await loadCompletions()
  void impact('light')
}
async function goToToday() {
  selected.value = today
  cursor.value = dateForKey(today)
  await loadCompletions()
  void impact('light')
}
async function loadCompletions() {
  const first = visibleDays.value[0]
  const last = visibleDays.value.at(-1)
  if (first && last) completions.value = await db.getCompletionsForDateRange(first, last)
}
async function toggleTodo(todo: Todo) {
  const updated = await db.toggleTodo(todo.id)
  const index = todos.value.findIndex((item) => item.id === todo.id)
  if (index >= 0) todos.value[index] = updated
  void impact(updated.is_done ? 'medium' : 'light')
}
function openAdd(date = selected.value) {
  editingTodo.value = null
  formDefaultDate.value = date
  showTodoModal.value = true
}
function openEdit(todo: Todo) {
  editingTodo.value = todo
  formDefaultDate.value = ''
  showTodoModal.value = true
}
function openNewNote() {
  editingNote.value = null
  showNoteSheet.value = true
}
function openNote(note: Scribble) {
  editingNote.value = note
  showNoteSheet.value = true
}
function updateLocalNote(note: Scribble) {
  const index = notes.value.findIndex((item) => item.id === note.id)
  if (index >= 0) notes.value[index] = note
  else notes.value.unshift(note)
}
async function saveCalendarNote(payload: CalendarNotePayload) {
  if (savingNote.value) return
  savingNote.value = true
  try {
    const note = editingNote.value
      ? await db.updateScribble({ id: editingNote.value.id, ...payload })
      : await db.createScribble(payload)
    updateLocalNote(note)
    showNoteSheet.value = false
    void notification('success')
  } catch (error) {
    logError('[calendar/saveNote]', error)
    toast.add({ title: 'Failed to save note', color: 'error', duration: 4000 })
  } finally {
    savingNote.value = false
  }
}
async function saveTodo(payload: Parameters<typeof db.createTodo>[0]) {
  try {
    if (editingTodo.value) {
      const updated = await db.updateTodo({ id: editingTodo.value.id, ...payload })
      const index = todos.value.findIndex((item) => item.id === updated.id)
      if (index >= 0) todos.value[index] = updated
    } else todos.value.push(await db.createTodo(payload))
    showTodoModal.value = false
    void notification('success')
  } catch (error) {
    logError('[calendar/saveTodo]', error)
    toast.add({ title: 'Failed to save todo', color: 'error', duration: 4000 })
  }
}
function updateTodo(todo: Todo) {
  const index = todos.value.findIndex((item) => item.id === todo.id)
  if (index >= 0) todos.value[index] = todo
  editingTodo.value = todo
}
onMounted(async () => {
  ;[todos.value, notes.value, habits.value, boredCategories.value] = await Promise.all([
    db.getTodos(),
    db.getScribbles(),
    db.getHabits(),
    db.getBoredCategories(),
  ])
  await loadCompletions()
  loading.value = false
})
</script>

<template>
  <div class="space-y-5 pb-24">
    <header><p class="text-sm text-(--ui-text-dimmed)">Plan your work, then keep the record</p><h1 class="text-3xl font-bold tracking-tight">Calendar</h1></header>
    <section class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3 shadow-sm">
      <div class="flex items-center justify-between gap-2"><UButton class="min-h-11 min-w-11" :icon="resolveIcon('chevron-left')" color="neutral" variant="ghost" aria-label="Previous period" @click="movePeriod(-1)" /><button type="button" class="min-h-11 rounded-lg px-3 text-center text-sm font-bold" @click="goToToday">{{ periodTitle }}</button><UButton class="min-h-11 min-w-11" :icon="resolveIcon('chevron-right')" color="neutral" variant="ghost" aria-label="Next period" @click="movePeriod(1)" /></div>
      <div class="mt-3 flex rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-1" role="group" aria-label="Calendar view"><button v-for="view in calendarViews" :key="view" type="button" class="min-h-11 flex-1 rounded-lg text-sm font-semibold capitalize" :class="calendarView === view ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed)'" :aria-pressed="calendarView === view" @click="selectView(view)">{{ view }}</button></div>
    </section>
    <AppSkeleton v-if="loading" variant="row" :count="4" />
    <template v-else-if="calendarView === 'day'">
      <section class="overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated)"><div class="flex items-center justify-between border-b border-(--ui-border) px-4 py-3"><div><h2 class="font-semibold">Schedule</h2><p class="text-xs text-(--ui-text-dimmed)">Timed habits and tasks, in order</p></div><UButton size="xs" variant="soft" :icon="resolveIcon('plus')" @click="openAdd()">Add task</UButton></div><ul v-if="scheduledAgenda.length" class="divide-y divide-(--ui-border)"><li v-for="item in scheduledAgenda" :key="item.id" class="grid grid-cols-[3.5rem_1fr] gap-3 px-4 py-3"><p class="pt-2 text-right text-xs font-semibold type-code text-(--ui-text-dimmed)">{{ item.time }}</p><div v-if="item.todo" class="flex min-h-14 items-center gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg) px-3"><button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" :aria-label="`${item.todo.is_done ? 'Reopen' : 'Complete'} ${item.label}`" @click="toggleTodo(item.todo)"><AppIcon v-if="item.todo.is_done" name="check" class="h-4 w-4 text-primary-500" /></button><button type="button" class="min-w-0 flex-1 text-left" @click="openEdit(item.todo)"><span class="block truncate font-semibold" :class="item.todo.is_done ? 'line-through text-(--ui-text-dimmed)' : ''">{{ item.label }}</span><span class="text-xs text-(--ui-text-dimmed)"><template v-if="item.duration">{{ item.duration }} min · </template>Task</span></button></div><div v-else class="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-(--ui-border) px-3"><span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: item.color }" /><span class="font-semibold">{{ item.label }}</span></div></li></ul><EmptyState v-else icon="clock" title="Open time" description="Add a task or give one a start time." /></section>
      <section v-if="untimedDue.length" class="space-y-2"><div class="px-1"><h2 class="font-semibold">Due today</h2><p class="text-xs text-(--ui-text-dimmed)">Tasks without a start time</p></div><ul class="space-y-2"><AppCard v-for="todo in untimedDue" :key="todo.id" tag="li" class="flex items-center gap-3"><button class="flex h-7 w-7 items-center justify-center rounded-full border" @click="toggleTodo(todo)"><AppIcon v-if="todo.is_done" name="check" class="h-4 w-4 text-primary-500" /></button><button class="min-w-0 flex-1 text-left" @click="openEdit(todo)"><p class="truncate font-semibold" :class="todo.is_done ? 'line-through text-(--ui-text-dimmed)' : ''">{{ todo.title }}</p><p class="text-xs text-(--ui-text-dimmed)">{{ todo.priority }} priority</p></button></AppCard></ul></section>
      <section v-if="backlog.length" class="space-y-2"><div class="px-1"><h2 class="font-semibold">Backlog</h2><p class="text-xs text-(--ui-text-dimmed)">Tasks waiting for a date</p></div><ul class="space-y-2"><AppCard v-for="todo in backlog" :key="todo.id" tag="li" class="flex items-center gap-3"><span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: priorityColor(todo) }" /><button class="min-w-0 flex-1 text-left" @click="openEdit(todo)"><p class="truncate font-semibold">{{ todo.title }}</p><p class="text-xs text-(--ui-text-dimmed)">{{ todo.priority }} priority</p></button></AppCard></ul></section>
      <section class="overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated)"><div class="border-b border-(--ui-border) px-4 py-3"><p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">{{ periodTitle }}</p><h2 class="mt-0.5 text-lg font-bold">Daily bulletin</h2></div><div class="space-y-2 p-3"><AppCard v-if="selectedHabits.length"><p class="font-semibold">{{ selectedHabits.length }} habit {{ selectedHabits.length === 1 ? 'completion' : 'completions' }}</p></AppCard><AppCard v-for="note in selectedNotes" :key="note.id" tag="button" class="w-full text-left hover:border-(--ui-border-accented)" @click="openNote(note)"><p class="font-semibold">{{ note.title || 'Untitled note' }}</p><p class="truncate text-xs text-(--ui-text-dimmed)">{{ note.content }}</p></AppCard><EmptyState v-if="!selectedHabits.length && !selectedNotes.length" icon="document-text" title="A quiet day" :description="notePrompt" /><UButton variant="soft" color="primary" block :icon="resolveIcon('plus')" @click="openNewNote">{{ notePrompt }}</UButton></div></section>
    </template>
    <section v-else-if="calendarView === 'week'" class="grid gap-3 sm:grid-cols-7">
      <button v-for="date in visibleDays" :key="date" type="button" class="min-h-44 rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3 text-left" @click="selectDate(date)">
        <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-dimmed)">{{ dateForKey(date).toLocaleDateString(undefined, { weekday: 'short' }) }}</p>
        <p class="text-xl font-bold">{{ dateForKey(date).getDate() }}</p>
        <ul class="mt-4 space-y-2">
          <li v-for="item in agendaFor(date)" :key="item.id" class="flex gap-2 text-xs">
            <span class="mt-1 h-2 w-2 rounded-full" :style="{ backgroundColor: item.color }" />
            <span class="truncate">{{ item.time }} {{ item.label }}</span>
          </li>
          <li v-if="!agendaFor(date).length" class="pt-4 text-xs text-(--ui-text-dimmed)">Open time</li>
        </ul>
      </button>
    </section>
    <template v-else><section class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) p-3"><div class="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-dimmed)"><span v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="pb-2">{{ day }}</span></div><div class="grid grid-cols-7 gap-1"><button v-for="date in visibleDays" :key="date" type="button" class="relative flex min-h-14 flex-col rounded-xl p-1.5 text-left" :class="[date === today ? 'bg-primary-500/10' : 'hover:bg-(--ui-bg-muted)', !isCurrentMonth(date) ? 'opacity-35' : '']" :aria-label="dateForKey(date).toLocaleDateString()" @click="selectDate(date)"><span class="text-sm font-bold">{{ dateForKey(date).getDate() }}</span><span class="mt-auto flex gap-1"><i v-if="completionCount(date)" class="h-1.5 w-1.5 rounded-full bg-emerald-500" /><i v-if="taskCount(date)" class="h-1.5 w-1.5 rounded-full bg-amber-500" /><i v-if="noteCount(date)" class="h-1.5 w-1.5 rounded-full bg-primary-500" /></span></button></div></section><p class="flex justify-center gap-3 text-xs text-(--ui-text-dimmed)"><span>Habits</span><span>Tasks</span><span>Notes</span></p></template>
    <TodoFormModal v-model:open="showTodoModal" :editing-todo="editingTodo" :bored-categories="boredCategories" :suggest-tags="suggestTags" :default-date="formDefaultDate" @save="saveTodo" @todo-updated="updateTodo" />
    <CalendarNoteSheet v-model:open="showNoteSheet" :note="editingNote" :entry-date="selected" :saving="savingNote" @save="saveCalendarNote" />
  </div>
</template>
