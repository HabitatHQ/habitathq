<script setup lang="ts">
import type { CheckinTemplate } from '~/types/database'

const db = useDatabase()
const toast = useToast()
const templates = ref<CheckinTemplate[]>([])
const loading = ref(true)

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadTemplates() {
  templates.value = await db.getCheckinTemplates()
  loading.value = false
}

onMounted(loadTemplates)

// ─── Schedule label ───────────────────────────────────────────────────────────

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
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
                {{ checkinScheduleLabel(t) }}<span v-if="t.response_day_count"> · {{ t.response_day_count }} {{ t.response_day_count === 1 ? 'session' : 'sessions' }}</span>
              </p>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-slate-600 flex-shrink-0" />
          </NuxtLink>
        </li>
      </ul>

      <EmptyState
        v-if="templates.length === 0"
        icon="i-heroicons-pencil-square"
        title="No check-ins yet"
        description="Create one to get started."
      />
    </div>

    <!-- ── Create modal ─────────────────────────────────────────────────────── -->
    <AppModal :open="showCreate" @close="showCreate = false">
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
        <p v-if="newTitleError" class="text-xs text-red-400 -mt-2 flex items-center gap-1">
          <UIcon name="i-heroicons-exclamation-circle" class="w-3.5 h-3.5 flex-shrink-0" />
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
