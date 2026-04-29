<script setup lang="ts">
import type { Todo } from '~/types/database'

defineProps<{
  todo: Todo
  done: boolean
  toggling: boolean
}>()

defineEmits<{
  toggle: []
}>()
</script>

<template>
  <AppCard tag="li" :completed="done">
    <!-- Priority stripe -->
    <div class="w-1 self-stretch rounded-full shrink-0" :class="priorityColor(todo.priority)" />

    <!-- Checkbox -->
    <button
      class="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
      :class="done ? 'border-green-500 bg-green-500' : 'border-(--ui-border-accented)'"
      :disabled="toggling"
      :aria-label="done ? `Mark '${todo.title}' not done` : `Mark '${todo.title}' done`"
      @click="$emit('toggle')"
    >
      <AppIcon v-if="done" name="check" class="w-3 h-3 text-white" aria-hidden="true" />
      <AppIcon v-else-if="todo.is_recurring" name="arrow-path" class="w-2.5 h-2.5 text-(--ui-text-dimmed)" aria-hidden="true" />
    </button>

    <!-- Title + estimate -->
    <div class="flex-1 min-w-0">
      <p
        class="text-sm font-medium truncate transition-colors"
        :class="done ? 'line-through text-(--ui-text-dimmed)' : 'text-(--ui-text)'"
      >{{ todo.title }}</p>
      <p v-if="todo.estimated_minutes" class="text-xs text-(--ui-text-dimmed) flex items-center gap-0.5 mt-0.5">
        <AppIcon name="clock" class="w-3 h-3" />
        {{ todo.estimated_minutes }}m
      </p>
    </div>
  </AppCard>
</template>
