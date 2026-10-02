<script setup lang="ts">
import type { ProgramProgress } from '~/composables/usePrograms'
import type { ProgramDayRow, ProgramRow, ProgramWeekRow, TemplateRow } from '~/types/database'

const route = useRoute()
const programId = computed(() => String(route.params['id'] ?? ''))
const { load, setActive, advanceWeek, getProgress, addDay } = usePrograms()
const workout = useWorkout()
const db = useDatabase()
const templatesApi = useTemplates()

const program = ref<ProgramRow | null>(null)
const progress = ref<ProgramProgress | null>(null)
const templates = ref<TemplateRow[]>([])
const weekDays = ref<ProgramDayRow[]>([])
const weekId = ref<string | null>(null)
const selectedDay = ref(1)
const selectedTemplate = ref('')
const loading = ref(true)

watch(
  db.status,
  async (status) => {
    if (status !== 'ready') return
    loading.value = true
    try {
      const programs = await load()
      program.value = programs.find((item) => item.id === programId.value) ?? null
      if (program.value) {
        progress.value = await getProgress(programId.value)
        const weekRows = await db.query<ProgramWeekRow>(
          'SELECT * FROM program_weeks WHERE program_id = ? AND week_num = ?',
          [programId.value, program.value.current_week],
        )
        weekId.value = weekRows[0]?.id ?? null
        weekDays.value = await db.query<ProgramDayRow>(
          `SELECT pd.* FROM program_days pd JOIN program_weeks pw ON pw.id=pd.week_id
           WHERE pw.program_id=? AND pw.week_num=? ORDER BY pd.day_num`,
          [programId.value, program.value.current_week],
        )
        await templatesApi.load()
        templates.value = [...templatesApi.templates.value]
      }
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function refresh() {
  const rows = await load()
  program.value = rows.find((item) => item.id === programId.value) ?? null
  progress.value = await getProgress(programId.value)
}

async function handleSetActive() {
  if (!program.value) return
  await setActive(programId.value)
  await refresh()
}

async function handleAdvanceWeek() {
  await advanceWeek(programId.value)
  await refresh()
  if (program.value) {
    const rows = await db.query<ProgramWeekRow>(
      'SELECT * FROM program_weeks WHERE program_id = ? AND week_num = ?',
      [programId.value, program.value.current_week],
    )
    weekId.value = rows[0]?.id ?? null
    weekDays.value = await db.query<ProgramDayRow>(
      `SELECT pd.* FROM program_days pd JOIN program_weeks pw ON pw.id=pd.week_id
       WHERE pw.program_id=? AND pw.week_num=? ORDER BY pd.day_num`,
      [programId.value, program.value.current_week],
    )
  }
}

async function handleAssignDay() {
  if (!weekId.value) return
  await addDay(weekId.value, selectedDay.value, selectedTemplate.value || null)
  weekDays.value = await db.query<ProgramDayRow>(
    `SELECT pd.* FROM program_days pd JOIN program_weeks pw ON pw.id=pd.week_id
     WHERE pw.program_id=? AND pw.week_num=? ORDER BY pd.day_num`,
    [programId.value, program.value?.current_week],
  )
}

async function startAssigned(day: ProgramDayRow) {
  if (!day.template_id || !progress.value) return
  await workout.startWorkout(day.template_id, {
    sessionType: 'gym',
    intensityModifier: progress.value.intensityModifier,
    volumeModifier: progress.value.volumeModifier,
  })
  await navigateTo('/workout')
}
</script>

<template>
  <article class="p-4 space-y-5">
    <header class="flex items-center gap-3 pt-2">
      <NuxtLink to="/templates/programs" class="text-(--ui-text-muted)" aria-label="Back">
        <UIcon name="i-ph-arrow-left" class="w-6 h-6" aria-hidden="true" />
      </NuxtLink>
      <h1 class="text-xl font-bold flex-1 truncate">{{ program?.name ?? 'Program' }}</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading…</p>
    </div>

    <template v-else-if="program">
      <!-- Status -->
      <div class="rounded-xl bg-(--color-surface) p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold">
              Week {{ program.current_week }} of {{ program.weeks }}
            </p>
            <p class="text-xs text-(--ui-text-muted)">
              {{ Math.round(((program.current_week - 1) / program.weeks) * 100) }}% complete
            </p>
          </div>
          <span
            v-if="program.active"
            class="text-xs font-bold px-2 py-1 rounded-full bg-(--color-accent)/15 text-(--color-accent)"
          >
            Active
          </span>
        </div>
        <div class="h-2 bg-(--color-surface-2) rounded-full overflow-hidden">
          <div
            class="h-full bg-(--color-accent) rounded-full transition-all"
            :style="{ width: `${Math.min(100, ((program.current_week - 1) / program.weeks) * 100)}%` }"
          />
        </div>
      </div>

      <section class="rounded-xl bg-(--color-surface) p-4 space-y-3" aria-label="Current week plan">
        <div>
          <h2 class="font-semibold">Week {{ program.current_week }} plan</h2>
          <p class="text-xs text-(--ui-text-muted)">
            {{ progress?.isDeload ? 'Deload week' : 'Training week' }} ·
            intensity ×{{ progress?.intensityModifier }} · volume ×{{ progress?.volumeModifier }}
          </p>
        </div>
        <ul v-if="weekDays.length" class="space-y-2">
          <li v-for="day in weekDays" :key="day.id" class="flex items-center justify-between gap-2">
            <span class="text-sm">{{ day.label ?? `Day ${day.day_num}` }} ({{ day.day_num }})</span>
            <UButton v-if="day.template_id" size="xs" @click="startAssigned(day)">Start assigned workout</UButton>
            <span v-else class="text-xs text-(--ui-text-muted)">No template assigned</span>
          </li>
        </ul>
        <p v-else class="text-sm text-(--ui-text-muted)">No workouts assigned this week yet.</p>
        <div v-if="weekId" class="grid grid-cols-2 gap-2">
          <label class="text-xs">Weekday
            <select v-model.number="selectedDay" class="block w-full rounded border p-2 bg-(--color-surface)">
              <option v-for="day in 7" :key="day" :value="day">{{ ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1] }}</option>
            </select>
          </label>
          <label class="text-xs">Template
            <select v-model="selectedTemplate" class="block w-full rounded border p-2 bg-(--color-surface)">
              <option value="">Select template</option>
              <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
            </select>
          </label>
          <UButton class="col-span-2" :disabled="!selectedTemplate" @click="handleAssignDay">Assign template to weekday</UButton>
        </div>
      </section>

      <div class="space-y-2">
        <UButton v-if="!program.active && !progress?.complete" class="w-full" color="primary" @click="handleSetActive">
          Set as Active Program
        </UButton>
        <p v-if="progress?.complete" class="text-sm text-green-500" role="status">Program complete</p>
        <UButton v-else class="w-full" variant="outline" @click="handleAdvanceWeek">
          {{ program.current_week >= program.weeks ? 'Complete program' : `Advance to Week ${program.current_week + 1}` }}
        </UButton>
      </div>
    </template>
  </article>
</template>
