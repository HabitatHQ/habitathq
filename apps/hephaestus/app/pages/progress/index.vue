<script setup lang="ts">
import { type ExerciseSessionStat, localDateKey } from '~/lib/analytics'
import { formatWeight } from '~/lib/format'
import type { ReadinessResult } from '~/lib/readiness'
import type { ExerciseRow, PersonalRecordRow } from '~/types/database'
import type { OrganizationReport } from '~/types/organization'

type ProgressPersonalRecordRow = PersonalRecordRow & {
  exercise_name: string | null
}

const { settings } = useAppSettings()
const db = useDatabase()
const progress = useProgress()
const organization = useOrganization()
function dateOffset(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return localDateKey(date)
}
const reportStart = ref(dateOffset(-27))
const reportEnd = ref(localDateKey())

const prs = ref<ProgressPersonalRecordRow[]>([])
const loading = ref(true)

const readiness = ref<ReadinessResult | null>(null)
const organizationReport = ref<OrganizationReport | null>(null)
const exerciseChoices = ref<Pick<ExerciseRow, 'id' | 'name'>[]>([])
const selectedExerciseId = ref('')
const exerciseHistory = ref<ExerciseSessionStat[]>([])
const effortByDate = ref<Record<string, number | null>>({})

watch(
  db.status,
  async (s) => {
    if (s === 'ready') await load()
  },
  { immediate: true },
)

async function load() {
  loading.value = true
  try {
    // Load recent PRs with exercise names
    prs.value = await db.query<ProgressPersonalRecordRow>(
      `SELECT pr.*, e.name AS exercise_name
       FROM personal_records pr
       LEFT JOIN exercises e ON e.id = pr.exercise_id
       ORDER BY pr.date DESC, pr.id DESC LIMIT 20`,
    )
    exerciseChoices.value = await db.query<Pick<ExerciseRow, 'id' | 'name'>>(
      'SELECT id,name FROM exercises ORDER BY name,id',
    )
    if (!selectedExerciseId.value) selectedExerciseId.value = exerciseChoices.value[0]?.id ?? ''
    readiness.value = await progress.readinessData()
    await loadOrganizationReport()
    await loadExerciseHistory()
  } finally {
    loading.value = false
  }
}

async function loadOrganizationReport() {
  if (!reportStart.value || !reportEnd.value || reportStart.value > reportEnd.value) return
  organizationReport.value = await organization.report(reportStart.value, reportEnd.value)
}
async function loadExerciseHistory() {
  if (!selectedExerciseId.value) {
    exerciseHistory.value = []
    effortByDate.value = {}
    return
  }
  exerciseHistory.value = await progress.exerciseHistory(selectedExerciseId.value)
  const effort = await db.query<{ date: string; rpe: number | null }>(
    `SELECT w.date,AVG(s.rpe) AS rpe
     FROM sets s
     JOIN workout_exercises we ON we.id=s.workout_exercise_id
     JOIN workouts w ON w.id=we.workout_id
       WHERE we.exercise_id = ? AND we.logging_mode='strength' AND w.ended_at IS NOT NULL AND s.completed=1 AND s.is_warmup=0 AND we.removed_at IS NULL AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id)
     GROUP BY w.id,w.date ORDER BY w.date DESC`,
    [selectedExerciseId.value],
  )
  effortByDate.value = Object.fromEntries(effort.map((item) => [item.date, item.rpe]))
}
function formatPrValue(pr: ProgressPersonalRecordRow): string {
  return pr.record_type === 'reps'
    ? `${pr.value} reps`
    : formatWeight(pr.value, settings.value.weightUnit)
}
const recentPRs = computed(() => prs.value.slice(0, 5))
</script>

<template>
  <article class="p-4 space-y-6">
    <header class="pt-2">
      <h1 class="text-2xl font-bold">Progress</h1>
    </header>

    <div v-if="loading" class="text-center py-12 text-(--ui-text-muted)">
      <p>Loading analytics…</p>
    </div>

    <template v-else>
      <section aria-labelledby="exercise-history-heading" class="space-y-3">
        <h2 id="exercise-history-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">Comparable exercise / variant history</h2>
        <label for="exercise-history-select" class="sr-only">Choose exercise variant</label>
        <select id="exercise-history-select" v-model="selectedExerciseId" class="w-full rounded-lg bg-(--color-surface) p-3" @change="loadExerciseHistory">
          <option v-for="exercise in exerciseChoices" :key="exercise.id" :value="exercise.id">{{ exercise.name }}</option>
        </select>
        <p class="text-xs text-(--ui-text-muted)">Completed strength sessions only. Loads use kg at rest and the selected display unit here. e1RM is a supporting estimate, not a measured max. Effort is the average recorded RPE; missing effort remains “Not recorded.”</p>
        <ul v-if="exerciseHistory.length" class="space-y-2">
          <li v-for="entry in exerciseHistory" :key="entry.date" class="rounded-xl bg-(--color-surface) p-3">
            <p class="font-medium">{{ entry.date }}</p>
            <p class="text-sm text-(--ui-text-muted)">Max completed load {{ entry.maxWeight === null ? '—' : formatWeight(entry.maxWeight, settings.weightUnit) }} · total reps {{ entry.totalReps }}</p>
            <p class="text-xs text-(--ui-text-muted)">Supporting e1RM estimate {{ entry.e1rm === null ? '—' : formatWeight(entry.e1rm, settings.weightUnit) }} · average recorded RPE {{ effortByDate[entry.date] == null ? 'Not recorded' : effortByDate[entry.date]!.toFixed(1) }}</p>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-(--color-surface) p-4 text-sm text-(--ui-text-muted)">No completed strength history for this exercise variant.</p>
      </section>

      <!-- Personal Records -->
      <section aria-labelledby="prs-heading">
        <h2 id="prs-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-3">
          Recent Personal Records
        </h2>

        <ul v-if="recentPRs.length > 0" role="list" class="space-y-2">
          <li
            v-for="pr in recentPRs"
            :key="pr.id"
            class="rounded-xl bg-(--color-surface) px-4 py-3 flex items-center gap-3"
          >
            <UIcon name="i-heroicons-trophy" class="w-5 h-5 text-yellow-400 shrink-0" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium capitalize">
                {{ pr.exercise_name ?? 'Unknown exercise' }} · {{ pr.record_type }} PR
              </p>
              <p class="text-xs text-(--ui-text-muted)">
                {{ new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
              </p>
            </div>
            <span class="text-sm font-bold tabular-nums text-(--color-accent)">
              {{ formatPrValue(pr) }}
            </span>
          </li>
        </ul>

        <div v-else class="rounded-xl bg-(--color-surface) p-6 text-center text-(--ui-text-muted)">
          <p>Complete workouts to track PRs.</p>
        </div>
      </section>

      <!-- Readiness -->
      <section v-if="readiness" aria-labelledby="readiness-heading">
        <h2 id="readiness-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted) mb-3">
          Today's Readiness
        </h2>
        <ProgressReadinessCard :readiness="readiness" />
      </section>

      <section v-if="organizationReport" aria-labelledby="organization-report-heading" class="space-y-3">
        <h2 id="organization-report-heading" class="text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">Training organization &amp; volume · {{ reportStart }}–{{ reportEnd }}</h2>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-xs text-(--ui-text-muted)">From<input v-model="reportStart" type="date" class="block w-full rounded-lg bg-(--color-surface) p-3 text-sm text-(--ui-text)" /></label>
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Through<input v-model="reportEnd" type="date" class="block w-full rounded-lg bg-(--color-surface) p-3 text-sm text-(--ui-text)" /></label>
        </div>
        <UButton class="w-full" variant="outline" :disabled="reportStart > reportEnd" @click="loadOrganizationReport">Update report period</UButton>
        <div class="rounded-xl bg-(--color-surface) p-4 space-y-3">
          <p class="text-xs text-(--ui-text-muted)">Commitments: open {{ organizationReport.commitments.open }}, fulfilled {{ organizationReport.commitments.fulfilled }}, skipped {{ organizationReport.commitments.skipped }}, postponed {{ organizationReport.commitments.postponed }}, overdue {{ organizationReport.commitments.overdue }}. No composite score.</p>
          <ul v-if="organizationReport.commitmentTiming.length" class="space-y-1 text-xs text-(--ui-text-muted)">
            <li v-for="item in organizationReport.commitmentTiming" :key="item.id">{{ item.status }} · original {{ item.originalDate }} · planned {{ item.plannedDate }}{{ item.performedDate ? ` · performed ${item.performedDate}` : '' }}{{ item.postponed ? ' · postponed' : '' }}{{ item.overdue ? ' · overdue' : '' }}</li>
          </ul>
          <div v-for="goal in organizationReport.weeklyGoals" :key="`${goal.id}-${goal.weekStart}`" class="flex justify-between gap-2 text-sm">
            <span>{{ goal.name }} · week of {{ goal.weekStart }}</span><span class="tabular-nums">{{ goal.count }} / {{ goal.target }}</span>
          </div>
        </div>
        <div class="rounded-xl bg-(--color-surface) p-4 space-y-2">
          <p class="font-medium">Strength working sets: {{ organizationReport.workingSets }}</p>
          <p class="text-xs text-(--ui-text-muted)">Each eligible actual working set counts once overall. Warm-ups, pending/skipped rows, and unfinished workouts are excluded.</p>
          <div><h3 class="text-sm font-medium">Comparable per-exercise external-load tonnage</h3><ul class="text-sm text-(--ui-text-muted)"><li v-for="item in organizationReport.exerciseTonnage" :key="`${item.exerciseId}-${item.equipment}`">{{ item.exerciseName }} · {{ item.equipment }}: {{ item.tonnageKgReps }} kg × reps across {{ item.sets }} sets</li></ul></div>
          <div><h3 class="text-sm font-medium">Primary movement pattern · counts sum to working sets</h3><ul class="text-sm text-(--ui-text-muted)"><li v-for="item in organizationReport.movementPatterns" :key="item.pattern">{{ item.pattern }}: {{ item.sets }}</li></ul></div>
          <div><h3 class="text-sm font-medium">Primary muscle credits · may overlap</h3><ul class="text-sm text-(--ui-text-muted)"><li v-for="item in organizationReport.primaryMuscles" :key="item.muscle">{{ item.muscle }}: {{ item.sets }}</li></ul><p class="text-xs text-(--ui-text-muted)">Secondary involvement is separate and is not a fractional share.</p><ul class="text-sm text-(--ui-text-muted)"><li v-for="item in organizationReport.secondaryMuscles" :key="item.muscle">{{ item.muscle }} secondary: {{ item.sets }}</li></ul><p class="text-xs text-(--ui-text-muted)">Unknown primary muscle classification: {{ organizationReport.unclassifiedSets }} sets.</p></div>
          <div v-if="organizationReport.activities.length"><h3 class="text-sm font-medium">Non-strength measures · separate units</h3><p v-for="item in organizationReport.activities" :key="item.mode" class="text-sm text-(--ui-text-muted)">{{ item.mode }} · {{ item.items }} completed work items · {{ item.distanceM }} m · {{ item.durationSec }} sec</p></div>
        </div>
      </section>
    </template>
  </article>
</template>
