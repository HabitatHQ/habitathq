<script setup lang="ts">
interface Props {
  programName: string
  currentWeek: number
  totalWeeks: number
  todayLabel?: string
  templateId?: string | null
}

const props = defineProps<Props>()

const percent = computed(() =>
  Math.min(100, Math.round(((props.currentWeek - 1) / props.totalWeeks) * 100)),
)
</script>

<template>
  <div class="rounded-xl bg-(--color-surface) p-4 space-y-3">
    <div class="flex items-start justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">Active Program</p>
        <p class="font-bold mt-0.5">{{ programName }}</p>
      </div>
      <span class="text-xs text-(--ui-text-muted)">
        Week {{ currentWeek }}/{{ totalWeeks }}
      </span>
    </div>

    <div class="h-2 bg-(--color-surface-2) rounded-full overflow-hidden">
      <div
        class="h-full bg-(--color-accent) rounded-full transition-all"
        :style="{ width: `${percent}%` }"
      />
    </div>

    <div v-if="todayLabel" class="flex items-center justify-between">
      <p class="text-sm text-(--ui-text-muted)">{{ todayLabel }}</p>
      <NuxtLink
        v-if="templateId"
        :to="`/templates/${templateId}`"
        class="text-xs font-semibold text-(--color-accent)"
      >
        Start →
      </NuxtLink>
    </div>
  </div>
</template>
