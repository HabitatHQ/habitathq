<script setup lang="ts">
import type { HabitWithSchedule } from '~/types/database'

defineProps<{
  habit: HabitWithSchedule
  done: boolean
  overLimit: boolean
  todayLogSum: number
  weeklyInfo: { done: number; target: number } | null
  toggling: boolean
  dimmed: boolean
  flashing: boolean
  showTags: boolean
  showAnnotations: boolean
}>()

defineEmits<{
  toggle: []
  log: []
}>()
</script>

<template>
  <AppCard
    tag="li"
    :completed="done"
    :dimmed="dimmed"
    :class="{ 'habit-flash': flashing }"
  >
    <AppCardIcon :icon="habit.icon" :icon-color="habit.color" :bg-color="habit.color + '22'" />

    <!-- Name + subtitle -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <p class="text-sm font-medium truncate text-(--ui-text)">{{ habit.name }}</p>
        <span
          v-if="habit.type !== 'BOOLEAN'"
          class="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
          :class="habit.type === 'NUMERIC'
            ? 'bg-primary-500/15 text-primary-400'
            : 'bg-amber-500/15 text-amber-400'"
        >{{ habit.type === 'NUMERIC' ? '# Target' : '↓ Limit' }}</span>
      </div>
      <!-- NUMERIC: logged / target -->
      <p v-if="habit.type === 'NUMERIC'" class="text-xs text-(--ui-text-dimmed)">
        {{ todayLogSum }} / {{ habit.target_value }}
        <span v-if="weeklyInfo" class="ml-2 text-slate-600">
          · {{ weeklyInfo.done }}/{{ weeklyInfo.target }} this week
        </span>
      </p>
      <!-- LIMIT: count / limit -->
      <p
        v-else-if="habit.type === 'LIMIT'"
        class="text-xs"
        :class="overLimit ? 'text-red-400' : 'text-(--ui-text-dimmed)'"
      >
        {{ todayLogSum }} / {{ habit.target_value }} limit
        <span v-if="weeklyInfo" class="ml-2 text-slate-600">
          · {{ weeklyInfo.done }}/{{ weeklyInfo.target }} this week
        </span>
      </p>
      <!-- BOOLEAN weekly flex badge -->
      <p v-else-if="weeklyInfo" class="text-xs text-(--ui-text-dimmed)">
        {{ weeklyInfo.done }}/{{ weeklyInfo.target }} this week
      </p>
      <div v-if="showTags && habit.tags.length" class="flex flex-wrap gap-1 mt-1">
        <span
          v-for="tag in habit.tags"
          :key="tag"
          class="px-1.5 py-0.5 rounded text-[9px]"
          :class="tag.startsWith('habitat-') ? 'bg-cyan-900/40 text-cyan-600' : 'bg-(--ui-bg-elevated) text-(--ui-text-dimmed)'"
        >#{{ tag.startsWith('habitat-') ? tag.slice(8) : tag }}</span>
      </div>
      <div v-if="showAnnotations && Object.keys(habit.annotations).length" class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
        <span
          v-for="(val, key) in habit.annotations"
          :key="key"
          class="text-[9px] text-slate-600"
        >{{ key }}: {{ val }}</span>
      </div>
    </div>

    <!-- BOOLEAN: toggle button -->
    <template v-if="habit.type === 'BOOLEAN'">
      <button
        class="w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all duration-200"
        :class="done
          ? 'bg-primary-500 border-primary-500'
          : 'border-(--ui-border-accented) hover:border-(--ui-border-accented) bg-transparent'"
        :disabled="toggling"
        @click="$emit('toggle')"
      >
        <AppIcon v-if="done" name="check" class="w-3.5 h-3.5 text-white" />
      </button>
    </template>

    <!-- NUMERIC / LIMIT: log button -->
    <template v-else>
      <UButton
        size="xs"
        variant="soft"
        :color="habit.type === 'LIMIT' && overLimit ? 'error' : habit.type === 'NUMERIC' ? 'primary' : 'warning'"
        @click="$emit('log')"
      >
        Log
      </UButton>
      <div v-if="done" class="w-5 flex-shrink-0 flex items-center justify-center">
        <AppIcon
          name="check-circle"
          class="w-5 h-5"
          :class="habit.type === 'NUMERIC' ? 'text-primary-400' : 'text-amber-400'"
        />
      </div>
    </template>
  </AppCard>
</template>
