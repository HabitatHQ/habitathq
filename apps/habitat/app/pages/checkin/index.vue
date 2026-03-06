<script setup lang="ts">
import type { CheckinTemplate } from '~/types/database'

const db = useDatabase()
const templates = ref<CheckinTemplate[]>([])
const loading = ref(true)

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadTemplates() {
  if (!db.isAvailable) {
    loading.value = false
    return
  }
  templates.value = await db.getCheckinTemplates()
  loading.value = false
}

onMounted(loadTemplates)

// ─── Schedule label ───────────────────────────────────────────────────────────

// ─── Create template ─────────────────────────────────────────────────────────

const showCreate = useBoolModalQuery('create')
const creating = ref(false)
const newTitle = ref('')
const newSchedule = ref<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY')
const newDays = ref<number[]>([])

function toggleDay(day: number) {
  const idx = newDays.value.indexOf(day)
  if (idx >= 0) newDays.value.splice(idx, 1)
  else {
    newDays.value.push(day)
    newDays.value.sort((a, b) => a - b)
  }
}

function openCreate() {
  newTitle.value = ''
  newSchedule.value = 'DAILY'
  newDays.value = []
  showCreate.value = true
}

async function createTemplate() {
  if (!db.isAvailable || !newTitle.value.trim() || creating.value) return
  creating.value = true
  try {
    const t = await db.createCheckinTemplate({
      title: newTitle.value.trim(),
      schedule_type: newSchedule.value,
      days_active:
        newSchedule.value === 'WEEKLY' && newDays.value.length ? [...newDays.value] : null,
    })
    templates.value.push(t)
    showCreate.value = false
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-5">

    <!-- Header -->
    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Check-in</h2>
      <UButton
        icon="i-heroicons-plus"
        variant="soft"
        color="neutral"
        size="sm"
        class="min-h-[44px]"
        @click="openCreate"
      >
        New
      </UButton>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin text-slate-600" />
    </div>

    <!-- Template list -->
    <div v-else class="space-y-2">
      <ul v-if="templates.length" class="space-y-2">
        <li v-for="t in templates" :key="t.id">
          <NuxtLink
            :to="`/checkin/${t.id}`"
            class="flex items-center justify-between p-4 rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border)
                   hover:border-(--ui-border-accented) transition-colors"
          >
            <div>
              <p class="font-semibold text-(--ui-text)">{{ t.title }}</p>
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5">{{ checkinScheduleLabel(t) }}</p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-600 flex-shrink-0" />
          </NuxtLink>
        </li>
      </ul>

      <div
        v-if="templates.length === 0"
        class="flex flex-col items-center gap-3 py-12 text-center"
      >
        <UIcon name="i-heroicons-pencil-square" class="w-8 h-8 text-slate-700" />
        <p class="text-sm text-(--ui-text-dimmed)">No check-ins yet. Create one to get started.</p>
      </div>
    </div>

    <!-- ── Create modal ─────────────────────────────────────────────────────── -->
    <div
      v-if="showCreate"
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="showCreate = false"
      />
      <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-(--ui-text)">New Check-in</h3>
          <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="showCreate = false" />
        </div>

        <!-- Title -->
        <UInput
          v-model="newTitle"
          placeholder="Name (e.g. Morning Check-in)"
          autofocus
          @keydown.enter="createTemplate"
        />

        <!-- Schedule -->
        <div class="space-y-1.5">
          <p class="text-xs text-(--ui-text-dimmed)">Schedule</p>
          <div class="flex gap-1.5">
            <button
              v-for="sched in (['DAILY', 'WEEKLY', 'MONTHLY'] as const)"
              :key="sched"
              class="flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors"
              :class="newSchedule === sched
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented) hover:text-(--ui-text-muted)'"
              @click="newSchedule = sched"
            >
              {{ sched === 'DAILY' ? 'Daily' : sched === 'WEEKLY' ? 'Weekly' : 'Monthly' }}
            </button>
          </div>
        </div>

        <!-- Day picker (WEEKLY only) -->
        <div v-if="newSchedule === 'WEEKLY'" class="space-y-1.5">
          <p class="text-xs text-(--ui-text-dimmed)">Days (leave blank for every day)</p>
          <div class="flex gap-1.5">
            <button
              v-for="(label, i) in CHECKIN_DAY_LABELS"
              :key="i"
              class="w-8 h-8 rounded-full text-xs font-medium border transition-colors"
              :class="newDays.includes(i)
                ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                : 'border-(--ui-border-accented) text-(--ui-text-dimmed) hover:border-(--ui-border-accented)'"
              @click="toggleDay(i)"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <UButton variant="ghost" color="neutral" size="sm" @click="showCreate = false">Cancel</UButton>
          <UButton
            size="sm"
            :disabled="!newTitle.trim() || creating"
            :loading="creating"
            @click="createTemplate"
          >
            Create
          </UButton>
        </div>
        <div class="safe-area-bottom" aria-hidden="true" />
      </div>
    </div>

  </div>
</template>
