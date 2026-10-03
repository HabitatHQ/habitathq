<script setup lang="ts">
import { localDateKey } from '~/lib/analytics'
import type {
  Appointment,
  AppointmentReview,
  OrganizationGoal,
  OrganizationPlan,
  OrganizationRecurrenceRule,
  OrganizationRotation,
  OrganizationTodayItem,
  RecurrenceReview,
} from '~/types/organization'
import type { ProgramAdoptionPreview, SavedRoutine } from '~/types/prescription'

const organization = useOrganization()
const routines = useRoutines()
const db = useDatabase()
const plans = ref<OrganizationPlan[]>([])
const appointments = ref<Appointment[]>([])
const savedRoutines = ref<SavedRoutine[]>([])
const selectedPlan = ref('')
const routineName = (id: string | null) =>
  savedRoutines.value.find((routine) => routine.id === id)?.name ?? 'No routine'
const planName = ref('')
const planStartDate = ref(localDateKey())
const routineId = ref('')
const appointmentDate = ref(localDateKey())
const appointmentTime = ref('')
const recurrenceRules = ref<OrganizationRecurrenceRule[]>([])
const recurrenceId = ref('')
const recurrenceWeekdays = ref<number[]>([])
const recurrenceStart = ref(localDateKey())
const recurrenceEnd = ref('')
const recurrenceTime = ref('')
const recurrencePreview = ref<RecurrenceReview | null>(null)
const weekdayChoices = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]
const rotationName = ref('')
const rotationRoutineIds = ref<string[]>([])
const goalName = ref('')
const goalTarget = ref(3)
const goalSessionType = ref('')
const exerciseChoices = ref<{ id: string; name: string }[]>([])
const movementChoices = ref<string[]>([])
const goalExerciseIds = ref<string[]>([])
const goalMovementPatterns = ref<string[]>([])
const goalId = ref('')
const savedGoals = ref<OrganizationGoal[]>([])
const savedRotations = ref<OrganizationRotation[]>([])
const rotationId = ref('')
const selectedPlanName = ref('')
const selectedPlanActive = ref(true)
type ProgramChoice = { id: string; name: string; revisionId: string | null }
type PlanProgram = {
  id: string
  programId: string | null
  programName: string | null
  adoptedRevisionId: string | null
  startDate: string
}
const programChoices = ref<ProgramChoice[]>([])
const planPrograms = ref<PlanProgram[]>([])
const selectedProgramId = ref('')
const adoptionPreview = ref<ProgramAdoptionPreview | null>(null)
const adoptionBindings = ref<Record<string, string | null>>({})
const adoptionNeedsReview = ref(false)
const programWeek = ref<{ week: number; weekStart: string; weekEnd: string } | null>(null)
const programDate = ref(localDateKey())
const scheduleDates = ref<Record<string, string>>({})
const scheduleTimes = ref<Record<string, string>>({})
const schedulePreview = ref<AppointmentReview | null>(null)
const futureScheduleChanges = computed(() =>
  appointments.value
    .filter(
      (item) =>
        item.status === 'open' &&
        !item.workoutId &&
        item.plannedDate > localDateKey() &&
        (scheduleDates.value[item.id] !== item.plannedDate ||
          (scheduleTimes.value[item.id] ?? '') !== (item.plannedTime ?? '')),
    )
    .map((item) => ({
      appointmentId: item.id,
      date: scheduleDates.value[item.id] ?? item.plannedDate,
      time: scheduleTimes.value[item.id] || null,
    })),
)
const selectedPlanProgram = computed(
  () => planPrograms.value.find((plan) => plan.id === selectedPlan.value) ?? null,
)
const selectedProgram = computed(
  () => programChoices.value.find((program) => program.id === selectedProgramId.value) ?? null,
)
const rotationItems = ref<OrganizationTodayItem[]>([])

const sessionTypes = ['gym', 'run', 'conditioning', 'mobility', 'other']
const error = ref('')
const busy = ref(false)
const savingOrganization = ref(false)

async function load() {
  if (db.status.value !== 'ready') return
  busy.value = true
  error.value = ''
  try {
    await organization.reconcileOpen(localDateKey())
    plans.value = await organization.plans()
    if (!selectedPlan.value) selectedPlan.value = plans.value.find((plan) => plan.active)?.id ?? ''
    savedRoutines.value = await routines.load()
    exerciseChoices.value = await db.query<{ id: string; name: string }>(
      'SELECT id,name FROM exercises ORDER BY name,id',
    )
    movementChoices.value = await db
      .query<{ movement: string }>(
        'SELECT DISTINCT movement FROM exercises WHERE movement IS NOT NULL ORDER BY movement',
      )
      .then((rows) => rows.map((row) => row.movement))
    programChoices.value = await db.query<ProgramChoice>(
      'SELECT p.id,p.name,(SELECT id FROM program_revisions r WHERE r.program_id=p.id ORDER BY r.revision_num DESC LIMIT 1) AS revisionId FROM programs p ORDER BY p.name,p.id',
    )
    planPrograms.value = await db.query<PlanProgram>(
      'SELECT t.id,t.program_id AS programId,p.name AS programName,t.adopted_program_revision_id AS adoptedRevisionId,t.start_local_date AS startDate FROM training_plans t LEFT JOIN programs p ON p.id=t.program_id ORDER BY t.created_at,t.id',
    )
    const todayItems = await organization.today(localDateKey())
    rotationItems.value = todayItems.filter(
      (item) => item.kind === 'rotation' && item.planId === selectedPlan.value,
    )
    appointments.value = await organization.appointments(selectedPlan.value || undefined)
    scheduleDates.value = Object.fromEntries(
      appointments.value.map((item) => [item.id, item.plannedDate]),
    )
    scheduleTimes.value = Object.fromEntries(
      appointments.value.map((item) => [item.id, item.plannedTime ?? '']),
    )
    recurrenceRules.value = await organization.recurrences(selectedPlan.value || undefined)
    recurrencePreview.value = null
    savedGoals.value = await organization.goals(selectedPlan.value || undefined)
    savedRotations.value = await organization.rotations(selectedPlan.value || undefined)
    const activePlan = plans.value.find((plan) => plan.id === selectedPlan.value)
    selectedPlanName.value = activePlan?.name ?? ''
    selectedPlanActive.value = activePlan?.active ?? true
    schedulePreview.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load training plans.'
  } finally {
    busy.value = false
  }
}
watch(
  db.status,
  async (status) => {
    if (status === 'ready') await load()
  },
  { immediate: true },
)
watch(selectedPlan, async (planId) => {
  adoptionPreview.value = null
  adoptionBindings.value = {}
  adoptionNeedsReview.value = false
  programWeek.value = null
  appointments.value = planId ? await organization.appointments(planId) : []
  scheduleDates.value = Object.fromEntries(
    appointments.value.map((item) => [item.id, item.plannedDate]),
  )
  scheduleTimes.value = Object.fromEntries(
    appointments.value.map((item) => [item.id, item.plannedTime ?? '']),
  )
  recurrenceRules.value = planId ? await organization.recurrences(planId) : []
  savedGoals.value = planId ? await organization.goals(planId) : []
  savedRotations.value = planId ? await organization.rotations(planId) : []
  const plan = plans.value.find((item) => item.id === planId)
  selectedPlanName.value = plan?.name ?? ''
  selectedPlanActive.value = plan?.active ?? true
  recurrencePreview.value = null
  schedulePreview.value = null
})
async function createPlan() {
  if (!planName.value.trim()) return
  try {
    if (selectedProgramId.value) {
      await db.domain('TRAINING_PLAN_SAVE', {
        id: crypto.randomUUID(),
        name: planName.value.trim(),
        programId: selectedProgramId.value,
        adoptedProgramRevisionId: null,
        startLocalDate: planStartDate.value,
        active: true,
        bindings: [],
      })
    } else {
      await organization.savePlan(planName.value.trim(), true, planStartDate.value)
    }
    planName.value = ''
    selectedProgramId.value = ''
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save plan.'
  }
}
async function previewProgramAdoption() {
  const plan = selectedPlanProgram.value
  const revisionId = plan?.programId
    ? programChoices.value.find((item) => item.id === plan.programId)?.revisionId
    : null
  if (!plan?.programId || !revisionId) {
    error.value = 'Choose a plan with a Program and an available Program revision.'
    return
  }
  try {
    const preview = await db.domain('TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION', {
      planId: plan.id,
      programRevisionId: revisionId,
      routineBindings: { ...adoptionBindings.value },
    })
    adoptionPreview.value = preview
    adoptionBindings.value = Object.fromEntries(
      preview.bindings.map((binding) => [binding.programSlotId, binding.routineId]),
    )
    adoptionNeedsReview.value = false
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not review Program adoption.'
    adoptionPreview.value = null
  }
}
async function applyProgramAdoption() {
  const preview = adoptionPreview.value
  if (!preview?.compatible) return
  try {
    await db.domain('TRAINING_PLAN_APPLY_PROGRAM_ADOPTION', { previewId: preview.previewId })
    adoptionPreview.value = null
    adoptionBindings.value = {}
    adoptionNeedsReview.value = false
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not apply Program adoption.'
  }
}
async function loadProgramWeek() {
  if (!selectedPlanProgram.value?.adoptedRevisionId) return
  try {
    programWeek.value = await organization.programWeek(selectedPlan.value, programDate.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not calculate the Program week.'
  }
}
function editRecurrence(rule: OrganizationRecurrenceRule) {
  recurrenceId.value = rule.id
  routineId.value = rule.routineId
  recurrenceWeekdays.value = [...rule.weekdays]
  recurrenceStart.value = rule.startDate
  recurrenceEnd.value = rule.endDate ?? ''
  recurrenceTime.value = rule.plannedTime ?? ''
  recurrencePreview.value = null
}
async function reviewRecurrence(active = true) {
  if (!selectedPlan.value || !routineId.value || !recurrenceWeekdays.value.length) return
  try {
    recurrencePreview.value = await organization.previewRecurrence({
      ...(recurrenceId.value ? { id: recurrenceId.value } : {}),
      planId: selectedPlan.value,
      routineId: routineId.value,
      weekdays: [...recurrenceWeekdays.value],
      startDate: recurrenceStart.value,
      endDate: recurrenceEnd.value || null,
      time: recurrenceTime.value || null,
      active,
      today: localDateKey(),
    })
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not review recurring schedule.'
  }
}
async function applyRecurrenceReview() {
  const review = recurrencePreview.value
  if (!review) return
  try {
    await organization.applyRecurrence(review.previewId, review.fingerprint)
    recurrencePreview.value = null
    recurrenceId.value = ''
    recurrenceWeekdays.value = []
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not apply recurring schedule.'
  }
}
async function createAppointment() {
  if (!selectedPlan.value || !routineId.value) return
  try {
    await organization.createAppointment(
      selectedPlan.value,
      routineId.value,
      appointmentDate.value,
      appointmentTime.value || null,
    )
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save appointment.'
  }
}
async function postpone(item: Appointment) {
  const proposed = window.prompt(
    'Move this appointment to local date (YYYY-MM-DD):',
    item.plannedDate,
  )
  if (!proposed) return
  try {
    await organization.postpone(item.id, proposed, false)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not postpone appointment.'
    if (
      message.startsWith('Same-routine appointment collision:') &&
      window.confirm(`${message}. Move this appointment anyway?`)
    ) {
      try {
        await organization.postpone(item.id, proposed, true)
      } catch (retryCause) {
        error.value = retryCause instanceof Error ? retryCause.message : message
        return
      }
    } else {
      error.value = message
      return
    }
  }
  await load()
}
async function previewFutureSchedule() {
  if (!selectedPlan.value || !futureScheduleChanges.value.length) return
  try {
    schedulePreview.value = await organization.previewSchedule(
      selectedPlan.value,
      futureScheduleChanges.value,
    )
    error.value = ''
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Could not review future schedule changes.'
    schedulePreview.value = null
  }
}
async function applyFutureSchedule() {
  const review = schedulePreview.value
  if (!review) return
  try {
    await organization.applySchedule(review.previewId, review.fingerprint)
    schedulePreview.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not apply the reviewed schedule.'
  }
}
async function skipRotation(item: OrganizationTodayItem) {
  if (!item.rotationId || item.generation === null) return
  try {
    await organization.skipRotation(item.rotationId, item.generation)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not skip this rotation item.'
  }
}
function moveRotation(routineId: string, offset: -1 | 1) {
  const next = [...rotationRoutineIds.value]
  const index = next.indexOf(routineId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= next.length) return
  const current = next[index]
  const replacement = next[target]
  if (current === undefined || replacement === undefined) return
  next[index] = replacement
  next[target] = current
  rotationRoutineIds.value = next
}
function removeRotationRoutine(routineId: string) {
  rotationRoutineIds.value = rotationRoutineIds.value.filter((id) => id !== routineId)
}
async function skip(item: Appointment) {
  try {
    await organization.skipAppointment(item.id)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not skip appointment.'
  }
}
function editRotation(rotation: OrganizationRotation) {
  rotationId.value = rotation.id
  rotationName.value = rotation.name
  rotationRoutineIds.value = [...rotation.routineIds]
}
function editGoal(goal: OrganizationGoal) {
  goalId.value = goal.id
  goalName.value = goal.name
  goalTarget.value = goal.targetCount
  goalSessionType.value = goal.filter.sessionTypes[0] ?? ''
  goalExerciseIds.value = [...goal.filter.exerciseIds]
  goalMovementPatterns.value = [...goal.filter.movementPatterns]
}
function setAdoptionBinding(slotId: string, event: Event) {
  const target = event.currentTarget
  if (!(target instanceof HTMLSelectElement)) return
  adoptionBindings.value[slotId] = target.value || null
  adoptionNeedsReview.value = true
}
async function saveSelectedPlan() {
  if (!selectedPlan.value || !selectedPlanName.value.trim()) return
  savingOrganization.value = true
  try {
    const currentPlan = plans.value.find((plan) => plan.id === selectedPlan.value)
    if (!currentPlan) throw new Error('The selected plan is no longer available. Reload plans.')
    await organization.savePlan(
      selectedPlanName.value.trim(),
      selectedPlanActive.value,
      currentPlan.startDate,
      currentPlan.id,
    )
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update plan.'
  } finally {
    savingOrganization.value = false
  }
}
async function saveRotation() {
  if (!selectedPlan.value || !rotationName.value.trim() || rotationRoutineIds.value.length === 0)
    return
  savingOrganization.value = true
  try {
    await organization.saveRotation(
      selectedPlan.value,
      rotationName.value.trim(),
      [...rotationRoutineIds.value],
      rotationId.value || undefined,
    )
    rotationId.value = ''
    rotationName.value = ''
    rotationRoutineIds.value = []
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save rotation.'
  } finally {
    savingOrganization.value = false
  }
}
async function saveGoal() {
  if (!selectedPlan.value || !goalName.value.trim()) return
  savingOrganization.value = true
  try {
    await organization.saveGoal(
      selectedPlan.value,
      goalName.value.trim(),
      goalTarget.value,
      {
        sessionTypes: goalSessionType.value ? [goalSessionType.value] : [],
        exerciseIds: [...goalExerciseIds.value],
        movementPatterns: [...goalMovementPatterns.value],
      },
      true,
      goalId.value || undefined,
    )
    goalId.value = ''
    goalName.value = ''
    goalExerciseIds.value = []
    goalMovementPatterns.value = []
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save weekly goal.'
  } finally {
    savingOrganization.value = false
  }
}
</script>

<template>
  <article class="p-4 pb-24 space-y-5">
    <header class="flex items-center justify-between pt-2">
      <h1 class="text-2xl font-bold">Training plans</h1>
      <UButton size="sm" variant="outline" to="/templates/programs">Programs</UButton>
    </header>
    <p class="text-sm text-(--ui-text-muted)">Plans can share saved routines while keeping independent appointments. Rotations and weekly goals are separate from the calendar.</p>
    <p v-if="error" role="alert" class="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{{ error }}</p>
    <section class="rounded-xl bg-(--color-surface) p-4 space-y-3" aria-labelledby="plan-heading">
      <h2 id="plan-heading" class="font-semibold">Your plans</h2>
      <label class="sr-only" for="plan-select">Select personal plan</label>
      <select id="plan-select" v-model="selectedPlan" class="w-full rounded-lg bg-(--color-surface-2) p-3">
        <option value="">Select a plan</option>
        <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}{{ plan.active ? ' · active' : '' }}</option>
      </select>
      <form class="space-y-2" @submit.prevent="createPlan">
        <label class="sr-only" for="plan-name">New plan name</label>
        <input id="plan-name" v-model="planName" class="w-full rounded-lg bg-(--color-surface-2) p-3" placeholder="New personal plan" required />
        <label class="block text-sm" for="plan-start-date">Plan start date</label>
        <input id="plan-start-date" v-model="planStartDate" type="date" required class="w-full rounded-lg bg-(--color-surface-2) p-3" />
        <label class="sr-only" for="program-select">Optional reusable Program</label>
        <select id="program-select" v-model="selectedProgramId" class="w-full rounded-lg bg-(--color-surface-2) p-3">
          <option value="">Personal plan without a Program</option>
          <option v-for="program in programChoices" :key="program.id" :value="program.id" :disabled="!program.revisionId">{{ program.name }}{{ program.revisionId ? '' : ' · no revision' }}</option>
        </select>
        <UButton type="submit" class="w-full" :disabled="!planName.trim() || Boolean(selectedProgramId && !selectedProgram?.revisionId)">Create personal plan</UButton>
      </form>
      <form v-if="selectedPlan" class="space-y-2 border-t border-(--ui-border) pt-3" @submit.prevent="saveSelectedPlan">
        <label class="sr-only" for="edit-plan-name">Plan name</label>
        <input id="edit-plan-name" v-model="selectedPlanName" class="w-full rounded-lg bg-(--color-surface-2) p-3" required />
        <label class="flex items-center gap-2 text-sm"><input v-model="selectedPlanActive" type="checkbox" /> Active in schedule suggestions</label>
        <UButton type="submit" class="w-full" :loading="savingOrganization">Save plan</UButton>
      </form>
    </section>
    <section v-if="selectedPlan" class="rounded-xl bg-(--color-surface) p-4 space-y-3" aria-labelledby="appointment-heading">
      <h2 id="appointment-heading" class="font-semibold">Calendar appointments</h2>
      <form class="space-y-2" @submit.prevent="createAppointment">
        <label class="sr-only" for="routine-select">Saved routine</label>
        <select id="routine-select" v-model="routineId" class="w-full rounded-lg bg-(--color-surface-2) p-3" required>
          <option value="">Choose a saved routine</option>
          <option v-for="routine in savedRoutines" :key="routine.id" :value="routine.id">{{ routine.name }}</option>
        </select>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Local date<input v-model="appointmentDate" type="date" class="block w-full rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text)" required /></label>
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Optional time<input v-model="appointmentTime" type="time" class="block w-full rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text)" /></label>
        </div>
        <UButton type="submit" class="w-full" :disabled="!routineId">Add appointment</UButton>
      </form>
      <ul v-if="appointments.length" class="space-y-2">
        <li v-for="item in appointments" :key="item.id" class="rounded-lg bg-(--color-surface-2) p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="font-medium">{{ savedRoutines.find((r) => r.id === item.routineId)?.name ?? 'Saved routine' }}</p><p class="text-xs text-(--ui-text-muted)">Originally {{ item.originalDate }} · planned {{ item.plannedDate }}{{ item.plannedTime ? ` at ${item.plannedTime}` : '' }}</p><p class="text-xs capitalize text-(--ui-text-muted)">{{ item.status }}{{ item.postponed ? ' · postponed' : '' }}{{ item.workoutId ? ' · linked workout' : '' }}</p></div>
            <label v-if="item.status === 'open' && !item.workoutId && item.plannedDate > localDateKey()" class="mt-2 block text-xs text-(--ui-text-muted)">Proposed future date<input v-model="scheduleDates[item.id]" type="date" class="mt-1 w-full rounded-lg bg-(--color-surface) p-2 text-sm text-(--ui-text)" @change="schedulePreview = null" /></label>
            <label v-if="item.status === 'open' && !item.workoutId && item.plannedDate > localDateKey()" class="mt-2 block text-xs text-(--ui-text-muted)">Proposed local time<input v-model="scheduleTimes[item.id]" type="time" class="mt-1 w-full rounded-lg bg-(--color-surface) p-2 text-sm text-(--ui-text)" @change="schedulePreview = null" /></label>
            <div v-if="item.status === 'open' && !item.workoutId" class="flex shrink-0 gap-1"><UButton size="xs" variant="soft" @click="postpone(item)">Postpone</UButton><UButton size="xs" variant="ghost" @click="skip(item)">Skip</UButton></div>
          </div>
        </li>
      </ul>
      <div v-if="futureScheduleChanges.length" class="space-y-2 rounded-lg bg-(--color-surface-2) p-3">
        <UButton class="w-full" variant="outline" @click="previewFutureSchedule">Review future schedule changes</UButton>
        <div v-if="schedulePreview" class="space-y-2">
          <p class="text-sm">Reviewed {{ schedulePreview.changed.length }} future appointment changes.</p>
          <p v-for="item in schedulePreview.changed" :key="item.id" class="text-xs text-(--ui-text-muted)">{{ item.originalDate }} → {{ item.plannedDate }}</p>
          <UButton class="w-full" :disabled="schedulePreview.changed.length === 0" @click="applyFutureSchedule">Apply reviewed dates</UButton>
        </div>
      </div>
      <p v-if="appointments.length === 0" class="rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text-muted)">No appointments in this plan yet.</p>
    </section>
    <section v-if="selectedPlan" class="rounded-xl bg-(--color-surface) p-4 space-y-3" aria-labelledby="recurrence-heading">
      <h2 id="recurrence-heading" class="font-semibold">Recurring schedule</h2>
      <p class="text-xs text-(--ui-text-muted)">Each occurrence has its own appointment identity. Reconciliation materializes today through the next 27 local dates and never recreates past obligations.</p>
      <ul v-if="recurrenceRules.length" class="space-y-2">
        <li v-for="rule in recurrenceRules" :key="rule.id" class="flex items-center justify-between gap-2 rounded-lg bg-(--color-surface-2) p-3">
          <p class="text-sm">{{ savedRoutines.find((routine) => routine.id === rule.routineId)?.name ?? 'Saved routine' }} · {{ rule.weekdays.map((day) => weekdayChoices[day - 1]?.label).join(', ') }} · from {{ rule.startDate }}{{ rule.endDate ? ` through ${rule.endDate}` : '' }}{{ rule.active ? '' : ' · paused' }}</p>
          <UButton size="xs" variant="outline" @click="editRecurrence(rule)">Edit</UButton>
        </li>
      </ul>
      <form class="space-y-3" @submit.prevent="reviewRecurrence()">
        <label class="sr-only" for="recurrence-routine">Recurring saved routine</label>
        <select id="recurrence-routine" v-model="routineId" class="w-full rounded-lg bg-(--color-surface-2) p-3" required>
          <option value="">Choose a saved routine</option>
          <option v-for="routine in savedRoutines" :key="routine.id" :value="routine.id">{{ routine.name }}</option>
        </select>
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">Repeat on</legend>
          <div class="grid grid-cols-4 gap-2">
            <label v-for="day in weekdayChoices" :key="day.value" class="flex items-center gap-2 rounded-lg bg-(--color-surface-2) p-2 text-sm">
              <input v-model="recurrenceWeekdays" type="checkbox" :value="day.value" />{{ day.label }}
            </label>
          </div>
        </fieldset>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Starts<input v-model="recurrenceStart" type="date" class="block w-full rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text)" required /></label>
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Optional end<input v-model="recurrenceEnd" type="date" class="block w-full rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text)" /></label>
        </div>
        <label class="block space-y-1 text-xs text-(--ui-text-muted)">Optional local time<input v-model="recurrenceTime" type="time" class="block w-full rounded-lg bg-(--color-surface-2) p-3 text-sm text-(--ui-text)" /></label>
        <div class="flex gap-2">
          <UButton type="submit" class="flex-1" variant="outline" :disabled="!routineId || recurrenceWeekdays.length === 0">Review recurrence</UButton>
          <UButton v-if="recurrenceId" type="button" class="flex-1" variant="soft" @click="reviewRecurrence(false)">Pause future occurrences</UButton>
        </div>
      </form>
      <div v-if="recurrencePreview" class="space-y-2 rounded-lg bg-(--color-surface-2) p-3">
        <p class="text-sm font-medium">Review recurring schedule</p>
        <p class="text-xs text-(--ui-text-muted)">Creates {{ recurrencePreview.createDates.length }} occurrences in the next 28 local dates; updates {{ recurrencePreview.updateAppointments.length }} and removes {{ recurrencePreview.removeAppointmentIds.length }} future unstarted occurrences.</p>
        <p v-if="recurrencePreview.protectedAppointmentIds.length" class="text-xs text-(--ui-text-muted)">Preserved {{ recurrencePreview.protectedAppointmentIds.length }} today, overdue, historical, fulfilled, skipped, or unfinished-linked appointments.</p>
        <UButton class="w-full" @click="applyRecurrenceReview">Apply reviewed recurrence</UButton>
      </div>
    </section>
    <section v-if="selectedPlan" class="rounded-xl bg-(--color-surface) p-4 space-y-3">
      <h2 class="font-semibold">Ordered rotation</h2>
      <p class="text-xs text-(--ui-text-muted)">Starting does not advance a rotation. A linked finished workout or explicit Skip advances it; rotations never create dated appointments.</p>
      <ul v-if="rotationItems.length" class="space-y-2" aria-label="Current rotation items">
        <li v-for="item in rotationItems" :key="item.id" class="flex items-center justify-between gap-2 rounded-lg bg-(--color-surface-2) p-3">
          <div><p class="font-medium">{{ item.title }}</p><p class="text-xs text-(--ui-text-muted)">{{ item.explanation }}</p></div>
          <UButton size="xs" variant="outline" :disabled="item.rotationId === null || item.generation === null" @click="skipRotation(item)">Skip</UButton>
        </li>
      </ul>
      <p v-else class="text-sm text-(--ui-text-muted)">No rotation is currently due.</p>
      <ul v-if="savedRotations.length" class="space-y-1">
        <li v-for="rotation in savedRotations" :key="rotation.id" class="flex items-center justify-between text-sm">
          <span>{{ rotation.name }} · {{ rotation.routineIds.length }} routines · {{ rotation.generation }} advances</span>
          <UButton size="xs" variant="ghost" @click="editRotation(rotation)">Edit</UButton>
        </li>
      </ul>
      <form class="space-y-2" @submit.prevent="saveRotation">
        <label class="sr-only" for="rotation-name">Rotation name</label>
        <input id="rotation-name" v-model="rotationName" class="w-full rounded-lg bg-(--color-surface-2) p-3" placeholder="e.g. Push / Pull / Legs" required />
        <label class="sr-only" for="rotation-routines">Choose routines to add</label>
        <select id="rotation-routines" v-model="rotationRoutineIds" multiple class="min-h-28 w-full rounded-lg bg-(--color-surface-2) p-3">
          <option v-for="routine in savedRoutines" :key="routine.id" :value="routine.id">{{ routine.name }}</option>
        </select>
        <p class="text-xs text-(--ui-text-muted)">Set the exact rotation order below.</p>
        <ol class="space-y-2">
          <li v-for="(id, index) in rotationRoutineIds" :key="id" class="flex items-center justify-between gap-2 rounded-lg bg-(--color-surface-2) p-2">
            <span class="min-w-0 truncate">{{ index + 1 }}. {{ savedRoutines.find((routine) => routine.id === id)?.name ?? 'Saved routine' }}</span>
            <span class="flex gap-1">
              <UButton size="xs" variant="ghost" :disabled="index === 0" :aria-label="`Move ${savedRoutines.find((routine) => routine.id === id)?.name ?? 'routine'} up`" @click="moveRotation(id, -1)">↑</UButton>
              <UButton size="xs" variant="ghost" :disabled="index === rotationRoutineIds.length - 1" :aria-label="`Move ${savedRoutines.find((routine) => routine.id === id)?.name ?? 'routine'} down`" @click="moveRotation(id, 1)">↓</UButton>
              <UButton size="xs" variant="ghost" :aria-label="`Remove ${savedRoutines.find((routine) => routine.id === id)?.name ?? 'routine'}`" @click="removeRotationRoutine(id)">Remove</UButton>
            </span>
          </li>
        </ol>
        <UButton type="submit" class="w-full" :loading="savingOrganization" :disabled="rotationRoutineIds.length === 0">Save rotation</UButton>
      </form>
    </section>
    <section v-if="selectedPlan" class="rounded-xl bg-(--color-surface) p-4 space-y-3">
      <h2 class="font-semibold">Weekly frequency goal</h2>
      <p class="text-xs text-(--ui-text-muted)">Counts a finished workout once when it contains completed actual work matching the filter. Selected activity type is OR within that dimension; supplied dimensions combine with AND. No duration threshold applies.</p>
      <form class="space-y-2" @submit.prevent="saveGoal">
        <label class="sr-only" for="goal-name">Goal name</label>
        <input id="goal-name" v-model="goalName" class="w-full rounded-lg bg-(--color-surface-2) p-3" placeholder="e.g. Strength sessions" required />
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Per Monday–Sunday week<input v-model.number="goalTarget" type="number" min="1" step="1" class="w-full rounded-lg bg-(--color-surface-2) p-3 text-sm" required /></label>
          <label class="space-y-1 text-xs text-(--ui-text-muted)">Activity type<select v-model="goalSessionType" class="w-full rounded-lg bg-(--color-surface-2) p-3 text-sm"><option value="">Any activity</option><option v-for="type in sessionTypes" :key="type" :value="type">{{ type }}</option></select></label>
        </div>
        <label class="space-y-1 text-xs text-(--ui-text-muted)">Exercises<select v-model="goalExerciseIds" multiple class="min-h-20 w-full rounded-lg bg-(--color-surface-2) p-3 text-sm"><option v-for="exercise in exerciseChoices" :key="exercise.id" :value="exercise.id">{{ exercise.name }}</option></select></label>
        <label class="space-y-1 text-xs text-(--ui-text-muted)">Movement patterns<select v-model="goalMovementPatterns" multiple class="min-h-20 w-full rounded-lg bg-(--color-surface-2) p-3 text-sm"><option v-for="movement in movementChoices" :key="movement" :value="movement">{{ movement }}</option></select></label>
        <ul v-if="savedGoals.length" class="space-y-1">
          <li v-for="goal in savedGoals" :key="goal.id" class="flex items-center justify-between text-sm">
            <span>{{ goal.name }} · {{ goal.targetCount }}/week · {{ goal.active ? 'active' : 'inactive' }}</span>
            <UButton size="xs" variant="ghost" @click="editGoal(goal)">Edit</UButton>
          </li>
        </ul>
        <UButton type="submit" class="w-full" :loading="savingOrganization" :disabled="!goalName.trim() || goalTarget < 1">Save weekly goal</UButton>
      </form>
    </section>
    <section v-if="selectedPlanProgram?.programId" class="rounded-xl bg-(--color-surface) p-4 space-y-3" aria-labelledby="program-adoption-heading">
      <h2 id="program-adoption-heading" class="font-semibold">Review Program adoption</h2>
      <p class="text-sm text-(--ui-text-muted)">{{ selectedPlanProgram.programName }} · {{ selectedPlanProgram.adoptedRevisionId ? 'Review a newer revision' : 'Not yet adopted' }}. Existing assignments remain unchanged until you review and apply.</p>
      <div v-if="adoptionPreview" class="space-y-3 rounded-lg bg-(--color-surface-2) p-3">
        <p class="text-sm font-medium">{{ adoptionPreview.compatible ? 'Bindings are compatible. Review each slot before applying.' : 'Resolve the listed binding issues before applying.' }}</p>
        <p class="text-sm text-(--ui-text-muted)">Program starts {{ adoptionPreview.calendar.startDate }}. Each Program week is seven local dates from that start; weekly goals remain Monday–Sunday.</p>
        <p v-if="adoptionNeedsReview" role="status" class="text-sm text-amber-300">Selections changed. Review these bindings again before applying.</p>
        <p v-for="issue in adoptionPreview.issues" :key="issue" role="status" class="text-sm text-amber-300">{{ issue }}</p>
        <div v-for="binding in adoptionPreview.bindings" :key="binding.programSlotId" class="space-y-1">
          <label :for="`binding-${binding.programSlotId}`" class="text-sm">{{ adoptionPreview.calendar.slots.find((slot) => slot.slotId === binding.programSlotId)?.label }} · {{ adoptionPreview.calendar.slots.find((slot) => slot.slotId === binding.programSlotId)?.plannedDate }} · {{ binding.issue ?? 'Compatible' }}</label>
          <select :id="`binding-${binding.programSlotId}`" :value="adoptionBindings[binding.programSlotId] ?? ''" class="w-full rounded-lg bg-(--color-surface) p-3" @change="setAdoptionBinding(binding.programSlotId, $event)">
            <option value="">Choose a saved routine</option>
            <option v-for="routine in savedRoutines.filter((item) => item.templateId === binding.templateId)" :key="routine.id" :value="routine.id">{{ routine.name }}</option>
          </select>
        </div>
        <section class="space-y-2" aria-label="Reviewed Program calendar changes">
          <h3 class="text-sm font-semibold">Future unstarted calendar changes</h3>
          <p class="text-xs text-(--ui-text-muted)">Today's, overdue, finished and unfinished-session-linked appointments stay unchanged. Applying this review may replace only the future unstarted appointments listed below.</p>
          <p v-if="adoptionPreview.calendar.changes.length === 0" class="text-sm">No calendar changes in the current four-week window.</p>
          <ul v-else class="space-y-2 text-sm">
            <li v-for="change in adoptionPreview.calendar.changes" :key="change.appointmentId ?? change.slotId" class="rounded-lg bg-(--color-surface) p-2">
              <span v-if="change.previousDate">{{ routineName(change.previousRoutineId) }} · {{ change.previousDate }} → </span>
              <span v-else>Add: </span>
              <span v-if="change.plannedDate">{{ routineName(change.routineId) }} · {{ change.plannedDate }}</span>
              <span v-else>Remove this future appointment</span>
            </li>
          </ul>
        </section>
        <UButton class="w-full" variant="outline" @click="previewProgramAdoption">Review selected bindings</UButton>
        <UButton class="w-full" :disabled="!adoptionPreview.compatible || adoptionNeedsReview" @click="applyProgramAdoption">Apply reviewed Program revision</UButton>
      </div>
      <UButton v-if="!adoptionPreview" class="w-full" variant="outline" @click="previewProgramAdoption">Review latest Program revision and bindings</UButton>
      <div v-if="selectedPlanProgram.adoptedRevisionId" class="grid grid-cols-[1fr_auto] gap-2">
        <label class="sr-only" for="program-week-date">Date for Program week lookup</label>
        <input id="program-week-date" v-model="programDate" type="date" class="rounded-lg bg-(--color-surface-2) p-3" />
        <UButton variant="outline" @click="loadProgramWeek">Week</UButton>
      </div>
      <p v-if="programWeek" class="text-sm text-(--ui-text-muted)">Week {{ programWeek.week }} · {{ programWeek.weekStart }}–{{ programWeek.weekEnd }} (seven local dates)</p>
      <p class="text-xs text-(--ui-text-muted)">Progression changes remain review-only and require explicit acceptance; no phases or routine targets change silently.</p>
    </section>
    <UButton to="/" variant="outline" class="w-full">Back to Today</UButton>
  </article>
</template>
