<script setup lang="ts">
import type { Habit } from '~/types/database'

const db = useDatabase()

const staggerHabitsOnce = useFirstVisit('archive-habits')

// ─── Archived habits ──────────────────────────────────────────────────────────

const archivedHabits = ref<Habit[]>([])
const loadingHabits = ref(true)

async function loadHabits() {
  archivedHabits.value = await db.getArchivedHabits()
  loadingHabits.value = false
}

onMounted(loadHabits)
</script>

<template>
  <div class="space-y-5">

    <!-- Back nav -->
    <BackNav to="/habits" label="Habits" />

    <header>
      <h2 class="text-2xl font-bold">Archive</h2>
    </header>

    <EmptyState
      v-if="!loadingHabits && archivedHabits.length === 0"
      icon="archive-box"
      title="No archived habits yet"
      description="Habits you archive will appear here."
    />

    <ul v-else :class="['space-y-2', { 'stagger-list': staggerHabitsOnce }]">
      <AppCard
        v-for="habit in archivedHabits"
        :key="habit.id"
        tag="li"
        align="start"
      >
        <div
          class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center opacity-60"
          :style="{ backgroundColor: habit.color + '33' }"
        >
          <AppIcon :name="habit.icon" :color="habit.color" class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-(--ui-text-muted) truncate">{{ habit.name }}</p>
          <p class="text-xs text-slate-600">
            Archived {{ habit.archived_at ? fmtArchived(habit.archived_at) : '' }}
          </p>
        </div>
      </AppCard>
    </ul>

  </div>
</template>
