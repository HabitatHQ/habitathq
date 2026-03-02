<script setup lang="ts">
import type { Habit } from '~/types/database'

const db = useDatabase()

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const tab = ref<'habits' | 'checkin'>('habits')

// ─── Archived habits ──────────────────────────────────────────────────────────

const archivedHabits = ref<Habit[]>([])
const loadingHabits = ref(true)

async function loadHabits() {
  if (!db.isAvailable) {
    loadingHabits.value = false
    return
  }
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
  if (!db.isAvailable) return
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
    <div class="flex items-center gap-2 -mb-1">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
        to="/habits"
      />
      <span class="text-sm text-(--ui-text-dimmed)">Habits</span>
    </div>

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
      <section
        v-if="!loadingHabits && archivedHabits.length === 0"
        class="flex flex-col items-center gap-3 py-12 text-center"
      >
        <UIcon name="i-heroicons-archive-box" class="w-8 h-8 text-slate-700" />
        <p class="text-sm text-(--ui-text-dimmed)">No archived habits yet.</p>
      </section>

      <ul v-else class="space-y-2">
        <li
          v-for="habit in archivedHabits"
          :key="habit.id"
          class="flex items-center gap-3 p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
        >
          <div
            class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center opacity-60"
            :style="{ backgroundColor: habit.color + '33' }"
          >
            <UIcon :name="habit.icon" class="w-5 h-5" :style="{ color: habit.color }" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text-muted) truncate">{{ habit.name }}</p>
            <p class="text-xs text-slate-600">
              Archived {{ habit.archived_at ? fmtArchived(habit.archived_at) : '' }}
            </p>
          </div>
        </li>
      </ul>
    </template>

    <!-- ── Check-in tab ─────────────────────────────────────────────────────────── -->
    <template v-else>
      <div v-if="loadingCheckins" class="flex items-center gap-2 text-xs text-(--ui-text-dimmed) py-4">
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 animate-spin" />
        Loading…
      </div>
      <section
        v-else-if="checkinDays.length === 0"
        class="flex flex-col items-center gap-3 py-12 text-center"
      >
        <UIcon name="i-heroicons-pencil-square" class="w-8 h-8 text-slate-700" />
        <p class="text-sm text-(--ui-text-dimmed)">No check-in responses yet.</p>
      </section>

      <ul v-else class="space-y-2">
        <li
          v-for="day in checkinDays"
          :key="day.date"
          class="flex items-center gap-3 p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
        >
          <div class="w-9 h-9 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center flex-shrink-0">
            <UIcon name="i-heroicons-pencil-square" class="w-4 h-4 text-(--ui-text-muted)" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text-toned) truncate">{{ day.label }}</p>
            <p class="text-xs text-slate-600">{{ day.count }} {{ day.count === 1 ? 'response' : 'responses' }}</p>
          </div>
        </li>
      </ul>
    </template>

  </div>
</template>
