<script setup lang="ts">
import type { WeekDot } from '~/lib/analytics'

defineProps<{
  grid: WeekDot[][] // [week][day]
}>()

const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const today = new Date().toISOString().slice(0, 10)
</script>

<template>
  <div class="w-full overflow-x-auto">
    <div class="flex gap-1 min-w-fit">
      <!-- Day labels column -->
      <div class="flex flex-col gap-1 mr-1">
        <div class="h-4" aria-hidden="true" />
        <!-- header spacer -->
        <div
          v-for="(label, i) in dayLabels"
          :key="i"
          class="w-4 h-4 flex items-center justify-center text-[9px] text-zinc-600"
          aria-hidden="true"
        >
          {{ label }}
        </div>
      </div>
      <!-- Weeks -->
      <div v-for="(week, wi) in grid" :key="wi" class="flex flex-col gap-1">
        <!-- Week label -->
        <div class="h-4 text-[9px] text-zinc-600 flex items-center justify-center w-4" aria-hidden="true">
          {{ wi % 4 === 0 ? week[0]?.date.slice(5, 7) : '' }}
        </div>
        <!-- Days -->
        <div
          v-for="dot in week"
          :key="dot.date"
          class="w-4 h-4 rounded-sm transition-colors"
          :class="dot.date > today
            ? 'bg-zinc-800/30'
            : dot.hasWorkout
              ? 'bg-orange-500'
              : 'bg-zinc-800'"
          :title="dot.date"
        />
      </div>
    </div>
  </div>
</template>
