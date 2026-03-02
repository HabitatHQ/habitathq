<script setup lang="ts">
import type { Todo } from '~/types/database'

const props = defineProps<{
  todos: Todo[]
  today: string
}>()

const emit = defineEmits<{
  create: [date: string]
  edit: [todo: Todo]
  toggle: [todo: Todo]
}>()

const { settings, set: setSetting } = useAppSettings()

// ─── Grain (month / week) — persisted ─────────────────────────────────────────

const grain = computed({
  get: () => settings.value.todoCalendarGrain,
  set: (v: 'month' | 'week') => setSetting('todoCalendarGrain', v),
})

// ─── View date (the month/week currently shown) ────────────────────────────────

const viewDate = ref(new Date(`${props.today}T00:00:00`))

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function prevPeriod() {
  const d = new Date(viewDate.value)
  if (grain.value === 'month') d.setMonth(d.getMonth() - 1)
  else d.setDate(d.getDate() - 7)
  viewDate.value = d
}

function nextPeriod() {
  const d = new Date(viewDate.value)
  if (grain.value === 'month') d.setMonth(d.getMonth() + 1)
  else d.setDate(d.getDate() + 7)
  viewDate.value = d
}

function goToToday() {
  viewDate.value = new Date(`${props.today}T00:00:00`)
}

// ─── Month grid cells ─────────────────────────────────────────────────────────

const calendarCells = computed(() => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  const startDow = new Date(year, month, 1).getDay() // 0 = Sunday
  const lastDate = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startDow + lastDate) / 7) * 7
  const cells: { date: string; inMonth: boolean }[] = []
  const d = new Date(year, month, 1 - startDow)
  for (let i = 0; i < totalCells; i++) {
    cells.push({ date: localDateStr(d), inMonth: d.getMonth() === month })
    d.setDate(d.getDate() + 1)
  }
  return cells
})

// ─── Week strip days ──────────────────────────────────────────────────────────

const weekDayDates = computed(() => {
  const start = new Date(viewDate.value)
  start.setDate(start.getDate() - start.getDay()) // rewind to Sunday
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    days.push(localDateStr(start))
    start.setDate(start.getDate() + 1)
  }
  return days
})

// ─── Period label ─────────────────────────────────────────────────────────────

const periodLabel = computed(() => {
  if (grain.value === 'month') {
    return viewDate.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const days = weekDayDates.value
  const first = new Date(`${days[0]}T00:00:00`)
  const last = new Date(`${days[6]}T00:00:00`)
  if (first.getMonth() === last.getMonth()) {
    return `${first.toLocaleDateString(undefined, { month: 'short' })} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`
  }
  return `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
})

// ─── Recurring expansion ──────────────────────────────────────────────────────

function expandRecurring(todo: Todo, rangeStart: string, rangeEnd: string): string[] {
  if (!todo.due_date || !todo.recurrence_rule) return []
  const d = new Date(`${todo.due_date}T00:00:00`)
  const startDate = new Date(`${rangeStart}T00:00:00`)
  const endDate = new Date(`${rangeEnd}T00:00:00`)
  if (d > endDate) return []
  // Advance d to within the range
  while (d < startDate) {
    if (todo.recurrence_rule === 'daily') d.setDate(d.getDate() + 1)
    else if (todo.recurrence_rule === 'weekly') d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
    if (d > endDate) return []
  }
  const dates: string[] = []
  while (d <= endDate) {
    dates.push(localDateStr(d))
    if (todo.recurrence_rule === 'daily') d.setDate(d.getDate() + 1)
    else if (todo.recurrence_rule === 'weekly') d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
  }
  return dates
}

// ─── Todos keyed by date ──────────────────────────────────────────────────────

const visibleRange = computed(() => {
  if (grain.value === 'month') {
    const cells = calendarCells.value
    return {
      start: cells[0]?.date ?? props.today,
      end: cells[cells.length - 1]?.date ?? props.today,
    }
  }
  const days = weekDayDates.value
  return { start: days[0] ?? props.today, end: days[6] ?? props.today }
})

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

const todosByDate = computed(() => {
  const map = new Map<string, Todo[]>()
  const { start, end } = visibleRange.value

  for (const todo of props.todos) {
    if (todo.archived_at) continue
    const dates = todo.is_recurring
      ? expandRecurring(todo, start, end)
      : todo.due_date && todo.due_date >= start && todo.due_date <= end
        ? [todo.due_date]
        : []
    for (const date of dates) {
      const existing = map.get(date)
      if (existing) {
        existing.push(todo)
      } else {
        map.set(date, [todo])
      }
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.is_done !== b.is_done) return a.is_done ? 1 : -1
      return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
    })
  }

  return map
})

// ─── Unscheduled ──────────────────────────────────────────────────────────────

const unscheduledTodos = computed(() =>
  props.todos.filter((t) => !t.archived_at && !t.due_date && !t.is_done && !t.is_recurring),
)

const unscheduledOpen = ref(false)

// ─── Chip styling ─────────────────────────────────────────────────────────────

function chipBorderClass(todo: Todo): string {
  if (todo.is_done) return 'border-l-2 border-(--ui-border)'
  if (todo.priority === 'high') return 'border-l-2 border-red-500'
  if (todo.priority === 'medium') return 'border-l-2 border-amber-500'
  return 'border-l-2 border-slate-500'
}

function chipBgClass(todo: Todo): string {
  if (todo.is_done) return 'bg-(--ui-bg-elevated)/60 opacity-50'
  if (todo.priority === 'high') return 'bg-red-500/10'
  if (todo.priority === 'medium') return 'bg-amber-500/10'
  return 'bg-slate-500/10'
}

function priorityBarClass(priority: string): string {
  if (priority === 'high') return 'bg-red-500'
  if (priority === 'medium') return 'bg-amber-500'
  return 'bg-slate-500'
}

// Unique priority dot colors for a set of todos (mobile month view)
function dotColors(dayTodos: Todo[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of dayTodos) {
    if (t.is_done) continue
    const key = t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low'
    if (!seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

// ─── Day detail panel ─────────────────────────────────────────────────────────

const selectedDay = ref<string | null>(null)

const selectedDayLabel = computed(() => {
  if (!selectedDay.value) return ''
  return new Date(`${selectedDay.value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
})

const selectedDayTodos = computed(() =>
  selectedDay.value ? (todosByDate.value.get(selectedDay.value) ?? []) : [],
)

function openDayCreate() {
  const date = selectedDay.value
  selectedDay.value = null
  if (date) emit('create', date)
}

// ─── Long-press to create / tap to view ───────────────────────────────────────

let pressTimer: ReturnType<typeof setTimeout> | null = null
let suppressNextClick = false

function onDayPointerDown(date: string) {
  suppressNextClick = false
  pressTimer = setTimeout(() => {
    pressTimer = null
    suppressNextClick = true
    emit('create', date)
  }, 600)
}

function onDayPointerCancel() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onDayClick(date: string) {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  selectedDay.value = date
}
</script>

<template>
  <div class="space-y-3">
    <div class="sm:flex sm:gap-5 sm:items-start">

      <!-- ── Main calendar area ──────────────────────────────────────────────── -->
      <div class="flex-1 min-w-0 space-y-3">

        <!-- Calendar header -->
        <div class="flex items-center gap-2">

          <!-- Month / Week grain toggle -->
          <div class="flex bg-(--ui-bg-elevated) rounded-lg p-0.5 gap-0.5 shrink-0">
            <button
              v-for="g in [['month', 'Month'], ['week', 'Week']] as const"
              :key="g[0]"
              class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
              :class="grain === g[0]
                ? 'bg-(--ui-bg) text-(--ui-text) shadow-sm'
                : 'text-(--ui-text-dimmed) hover:text-(--ui-text-toned)'"
              @click="grain = g[0]"
            >{{ g[1] }}</button>
          </div>

          <!-- Prev / label / Next -->
          <div class="flex-1 flex items-center justify-center gap-1">
            <button
              class="p-1.5 rounded-lg hover:bg-(--ui-bg-elevated) text-(--ui-text-toned) transition-colors"
              @click="prevPeriod"
            ><UIcon name="i-heroicons-chevron-left" class="w-4 h-4" /></button>
            <span class="text-sm font-semibold text-(--ui-text) text-center w-40 shrink-0">{{ periodLabel }}</span>
            <button
              class="p-1.5 rounded-lg hover:bg-(--ui-bg-elevated) text-(--ui-text-toned) transition-colors"
              @click="nextPeriod"
            ><UIcon name="i-heroicons-chevron-right" class="w-4 h-4" /></button>
          </div>

          <!-- Today pill -->
          <button
            class="text-xs px-2.5 py-1 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-toned) hover:bg-(--ui-bg-accented) transition-colors shrink-0"
            @click="goToToday"
          >Today</button>
        </div>

        <!-- ── Month view ──────────────────────────────────────────────────── -->
        <div v-if="grain === 'month'">

          <!-- Day-of-week headers -->
          <div class="grid grid-cols-7 mb-1">
            <div
              v-for="label in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']"
              :key="label"
              class="text-center text-[10px] font-semibold text-(--ui-text-dimmed) py-1"
            >{{ label }}</div>
          </div>

          <!-- Cell grid -->
          <div class="grid grid-cols-7 border-l border-t border-(--ui-border)/60 rounded-tl-sm">
            <div
              v-for="cell in calendarCells"
              :key="cell.date"
              class="border-r border-b border-(--ui-border)/60 p-1 cursor-pointer select-none transition-colors min-h-[52px] sm:min-h-[90px]"
              :class="[
                cell.inMonth ? 'hover:bg-(--ui-bg-elevated)/50' : 'opacity-35',
                cell.date === today ? 'bg-primary-500/5' : '',
              ]"
              @click="onDayClick(cell.date)"
              @pointerdown="onDayPointerDown(cell.date)"
              @pointerup="onDayPointerCancel()"
              @pointerleave="onDayPointerCancel()"
            >
              <!-- Day number -->
              <div class="flex justify-end mb-0.5">
                <span
                  class="w-5 h-5 text-[11px] flex items-center justify-center rounded-full font-medium leading-none"
                  :class="cell.date === today ? 'bg-primary-500 text-white' : 'text-(--ui-text-muted)'"
                >{{ Number(cell.date.slice(8)) }}</span>
              </div>

              <!-- Mobile: priority dots -->
              <div class="sm:hidden flex gap-0.5 justify-center flex-wrap mt-1">
                <span
                  v-for="p in dotColors(todosByDate.get(cell.date) ?? [])"
                  :key="p"
                  class="w-1.5 h-1.5 rounded-full"
                  :class="p === 'high' ? 'bg-red-500' : p === 'medium' ? 'bg-amber-500' : 'bg-slate-400'"
                />
              </div>

              <!-- Desktop: chips -->
              <div class="hidden sm:flex sm:flex-col gap-0.5">
                <template v-for="(todo, ti) in todosByDate.get(cell.date) ?? []" :key="todo.id">
                  <div
                    v-if="ti < 3"
                    class="text-[11px] rounded px-1 py-0.5 truncate leading-tight cursor-pointer"
                    :class="[chipBorderClass(todo), chipBgClass(todo), todo.is_done ? 'line-through' : '']"
                    @click.stop="emit('edit', todo)"
                  >{{ todo.title }}</div>
                </template>
                <div
                  v-if="(todosByDate.get(cell.date) ?? []).length > 3"
                  class="text-[11px] text-(--ui-text-dimmed) hover:text-(--ui-text-toned) cursor-pointer px-1 leading-tight"
                  @click.stop="onDayClick(cell.date)"
                >+{{ (todosByDate.get(cell.date) ?? []).length - 3 }} more</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Week view ───────────────────────────────────────────────────── -->
        <div v-else>

          <!-- Day headers -->
          <div class="grid grid-cols-7 gap-1 mb-1">
            <div v-for="date in weekDayDates" :key="date" class="text-center">
              <p class="text-[10px] font-semibold text-(--ui-text-dimmed)">
                {{ new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }) }}
              </p>
              <div
                class="mx-auto mt-0.5 w-6 h-6 text-xs flex items-center justify-center rounded-full font-medium"
                :class="date === today ? 'bg-primary-500 text-white' : 'text-(--ui-text-muted)'"
              >{{ Number(date.slice(8)) }}</div>
            </div>
          </div>

          <!-- Week cells -->
          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="date in weekDayDates"
              :key="date"
              class="min-h-[120px] rounded-lg border border-(--ui-border)/60 p-1.5 cursor-pointer select-none transition-colors hover:bg-(--ui-bg-elevated)/50"
              :class="date === today ? 'bg-primary-500/5 border-primary-500/30' : ''"
              @click="onDayClick(date)"
              @pointerdown="onDayPointerDown(date)"
              @pointerup="onDayPointerCancel()"
              @pointerleave="onDayPointerCancel()"
            >
              <div class="flex flex-col gap-0.5">
                <template v-for="(todo, ti) in todosByDate.get(date) ?? []" :key="todo.id">
                  <div
                    v-if="ti < 5"
                    class="text-[11px] rounded px-1 py-0.5 truncate leading-tight cursor-pointer"
                    :class="[chipBorderClass(todo), chipBgClass(todo), todo.is_done ? 'line-through' : '']"
                    @click.stop="emit('edit', todo)"
                  >{{ todo.title }}</div>
                </template>
                <div
                  v-if="(todosByDate.get(date) ?? []).length > 5"
                  class="text-[11px] text-(--ui-text-dimmed) hover:text-(--ui-text-toned) cursor-pointer px-1"
                  @click.stop="onDayClick(date)"
                >+{{ (todosByDate.get(date) ?? []).length - 5 }} more</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Mobile: Unscheduled strip ──────────────────────────────────── -->
        <div v-if="unscheduledTodos.length > 0" class="sm:hidden border border-(--ui-border) rounded-xl overflow-hidden">
          <button
            class="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-(--ui-bg-elevated)/40 transition-colors"
            @click="unscheduledOpen = !unscheduledOpen"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-heroicons-inbox" class="w-4 h-4 text-(--ui-text-dimmed)" />
              <span class="text-sm font-medium">Unscheduled</span>
              <span class="text-xs px-1.5 py-0.5 rounded-full bg-(--ui-bg-elevated) text-(--ui-text-muted) font-mono">{{ unscheduledTodos.length }}</span>
            </div>
            <UIcon :name="unscheduledOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="w-4 h-4 text-(--ui-text-dimmed)" />
          </button>
          <div v-if="unscheduledOpen" class="border-t border-(--ui-border)/60 divide-y divide-(--ui-border)/40">
            <div
              v-for="todo in unscheduledTodos"
              :key="todo.id"
              class="flex items-center gap-2.5 px-3 py-2.5"
            >
              <div class="w-1 h-4 rounded-full shrink-0" :class="priorityBarClass(todo.priority)" />
              <span class="text-sm flex-1 truncate">{{ todo.title }}</span>
              <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-pencil" @click="emit('edit', todo)" />
            </div>
          </div>
        </div>

      </div>

      <!-- ── Desktop: Unscheduled sidebar ───────────────────────────────────── -->
      <div v-if="unscheduledTodos.length > 0" class="hidden sm:flex sm:flex-col gap-2 w-48 shrink-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-dimmed) flex items-center gap-1.5">
          <UIcon name="i-heroicons-inbox" class="w-3.5 h-3.5" />
          Unscheduled
          <span class="ml-auto font-mono font-normal normal-case tracking-normal">{{ unscheduledTodos.length }}</span>
        </p>
        <div class="space-y-1.5 max-h-[60vh] overflow-y-auto">
          <div
            v-for="todo in unscheduledTodos"
            :key="todo.id"
            class="flex items-start gap-2 p-2 rounded-lg bg-(--ui-bg-muted) border border-(--ui-border)/60 cursor-pointer hover:border-(--ui-border-accented) transition-colors"
            @click="emit('edit', todo)"
          >
            <div class="w-1 self-stretch rounded-full shrink-0 mt-0.5" :class="priorityBarClass(todo.priority)" />
            <span class="text-xs flex-1 min-w-0 break-words leading-snug">{{ todo.title }}</span>
          </div>
        </div>
      </div>

    </div>

    <!-- ── Day detail panel (bottom sheet) ────────────────────────────────── -->
    <Transition name="panel-up">
      <div v-if="selectedDay" class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="selectedDay = null" />
        <div class="absolute inset-x-0 bottom-0 bg-(--ui-bg-muted) border-t border-(--ui-border-accented) rounded-t-2xl max-h-[72vh] flex flex-col">

          <!-- Drag handle -->
          <div class="flex justify-center pt-2.5 pb-0 shrink-0">
            <div class="w-10 h-1 rounded-full bg-(--ui-bg-accented)" />
          </div>

          <!-- Panel header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-(--ui-border)/60 shrink-0">
            <h3 class="font-semibold text-(--ui-text)">{{ selectedDayLabel }}</h3>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                variant="soft"
                color="primary"
                icon="i-heroicons-plus"
                @click="openDayCreate"
              >Add</UButton>
              <button
                class="p-1.5 rounded-lg hover:bg-(--ui-bg-elevated) text-(--ui-text-dimmed) transition-colors"
                @click="selectedDay = null"
              ><UIcon name="i-heroicons-x-mark" class="w-4 h-4" /></button>
            </div>
          </div>

          <!-- Todo list -->
          <div class="flex-1 overflow-y-auto divide-y divide-(--ui-border)/50">
            <div
              v-for="todo in selectedDayTodos"
              :key="todo.id"
              class="flex items-start gap-3 px-4 py-3"
            >
              <div class="w-1 self-stretch rounded-full shrink-0 mt-0.5" :class="priorityBarClass(todo.priority)" />
              <button
                class="mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                :class="todo.is_done ? 'border-green-500 bg-green-500' : 'border-(--ui-border-accented) hover:border-primary-400'"
                @click="emit('toggle', todo)"
              >
                <UIcon v-if="todo.is_done" name="i-heroicons-check" class="w-3 h-3 text-white" />
              </button>
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm font-medium leading-snug"
                  :class="todo.is_done ? 'line-through text-(--ui-text-dimmed)' : ''"
                >{{ todo.title }}</p>
                <div v-if="todo.description || todo.estimated_minutes" class="flex items-center gap-2 mt-0.5">
                  <p v-if="todo.description" class="text-xs text-(--ui-text-dimmed) truncate">{{ todo.description }}</p>
                  <span v-if="todo.estimated_minutes" class="text-xs text-(--ui-text-dimmed) shrink-0">{{ todo.estimated_minutes }}m</span>
                </div>
              </div>
              <UButton variant="ghost" color="neutral" size="xs" icon="i-heroicons-pencil" @click="emit('edit', todo)" />
            </div>

            <!-- Empty state -->
            <div v-if="selectedDayTodos.length === 0" class="flex flex-col items-center gap-3 py-10 text-(--ui-text-dimmed)">
              <p class="text-sm">No TODOs for this day.</p>
              <UButton size="sm" variant="soft" color="primary" icon="i-heroicons-plus" @click="openDayCreate">
                Add one
              </UButton>
            </div>
          </div>

          <!-- Safe-area spacer -->
          <div class="safe-area-bottom shrink-0" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-up-enter-active,
.panel-up-leave-active {
  transition: transform 0.24s ease;
}
.panel-up-enter-active .absolute.inset-0,
.panel-up-leave-active .absolute.inset-0 {
  transition: opacity 0.24s ease;
}
.panel-up-enter-from .absolute.inset-x-0,
.panel-up-leave-to .absolute.inset-x-0 {
  transform: translateY(100%);
}
.panel-up-enter-from .absolute.inset-0,
.panel-up-leave-to .absolute.inset-0 {
  opacity: 0;
}
</style>
