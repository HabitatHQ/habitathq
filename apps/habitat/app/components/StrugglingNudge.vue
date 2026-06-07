<script setup lang="ts">
/**
 * StrugglingNudge — gentle intervention shown when a habit's recent completion
 * has dropped off (see `isStruggling`). Resurfaces the habit's motivation and
 * offers a one-week pause. Used on the Today page (with the habit name) and on
 * the habit detail page (name omitted — the header already shows it).
 */
import type { HabitWithSchedule } from '~/types/database'

defineProps<{
  habit: HabitWithSchedule
  /** Show the habit's name + icon (Today list, where several may appear). */
  showName?: boolean
  pausing?: boolean
}>()

defineEmits<{
  pause: []
  /** Request to add motivation (parent opens the edit form). */
  edit: []
}>()
</script>

<template>
  <div class="flex flex-col gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
    <div class="flex items-start gap-3">
      <div
        v-if="showName"
        class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        :style="{ backgroundColor: `${habit.color}26` }"
      >
        <AppIcon :name="habit.icon" :color="habit.color" class="w-4 h-4" />
      </div>
      <AppIcon v-else name="heart" class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />

      <div class="space-y-1 min-w-0">
        <p class="text-sm font-medium text-amber-200">
          <template v-if="showName">{{ habit.name }} is slipping lately</template>
          <template v-else>Struggling with this one lately?</template>
        </p>
        <p v-if="habit.why" class="text-sm text-(--ui-text-toned)">
          Remember your motivation: <span class="italic">“{{ habit.why }}”</span>
        </p>
        <p v-else class="text-sm text-(--ui-text-dimmed)">
          Adding your motivation helps you reconnect with it.
        </p>
      </div>
    </div>

    <div class="flex gap-2">
      <UButton
        size="xs"
        color="warning"
        variant="soft"
        :loading="pausing"
        @click="$emit('pause')"
      >
        Pause for a week
      </UButton>
      <UButton v-if="!habit.why" size="xs" color="neutral" variant="ghost" @click="$emit('edit')">
        Add motivation
      </UButton>
    </div>
  </div>
</template>
