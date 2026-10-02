<script setup lang="ts">
import { formatWeight } from '~/lib/format'
import type { LoggingMode, SetRow } from '~/types/database'

const props = defineProps<{
  set: SetRow
  unit?: 'kg' | 'lbs'
  loggingMode?: LoggingMode
}>()
const emit = defineEmits<{ tap: [set: SetRow] }>()

const unit = computed(() => props.unit ?? 'kg')
const loggingMode = computed(() => props.loggingMode ?? 'strength')

const label = computed(() => {
  if (props.set.is_warmup) return 'W'
  return String(props.set.set_num)
})

const stateIcon = computed(() => {
  if (!props.set.completed) return '○'
  if (props.set.is_warmup) return '○'
  return '●'
})

const weightStr = computed(() =>
  props.set.weight_kg === null ? '—' : formatWeight(props.set.weight_kg, unit.value),
)
</script>

<template>
  <li
    class="flex items-center gap-3 py-2 text-sm"
    :class="set.is_warmup ? 'opacity-60' : ''"
  >
    <!-- Set number / warmup indicator -->
    <span
      class="w-6 text-center font-mono text-xs shrink-0"
      :class="set.completed ? 'text-(--ui-text)' : 'text-(--ui-text-muted)'"
      aria-hidden="true"
    >
      {{ stateIcon }}
    </span>
    <span class="w-4 text-center text-xs font-medium text-(--ui-text-muted) shrink-0">
      {{ label }}
    </span>

    <!-- Weight × Reps -->
    <button
      class="flex-1 flex items-center gap-2 text-left"
      :aria-label="`Edit set ${set.set_num}`"
      :class="set.completed ? 'text-(--ui-text)' : 'text-(--ui-text-muted) italic'"
      @click="emit('tap', set)"
    >
      <template v-if="loggingMode !== 'strength'">
        <span class="font-medium tabular-nums">
          {{ set.distance_m == null ? '—' : `${(set.distance_m / 1000).toFixed(2)} km` }}
        </span>
        <span v-if="set.duration_sec != null" class="text-xs text-(--ui-text-muted)">
          {{ set.duration_sec }} sec
        </span>
      </template>
      <template v-else>
        <span class="font-medium tabular-nums">{{ weightStr }}</span>
        <span class="text-(--ui-text-muted)">×</span>
        <span class="font-medium tabular-nums">{{ set.reps ?? '—' }}</span>
      </template>
      <span v-if="loggingMode === 'strength' && set.rpe !== null" class="text-xs text-(--ui-text-muted)">
        RPE {{ set.rpe }}
      </span>
      <span v-if="loggingMode === 'strength' && set.rir !== null" class="text-xs text-(--ui-text-muted)">
        RIR {{ set.rir }}
      </span>
      <span v-if="loggingMode === 'strength' && set.failure_flag === 1" class="text-xs font-bold text-red-400 shrink-0">F</span>
      <span v-if="loggingMode === 'strength' && set.failure_flag === 1 && set.partial_reps" class="text-xs text-(--ui-text-muted)">
        +{{ set.partial_reps }}p
      </span>
    </button>

    <!-- Notes indicator -->
    <UIcon
      v-if="set.notes"
      name="i-ph-chat-text"
      class="w-4 h-4 text-(--ui-text-muted) shrink-0"
      aria-label="Has note"
    />
  </li>
</template>
