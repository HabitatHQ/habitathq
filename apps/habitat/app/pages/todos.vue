<script setup lang="ts">
import type { BoredCategory, Todo } from '~/types/database'

const db = useDatabase()
const { settings: appSettings, set: setAppSetting } = useAppSettings()

const calendarView = computed({
  get: () => appSettings.value.todoCalendarView,
  set: (v: boolean) => setAppSetting('todoCalendarView', v),
})

const todos = ref<Todo[]>([])
const boredCategories = ref<BoredCategory[]>([])
const filter = ref<'all' | 'active' | 'done'>('all')
const showModal = useBoolModalQuery('add')
const editingTodo = ref<Todo | null>(null)
const showDone = ref(false)

const form = reactive({
  title: '',
  description: '',
  due_date: '',
  priority: 'medium' as 'high' | 'medium' | 'low',
  estimated_minutes: '' as string | number,
  is_recurring: false,
  recurrence_rule: 'daily' as 'daily' | 'weekly' | 'monthly',
  show_in_bored: false,
  bored_category_id: '' as string,
  tags: '',
})

async function load() {
  ;[todos.value, boredCategories.value] = await Promise.all([
    db.getTodos(),
    db.getBoredCategories(),
  ])
}

onMounted(load)

// Use local calendar date (not UTC) so "today" matches the device's clock
const _d = new Date()
const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`

const overdue = computed(() =>
  todos.value.filter((t) => !t.is_done && !t.archived_at && t.due_date && t.due_date < today),
)

const dueToday = computed(() =>
  todos.value.filter((t) => !t.is_done && !t.archived_at && t.due_date === today),
)

const upcoming = computed(() => {
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const limit = `${in30.getFullYear()}-${String(in30.getMonth() + 1).padStart(2, '0')}-${String(in30.getDate()).padStart(2, '0')}`
  return todos.value.filter(
    (t) => !t.is_done && !t.archived_at && t.due_date && t.due_date > today && t.due_date <= limit,
  )
})

const noDate = computed(() =>
  todos.value.filter((t) => !t.is_done && !t.archived_at && !t.due_date),
)

const done = computed(() =>
  todos.value
    .filter((t) => t.is_done && !t.archived_at)
    .sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at))
    .slice(0, 20),
)

// Todos passed to the calendar — respects the active filter
const filteredTodosForCalendar = computed(() =>
  todos.value.filter((t) => {
    if (t.archived_at) return false
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
  const updated = await db.toggleTodo(t.id)
  const idx = todos.value.findIndex((x) => x.id === t.id)
  if (idx !== -1) todos.value[idx] = updated
}

function openAdd() {
  openAddWithDate('')
}

function openAddWithDate(date: string) {
  editingTodo.value = null
  Object.assign(form, {
    title: '',
    description: '',
    due_date: date,
    priority: 'medium',
    estimated_minutes: '',
    is_recurring: false,
    recurrence_rule: 'daily',
    show_in_bored: false,
    bored_category_id: '',
    tags: '',
  })
  showModal.value = true
}

function openEdit(t: Todo) {
  editingTodo.value = t
  Object.assign(form, {
    title: t.title,
    description: t.description,
    due_date: t.due_date ?? '',
    priority: t.priority,
    estimated_minutes: t.estimated_minutes ?? '',
    is_recurring: t.is_recurring,
    recurrence_rule: t.recurrence_rule ?? 'daily',
    show_in_bored: t.show_in_bored,
    bored_category_id: t.bored_category_id ?? '',
    tags: t.tags.join(', '),
  })
  showModal.value = true
}

async function saveTodo() {
  if (!form.title.trim()) return
  const mins = form.estimated_minutes !== '' ? Number(form.estimated_minutes) : null
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const payload = {
    title: form.title.trim(),
    description: form.description.trim(),
    due_date: form.due_date || null,
    priority: form.priority,
    estimated_minutes: mins,
    is_recurring: form.is_recurring,
    recurrence_rule: form.is_recurring ? form.recurrence_rule : null,
    show_in_bored: form.show_in_bored,
    bored_category_id: form.show_in_bored && form.bored_category_id ? form.bored_category_id : null,
    tags,
    annotations: {} as Record<string, string>,
  }
  if (editingTodo.value) {
    const updated = await db.updateTodo({ id: editingTodo.value.id, ...payload })
    const idx = todos.value.findIndex((x) => x.id === editingTodo.value?.id)
    if (idx !== -1) todos.value[idx] = updated
  } else {
    const created = await db.createTodo(payload)
    todos.value.push(created)
  }
  showModal.value = false
}

async function archiveTodo(t: Todo) {
  await db.archiveTodo(t.id)
  todos.value = todos.value.filter((x) => x.id !== t.id)
}

async function deleteTodoItem(t: Todo) {
  await db.deleteTodo(t.id)
  todos.value = todos.value.filter((x) => x.id !== t.id)
}

async function deleteAndClose(t: Todo) {
  await deleteTodoItem(t)
  showModal.value = false
}
</script>

<template>
  <div :class="calendarView ? 'space-y-4' : 'max-w-lg mx-auto space-y-5'">
    <!-- Header -->
    <div :class="calendarView ? '' : ''" class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">TODOs</h1>
      <div class="flex items-center gap-2">
        <!-- List / Calendar toggle -->
        <div class="flex bg-(--ui-bg-elevated) rounded-lg p-0.5 gap-0.5">
          <button
            class="p-1.5 rounded-md transition-colors"
            :class="!calendarView ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
            @click="calendarView = false"
          ><UIcon name="i-heroicons-list-bullet" class="w-4 h-4" /></button>
          <button
            class="p-1.5 rounded-md transition-colors"
            :class="calendarView ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
            @click="calendarView = true"
          ><UIcon name="i-heroicons-calendar-days" class="w-4 h-4" /></button>
        </div>
        <UButton size="sm" icon="i-heroicons-plus" @click="openAdd">Add</UButton>
      </div>
    </div>

    <!-- Filter chips (shared between list and calendar) -->
    <div class="flex gap-2" :class="calendarView ? 'max-w-xs' : ''">
      <button
        v-for="f in [['all', 'All'], ['active', 'Active'], ['done', 'Done']] as const"
        :key="f[0]"
        class="px-3 py-1 rounded-full text-sm font-medium transition-colors"
        :class="filter === f[0] ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned) hover:bg-(--ui-bg-accented)'"
        @click="filter = f[0]"
      >{{ f[1] }}</button>
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
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed)">{{ section.label }}</p>
          <button
            v-if="section.collapsible"
            class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-toned)"
            @click="showDone = !showDone"
          >
            {{ showDone ? 'Collapse' : 'Show' }}
          </button>
        </div>

        <template v-if="!section.collapsible || showDone">
          <div
            v-for="todo in section.items"
            :key="todo.id"
            class="flex items-start gap-3 bg-(--ui-bg-muted) border border-(--ui-border) rounded-xl px-3 py-3"
          >
            <!-- Priority stripe -->
            <div class="w-1 self-stretch rounded-full shrink-0 mt-0.5" :class="priorityColor(todo.priority)" />

            <!-- Checkbox -->
            <button
              class="mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors"
              :class="todo.is_done ? 'border-green-500 bg-green-500' : 'border-(--ui-border-accented) hover:border-(--ui-border-muted)'"
              @click="toggleTodo(todo)"
            >
              <UIcon v-if="todo.is_done" name="i-heroicons-check" class="w-3.5 h-3.5 text-white" />
              <UIcon v-else-if="todo.is_recurring" name="i-heroicons-arrow-path" class="w-3 h-3 text-(--ui-text-dimmed)" />
            </button>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium" :class="todo.is_done ? 'line-through text-(--ui-text-dimmed)' : ''">
                {{ todo.title }}
              </p>
              <p v-if="todo.description" class="text-xs text-(--ui-text-dimmed) mt-0.5 truncate">{{ todo.description }}</p>
              <!-- Metadata -->
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                <span
                  v-if="todo.due_date"
                  class="text-xs flex items-center gap-0.5"
                  :class="isOverdue(todo, today) ? 'text-red-400' : 'text-(--ui-text-muted)'"
                >
                  <UIcon name="i-heroicons-calendar" class="w-3 h-3" />
                  {{ formatDueDate(todo.due_date, today) }}
                </span>
                <span v-if="todo.estimated_minutes" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5">
                  <UIcon name="i-heroicons-clock" class="w-3 h-3" />
                  {{ todo.estimated_minutes }}m
                </span>
                <span v-if="todo.is_recurring" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5">
                  <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" />
                  {{ todo.recurrence_rule }}
                </span>
                <span v-if="todo.show_in_bored" class="text-xs text-amber-500 flex items-center gap-0.5">
                  <UIcon name="i-heroicons-sparkles" class="w-3 h-3" />
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
            </div>

            <!-- Actions -->
            <div class="flex flex-col gap-1 shrink-0">
              <UButton variant="ghost" color="neutral" size="sm" icon="i-heroicons-pencil" @click="openEdit(todo)" />
              <UButton variant="ghost" color="neutral" size="sm" icon="i-heroicons-archive-box" @click="archiveTodo(todo)" />
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Empty state -->
    <div v-if="filteredSections.length === 0" class="text-center py-12 text-(--ui-text-dimmed)">
      <UIcon name="i-heroicons-check-circle" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>No todos yet. Tap + to add one.</p>
    </div>

    </template><!-- end list view -->

    <!-- Add/Edit modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false" />
      <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold">{{ editingTodo ? 'Edit TODO' : 'New TODO' }}</h2>

        <div class="space-y-3">
          <UFormField label="Title" required>
            <UInput v-model="form.title" placeholder="What needs doing?" class="w-full" autofocus />
          </UFormField>

          <UFormField label="Description">
            <UTextarea v-model="form.description" placeholder="Optional details" class="w-full" />
          </UFormField>

          <UFormField label="Due date">
            <UInput v-model="form.due_date" type="date" class="w-full" />
          </UFormField>

          <UFormField label="Priority">
            <div class="flex gap-2">
              <button
                v-for="p in [['high', 'High', 'bg-red-600'], ['medium', 'Medium', 'bg-amber-600'], ['low', 'Low', 'bg-slate-600']] as const"
                :key="p[0]"
                class="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
                :class="form.priority === p[0] ? p[2] + ' text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
                @click="form.priority = p[0]"
              >
                {{ p[1] }}
              </button>
            </div>
          </UFormField>

          <UFormField label="Estimated minutes">
            <UInput v-model="form.estimated_minutes" type="number" min="1" placeholder="e.g. 30" class="w-full" />
          </UFormField>

          <div class="flex items-center justify-between">
            <span class="text-sm">Recurring</span>
            <USwitch v-model="form.is_recurring" />
          </div>
          <div v-if="form.is_recurring">
            <UFormField label="Recurrence">
              <div class="flex gap-2">
                <button
                  v-for="rule in ['daily', 'weekly', 'monthly'] as const"
                  :key="rule"
                  class="flex-1 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors"
                  :class="form.recurrence_rule === rule ? 'bg-primary-600 text-white' : 'bg-(--ui-bg-elevated) text-(--ui-text-toned)'"
                  @click="form.recurrence_rule = rule"
                >
                  {{ rule }}
                </button>
              </div>
            </UFormField>
          </div>

          <UFormField label="Tags (comma-separated)">
            <UInput v-model="form.tags" placeholder="tag1, tag2" class="w-full" />
          </UFormField>

          <div class="flex items-center justify-between">
            <span class="text-sm">Show in Bored mode</span>
            <USwitch v-model="form.show_in_bored" />
          </div>
          <div v-if="form.show_in_bored && boredCategories.length">
            <UFormField label="Bored category (optional)">
              <select
                v-model="form.bored_category_id"
                class="w-full bg-(--ui-bg-elevated) border border-(--ui-border-accented) rounded-lg px-3 py-2 text-sm text-(--ui-text)"
              >
                <option value="">None</option>
                <option v-for="cat in boredCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </UFormField>
          </div>
        </div>

        <div class="flex gap-2 pt-1">
          <UButton variant="soft" color="neutral" class="flex-1" @click="showModal = false">Cancel</UButton>
          <UButton
            v-if="editingTodo"
            variant="ghost"
            color="error"
            class="flex-none"
            icon="i-heroicons-trash"
            @click="deleteAndClose(editingTodo)"
          />
          <UButton color="primary" class="flex-1" @click="saveTodo">Save</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
