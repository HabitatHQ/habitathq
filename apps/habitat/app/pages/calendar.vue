<script setup lang="ts">
import type { Scribble, Todo } from '~/types/database'

const db = useDatabase()
const now = new Date()
const view = ref(new Date(now.getFullYear(), now.getMonth(), 1))
const todos = ref<Todo[]>([])
const notes = ref<Scribble[]>([])
const selected = ref<string | null>(null)
function key(d: Date) {
  return d.toISOString().slice(0, 10)
}
const cells = computed(() => {
  const start = new Date(view.value)
  start.setDate(1 - start.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return key(d)
  })
})
const noteCount = (date: string) => notes.value.filter((note) => note.entry_date === date).length
const taskCount = (date: string) =>
  todos.value.filter((todo) => !todo.is_done && todo.due_date === date).length
const label = computed(() =>
  view.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)
function shift(months: number) {
  view.value = new Date(view.value.getFullYear(), view.value.getMonth() + months, 1)
}
onMounted(async () => {
  ;[todos.value, notes.value] = await Promise.all([db.getTodos(), db.getScribbles()])
})
</script>
<template><div class="space-y-5"><header><p class="text-sm text-(--ui-text-dimmed)">Your activity and reflections</p><h1 class="text-2xl font-bold">Calendar</h1></header><div class="flex items-center justify-between"><UButton :icon="resolveIcon('chevron-left')" color="neutral" variant="ghost" aria-label="Previous month" @click="shift(-1)" /><span class="font-semibold">{{ label }}</span><UButton :icon="resolveIcon('chevron-right')" color="neutral" variant="ghost" aria-label="Next month" @click="shift(1)" /></div><div class="grid grid-cols-7 gap-1 text-center text-xs text-(--ui-text-dimmed)"><span v-for="day in ['S','M','T','W','T','F','S']" :key="day">{{ day }}</span><button v-for="date in cells" :key="date" class="aspect-square rounded-lg border p-1 text-left" :class="date === selected ? 'border-primary-400 bg-primary-500/10' : 'border-(--ui-border)'" @click="selected = date"><span class="text-(--ui-text)">{{ +date.slice(8) }}</span><span v-if="taskCount(date)" class="block h-1.5 w-1.5 rounded-full bg-amber-400" /><span v-if="noteCount(date)" class="block h-1.5 w-1.5 rounded-full bg-primary-400" /></button></div><AppListSection v-if="selected" :title="selected"><ul class="space-y-2"><AppCard v-for="todo in todos.filter((t) => t.due_date === selected)" :key="todo.id" tag="li"><p class="font-medium">{{ todo.title }}</p><p class="text-xs text-(--ui-text-dimmed)">{{ todo.scheduled_time || 'Any time' }}</p></AppCard><AppCard v-for="note in notes.filter((n) => n.entry_date === selected)" :key="note.id" tag="li" :to="`/jots/edit-${note.id}`"><p class="font-medium">{{ note.title || 'Untitled note' }}</p><p class="text-xs text-(--ui-text-dimmed) truncate">{{ note.content }}</p></AppCard><UButton :to="`/jots/new?date=${selected}`" variant="soft" color="neutral" block>Add note</UButton></ul></AppListSection></div></template>
