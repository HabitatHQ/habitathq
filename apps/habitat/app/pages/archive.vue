<script setup lang="ts">
import type { Habit } from '~/types/database'

const db = useDatabase()

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const tab = ref<'habits' | 'checkin'>('habits')
const staggerHabitsOnce = useFirstVisit('archive-habits')
const staggerCheckinOnce = useFirstVisit('archive-checkin')

// ─── Archived habits ──────────────────────────────────────────────────────────

const archivedHabits = ref<Habit[]>([])
const loadingHabits = ref(true)

async function loadHabits() {
  archivedHabits.value = await db.getArchivedHabits()
  loadingHabits.value = false
}

// ─── Check-in history ─────────────────────────────────────────────────────────

interface CheckinDay {
  date: string
  label: string
  count: number
}

const checkinDays = ref<CheckinDay[]>([])
const loadingCheckins = ref(false)

async function loadCheckins() {
  loadingCheckins.value = true
  try {
    const rows = await db.getCheckinResponseDates()
    checkinDays.value = rows.map((r) => ({
      date: r.date,
      label: new Date(`${r.date}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      count: r.count,
    }))
  } finally {
    loadingCheckins.value = false
  }
}

watch(tab, (t) => {
  if (t === 'checkin' && checkinDays.value.length === 0) void loadCheckins()
})

onMounted(loadHabits)
</script>

<template>
  <div class="space-y-5">

    <!-- Back nav -->
    <BackNav to="/habits" label="Habits" />

    <header>
      <h2 class="text-2xl font-bold">Archive &amp; History</h2>
    </header>

    <!-- Tabs -->
    <div class="flex gap-1 bg-(--ui-bg-muted) rounded-xl p-1">
      <button
        class="flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors"
        :class="tab === 'habits' ? 'bg-(--ui-bg-elevated) text-(--ui-text)' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-muted)'"
        @click="tab = 'habits'"
      >
        Habits
      </button>
      <button
        class="flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors"
        :class="tab === 'checkin' ? 'bg-(--ui-bg-elevated) text-(--ui-text)' : 'text-(--ui-text-dimmed) hover:text-(--ui-text-muted)'"
        @click="tab = 'checkin'"
      >
        Check-in
      </button>
    </div>

    <!-- ── Habits tab ──────────────────────────────────────────────────────────── -->
    <template v-if="tab === 'habits'">
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
    </template>

    <!-- ── Check-in tab ─────────────────────────────────────────────────────────── -->
    <template v-else>
      <div v-if="loadingCheckins" class="flex items-center gap-2 text-xs text-(--ui-text-dimmed) py-4">
        <AppIcon name="arrow-path" class="w-4 h-4 animate-spin" />
        Loading…
      </div>
      <EmptyState
        v-else-if="checkinDays.length === 0"
        icon="pencil-square"
        title="No check-in responses yet"
        description="Completed check-ins will appear here."
      />

      <ul v-else :class="['space-y-2', { 'stagger-list': staggerCheckinOnce }]">
        <AppCard
          v-for="day in checkinDays"
          :key="day.date"
          tag="li"
        >
          <div class="w-9 h-9 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center flex-shrink-0">
            <AppIcon name="pencil-square" class="w-4 h-4 text-(--ui-text-muted)" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text-toned) truncate">{{ day.label }}</p>
            <p class="text-xs text-slate-600">{{ day.count }} {{ day.count === 1 ? 'response' : 'responses' }}</p>
          </div>
        </AppCard>
      </ul>
    </template>

  </div>
</template>
