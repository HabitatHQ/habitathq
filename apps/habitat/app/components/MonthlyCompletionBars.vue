<script setup lang="ts">
/**
 * MonthlyCompletionBars — vertical bar chart of monthly completion rate, shared
 * by the Insights surfaces. Each column needs `h-full` so the percentage bar
 * height resolves against the fixed-height row (otherwise bars collapse to 0).
 */
defineProps<{
  /** Oldest → newest. */
  data: { label: string; rate: number }[]
}>()
</script>

<template>
  <div class="flex items-end gap-1.5 h-28">
    <div
      v-for="month in data"
      :key="month.label"
      class="flex-1 h-full flex flex-col items-center gap-1"
    >
      <span
        class="text-[10px] font-medium tabular-nums"
        :class="month.rate >= 70 ? 'text-emerald-400' : month.rate >= 40 ? 'text-amber-400' : month.rate > 0 ? 'text-rose-400' : 'text-slate-700'"
      >{{ month.rate > 0 ? `${month.rate}%` : '—' }}</span>
      <div class="w-full flex-1 flex items-end">
        <div
          class="w-full rounded-t transition-all duration-700"
          :class="month.rate >= 70 ? 'bg-emerald-500' : month.rate >= 40 ? 'bg-amber-400' : month.rate > 0 ? 'bg-rose-500' : 'bg-(--ui-bg-elevated)'"
          :style="{ height: `${Math.max(month.rate > 0 ? 4 : 0, month.rate)}%` }"
        />
      </div>
      <span class="text-[10px] text-slate-600">{{ month.label }}</span>
    </div>
  </div>
</template>
