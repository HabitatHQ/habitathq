<script setup lang="ts">
import type { CheckinTemplate } from '~/types/database'
import { toLocalDateKey } from '~/utils/format'

const db = useDatabase()
const toast = useToast()
const templates = ref<CheckinTemplate[]>([])
const loading = ref(true)
const staggerOnce = useFirstVisit('checkin-list')

// ─── Load ────────────────────────────────────────────────────────────────────

const todaySummary = ref<Map<string, { count: number; completed: boolean }>>(new Map())

const loadError = ref<string | null>(null)

async function loadTemplates() {
  try {
    templates.value = await db.getCheckinTemplates()
    const today = toLocalDateKey(new Date())
    const summary = await db.getCheckinSummaryForDate(today)
    todaySummary.value = new Map(
      summary.map((s) => [s.template_id, { count: s.response_count, completed: s.is_completed }]),
    )
    loadError.value = null
  } catch (e) {
    loadError.value = logError('[checkin/load]', e)
  } finally {
    loading.value = false
  }
}

function isCompleted(t: CheckinTemplate) {
  return todaySummary.value.get(t.id)?.completed ?? false
}

onMounted(loadTemplates)

// ─── Active-today gating (schedule label comes from checkinScheduleLabel helper) ──

const now = new Date()
const todayDow = now.getDay() // 0=Sun … 6=Sat
const todayDom = now.getDate() // 1…31
const daysInThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

function isActiveToday(t: CheckinTemplate): boolean {
  if (t.schedule_type === 'DAILY') return true
  if (t.schedule_type === 'WEEKLY') {
    if (!t.days_active || t.days_active.length === 0) return true
    return t.days_active.includes(todayDow)
  }
  // MONTHLY — active on the configured day, clamped to the month's last day.
  const day = t.days_active?.[0]
  if (!day) return true
  return todayDom === Math.min(day, daysInThisMonth)
}

// ─── Create template ─────────────────────────────────────────────────────────
// Skip the modal — create a blank check-in and land straight on its edit page,
// where title/icon/color/schedule/questions are all configured inline.

const creating = ref(false)

async function openCreate() {
  if (creating.value) return
  creating.value = true
  try {
    const t = await db.createCheckinTemplate({
      title: 'New check-in',
      schedule_type: 'DAILY',
      days_active: null,
      icon: 'pencil-square',
      color: '#22d3ee',
    })
    await navigateTo(`/checkin/${t.id}?new=1`)
  } catch (e) {
    creating.value = false
    logError('[checkin/create]', e)
    toast.add({ title: 'Failed to create check-in', color: 'error', duration: 3000 })
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
          :loading="creating"
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
      <ul v-if="templates.length" :class="['space-y-2', { 'stagger-list': staggerOnce }]">
        <AppCard
          v-for="t in templates"
          :key="t.id"
          tag="li"
          :to="`/checkin/entry-${t.id}`"
          :completed="isCompleted(t)"
          :dimmed="!isActiveToday(t)"
        >
          <AppCardIcon :icon="t.icon" :icon-color="t.color" :bg-color="t.color + '33'" />
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
        description="Track your mood, energy, or anything you want to reflect on."
      >
        <template #actions>
          <UButton @click="openCreate" :icon="resolveIcon('plus')" :loading="creating">
            Create Check-in
          </UButton>
        </template>
      </EmptyState>
    </div>

  </div>
</template>
