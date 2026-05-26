<script setup lang="ts">
import { buildPomodoroConfig, type TimerMode } from '~/composables/useTimer'
import type { BoredCategory, Todo } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'
import { sortByPriority } from '~/utils/todos-helpers'

const db = useDatabase()
const { settings, set: setAppSetting } = useAppSettings()
const { anyActive, matchesContext } = useContextFilter()
const { impact, selectionChanged, notification } = useHaptics()
const { loadTags, suggest: suggestTags } = useTagSuggestions('todo')

// ── Timer ─────────────────────────────────────────────────────────────────────

const timer = reactive(useTimer())

const modeMenuItemId = ref<string | null>(null)
const modeMenuMinutes = ref(25)

const { start: lpStart, cancel: cancelLongPress, activated: longPressActivated } = useLongPress()

function startLongPress(todo: Todo) {
  lpStart(() => {
    modeMenuMinutes.value = todo.estimated_minutes ?? 25
    modeMenuItemId.value = todo.id
  })
}

function closeModeMenu() {
  modeMenuItemId.value = null
  longPressActivated.value = false
}

function handleTodoStart(todo: Todo) {
  if (longPressActivated.value) return
  modeMenuItemId.value = null
  if (todo.estimated_minutes) {
    timer.startTimer(
      todo.id,
      'todo',
      todo.title,
      'countdown',
      todo.estimated_minutes * 60,
      buildPomodoroConfig(settings.value),
    )
    void impact('medium')
    void navigateTo('/focus')
  } else {
    modeMenuMinutes.value = 25
    modeMenuItemId.value = todo.id
    void impact('light')
  }
}

function startMode(todo: Todo, mode: TimerMode) {
  modeMenuItemId.value = null
  const secs = mode === 'countdown' ? modeMenuMinutes.value * 60 : 0
  timer.startTimer(todo.id, 'todo', todo.title, mode, secs, buildPomodoroConfig(settings.value))
  void navigateTo('/focus')
}

async function finishTimerAndDone(todo: Todo) {
  timer.stopTimer()
  await toggleTodo(todo)
  void impact('medium')
}

const calendarView = computed({
  get: () => settings.value.todoCalendarView,
  set: (v: boolean) => setAppSetting('todoCalendarView', v),
})

const toast = useToast()

const todos = ref<Todo[]>([])
const boredCategories = ref<BoredCategory[]>([])
const filter = ref<'all' | 'active' | 'done'>('all')
const showModal = useBoolModalQuery('add')

// ── Confirm dialogs ───────────────────────────────────────────────────────────
const confirmArchiveTodo = ref<Todo | null>(null)
const confirmDeleteTodo = ref<Todo | null>(null)
const editingTodo = ref<Todo | null>(null)
const showDone = ref(false)
const route = useRoute()
const highlightedTodoId = ref<string | null>(null)

// ── Search, sort & filter ─────────────────────────────────────────────────────
const searchQuery = ref('')
const searchExpanded = ref(false)
const sortBy = ref<'priority' | 'due_date' | 'created' | 'title'>('priority')
const sortDir = ref<'asc' | 'desc'>('asc')
const filterTags = ref<string[]>([])
const showSortFilter = ref(false)

const todoTags = computed(() => {
  const seen = new Set<string>()
  for (const t of todos.value) {
    if (t.archived_at) continue
    for (const tag of t.tags) seen.add(tag)
  }
  return [...seen].sort()
})

function toggleFilterTag(tag: string) {
  const idx = filterTags.value.indexOf(tag)
  if (idx === -1) filterTags.value.push(tag)
  else filterTags.value.splice(idx, 1)
  void selectionChanged()
}

const activeFilterCount = computed(() => {
  let count = filterTags.value.length
  if (filter.value !== 'all') count++
  if (sortBy.value !== 'priority') count++
  return count
})

const processedTodos = computed(() => {
  let list = todos.value.filter((t) => !t.archived_at)

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(
      (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    )
  }

  if (filterTags.value.length > 0) {
    list = list.filter((t) => filterTags.value.some((ft) => t.tags.includes(ft)))
  }

  const dir = sortDir.value === 'asc' ? 1 : -1
  switch (sortBy.value) {
    case 'priority':
      list = sortByPriority(list)
      if (dir === -1) list.reverse()
      break
    case 'due_date':
      list = [...list].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date) * dir
      })
      break
    case 'created':
      list = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at) * dir)
      break
    case 'title':
      list = [...list].sort((a, b) => a.title.localeCompare(b.title) * dir)
      break
  }

  return list
})

async function load() {
  ;[todos.value, boredCategories.value] = await Promise.all([
    db.getTodos(),
    db.getBoredCategories(),
  ])
  void loadTags()
}

onMounted(async () => {
  await load()
  const hid = route.query['highlight']
  if (typeof hid === 'string' && hid) {
    highlightedTodoId.value = hid
    await nextTick()
    const el = document.getElementById(`todo-${hid}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setTimeout(() => {
      highlightedTodoId.value = null
    }, 2500)
  }
})

// Use local calendar date (not UTC) so "today" matches the device's clock
const today = toLocalDateKey()

const overdue = computed(() =>
  sortByPriority(
    processedTodos.value.filter((t) => !t.is_done && t.due_date !== null && t.due_date < today),
  ),
)

const dueToday = computed(() =>
  sortByPriority(processedTodos.value.filter((t) => !t.is_done && t.due_date === today)),
)

const upcoming = computed(() => {
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const limit = toLocalDateKey(in30)
  return sortByPriority(
    processedTodos.value.filter(
      (t) => !t.is_done && t.due_date !== null && t.due_date > today && t.due_date <= limit,
    ),
  )
})

const noDate = computed(() =>
  sortByPriority(processedTodos.value.filter((t) => !t.is_done && !t.due_date)),
)

const done = computed(() =>
  processedTodos.value
    .filter((t) => t.is_done)
    .sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at))
    .slice(0, 20),
)

const filteredTodosForCalendar = computed(() =>
  processedTodos.value.filter((t) => {
    if (filter.value === 'active') return !t.is_done
    if (filter.value === 'done') return t.is_done
    return true
  }),
)

type Section = { label: string; items: Todo[]; key: string; collapsible?: boolean }

const filteredSections = computed((): Section[] => {
  if (filter.value === 'done') {
    return [{ label: 'Done', items: done.value, key: 'done' }]
  }
  if (filter.value === 'active') {
    return (
      [
        { label: '🔴 Overdue', items: overdue.value, key: 'overdue' },
        { label: '📅 Today', items: dueToday.value, key: 'today' },
        { label: '📋 Upcoming', items: upcoming.value, key: 'upcoming' },
        { label: '📌 No date', items: noDate.value, key: 'nodate' },
      ] as Section[]
    ).filter((s) => s.items.length > 0)
  }
  // all
  return (
    [
      { label: '🔴 Overdue', items: overdue.value, key: 'overdue' },
      { label: '📅 Today', items: dueToday.value, key: 'today' },
      { label: '📋 Upcoming', items: upcoming.value, key: 'upcoming' },
      { label: '📌 No date', items: noDate.value, key: 'nodate' },
      { label: '✓ Done', items: done.value, key: 'done', collapsible: true },
    ] as Section[]
  ).filter((s) => s.items.length > 0)
})

async function toggleTodo(t: Todo) {
  const wasDone = t.is_done
  const updated = await db.toggleTodo(t.id)
  void impact(updated.is_done ? 'medium' : 'light')
  const idx = todos.value.findIndex((x) => x.id === t.id)
  if (idx !== -1) todos.value[idx] = updated
  if (updated.is_done && timer.timer?.itemId === t.id) timer.stopTimer()
  // Undo toast when marking done
  if (!wasDone && updated.is_done) {
    toast.add({
      title: `"${t.title}" marked done`,
      color: 'success',
      duration: 4000,
      actions: [{ label: 'Undo', onClick: () => toggleTodo(updated) }],
    })
  }
}

const formDefaultDate = ref('')

function openAdd() {
  editingTodo.value = null
  formDefaultDate.value = ''
  showModal.value = true
}

function openAddWithDate(date: string) {
  editingTodo.value = null
  formDefaultDate.value = date
  showModal.value = true
}

function openEdit(t: Todo) {
  editingTodo.value = t
  formDefaultDate.value = ''
  showModal.value = true
}

async function handleFormSave(payload: Parameters<typeof db.createTodo>[0]) {
  try {
    if (editingTodo.value) {
      const updated = await db.updateTodo({ id: editingTodo.value.id, ...payload })
      const idx = todos.value.findIndex((x) => x.id === editingTodo.value?.id)
      if (idx !== -1) todos.value[idx] = updated
      void notification('success')
      toast.add({ title: 'Todo updated', color: 'success', duration: 2000 })
    } else {
      const created = await db.createTodo(payload)
      todos.value.push(created)
      void notification('success')
      toast.add({ title: 'Todo created', color: 'success', duration: 2000 })
    }
    showModal.value = false
  } catch (err) {
    logError('[saveTodo]', err)
    toast.add({ title: 'Failed to save todo', color: 'error', duration: 4000 })
  }
}

function handleFormTodoUpdated(updated: Todo) {
  const idx = todos.value.findIndex((x) => x.id === updated.id)
  if (idx !== -1) todos.value[idx] = updated
  editingTodo.value = updated
}

async function archiveTodo(t: Todo) {
  try {
    await db.archiveTodo(t.id)
    void notification('warning')
    todos.value = todos.value.filter((x) => x.id !== t.id)
    confirmArchiveTodo.value = null
    toast.add({ title: 'Todo archived', color: 'success', duration: 2000 })
  } catch (err) {
    logError('[archiveTodo]', err)
    toast.add({ title: 'Failed to archive todo', color: 'error', duration: 4000 })
  }
}

async function deleteTodoItem(t: Todo) {
  try {
    await db.deleteTodo(t.id)
    todos.value = todos.value.filter((x) => x.id !== t.id)
    toast.add({ title: 'Todo deleted', color: 'success', duration: 2000 })
  } catch (err) {
    logError('[deleteTodo]', err)
    toast.add({ title: 'Failed to delete todo', color: 'error', duration: 4000 })
  }
}

async function deleteAndClose(t: Todo) {
  await deleteTodoItem(t)
  showModal.value = false
  confirmDeleteTodo.value = null
}
</script>

<template>
  <div :class="calendarView ? 'space-y-4' : 'max-w-lg mx-auto space-y-5'">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">TODOs</h1>
      <div class="flex items-center gap-2">
        <!-- List / Calendar toggle -->
        <AppToggleSwitcher
          :model-value="calendarView ? 'calendar' : 'list'"
          :options="[
            { value: 'list', icon: 'list-bullet', ariaLabel: 'List view' },
            { value: 'calendar', icon: 'calendar-days', ariaLabel: 'Calendar view' }
          ]"
          group-label="View mode"
          @update:model-value="v => calendarView = (v === 'calendar')"
        />
        <UButton size="sm" class="min-h-[44px]" :icon="resolveIcon('plus')" @click="openAdd">Add</UButton>
      </div>
    </div>

    <!-- Toolbar: search + filter -->
    <div class="flex items-center gap-2">
      <!-- Search -->
      <button
        v-if="!searchExpanded"
        class="w-10 h-10 rounded-full flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors"
        aria-label="Search todos"
        @click="searchExpanded = true"
      >
        <AppIcon name="magnifying-glass" class="w-5 h-5" />
      </button>
      <div
        v-else
        class="flex items-center gap-2 flex-1 min-w-0 px-3 h-10 rounded-full
               bg-(--ui-bg-elevated) border border-(--ui-border-accented)
               focus-within:ring-2 focus-within:ring-primary-500/40 transition-shadow"
      >
        <AppIcon name="magnifying-glass" class="w-4 h-4 text-(--ui-text-dimmed) shrink-0" />
        <input
          v-model="searchQuery"
          autofocus
          placeholder="Search todos…"
          class="flex-1 min-w-0 bg-transparent text-(--ui-text) placeholder:text-(--ui-text-dimmed) outline-none border-0 type-input"
          @blur="searchQuery || (searchExpanded = false)"
          @keydown.escape="searchQuery = ''; searchExpanded = false"
        />
        <button
          class="w-5 h-5 rounded-full flex items-center justify-center text-(--ui-text-dimmed) hover:text-(--ui-text)"
          aria-label="Clear search"
          @click="searchQuery = ''; searchExpanded = false"
        >
          <AppIcon name="x-mark" class="w-4 h-4" />
        </button>
      </div>

      <div class="flex-1" />

      <!-- Filter -->
      <div class="relative">
        <button
          class="w-10 h-10 rounded-full flex items-center justify-center transition-colors relative"
          :class="showSortFilter || activeFilterCount > 0
            ? 'bg-(--ui-bg-elevated) text-(--ui-text)'
            : 'text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-bg-elevated)'"
          aria-label="Sort and filter"
          @click="showSortFilter = !showSortFilter"
        >
          <AppIcon name="adjustments-horizontal" class="w-5 h-5" />
          <span
            v-if="activeFilterCount > 0"
            class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary-600 text-[10px] text-white flex items-center justify-center font-bold"
          >{{ activeFilterCount }}</span>
        </button>

        <!-- Filter popover -->
        <div v-if="showSortFilter" class="fixed inset-0 z-40" @click="showSortFilter = false" />
        <div
          v-if="showSortFilter"
          class="absolute right-0 top-full mt-1 z-50 w-72 bg-(--ui-bg) border border-(--ui-border) rounded-xl shadow-xl p-3 space-y-3.5"
        >
          <!-- Status -->
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">Status</p>
            <div class="flex gap-1.5">
              <button
                v-for="f in [['all', 'All'], ['active', 'Active'], ['done', 'Done']] as const"
                :key="f[0]"
                class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                :class="filter === f[0] ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="filter = f[0]; selectionChanged()"
              >{{ f[1] }}</button>
            </div>
          </div>

          <!-- Sort by -->
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">Sort by</p>
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="opt in [
                  ['priority', 'Priority'],
                  ['due_date', 'Due date'],
                  ['created', 'Created'],
                  ['title', 'Title'],
                ] as const"
                :key="opt[0]"
                class="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                :class="sortBy === opt[0] ? 'bg-primary-600/20 text-primary-400' : 'text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
                @click="sortBy = opt[0]; selectionChanged()"
              >{{ opt[1] }}</button>
            </div>
            <button
              class="mt-1 text-[10px] text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1"
              @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'; selectionChanged()"
            >
              <AppIcon :name="sortDir === 'asc' ? 'bars-arrow-up' : 'bars-arrow-down'" class="w-3 h-3" />
              {{ sortDir === 'asc' ? 'Ascending' : 'Descending' }}
            </button>
          </div>

          <!-- Filter by tags -->
          <div v-if="todoTags.length > 0">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-dimmed) mb-1.5">Tags</p>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="tag in todoTags"
                :key="tag"
                class="px-2 py-1 rounded-full text-xs font-medium transition-colors"
                :class="filterTags.includes(tag) ? 'bg-primary-600/20 text-primary-400 ring-1 ring-primary-500/40' : 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text-toned)'"
                @click="toggleFilterTag(tag)"
              >{{ tag }}</button>
            </div>
          </div>

          <!-- Reset -->
          <button
            v-if="activeFilterCount > 0"
            class="w-full text-[11px] text-(--ui-text-dimmed) hover:text-(--ui-text-muted) pt-1 border-t border-(--ui-border)/50"
            @click="filter = 'all'; sortBy = 'priority'; sortDir = 'asc'; filterTags = []; selectionChanged()"
          >Reset all filters</button>
        </div>
      </div>
    </div>

    <!-- Calendar view -->
    <TodoCalendarView
      v-if="calendarView"
      :todos="filteredTodosForCalendar"
      :today="today"
      @create="openAddWithDate"
      @edit="openEdit"
      @toggle="toggleTodo"
    />

    <!-- Sections (list view) -->
    <template v-if="!calendarView">
    <template v-for="section in filteredSections" :key="section.key">
      <section class="space-y-2">
        <header class="flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">{{ section.label }}</h2>
          <button
            v-if="section.collapsible"
            class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-toned)"
            @click="showDone = !showDone"
          >
            {{ showDone ? 'Collapse' : 'Show' }}
          </button>
        </header>

        <ul v-if="!section.collapsible || showDone" class="space-y-2">
          <li
            v-for="todo in section.items"
            :key="todo.id"
            :id="`todo-${todo.id}`"
            class="flex items-start gap-3 bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl px-3 py-3 transition-shadow"
            :class="[
              highlightedTodoId === todo.id ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-(--ui-bg)' : '',
              anyActive && !matchesContext(todo.tags) ? 'opacity-40' : '',
            ]"
          >
            <!-- Priority stripe -->
            <div class="w-1 self-stretch rounded-full shrink-0 mt-0.5" :class="priorityColor(todo.priority)" />

            <!-- Checkbox -->
            <button
              class="mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors"
              :class="todo.is_done ? 'border-green-500 bg-green-500' : 'border-(--ui-border-accented) hover:border-(--ui-border-muted)'"
              @click="toggleTodo(todo)"
            >
              <AppIcon v-if="todo.is_done" name="check" class="w-4 h-4 text-white" />
              <AppIcon v-else-if="todo.is_recurring" name="arrow-path" class="w-3 h-3 text-(--ui-text-dimmed)" />
            </button>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium" :class="todo.is_done ? 'line-through text-(--ui-text-dimmed)' : ''">
                {{ todo.title }}
              </p>
              <p v-if="todo.description" class="text-xs text-(--ui-text-dimmed) mt-0.5 truncate">{{ todo.description }}</p>
              <!-- Metadata -->
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                <time
                  v-if="todo.due_date"
                  :datetime="todo.due_date"
                  class="text-xs flex items-center gap-0.5"
                  :class="isOverdue(todo, today) ? 'text-red-400' : 'text-(--ui-text-muted)'"
                >
                  <AppIcon name="calendar" class="w-3 h-3" />
                  {{ formatDueDate(todo.due_date, today) }}
                </time>
                <span v-if="todo.estimated_minutes" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5">
                  <AppIcon name="clock" class="w-3 h-3" />
                  {{ todo.estimated_minutes }}m
                </span>
                <span v-if="todo.is_recurring" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5">
                  <AppIcon name="arrow-path" class="w-3 h-3" />
                  Repeats {{ todo.recurrence_rule }}
                </span>
                <span v-if="todo.show_in_bored" class="text-xs text-amber-500 flex items-center gap-0.5">
                  <AppIcon name="sparkles" class="w-3 h-3" />
                  Bored
                </span>
              </div>
              <!-- Tags -->
              <div v-if="todo.tags.length" class="flex flex-wrap gap-1 mt-1.5">
                <span
                  v-for="tag in todo.tags"
                  :key="tag"
                  class="text-xs px-1.5 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text-muted)"
                >{{ tag }}</span>
              </div>

              <!-- Timer area (feature-gated, non-done items only) -->
              <template v-if="settings.enableTimer && !todo.is_done">
                <!-- Running timer on THIS card -->
                <div v-if="timer.timer?.itemId === todo.id" class="flex items-center gap-2 mt-2 pt-2 border-t border-(--ui-border)/50">
                  <time
                    class="text-sm type-duration font-medium"
                    :class="timer.isOvertime ? 'text-red-400 animate-pulse' : 'text-(--ui-text)'"
                  >{{ timer.displayTime }}</time>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :icon="resolveIcon(timer.isRunning ? 'pause' : 'play')"
                    :aria-label="timer.isRunning ? 'Pause timer' : 'Resume timer'"
                    @click="timer.isRunning ? timer.pauseTimer() : timer.resumeTimer()"
                  />
                  <UButton
                    size="xs"
                    variant="soft"
                    color="success"
                    :icon="resolveIcon('check')"
                    aria-label="Done"
                    @click="finishTimerAndDone(todo)"
                  >Done</UButton>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :icon="resolveIcon('x-mark')"
                    aria-label="Stop timer"
                    @click="timer.stopTimer()"
                  />
                </div>

                <!-- Start button (no active timer on this card) -->
                <div v-else class="relative mt-1.5">
                  <div v-if="modeMenuItemId === todo.id" class="fixed inset-0 z-40" @click="closeModeMenu()" />
                  <div class="flex items-center gap-1.5">
                  <UButton
                    size="xs"
                    variant="soft"
                    color="neutral"
                    :icon="resolveIcon('play')"
                    aria-label="Start timer"
                    @click="handleTodoStart(todo)"
                    @pointerdown="startLongPress(todo)"
                    @pointerup="cancelLongPress"
                    @pointerleave="cancelLongPress"
                    @pointermove="cancelLongPress"
                  >Start</UButton>
                  <span v-if="todo.estimated_minutes" class="text-[10px] text-(--ui-text-dimmed)">Hold for modes</span>
                  </div>
                  <!-- Mode menu (long-press or no-estimate tap) -->
                  <div
                    v-if="modeMenuItemId === todo.id"
                    role="menu"
                    class="absolute bottom-full left-0 mb-1 bg-(--ui-bg) border border-(--ui-border) rounded-xl shadow-xl p-1 z-50 min-w-44 space-y-0.5"
                  >
                    <button
                      role="menuitem"
                      class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2"
                      @click="startMode(todo, 'stopwatch')"
                    >
                      <AppIcon name="play" class="w-4 h-4" /> Stopwatch
                    </button>
                    <div role="menuitem" class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted)">
                      <AppIcon name="clock" class="w-4 h-4 shrink-0" />
                      <div class="flex items-center gap-1" @click.stop>
                        <button
                          class="w-6 h-6 rounded-md bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) transition-colors active:scale-90"
                          :class="{ 'opacity-30 pointer-events-none': modeMenuMinutes <= 5 }"
                          @click="modeMenuMinutes = Math.max(5, modeMenuMinutes - 5)"
                        >
                          <AppIcon name="minus" class="w-3 h-3" />
                        </button>
                        <span class="w-10 text-center font-semibold tabular-nums text-(--ui-text)">{{ modeMenuMinutes }}</span>
                        <button
                          class="w-6 h-6 rounded-md bg-(--ui-bg-elevated) border border-(--ui-border) flex items-center justify-center text-(--ui-text-muted) hover:text-(--ui-text) transition-colors active:scale-90"
                          :class="{ 'opacity-30 pointer-events-none': modeMenuMinutes >= 120 }"
                          @click="modeMenuMinutes = Math.min(120, modeMenuMinutes + 5)"
                        >
                          <AppIcon name="plus" class="w-3 h-3" />
                        </button>
                      </div>
                      <span class="text-(--ui-text-muted) text-xs">min</span>
                      <button class="ml-auto text-primary-400 text-xs font-medium" @click="startMode(todo, 'countdown')">Start</button>
                    </div>
                    <button
                      role="menuitem"
                      class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-(--ui-bg-muted) flex items-center gap-2"
                      @click="startMode(todo, 'pomodoro')"
                    >
                      🍅 Pomodoro
                    </button>
                  </div>
                </div>
              </template>
            </div>

            <!-- Actions -->
            <div class="flex flex-col gap-1 shrink-0">
              <AppIconButton icon="pencil" label="Edit todo" @click="openEdit(todo)" />
              <AppIconButton icon="archive-box" label="Archive todo" @click="confirmArchiveTodo = todo" />
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- Empty state -->
    <div v-if="filteredSections.length === 0" class="text-center py-12 text-(--ui-text-dimmed)">
      <AppIcon name="check-circle" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>No todos yet. Tap + to add one.</p>
    </div>

    </template><!-- end list view -->

    <!-- Add/Edit modal -->
    <TodoFormModal
      v-model:open="showModal"
      :editing-todo="editingTodo"
      :bored-categories="boredCategories"
      :suggest-tags="suggestTags"
      :default-date="formDefaultDate"
      @save="handleFormSave"
      @delete="confirmDeleteTodo = $event"
      @todo-updated="handleFormTodoUpdated"
    />

    <!-- Archive confirm -->
    <ConfirmDialog
      :open="!!confirmArchiveTodo"
      icon="archive-box"
      icon-color="amber"
      :title="`Archive &quot;${confirmArchiveTodo?.title}&quot;?`"
      message="This todo will be moved to your archive."
      confirm-label="Archive"
      confirm-color="warning"
      @confirm="confirmArchiveTodo && archiveTodo(confirmArchiveTodo)"
      @cancel="confirmArchiveTodo = null"
      @update:open="(open) => !open && (confirmArchiveTodo = null)"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      :open="!!confirmDeleteTodo"
      icon="trash"
      icon-color="red"
      :title="`Delete &quot;${confirmDeleteTodo?.title}&quot;?`"
      message="This cannot be undone. The todo will be permanently removed."
      confirm-label="Delete"
      confirm-color="error"
      @confirm="confirmDeleteTodo && deleteAndClose(confirmDeleteTodo)"
      @cancel="confirmDeleteTodo = null"
      @update:open="(open) => !open && (confirmDeleteTodo = null)"
    />

  </div>
</template>
