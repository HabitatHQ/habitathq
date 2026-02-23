<script setup lang="ts">
import type { Todo, BoredCategory } from '~/types/database'

const db = useDatabase()

const todos = ref<Todo[]>([])
const boredCategories = ref<BoredCategory[]>([])
const filter = ref<'all' | 'active' | 'done'>('all')
const showModal = ref(false)
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

const today = new Date().toISOString().slice(0, 10)

const overdue = computed(() =>
  todos.value.filter(t => !t.is_done && !t.archived_at && t.due_date && t.due_date < today),
)

const dueToday = computed(() =>
  todos.value.filter(t => !t.is_done && !t.archived_at && t.due_date === today),
)

const upcoming = computed(() => {
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const limit = in30.toISOString().slice(0, 10)
  return todos.value.filter(t => !t.is_done && !t.archived_at && t.due_date && t.due_date > today && t.due_date <= limit)
})

const noDate = computed(() =>
  todos.value.filter(t => !t.is_done && !t.archived_at && !t.due_date),
)

const done = computed(() =>
  todos.value.filter(t => t.is_done && !t.archived_at).slice(-20).reverse(),
)

type Section = { label: string; items: Todo[]; key: string; collapsible?: boolean }

const filteredSections = computed((): Section[] => {
  if (filter.value === 'done') {
    return [{ label: 'Done', items: done.value, key: 'done' }]
  }
  if (filter.value === 'active') {
    return ([
      { label: '🔴 Overdue', items: overdue.value, key: 'overdue' },
      { label: '📅 Today', items: dueToday.value, key: 'today' },
      { label: '📋 Upcoming', items: upcoming.value, key: 'upcoming' },
      { label: '📌 No date', items: noDate.value, key: 'nodate' },
    ] as Section[]).filter(s => s.items.length > 0)
  }
  // all
  return ([
    { label: '🔴 Overdue', items: overdue.value, key: 'overdue' },
    { label: '📅 Today', items: dueToday.value, key: 'today' },
    { label: '📋 Upcoming', items: upcoming.value, key: 'upcoming' },
    { label: '📌 No date', items: noDate.value, key: 'nodate' },
    { label: '✓ Done', items: done.value, key: 'done', collapsible: true },
  ] as Section[]).filter(s => s.items.length > 0)
})

function priorityColor(p: string) {
  if (p === 'high') return 'bg-red-500'
  if (p === 'low') return 'bg-slate-600'
  return 'bg-amber-500'
}

function formatDueDate(d: string) {
  if (d === today) return 'Today'
  const diff = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000)
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff < 7) return `in ${diff}d`
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isOverdue(t: Todo) {
  return !t.is_done && t.due_date && t.due_date < today
}

async function toggleTodo(t: Todo) {
  const updated = await db.toggleTodo(t.id)
  const idx = todos.value.findIndex(x => x.id === t.id)
  if (idx !== -1) todos.value[idx] = updated
}

function openAdd() {
  editingTodo.value = null
  Object.assign(form, {
    title: '', description: '', due_date: '', priority: 'medium',
    estimated_minutes: '', is_recurring: false, recurrence_rule: 'daily',
    show_in_bored: false, bored_category_id: '', tags: '',
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
  const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)
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
    const idx = todos.value.findIndex(x => x.id === editingTodo.value!.id)
    if (idx !== -1) todos.value[idx] = updated
  } else {
    const created = await db.createTodo(payload)
    todos.value.push(created)
  }
  showModal.value = false
}

async function archiveTodo(t: Todo) {
  await db.archiveTodo(t.id)
  todos.value = todos.value.filter(x => x.id !== t.id)
}

async function deleteTodoItem(t: Todo) {
  await db.deleteTodo(t.id)
  todos.value = todos.value.filter(x => x.id !== t.id)
}
</script>

<template>
  <div class="max-w-lg mx-auto space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">TODOs</h1>
      <UButton size="sm" icon="i-heroicons-plus" @click="openAdd">Add</UButton>
    </div>

    <!-- Filter chips -->
    <div class="flex gap-2">
      <button
        v-for="f in [['all', 'All'], ['active', 'Active'], ['done', 'Done']] as const"
        :key="f[0]"
        class="px-3 py-1 rounded-full text-sm font-medium transition-colors"
        :class="filter === f[0] ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'"
        @click="filter = f[0]"
      >
        {{ f[1] }}
      </button>
    </div>

    <!-- Sections -->
    <template v-for="section in filteredSections" :key="section.key">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">{{ section.label }}</p>
          <button
            v-if="section.collapsible"
            class="text-xs text-slate-500 hover:text-slate-300"
            @click="showDone = !showDone"
          >
            {{ showDone ? 'Collapse' : 'Show' }}
          </button>
        </div>

        <template v-if="!section.collapsible || showDone">
          <div
            v-for="todo in section.items"
            :key="todo.id"
            class="flex items-start gap-3 bg-slate-900 border border-slate-800 rounded-xl px-3 py-3"
          >
            <!-- Priority stripe -->
            <div class="w-1 self-stretch rounded-full shrink-0 mt-0.5" :class="priorityColor(todo.priority)" />

            <!-- Checkbox -->
            <button
              class="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
              :class="todo.is_done ? 'border-green-500 bg-green-500' : 'border-slate-600 hover:border-slate-400'"
              @click="toggleTodo(todo)"
            >
              <UIcon v-if="todo.is_done" name="i-heroicons-check" class="w-3 h-3 text-white" />
              <UIcon v-else-if="todo.is_recurring" name="i-heroicons-arrow-path" class="w-2.5 h-2.5 text-slate-500" />
            </button>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium" :class="todo.is_done ? 'line-through text-slate-500' : ''">
                {{ todo.title }}
              </p>
              <p v-if="todo.description" class="text-xs text-slate-500 mt-0.5 truncate">{{ todo.description }}</p>
              <!-- Metadata -->
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                <span
                  v-if="todo.due_date"
                  class="text-xs flex items-center gap-0.5"
                  :class="isOverdue(todo) ? 'text-red-400' : 'text-slate-400'"
                >
                  <UIcon name="i-heroicons-calendar" class="w-3 h-3" />
                  {{ formatDueDate(todo.due_date) }}
                </span>
                <span v-if="todo.estimated_minutes" class="text-xs text-slate-500 flex items-center gap-0.5">
                  <UIcon name="i-heroicons-clock" class="w-3 h-3" />
                  {{ todo.estimated_minutes }}m
                </span>
                <span v-if="todo.is_recurring" class="text-xs text-slate-500 flex items-center gap-0.5">
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
                  class="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                >{{ tag }}</span>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex flex-col gap-1 shrink-0">
              <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-pencil" @click="openEdit(todo)" />
              <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-archive-box" @click="archiveTodo(todo)" />
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Empty state -->
    <div v-if="filteredSections.length === 0" class="text-center py-12 text-slate-500">
      <UIcon name="i-heroicons-check-circle" class="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>No todos yet. Tap + to add one.</p>
    </div>

    <!-- Add/Edit modal -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false" />
      <div class="relative w-full sm:max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
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
                :class="form.priority === p[0] ? p[2] + ' text-white' : 'bg-slate-800 text-slate-300'"
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
                  :class="form.recurrence_rule === rule ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-300'"
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
                class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
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
            @click="deleteTodoItem(editingTodo); showModal = false"
          />
          <UButton color="primary" class="flex-1" @click="saveTodo">Save</UButton>
        </div>
      </div>
    </div>
  </div>
</template>
