import type {
  MovementPattern,
  TemplateExerciseRow,
  TemplateRow,
  TemplateUpdatePayload,
} from '~/types/database'

export interface ExercisePreview {
  movement: MovementPattern
  icon: string | null
}

const templates = ref<TemplateRow[]>([])
const loadingTemplates = ref(false)

export interface TemplateExerciseWithName extends TemplateExerciseRow {
  exercise_name: string
  exercise_movement: string
  exercise_icon: string | null
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

  async function create(
    name: string,
    description: string | null,
    exercises: Array<{
      exerciseId: string
      orderNum: number
      setsPlanned: number
      repsPlanned: string
      restSeconds: number
      supersetGroup?: string
      setRestSeconds?: string
      setScheme?: string
    }>,
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.exec('INSERT INTO templates (id, name, description, created_at) VALUES (?, ?, ?, ?)', [
      id,
      name,
      description,
      now,
    ])
    for (const ex of exercises) {
      const teId = crypto.randomUUID()
      await db.exec(
        `INSERT INTO template_exercises
           (id, template_id, exercise_id, order_num, superset_group,
            sets_planned, reps_planned, rpe_target, increment_kg, rest_seconds,
            set_rest_seconds, set_scheme)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 2.5, ?, ?, ?)`,
        [
          teId,
          id,
          ex.exerciseId,
          ex.orderNum,
          ex.supersetGroup ?? null,
          ex.setsPlanned,
          ex.repsPlanned,
          ex.restSeconds,
          ex.setRestSeconds ?? null,
          ex.setScheme ?? null,
        ],
      )
    }
    await load()
    return id
  }

  async function update(id: string, payload: TemplateUpdatePayload): Promise<void> {
    const entries = Object.entries(payload).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return
    const sets = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db.exec(`UPDATE templates SET ${sets} WHERE id = ?`, [...values, id])
    // Refresh the in-memory list
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1) {
      const updated = await getById(id)
      if (updated) templates.value[idx] = updated
    }
  }

  async function cloneTemplate(id: string, newName?: string): Promise<string> {
    const src = await getById(id)
    if (!src) throw new Error(`Template ${id} not found`)
    const srcExercises = await getExercises(id)

    const cloneId = crypto.randomUUID()
    const now = new Date().toISOString()
    const name = newName ?? `Copy of ${src.name}`
    await db.exec(
      'INSERT INTO templates (id, name, description, cover_emoji, created_at) VALUES (?, ?, ?, ?, ?)',
      [cloneId, name, src.description, src.cover_emoji, now],
    )
    for (const ex of srcExercises) {
      const teId = crypto.randomUUID()
      await db.exec(
        `INSERT INTO template_exercises
           (id, template_id, exercise_id, order_num, superset_group,
            sets_planned, reps_planned, rpe_target, increment_kg, rest_seconds,
            set_rest_seconds, set_scheme)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          teId,
          cloneId,
          ex.exercise_id,
          ex.order_num,
          ex.superset_group,
          ex.sets_planned,
          ex.reps_planned,
          ex.rpe_target,
          ex.increment_kg,
          ex.rest_seconds,
          ex.set_rest_seconds,
          ex.set_scheme,
        ],
      )
    }
    await load()
    return cloneId
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
      'SELECT exercise_id, order_num, rest_seconds, superset_group FROM workout_exercises WHERE workout_id = ? ORDER BY order_num',
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
