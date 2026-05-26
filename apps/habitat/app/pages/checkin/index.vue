<script setup lang="ts">
import type { CheckinTemplate } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'

const db = useDatabase()
const toast = useToast()
const templates = ref<CheckinTemplate[]>([])
const loading = ref(true)

// ─── Load ────────────────────────────────────────────────────────────────────

const todaySummary = ref<Map<string, { count: number; completed: boolean }>>(new Map())

async function loadTemplates() {
  templates.value = await db.getCheckinTemplates()
  const today = toLocalDateKey(new Date())
  const summary = await db.getCheckinSummaryForDate(today)
  todaySummary.value = new Map(
    summary.map((s) => [s.template_id, { count: s.response_count, completed: s.is_completed }]),
  )
  loading.value = false
}

function isCompleted(t: CheckinTemplate) {
  return todaySummary.value.get(t.id)?.completed ?? false
}

onMounted(loadTemplates)

// ─── Schedule label ───────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function checkinScheduleLabel(t: CheckinTemplate): string {
  if (t.schedule_type === 'DAILY') return 'Daily'
  if (t.schedule_type === 'MONTHLY') return 'Monthly'
  if (!t.days_active || t.days_active.length === 0) return 'Weekly'
  return `Weekly · ${t.days_active.map((d) => DAY_NAMES[d]).join(', ')}`
}

const todayDow = new Date().getDay() // 0=Sun … 6=Sat

function isActiveToday(t: CheckinTemplate): boolean {
  if (t.schedule_type === 'DAILY') return true
  if (t.schedule_type === 'WEEKLY') {
    if (!t.days_active || t.days_active.length === 0) return true
    return t.days_active.includes(todayDow)
  }
  return true // MONTHLY — always show
}

// ─── Create template ─────────────────────────────────────────────────────────

const showCreate = useBoolModalQuery('create')
const creating = ref(false)
const newTitle = ref('')
const newTitleError = ref<string | null>(null)
const newSchedule = ref<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY')
const newDays = ref<number[]>([])

watch(newTitle, () => {
  newTitleError.value = null
})

function openCreate() {
  newTitle.value = ''
  newSchedule.value = 'DAILY'
  newDays.value = []
  showCreate.value = true
}

async function createTemplate() {
  if (creating.value) return
  if (!newTitle.value.trim()) {
    newTitleError.value = 'Name is required'
    return
  }
  newTitleError.value = null
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
    toast.add({ title: 'Check-in created', color: 'success', duration: 2000 })
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
      <div class="flex items-center gap-2">
        <UButton
          :icon="resolveIcon('clock')"
          variant="ghost"
          color="neutral"
          size="sm"
          class="min-h-[44px]"
          to="/checkin/history"
        >
          History
        </UButton>
        <UButton
          :icon="resolveIcon('plus')"
          variant="soft"
          color="neutral"
          size="sm"
          class="min-h-[44px]"
          @click="openCreate"
        >
          New
        </UButton>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <AppIcon name="arrow-path" class="w-5 h-5 animate-spin text-(--ui-text-muted)" />
    </div>

    <!-- Template list -->
    <div v-else class="space-y-2">
      <ul v-if="templates.length" class="space-y-2">
        <AppCard
          v-for="t in templates"
          :key="t.id"
          tag="li"
          :to="`/checkin/entry-${t.id}`"
          :completed="isCompleted(t)"
          :dimmed="!isActiveToday(t)"
        >
          <AppCardIcon icon="pencil-square" bg-class="bg-primary-500/10" icon-color="#22d3ee" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text) truncate">{{ t.title }}</p>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
              {{ checkinScheduleLabel(t) }}<span v-if="t.response_day_count"> · {{ t.response_day_count }} {{ t.response_day_count === 1 ? 'session' : 'sessions' }}</span>
            </p>
          </div>
          <AppIcon name="chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) flex-shrink-0" />
        </AppCard>
      </ul>

      <EmptyState
        v-if="templates.length === 0"
        icon="pencil-square"
        title="No check-ins yet"
        description="Create one to get started."
      />
    </div>

    <!-- ── Create modal ─────────────────────────────────────────────────────── -->
    <AppModal v-model="showCreate">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-(--ui-text)">New Check-in</h3>
          <AppIconButton icon="x-mark" label="Close" @click="showCreate = false" />
        </div>

        <!-- Title -->
        <AppTextField
          v-model="newTitle"
          placeholder="Name (e.g. Morning Check-in)"
          autofocus
          @keydown.enter="createTemplate"
        />
        <p v-if="newTitleError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
          <AppIcon name="exclamation-circle" class="w-4 h-4 flex-shrink-0" />
          {{ newTitleError }}
        </p>

        <!-- Schedule -->
        <div class="space-y-1.5">
          <p class="text-xs text-(--ui-text-dimmed)">Schedule</p>
          <TypeSelector
            v-model="newSchedule"
            :options="[{value:'DAILY',label:'Daily'},{value:'WEEKLY',label:'Weekly'},{value:'MONTHLY',label:'Monthly'}]"
          />
        </div>

        <!-- Day picker (WEEKLY only) -->
        <div v-if="newSchedule === 'WEEKLY'" class="space-y-1.5">
          <p class="text-xs text-(--ui-text-dimmed)">Days (leave blank for every day)</p>
          <DayPicker v-model="newDays" :labels="CHECKIN_DAY_LABELS" />
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
    </AppModal>

  </div>
</template>
