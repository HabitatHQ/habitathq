<script setup lang="ts">
interface Props {
  exercises: Array<{ muscles_primary: string; movement: string }>
}

const props = defineProps<Props>()

const MOVEMENT_COLORS: Record<string, string> = {
  squat: '#3b82f6',
  hinge: '#f59e0b',
  press: '#f97316',
  row: '#14b8a6',
  carry: '#8b5cf6',
  isolation: '#f43f5e',
  cardio: '#22c55e',
}

interface MuscleSegment {
  movement: string
  count: number
  color: string
}

const segments = computed<MuscleSegment[]>(() => {
  const counts: Record<string, number> = {}
  for (const ex of props.exercises) {
    const movement = ex.movement
    counts[movement] = (counts[movement] ?? 0) + 1
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([movement, count]) => ({
      movement,
      count,
      color: MOVEMENT_COLORS[movement] ?? '#71717a',
    }))
})

const total = computed(() => segments.value.reduce((a, s) => a + s.count, 0))
</script>

<template>
  <div v-if="segments.length > 0" class="space-y-2">
    <!-- Stacked bar -->
    <div class="h-3 rounded-full overflow-hidden flex" role="img" :aria-label="`Muscle group distribution: ${segments.map(s => `${s.movement} ${Math.round((s.count / total) * 100)}%`).join(', ')}`">
      <div
        v-for="seg in segments"
        :key="seg.movement"
        class="h-full transition-all"
        :style="{ width: `${(seg.count / total) * 100}%`, backgroundColor: seg.color }"
      />
    </div>
    <!-- Legend -->
    <div class="flex flex-wrap gap-2">
      <div v-for="seg in segments" :key="seg.movement" class="flex items-center gap-1">
        <div class="w-2 h-2 rounded-full" :style="{ backgroundColor: seg.color }" />
        <span class="text-[10px] text-(--ui-text-muted) capitalize">{{ seg.movement }}</span>
      </div>
    </div>
  </div>
</template>
