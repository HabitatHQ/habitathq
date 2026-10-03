import { parseSerializablePrescription } from '~/lib/prescription-domain'
import type {
  CircuitRestMode,
  GroupType,
  MovementPattern,
  TemplateExerciseRow,
  TemplateRow,
  TemplateUpdatePayload,
} from '~/types/database'
import type {
  PrescriptionActivity,
  SerializablePrescription,
  TemplateEditRequest,
} from '~/types/prescription'

type TemplateExerciseInput = {
  exerciseId: string
  orderNum: number
  setsPlanned: number
  repsPlanned: string
  restSeconds: number
  supersetGroup?: string
  setRestSeconds?: string
  setScheme?: string
}

function parsePlannedReps(value: string): PrescriptionActivity['sets'][number]['reps'] {
  const planned = value.trim()
  if (/^\d+$/.test(planned)) {
    const reps = Number(planned)
    return {
      kind: 'exact',
      value: {
        id: crypto.randomUUID(),
        rule: { kind: 'fixed', value: reps },
        resolvedValue: reps,
      },
    }
  }
  if (/^\d+\s*[-–]\s*\d+$/.test(planned)) {
    const parts = planned.split(/[-–]/)
    return { kind: 'range', minimum: Number(parts[0]), maximum: Number(parts[1]) }
  }
  if (/^\d+\+$/.test(planned)) return { kind: 'minimum', minimum: Number(planned.slice(0, -1)) }
  return null
}

function legacyTemplateActivity(
  exercise: TemplateExerciseInput,
  groupIds: Map<string, string>,
): PrescriptionActivity {
  const sets = Array.from({ length: exercise.setsPlanned }, (_, index) => {
    const reps = parsePlannedReps(exercise.repsPlanned)
    const rest = exercise.setRestSeconds
      ? Number(JSON.parse(exercise.setRestSeconds)[index] ?? exercise.restSeconds)
      : exercise.restSeconds
    return {
      id: crypto.randomUUID(),
      order: index + 1,
      role: 'working' as const,
      reps,
      weightKg: null,
      restSec: {
        id: crypto.randomUUID(),
        rule: { kind: 'fixed' as const, value: rest },
        resolvedValue: rest,
      },
      rpe: null,
      rir: null,
      notes: null,
      legacyScheme: exercise.setScheme ?? null,
    }
  })
  return {
    id: crypto.randomUUID(),
    exerciseId: exercise.exerciseId,
    order: exercise.orderNum,
    loggingMode: 'strength',
    executionGroupId: exercise.supersetGroup
      ? (groupIds.get(exercise.supersetGroup) ?? null)
      : null,
    sets,
    targets: { durationSec: null, distanceM: null },
    notes: null,
  }
}

export interface ExercisePreview {
  movement: MovementPattern
  icon: string | null
}

const templates = ref<TemplateRow[]>([])
const loadingTemplates = ref(false)

export interface TemplateExerciseWithName extends TemplateExerciseRow {
  exercise_name: string
  exercise_movement: MovementPattern
  exercise_icon: string | null
}
export interface TemplateGroupInput {
  label: string
  name?: string | null
  groupType: GroupType
  transitionRestSec?: number
  restAfterRoundSec?: number
  circuitRestMode?: CircuitRestMode
  sortOrder?: number
  displayName?: string | null
  rounds?: number
  amrap?: boolean
  timeCapSec?: number | null
}

export interface LoadOptions {
  includeArchived?: boolean
  sortBy?: string
}

export function useTemplates() {
  const db = useDatabase()

  async function load(opts: LoadOptions = {}) {
    if (loadingTemplates.value) return
    loadingTemplates.value = true
    try {
      const whereClause = opts.includeArchived ? '' : 'WHERE archived_at IS NULL'
      templates.value = await db.query<TemplateRow>(
        `SELECT * FROM templates ${whereClause} ORDER BY created_at DESC`,
      )
    } finally {
      loadingTemplates.value = false
    }
  }

  async function getRevision(templateId: string, revisionId?: string) {
    return db.domain('TEMPLATE_GET_REVISION', {
      templateId,
      ...(revisionId === undefined ? {} : { revisionId }),
    })
  }

  async function createRevision(input: {
    name: string
    description: string | null
    prescription: SerializablePrescription
  }) {
    return db.domain('TEMPLATE_CREATE', {
      ...input,
      prescription: parseSerializablePrescription(input.prescription),
    })
  }

  async function editRevision(input: TemplateEditRequest) {
    return db.domain('TEMPLATE_EDIT', {
      ...input,
      prescription: parseSerializablePrescription(input.prescription),
    })
  }
  async function create(
    name: string,
    description: string | null,
    exercises: TemplateExerciseInput[],
    groups: TemplateGroupInput[] = [],
  ): Promise<string> {
    const groupIds = new Map(groups.map((group) => [group.label, crypto.randomUUID()]))
    const activities = exercises.map((exercise) => legacyTemplateActivity(exercise, groupIds))
    const revision = await db.domain('TEMPLATE_CREATE', {
      name,
      description,
      now: new Date().toISOString(),
      prescription: {
        schemaVersion: 1,
        evaluatorVersion: 'cel-js-8.0.0-js-number-v1',
        inputs: [],
        defaults: { incrementKg: 2.5, restSec: 120 },
        groups: groups.map((group) => {
          const id = groupIds.get(group.label)
          if (!id) throw new Error(`Template group ${group.label} has no generated identity`)
          return {
            id,
            label: group.label,
            name: group.name ?? group.displayName ?? null,
            type: group.groupType,
            activityIds: activities
              .filter((activity) => activity.executionGroupId === id)
              .map((activity) => activity.id),
            transitionRestSec: group.transitionRestSec ?? 0,
            restAfterRoundSec: group.restAfterRoundSec ?? 120,
            circuitRestMode: group.circuitRestMode ?? 'after_round',
            rounds: group.rounds ?? 1,
            amrap: group.amrap ?? false,
            timeCapSec: group.timeCapSec ?? null,
          }
        }),
        activities,
        provenance: {
          kind: 'authored',
          migratedAt: null,
          legacyTemplateId: null,
          unresolvedFields: [],
        },
      },
    })
    await load()
    return revision.templateId
  }

  async function update(id: string, payload: TemplateUpdatePayload): Promise<void> {
    await db.domain('TEMPLATE_UPDATE_METADATA', {
      templateId: id,
      changes: Object.fromEntries(Object.entries(payload)),
    })
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      const updated = await getById(id)
      if (updated) templates.value[idx] = updated
    }
  }

  async function cloneTemplate(id: string, newName?: string): Promise<string> {
    const revision = await db.domain('TEMPLATE_DUPLICATE', {
      templateId: id,
      ...(newName === undefined ? {} : { name: newName }),
    })
    await load()
    return revision.templateId
  }

  async function archiveTemplate(id: string): Promise<void> {
    const now = new Date().toISOString()
    await update(id, { archived_at: now })
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  async function unarchiveTemplate(id: string): Promise<void> {
    await db.exec('UPDATE templates SET archived_at = NULL WHERE id = ?', [id])
    await load()
  }

  async function pinTemplate(id: string): Promise<void> {
    const now = new Date().toISOString()
    await update(id, { pinned_at: now })
  }

  async function unpinTemplate(id: string): Promise<void> {
    await db.exec('UPDATE templates SET pinned_at = NULL WHERE id = ?', [id])
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      const updated = await getById(id)
      if (updated) templates.value[idx] = updated
    }
  }

  async function reorder(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      await db.exec('UPDATE templates SET sort_order = ? WHERE id = ?', [i, id])
    }
    await load()
  }

  async function markUsed(id: string): Promise<void> {
    const now = new Date().toISOString()
    await db.exec('UPDATE templates SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [
      now,
      id,
    ])
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      const updated = await getById(id)
      if (updated) templates.value[idx] = updated
    }
  }

  async function getById(id: string): Promise<TemplateRow | null> {
    const rows = await db.query<TemplateRow>('SELECT * FROM templates WHERE id = ?', [id])
    return rows[0] ?? null
  }

  async function getExercises(templateId: string): Promise<TemplateExerciseWithName[]> {
    return db.query<TemplateExerciseWithName>(
      `SELECT te.*, e.name AS exercise_name, e.movement AS exercise_movement, e.icon AS exercise_icon
       FROM template_exercises te
       JOIN exercises e ON e.id = te.exercise_id
       WHERE te.template_id = ?
       ORDER BY te.order_num`,
      [templateId],
    )
  }

  async function getExercisePreviews(): Promise<Record<string, ExercisePreview[]>> {
    const rows = await db.query<{
      template_id: string
      movement: MovementPattern
      icon: string | null
    }>(
      `SELECT template_id, movement, icon FROM (
         SELECT te.template_id, e.movement, e.icon,
                ROW_NUMBER() OVER (PARTITION BY te.template_id ORDER BY te.order_num) AS rn
         FROM template_exercises te
         JOIN exercises e ON e.id = te.exercise_id
       ) WHERE rn <= 3`,
    )
    const result: Record<string, ExercisePreview[]> = {}
    for (const row of rows) {
      if (!result[row.template_id]) result[row.template_id] = []
      result[row.template_id]?.push({ movement: row.movement, icon: row.icon })
    }
    return result
  }

  async function getExerciseCounts(): Promise<Record<string, number>> {
    const rows = await db.query<{ template_id: string; cnt: number }>(
      'SELECT template_id, COUNT(*) AS cnt FROM template_exercises GROUP BY template_id',
    )
    return Object.fromEntries(rows.map((r) => [r.template_id, r.cnt]))
  }

  async function deleteTemplate(id: string): Promise<void> {
    await db.exec('DELETE FROM templates WHERE id = ?', [id])
    templates.value = templates.value.filter((t) => t.id !== id)
  }

  async function saveWorkoutAsTemplate(
    workoutId: string,
    name: string,
    description?: string,
  ): Promise<string> {
    const exercises = await db.query<{
      exercise_id: string
      order_num: number
      rest_seconds: number
      superset_group: string | null
    }>(
      'SELECT exercise_id, order_num, rest_seconds, superset_group FROM workout_exercises WHERE workout_id = ? AND removed_at IS NULL ORDER BY order_num',
      [workoutId],
    )
    const id = await create(
      name,
      description ?? null,
      exercises.map((ex) => ({
        exerciseId: ex.exercise_id,
        orderNum: ex.order_num,
        setsPlanned: 3,
        repsPlanned: '8',
        restSeconds: ex.rest_seconds,
        ...(ex.superset_group == null ? {} : { supersetGroup: ex.superset_group }),
      })),
    )
    return id
  }

  return {
    templates: readonly(templates),
    loading: readonly(loadingTemplates),
    load,
    create,
    createRevision,
    editRevision,
    getRevision,
    update,
    cloneTemplate,
    archiveTemplate,
    unarchiveTemplate,
    pinTemplate,
    unpinTemplate,
    reorder,
    markUsed,
    getById,
    getExercises,
    getExerciseCounts,
    getExercisePreviews,
    deleteTemplate,
    saveWorkoutAsTemplate,
  }
}
