<script setup lang="ts">
const props = defineProps<{
  muscles: Array<{ muscle: string; count: number; lastTrained: string | null }>
}>()

const maxCount = computed(() =>
  props.muscles.length > 0 ? Math.max(...props.muscles.map((m) => m.count)) : 1,
)

function intensity(count: number): string {
  const ratio = count / maxCount.value
  if (ratio > 0.75) return 'bg-orange-500'
  if (ratio > 0.5) return 'bg-orange-400'
  if (ratio > 0.25) return 'bg-orange-300'
  return 'bg-orange-200'
}

function formatMuscle(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>

<template>
  <div>
    <div v-if="muscles.length === 0" class="text-center text-zinc-500 text-sm py-4">
      No data for the selected period
    </div>
    <div v-else class="grid grid-cols-2 gap-2">
      <div
        v-for="m in muscles"
        :key="m.muscle"
        class="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/50"
      >
        <div
          class="w-3 h-3 rounded-full flex-shrink-0"
          :class="intensity(m.count)"
          aria-hidden="true"
        />
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium text-white truncate">{{ formatMuscle(m.muscle) }}</p>
          <p class="text-[10px] text-zinc-500">{{ m.count }} sessions</p>
        </div>
      </div>
    </div>
  </div>
</template>
