function recurrenceDates(
  weekdays: number[],
  start: string,
  end: string | null,
  today: string,
): string[] {
  const dates: string[] = []
  for (let offset = 0; offset <= 27; offset++) {
    const candidate = addDays(today, offset)
    if (candidate < start || (end !== null && candidate > end)) continue
    const weekday = ((new Date(`${candidate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
    if (weekdays.includes(weekday)) dates.push(candidate)
  }
  return dates
}

import type { DbAdapter } from '@palladium/core'
import type {
  Appointment,
  AppointmentReview,
  OrganizationCreditPreview,
  OrganizationFilter,
  OrganizationOperation,
  OrganizationOperationMap,
  OrganizationRecurrenceRule,
  OrganizationReport,
  OrganizationTodayItem,
  RecurrenceReview,
} from '~/types/organization'
import { ORGANIZATION_OPERATIONS } from '~/types/organization'

interface Row extends Record<string, unknown> {}
const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}
function date(value: unknown, label = 'Date'): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be a local YYYY-MM-DD date`)
  return value
}
function localToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
function addDays(value: string, amount: number): string {
  const result = new Date(`${value}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + amount)
  return result.toISOString().slice(0, 10)
}
function monday(value: string): string {
  const d = new Date(`${value}T12:00:00Z`)
  return addDays(value, -((d.getUTCDay() + 6) % 7))
}
function fingerprint(value: unknown): string {
  return JSON.stringify(value)
}
function appointment(row: Row): Appointment {
  return {
    id: String(row['id']),
    occurrenceKey: row['occurrence_key'] == null ? null : String(row['occurrence_key']),
    sourceKind:
      row['source_kind'] === 'recurrence' || row['source_kind'] === 'program'
        ? row['source_kind']
        : 'manual',
    sourceId: row['source_id'] == null ? null : String(row['source_id']),
    planId: String(row['plan_id']),
    routineId: String(row['routine_id']),
    originalDate: String(row['original_date']),
    originalTime: row['original_time'] == null ? null : String(row['original_time']),
    plannedDate: String(row['planned_date']),
    plannedTime: row['planned_time'] == null ? null : String(row['planned_time']),
    status: row['status'] as Appointment['status'],
    workoutId: row['workout_id'] == null ? null : String(row['workout_id']),
    postponed: row['postponed'] === 1,
    createdAt: String(row['created_at']),
  }
}
async function appointmentRow(db: DbAdapter, id: string): Promise<Appointment> {
  const row = await db.queryOne<Row>('SELECT * FROM organization_appointments WHERE id=?', [id])
  if (!row) throw new Error('Appointment not found')
  return appointment(row)
}
async function routinePolicy(
  db: DbAdapter,
  routineId: string,
): Promise<{ continuation_policy: string; deferral_mode: string | null }> {
  const row = await db.queryOne<{ continuation_policy: string; deferral_mode: string | null }>(
    'SELECT continuation_policy,deferral_mode FROM saved_routines WHERE id=?',
    [routineId],
  )
  if (!row) throw new Error('Saved routine not found')
  return row
}

function recurrenceRule(row: Row): OrganizationRecurrenceRule {
  const weekdays: unknown = JSON.parse(String(row['weekdays_json']))
  if (
    !Array.isArray(weekdays) ||
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )
    throw new Error('Stored recurrence weekdays are invalid')
  return {
    id: String(row['id']),
    planId: String(row['plan_id']),
    routineId: String(row['routine_id']),
    weekdays,
    startDate: String(row['start_date']),
    endDate: row['end_date'] == null ? null : String(row['end_date']),
    plannedTime: row['planned_time'] == null ? null : String(row['planned_time']),
    active: row['active'] === 1,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  }
}

async function previewRecurrence(db: DbAdapter, input: unknown): Promise<RecurrenceReview> {
  const p = isRecord(input) ? input : {}
  const today = date(p['today'])
  const rule: OrganizationRecurrenceRule = {
    id: typeof p['id'] === 'string' ? p['id'] : crypto.randomUUID(),
    planId: text(p['planId'], 'Plan'),
    routineId: text(p['routineId'], 'Routine'),
    weekdays: Array.isArray(p['weekdays']) ? (p['weekdays'] as number[]) : [],
    startDate: date(p['startDate'], 'Recurrence start date'),
    endDate: p['endDate'] == null ? null : date(p['endDate'], 'Recurrence end date'),
    plannedTime: p['time'] == null ? null : text(p['time'], 'Appointment time'),
    active: p['active'] !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (
    !rule.weekdays.length ||
    rule.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(rule.weekdays).size !== rule.weekdays.length
  )
    throw new Error('Select one or more weekdays from Monday through Sunday')
  if (rule.endDate && rule.endDate < rule.startDate)
    throw new Error('Recurrence end date precedes its start date')
  await routinePolicy(db, rule.routineId)
  const createDates = rule.active
    ? recurrenceDates(rule.weekdays, rule.startDate, rule.endDate, today)
    : []
  const existing = await db.queryAll<Row>(
    `SELECT * FROM organization_appointments WHERE plan_id=? AND source_kind='recurrence' AND source_id=? ORDER BY planned_date,id`,
    [rule.planId, rule.id],
  )
  const expected = new Set(createDates.map((day) => `recurrence:${rule.id}:${day}`))
  const updateAppointments: Appointment[] = []
  const removeAppointmentIds: string[] = []
  const protectedAppointmentIds: string[] = []
  for (const row of existing) {
    const item = appointment(row)
    if (item.status !== 'open' || item.workoutId || item.plannedDate <= today) {
      protectedAppointmentIds.push(item.id)
      continue
    }
    if (!expected.has(item.occurrenceKey ?? '')) removeAppointmentIds.push(item.id)
    else if (item.routineId !== rule.routineId || item.plannedTime !== rule.plannedTime)
      updateAppointments.push(item)
  }
  const changed = {
    rule,
    createDates,
    updateAppointments,
    removeAppointmentIds,
    protectedAppointmentIds,
  }
  const hash = fingerprint(changed)
  const previewId = crypto.randomUUID()
  await db.exec(
    'INSERT INTO organization_reviews(id,kind,owner_id,fingerprint,snapshot_json,created_at) VALUES(?,?,?,?,?,?)',
    [previewId, 'recurrence', rule.planId, hash, JSON.stringify(changed), new Date().toISOString()],
  )
  return { previewId, ...changed, fingerprint: hash }
}

async function applyRecurrence(db: DbAdapter, input: unknown): Promise<OrganizationRecurrenceRule> {
  const p = isRecord(input) ? input : {}
  const previewId = text(p['previewId'], 'Preview')
  const review = await db.queryOne<{ fingerprint: string; snapshot_json: string }>(
    `SELECT fingerprint,snapshot_json FROM organization_reviews WHERE id=? AND kind='recurrence'`,
    [previewId],
  )
  if (!review || review.fingerprint !== p['fingerprint'])
    throw new Error('Recurrence review is stale or missing')
  const data = JSON.parse(review.snapshot_json) as Omit<
    RecurrenceReview,
    'previewId' | 'fingerprint'
  >
  const rule = data.rule
  for (const id of data.protectedAppointmentIds) {
    const current = await appointmentRow(db, id)
    if (current.status === 'open' && !current.workoutId && current.plannedDate > localToday()) {
      throw new Error('Protected appointment state changed; refresh recurrence review')
    }
  }
  const now = new Date().toISOString()
  await db.exec(
    'INSERT INTO organization_recurrence_rules(id,plan_id,routine_id,weekdays_json,start_date,end_date,planned_time,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET routine_id=excluded.routine_id,weekdays_json=excluded.weekdays_json,start_date=excluded.start_date,end_date=excluded.end_date,planned_time=excluded.planned_time,active=excluded.active,updated_at=excluded.updated_at',
    [
      rule.id,
      rule.planId,
      rule.routineId,
      JSON.stringify(rule.weekdays),
      rule.startDate,
      rule.endDate,
      rule.plannedTime,
      rule.active ? 1 : 0,
      rule.createdAt,
      now,
    ],
  )
  for (const id of data.removeAppointmentIds)
    await db.exec(
      `DELETE FROM organization_appointments WHERE id=? AND status='open' AND workout_id IS NULL AND planned_date>?`,
      [id, localToday()],
    )
  for (const appointment of data.updateAppointments)
    await db.exec(
      `UPDATE organization_appointments SET routine_id=?,planned_time=? WHERE id=? AND status='open' AND workout_id IS NULL AND planned_date>?`,
      [rule.routineId, rule.plannedTime, appointment.id, localToday()],
    )
  await db.exec('DELETE FROM organization_reviews WHERE id=?', [previewId])
  return { ...rule, updatedAt: now }
}

const operations: {
  [K in OrganizationOperation]: (
    db: DbAdapter,
    input: unknown,
  ) => Promise<OrganizationOperationMap[K]['result']>
} = {
  ORGANIZATION_PLAN_LIST: async (db) =>
    (await db.queryAll<Row>('SELECT * FROM training_plans ORDER BY created_at,id')).map((r) => ({
      id: String(r['id']),
      name: String(r['name']),
      active: r['active'] === 1,
      startDate: String(r['start_local_date']),
      createdAt: String(r['created_at']),
      updatedAt: String(r['updated_at']),
    })),
  ORGANIZATION_PLAN_SAVE: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = typeof p['id'] === 'string' ? p['id'] : crypto.randomUUID()
    const now = new Date().toISOString()
    const start = date(p['startDate'] ?? localToday(), 'Plan start date')
    const name = text(p['name'], 'Plan name').trim()
    const active = p['active'] === false ? 0 : 1
    await db.exec(
      'INSERT INTO training_plans(id,name,program_id,adopted_program_revision_id,start_local_date,active,legacy_state_json,created_at,updated_at) VALUES(?,?,NULL,NULL,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_local_date=excluded.start_local_date,active=excluded.active,updated_at=excluded.updated_at',
      [id, name, start, active, now, now],
    )
    return { id, name, active: active === 1, startDate: start, createdAt: now, updatedAt: now }
  },
  ORGANIZATION_APPOINTMENT_LIST: async (db, input) => {
    const planId = isRecord(input) && typeof input['planId'] === 'string' ? input['planId'] : null
    const rows = planId
      ? await db.queryAll<Row>(
          'SELECT * FROM organization_appointments WHERE plan_id=? ORDER BY planned_date,planned_time,id',
          [planId],
        )
      : await db.queryAll<Row>(
          'SELECT * FROM organization_appointments ORDER BY planned_date,planned_time,id',
        )
    return rows.map(appointment)
  },
  ORGANIZATION_APPOINTMENT_CREATE: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = typeof p['id'] === 'string' ? p['id'] : crypto.randomUUID()
    const planId = text(p['planId'], 'Plan')
    const routineId = text(p['routineId'], 'Routine')
    const planned = date(p['date'])
    const plannedTime = p['time'] == null ? null : text(p['time'], 'Appointment time')
    const now = new Date().toISOString()
    await routinePolicy(db, routineId)
    await db.exec(
      `INSERT INTO organization_appointments(id,plan_id,routine_id,original_date,planned_date,planned_time,status,created_at,source_kind,original_time) VALUES(?,?,?,?,?,?,'open',?,'manual',?)`,
      [id, planId, routineId, planned, planned, plannedTime, now, plannedTime],
    )
    return appointmentRow(db, id)
  },
  ORGANIZATION_APPOINTMENT_POSTPONE_PREVIEW: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = text(p['appointmentId'], 'Appointment')
    const target = date(p['date'])
    const source = await appointmentRow(db, id)
    if (source.status !== 'open' || source.workoutId)
      throw new Error('Only open, unlinked appointments can be postponed')
    const collisions = await db.queryAll<{ id: string }>(
      `SELECT a.id FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id WHERE p.active=1 AND a.status='open' AND a.routine_id=? AND a.planned_date=? AND a.id<>? ORDER BY a.id`,
      [source.routineId, target, id],
    )
    return {
      appointment: source,
      targetDate: target,
      collisionIds: collisions.map((row) => row.id),
    }
  },
  ORGANIZATION_APPOINTMENT_POSTPONE: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = text(p['appointmentId'], 'Appointment')
    const target = date(p['date'])
    const source = await appointmentRow(db, id)
    if (source.status !== 'open' || source.workoutId)
      throw new Error('Only open, unlinked appointments can be postponed')
    const collisions = await db.queryAll<{ id: string }>(
      "SELECT a.id FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id WHERE p.active=1 AND a.status='open' AND a.routine_id=? AND a.planned_date=? AND a.id<>? ORDER BY a.id",
      [source.routineId, target, id],
    )
    const collisionIds = collisions.map((r) => r.id)
    if (collisionIds.length && p['overrideCollision'] !== true)
      throw new Error(`Same-routine appointment collision: ${collisionIds.join(', ')}`)
    await db.exec('UPDATE organization_appointments SET planned_date=?,postponed=1 WHERE id=?', [
      target,
      id,
    ])
    return { appointment: await appointmentRow(db, id), collisionIds }
  },
  ORGANIZATION_RECURRENCE_LIST: async (db, input) => {
    const planId = isRecord(input) && typeof input['planId'] === 'string' ? input['planId'] : null
    const rows = planId
      ? await db.queryAll<Row>(
          'SELECT * FROM organization_recurrence_rules WHERE plan_id=? ORDER BY start_date,id',
          [planId],
        )
      : await db.queryAll<Row>('SELECT * FROM organization_recurrence_rules ORDER BY start_date,id')
    return rows.map(recurrenceRule)
  },
  ORGANIZATION_RECURRENCE_PREVIEW: previewRecurrence,
  ORGANIZATION_RECURRENCE_APPLY: applyRecurrence,
  ORGANIZATION_APPOINTMENT_SKIP: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = text(p['appointmentId'], 'Appointment')
    const row = await appointmentRow(db, id)
    if (row.workoutId) throw new Error('An appointment linked to a workout cannot be skipped')
    await db.exec(
      "UPDATE organization_appointments SET status='skipped' WHERE id=? AND status='open'",
      [id],
    )
    return appointmentRow(db, id)
  },
  ORGANIZATION_RECONCILE_OPEN: reconcileOpen,
  ORGANIZATION_SCHEDULE_PREVIEW: previewSchedule,
  ORGANIZATION_SCHEDULE_APPLY: applySchedule,
  ORGANIZATION_ROTATION_LIST: async (db, input) => {
    const planId = isRecord(input) && typeof input['planId'] === 'string' ? input['planId'] : null
    const rows = planId
      ? await db.queryAll<Row>('SELECT * FROM organization_rotations WHERE plan_id=? ORDER BY id', [
          planId,
        ])
      : await db.queryAll<Row>('SELECT * FROM organization_rotations ORDER BY id')
    return rows.map((row) => {
      const routineIds = JSON.parse(String(row['routine_ids_json'])) as string[]
      const currentRoutineId = routineIds[Number(row['position']) % routineIds.length]
      if (currentRoutineId === undefined) throw new Error('Rotation has no current routine')
      return {
        id: String(row['id']),
        planId: String(row['plan_id']),
        name: String(row['name']),
        routineIds,
        position: Number(row['position']),
        generation: Number(row['generation']),
        currentRoutineId,
      }
    })
  },
  ORGANIZATION_ROTATION_SAVE: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = typeof p['id'] === 'string' ? p['id'] : crypto.randomUUID()
    const routineIds = p['routineIds']
    if (
      !Array.isArray(routineIds) ||
      !routineIds.length ||
      routineIds.some((x) => typeof x !== 'string')
    )
      throw new Error('A rotation requires saved routines in order')
    for (const routineId of routineIds) await routinePolicy(db, routineId)
    const name = text(p['name'], 'Rotation name')
    await db.exec(
      'INSERT INTO organization_rotations(id,plan_id,name,routine_ids_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,routine_ids_json=excluded.routine_ids_json',
      [id, text(p['planId'], 'Plan'), name, JSON.stringify(routineIds), new Date().toISOString()],
    )
    const saved = (
      await operations.ORGANIZATION_ROTATION_LIST(db, { planId: text(p['planId'], 'Plan') })
    ).find((rotation) => rotation.id === id)
    if (!saved) throw new Error('Rotation save did not persist')
    return saved
  },
  ORGANIZATION_ROTATION_SKIP: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const id = text(p['rotationId'], 'Rotation')
    const generation = Number(p['generation'])
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new Error('Invalid rotation generation')
    const row = await db.queryOne<{
      routine_ids_json: string
      position: number
      generation: number
    }>('SELECT * FROM organization_rotations WHERE id=?', [id])
    if (!row) throw new Error('Rotation not found')
    if (row.generation !== generation) throw new Error('Rotation changed; refresh before skipping')
    const linked = await db.queryOne<{ id: string }>(
      'SELECT w.id FROM organization_source_links l JOIN workouts w ON w.id=l.workout_id WHERE l.rotation_id=? AND l.rotation_generation=? AND w.ended_at IS NULL LIMIT 1',
      [id, generation],
    )
    if (linked) throw new Error('An unfinished workout is linked to this rotation item')
    const next = (row.position + 1) % (JSON.parse(row.routine_ids_json) as string[]).length
    await advanceRotation(db, id, generation, next, null, 'skip')
    return generation + 1
  },
  ORGANIZATION_GOAL_LIST: async (db, input) => {
    const planId = isRecord(input) && typeof input['planId'] === 'string' ? input['planId'] : null
    const rows = planId
      ? await db.queryAll<Row>('SELECT * FROM organization_goals WHERE plan_id=? ORDER BY id', [
          planId,
        ])
      : await db.queryAll<Row>('SELECT * FROM organization_goals ORDER BY id')
    return rows.map((row) => ({
      id: String(row['id']),
      planId: String(row['plan_id']),
      name: String(row['name']),
      targetCount: Number(row['target_count']),
      filter: parseFilter(JSON.parse(String(row['filter_json']))),
      active: row['active'] === 1,
      createdAt: String(row['created_at']),
    }))
  },
  ORGANIZATION_GOAL_SAVE: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const filter = parseFilter(p['filter'])
    const id = typeof p['id'] === 'string' ? p['id'] : crypto.randomUUID()
    const target = Number(p['targetCount'])
    if (!Number.isSafeInteger(target) || target < 1)
      throw new Error('Weekly goal target must be a positive integer')
    const planId = text(p['planId'], 'Plan')
    const name = text(p['name'], 'Goal name')
    const active = p['active'] === false ? 0 : 1
    const now = new Date().toISOString()
    await db.exec(
      'INSERT INTO organization_goals(id,plan_id,name,target_count,filter_json,active,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,target_count=excluded.target_count,filter_json=excluded.filter_json,active=excluded.active',
      [id, planId, name, target, JSON.stringify(filter), active, now],
    )
    return { id, planId, name, targetCount: target, filter, active: active === 1, createdAt: now }
  },
  ORGANIZATION_TODAY: todayItems,
  ORGANIZATION_CREDIT_PREVIEW: organizationCreditPreview,
  ORGANIZATION_PROGRAM_WEEK: async (db, input) => {
    const p = isRecord(input) ? input : {}
    const planId = text(p['planId'], 'Plan')
    const day = date(p['date'])
    const plan = await db.queryOne<{ start_local_date: string }>(
      'SELECT start_local_date FROM training_plans WHERE id=?',
      [planId],
    )
    if (!plan) throw new Error('Plan not found')
    const start = date(plan.start_local_date)
    if (day < start) return { week: 0, weekStart: start, weekEnd: addDays(start, 6) }
    const week =
      Math.floor((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 604800000) +
      1
    const weekStart = addDays(start, (week - 1) * 7)
    return { week, weekStart, weekEnd: addDays(weekStart, 6) }
  },
  ORGANIZATION_REPORT: report,
}

function parseFilter(value: unknown): OrganizationFilter {
  if (!isRecord(value)) throw new Error('Activity filter is required')
  const dimension = (key: string): string[] => {
    const entries = value[key] ?? []
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string'))
      throw new Error(`Invalid activity filter ${key}`)
    return [...new Set(entries as string[])]
  }
  return {
    sessionTypes: dimension('sessionTypes'),
    exerciseIds: dimension('exerciseIds'),
    movementPatterns: dimension('movementPatterns'),
  }
}
async function materializeRuleOccurrences(db: DbAdapter, today: string): Promise<void> {
  await materializeRecurrenceOccurrences(db, today)
  await materializeProgramOccurrences(db, today)
}

async function materializeRecurrenceOccurrences(db: DbAdapter, today: string): Promise<void> {
  const rules = await db.queryAll<Row>(
    'SELECT r.* FROM organization_recurrence_rules r JOIN training_plans p ON p.id=r.plan_id WHERE p.active=1 AND r.active=1',
  )
  const now = new Date().toISOString()
  for (const row of rules) {
    const rule = recurrenceRule(row)
    for (const occurrenceDate of recurrenceDates(
      rule.weekdays,
      rule.startDate,
      rule.endDate,
      today,
    )) {
      const key = `recurrence:${rule.id}:${occurrenceDate}`
      await db.exec(
        `INSERT OR IGNORE INTO organization_appointments(id,plan_id,routine_id,original_date,planned_date,planned_time,status,created_at,occurrence_key,source_kind,source_id,original_time) VALUES(?,?,?,?,?,?,'open',?,?, 'recurrence',?,?)`,
        [
          crypto.randomUUID(),
          rule.planId,
          rule.routineId,
          occurrenceDate,
          occurrenceDate,
          rule.plannedTime,
          now,
          key,
          rule.id,
          rule.plannedTime,
        ],
      )
    }
  }
}

function programOccurrenceSlot(value: unknown): { id: string; week: number; day: number } | null {
  if (!isRecord(value)) return null
  const id = value['id']
  const week = value['week']
  const day = value['day']
  if (
    typeof id !== 'string' ||
    typeof week !== 'number' ||
    !Number.isInteger(week) ||
    week < 1 ||
    typeof day !== 'number' ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 7
  )
    return null
  return { id, week, day }
}

async function insertProgramOccurrences(
  db: DbAdapter,
  planId: string,
  desired: Map<string, { date: string; routineId: string; slotId: string }>,
  horizonEnd: string,
): Promise<void> {
  const now = new Date().toISOString()
  for (const [key, target] of desired) {
    if (target.date > horizonEnd) continue
    await db.exec(
      `INSERT OR IGNORE INTO organization_appointments(id,plan_id,routine_id,original_date,planned_date,planned_time,status,created_at,occurrence_key,source_kind,source_id,original_time) VALUES(?,?,?,?,?,NULL,'open',?,?, 'program',?,NULL)`,
      [
        crypto.randomUUID(),
        planId,
        target.routineId,
        target.date,
        target.date,
        now,
        key,
        target.slotId,
      ],
    )
  }
}

async function materializeProgramOccurrences(db: DbAdapter, today: string): Promise<void> {
  const plans = await db.queryAll<{
    id: string
    start_local_date: string
    adopted_program_revision_id: string
  }>(
    'SELECT id,start_local_date,adopted_program_revision_id FROM training_plans WHERE active=1 AND adopted_program_revision_id IS NOT NULL',
  )
  const horizonEnd = addDays(today, 27)
  for (const plan of plans) {
    const revision = await db.queryOne<{ design_json: string }>(
      'SELECT design_json FROM program_revisions WHERE id=?',
      [plan.adopted_program_revision_id],
    )
    if (!revision) continue
    const design: unknown = JSON.parse(revision.design_json)
    if (!isRecord(design) || !Array.isArray(design['slots'])) continue
    const bindings = await db.queryAll<{ program_slot_id: string; routine_id: string | null }>(
      'SELECT program_slot_id,routine_id FROM training_plan_bindings WHERE plan_id=?',
      [plan.id],
    )
    const desired = new Map<string, { date: string; routineId: string; slotId: string }>()
    for (const slotValue of design['slots']) {
      const slot = programOccurrenceSlot(slotValue)
      if (!slot) continue
      const slotId = slot.id
      const routineId = bindings.find((binding) => binding.program_slot_id === slotId)?.routine_id
      if (!routineId) continue
      const occurrenceDate = addDays(plan.start_local_date, (slot.week - 1) * 7 + slot.day - 1)
      if (occurrenceDate < today) continue
      desired.set(`program:${plan.id}:${slotId}`, { date: occurrenceDate, routineId, slotId })
    }
    await insertProgramOccurrences(db, plan.id, desired, horizonEnd)
  }
}

async function hasRuleCollision(
  db: DbAdapter,
  routineId: string,
  candidate: string,
  exceptId: string,
): Promise<boolean> {
  const occurrence = await db.queryOne<{ id: string }>(
    `SELECT a.id FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id WHERE p.active=1 AND a.status='open' AND a.routine_id=? AND a.planned_date=? AND a.id<>? LIMIT 1`,
    [routineId, candidate, exceptId],
  )
  if (occurrence) return true
  const rules = await db.queryAll<{
    id: string
    weekdays_json: string
    start_date: string
    end_date: string | null
  }>(
    'SELECT r.id,r.weekdays_json,r.start_date,r.end_date FROM organization_recurrence_rules r JOIN training_plans p ON p.id=r.plan_id WHERE p.active=1 AND r.active=1 AND r.routine_id=? AND r.start_date<=? AND (r.end_date IS NULL OR r.end_date>=?)',
    [routineId, candidate, candidate],
  )
  const weekday = ((new Date(`${candidate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  if (rules.some((rule) => (JSON.parse(rule.weekdays_json) as number[]).includes(weekday)))
    return true
  const plans = await db.queryAll<{
    id: string
    start_local_date: string
    adopted_program_revision_id: string | null
  }>(
    'SELECT id,start_local_date,adopted_program_revision_id FROM training_plans WHERE active=1 AND adopted_program_revision_id IS NOT NULL',
  )
  for (const plan of plans) {
    const revision = await db.queryOne<{ design_json: string }>(
      'SELECT design_json FROM program_revisions WHERE id=?',
      [plan.adopted_program_revision_id],
    )
    if (!revision) continue
    const design: unknown = JSON.parse(revision.design_json)
    if (!isRecord(design) || !Array.isArray(design['slots'])) continue
    const bindings = await db.queryAll<{ program_slot_id: string; routine_id: string | null }>(
      'SELECT program_slot_id,routine_id FROM training_plan_bindings WHERE plan_id=?',
      [plan.id],
    )
    for (const slotValue of design['slots']) {
      if (
        !isRecord(slotValue) ||
        !Number.isInteger(slotValue['week']) ||
        !Number.isInteger(slotValue['day'])
      )
        continue
      if (
        addDays(
          plan.start_local_date,
          (Number(slotValue['week']) - 1) * 7 + Number(slotValue['day']) - 1,
        ) === candidate &&
        bindings.some(
          (binding) =>
            binding.program_slot_id === slotValue['id'] && binding.routine_id === routineId,
        )
      )
        return true
    }
  }
  return false
}

async function reconcileOpen(db: DbAdapter, input: unknown): Promise<Appointment[]> {
  const today = date(isRecord(input) ? input['today'] : null)
  await materializeRuleOccurrences(db, today)
  const overdue = await db.queryAll<Row>(
    `SELECT a.* FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id JOIN saved_routines r ON r.id=a.routine_id WHERE p.active=1 AND a.status='open' AND a.workout_id IS NULL AND a.planned_date<? AND r.continuation_policy='carry_forward' AND r.deferral_mode='automatic' ORDER BY a.planned_date,a.id`,
    [today],
  )
  for (const row of overdue) {
    const item = appointmentFromRow(row)
    let destination: string | null = null
    for (let offset = 0; offset <= 27; offset++) {
      const candidate = addDays(today, offset)
      if (!(await hasRuleCollision(db, item.routineId, candidate, item.id))) {
        destination = candidate
        break
      }
    }
    if (destination)
      await db.exec(
        `UPDATE organization_appointments SET planned_date=?,postponed=1 WHERE id=? AND status='open' AND workout_id IS NULL`,
        [destination, item.id],
      )
  }
  const rows = await db.queryAll<Row>(
    'SELECT * FROM organization_appointments ORDER BY planned_date,planned_time,id',
  )
  return rows.map(appointment)
}
function appointmentFromRow(row: Row): Appointment {
  return appointment(row)
}
function scheduleChanges(input: unknown): Map<string, { date: string; time: string | null }> {
  if (!Array.isArray(input)) throw new Error('Schedule date changes are required')
  const changes = new Map<string, { date: string; time: string | null }>()
  for (const entry of input) {
    if (!isRecord(entry)) throw new Error('Invalid schedule change')
    const nextDate = date(entry['date'])
    if (nextDate <= localToday())
      throw new Error('Schedule reconciliation dates must be in the future')
    const id = text(entry['appointmentId'], 'Appointment')
    const time = entry['time'] == null ? null : text(entry['time'], 'Appointment time')
    if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error('Appointment time must use local HH:MM')
    if (changes.has(id)) throw new Error('Duplicate appointment in schedule changes')
    changes.set(id, { date: nextDate, time })
  }
  return changes
}

async function previewSchedule(db: DbAdapter, input: unknown): Promise<AppointmentReview> {
  const p = isRecord(input) ? input : {}
  const planId = text(p['planId'], 'Plan')
  const changes = scheduleChanges(p['dates'])
  const appointments = await db.queryAll<Row>(
    `SELECT * FROM organization_appointments WHERE plan_id=? AND status='open' AND workout_id IS NULL AND planned_date>? ORDER BY id`,
    [planId, localToday()],
  )
  const eligibleIds = new Set(appointments.map((row) => String(row['id'])))
  if ([...changes.keys()].some((id) => !eligibleIds.has(id)))
    throw new Error('Only unstarted future appointments can be reconciled')
  const changed: { appointment: Appointment; previousDate: string; previousTime: string | null }[] =
    []
  for (const row of appointments) {
    const next = changes.get(String(row['id']))
    if (!next) continue
    const current = appointment(row)
    if (next.date !== current.plannedDate || next.time !== current.plannedTime)
      changed.push({
        appointment: { ...current, plannedDate: next.date, plannedTime: next.time },
        previousDate: current.plannedDate,
        previousTime: current.plannedTime,
      })
  }
  await validateScheduleCollisions(
    db,
    changed.map((entry) => entry.appointment),
  )
  const previewId = crypto.randomUUID()
  const value = { planId, changed }
  const hash = fingerprint(value)
  await db.exec(
    'INSERT INTO organization_reviews(id,kind,owner_id,fingerprint,snapshot_json,created_at) VALUES(?,?,?,?,?,?)',
    [previewId, 'schedule', planId, hash, JSON.stringify(value), new Date().toISOString()],
  )
  return {
    previewId,
    planId,
    changed: changed.map((entry) => entry.appointment),
    fingerprint: hash,
  }
}
async function validateScheduleCollisions(db: DbAdapter, changes: Appointment[]): Promise<void> {
  const changedIds = new Set(changes.map((item) => item.id))
  const proposed = new Set<string>()
  for (const item of changes) {
    const key = `${item.routineId}\u0000${item.plannedDate}`
    if (proposed.has(key))
      throw new Error(`Same-routine appointment collision on ${item.plannedDate}`)
    proposed.add(key)
    const existing = await db.queryAll<{ id: string }>(
      `SELECT a.id FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id WHERE p.active=1 AND a.status='open' AND a.routine_id=? AND a.planned_date=? AND a.id<>?`,
      [item.routineId, item.plannedDate, item.id],
    )
    if (existing.some((row) => !changedIds.has(row.id)))
      throw new Error(`Same-routine appointment collision on ${item.plannedDate}`)
  }
}
async function applySchedule(db: DbAdapter, input: unknown): Promise<Appointment[]> {
  const p = isRecord(input) ? input : {}
  const id = text(p['previewId'], 'Preview')
  const review = await db.queryOne<{ fingerprint: string; snapshot_json: string }>(
    `SELECT * FROM organization_reviews WHERE id=? AND kind='schedule'`,
    [id],
  )
  if (!review || review.fingerprint !== p['fingerprint'])
    throw new Error('Schedule review is stale or missing')
  const payload = JSON.parse(review.snapshot_json) as {
    changed: { appointment: Appointment; previousDate: string; previousTime: string | null }[]
  }
  for (const proposed of payload.changed) {
    const current = await appointmentRow(db, proposed.appointment.id)
    if (
      current.status !== 'open' ||
      current.workoutId ||
      current.plannedDate !== proposed.previousDate ||
      current.plannedTime !== proposed.previousTime ||
      current.plannedDate <= localToday()
    )
      throw new Error('Appointment is protected or changed; refresh schedule review')
  }
  await validateScheduleCollisions(
    db,
    payload.changed.map((entry) => entry.appointment),
  )
  for (const proposed of payload.changed)
    await db.exec('UPDATE organization_appointments SET planned_date=?,planned_time=? WHERE id=?', [
      proposed.appointment.plannedDate,
      proposed.appointment.plannedTime,
      proposed.appointment.id,
    ])
  await db.exec('DELETE FROM organization_reviews WHERE id=?', [id])
  return payload.changed.map((entry) => entry.appointment)
}
async function advanceRotation(
  db: DbAdapter,
  rotationId: string,
  generation: number,
  nextPosition: number,
  workoutId: string | null,
  reason: 'finish' | 'skip',
): Promise<void> {
  const receipt = workoutId
    ? await db.queryOne<{ id: string }>(
        'SELECT id FROM organization_rotation_advances WHERE rotation_id=? AND workout_id=?',
        [rotationId, workoutId],
      )
    : await db.queryOne<{ id: string }>(
        'SELECT id FROM organization_rotation_advances WHERE rotation_id=? AND generation=? AND reason=?',
        [rotationId, generation + 1, reason],
      )
  if (receipt) return
  await db.exec(
    'INSERT INTO organization_rotation_advances(id,rotation_id,generation,workout_id,reason,created_at) VALUES(?,?,?,?,?,?)',
    [crypto.randomUUID(), rotationId, generation + 1, workoutId, reason, new Date().toISOString()],
  )
  await db.exec(
    'UPDATE organization_rotations SET position=?,generation=generation+1 WHERE id=? AND generation=?',
    [nextPosition, rotationId, generation],
  )
  const advanced = await db.queryOne<{ generation: number }>(
    'SELECT generation FROM organization_rotations WHERE id=?',
    [rotationId],
  )
  if (advanced?.generation !== generation + 1)
    throw new Error('Rotation generation changed before advancement')
}
async function todayItems(db: DbAdapter, input: unknown): Promise<OrganizationTodayItem[]> {
  const p = isRecord(input) ? input : {}
  const today = date(p['today'])
  await reconcileOpen(db, { today })
  const result: OrganizationTodayItem[] = []
  const active = await db.queryOne<{ id: string }>(
    'SELECT id FROM workouts WHERE ended_at IS NULL ORDER BY started_at LIMIT 1',
  )
  if (active)
    result.push({
      kind: 'recovery',
      id: active.id,
      planId: null,
      planName: null,
      title: 'Resume unfinished workout',
      explanation: 'Your unfinished session takes priority.',
      date: null,
      time: null,
      routineId: null,
      workoutId: active.id,
      rotationId: null,
      generation: null,
      progress: null,
      alternatives: [],
    })
  const appointments = await db.queryAll<Row>(
    `SELECT a.*,r.name AS routine_name,p.name AS plan_name FROM organization_appointments a JOIN training_plans p ON p.id=a.plan_id JOIN saved_routines r ON r.id=a.routine_id WHERE p.active=1 AND a.status='open' AND (a.planned_date<=? OR a.workout_id IS NOT NULL) ORDER BY a.planned_date,a.planned_time,p.created_at,p.id,a.id`,
    [today],
  )
  const savedRoutineIds = (
    await db.queryAll<{ id: string }>('SELECT id FROM saved_routines ORDER BY name,id')
  ).map((row) => row.id)
  for (const a of appointments)
    result.push({
      kind: 'appointment',
      id: String(a['id']),
      planId: String(a['plan_id']),
      planName: String(a['plan_name']),
      title: String(a['routine_name']),
      explanation: a['workout_id']
        ? 'Linked unfinished workout is protected.'
        : String(a['planned_date']) < today
          ? 'Overdue commitment; resolve, postpone or start.'
          : 'Scheduled commitment for today.',
      date: String(a['planned_date']),
      time: a['planned_time'] == null ? null : String(a['planned_time']),
      routineId: String(a['routine_id']),
      workoutId: a['workout_id'] == null ? null : String(a['workout_id']),
      rotationId: null,
      generation: null,
      progress: null,
      alternatives: savedRoutineIds.filter((id) => id !== String(a['routine_id'])),
    })
  await appendRotationItems(db, result)
  await appendGoalItems(db, today, result)
  return result
}

async function appendRotationItems(db: DbAdapter, result: OrganizationTodayItem[]): Promise<void> {
  const rotations = await db.queryAll<{
    id: string
    plan_id: string
    plan_name: string
    name: string
    routine_ids_json: string
    position: number
    generation: number
  }>(
    'SELECT r.*,p.name AS plan_name FROM organization_rotations r JOIN training_plans p ON p.id=r.plan_id WHERE p.active=1 ORDER BY p.created_at,p.id,r.id',
  )
  for (const r of rotations) {
    const routineIds: unknown = JSON.parse(r.routine_ids_json)
    if (
      !Array.isArray(routineIds) ||
      !routineIds.every((id): id is string => typeof id === 'string')
    )
      throw new Error('Rotation contains invalid routine identities')
    const routineId = routineIds[r.position % routineIds.length]
    if (!routineId) throw new Error('Rotation has no current routine')
    const routine = await db.queryOne<{ name: string }>(
      'SELECT name FROM saved_routines WHERE id=?',
      [routineId],
    )
    result.push({
      kind: 'rotation',
      id: r.id,
      planId: r.plan_id,
      planName: r.plan_name,
      title: routine?.name ?? r.name,
      explanation: `Current rotation item in ${r.name}; finish this linked session or explicitly skip to advance.`,
      date: null,
      time: null,
      routineId,
      workoutId: null,
      rotationId: r.id,
      generation: r.generation,
      progress: null,
      alternatives: routineIds.filter((id) => id !== routineId),
    })
  }
}

async function appendGoalItems(
  db: DbAdapter,
  today: string,
  result: OrganizationTodayItem[],
): Promise<void> {
  const goals = await db.queryAll<{
    id: string
    plan_id: string
    plan_name: string
    name: string
    target_count: number
  }>(
    'SELECT g.id,g.plan_id,p.name AS plan_name,g.name,g.target_count FROM organization_goals g JOIN training_plans p ON p.id=g.plan_id WHERE p.active=1 AND g.active=1 ORDER BY p.created_at,p.id,g.id',
  )
  for (const goal of goals) {
    const count =
      (
        await db.queryOne<{ n: number }>(
          'SELECT COUNT(*) AS n FROM organization_goal_credits WHERE goal_id=? AND week_start=?',
          [goal.id, monday(today)],
        )
      )?.n ?? 0
    if (count < goal.target_count)
      result.push({
        kind: 'goal',
        id: goal.id,
        planId: goal.plan_id,
        planName: goal.plan_name,
        title: goal.name,
        explanation: `${count} of ${goal.target_count} qualifying workouts this Monday–Sunday week.`,
        date: null,
        time: null,
        routineId: null,
        workoutId: null,
        rotationId: null,
        generation: null,
        progress: count,
        alternatives: [],
      })
  }
}
async function qualifyingWork(db: DbAdapter, workoutId: string): Promise<boolean> {
  const row = await db.queryOne<{ n: number }>(
    `SELECT
    (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id
      JOIN exercises e ON e.id=we.exercise_id WHERE we.workout_id=? AND s.completed=1 AND we.removed_at IS NULL AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id)
      AND ((we.logging_mode='strength' AND s.is_warmup=0 AND s.reps IS NOT NULL)
        OR (we.logging_mode<>'strength' AND (COALESCE(s.duration_sec,0)>0 OR COALESCE(s.distance_m,0)>0))))
    + (SELECT COUNT(*) FROM runs WHERE workout_id=? AND (COALESCE(distance_m,0)>0 OR COALESCE(duration_sec,0)>0)) AS n`,
    [workoutId, workoutId],
  )
  return (row?.n ?? 0) > 0
}
async function matchesFilter(
  db: DbAdapter,
  workoutId: string,
  filter: OrganizationFilter,
): Promise<boolean> {
  const dimensions: boolean[] = []
  if (filter.sessionTypes.length) {
    const row = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM workouts WHERE id=? AND session_type IN (${filter.sessionTypes.map(() => '?').join(',')})`,
      [workoutId, ...filter.sessionTypes],
    )
    dimensions.push((row?.n ?? 0) > 0)
  }
  if (filter.exerciseIds.length) {
    const row = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id JOIN workouts w ON w.id=we.workout_id WHERE w.id=? AND we.removed_at IS NULL AND we.exercise_id IN (${filter.exerciseIds.map(() => '?').join(',')}) AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id=we.id AND s.completed=1 AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id) AND ((we.logging_mode='strength' AND s.is_warmup=0 AND s.reps IS NOT NULL) OR (we.logging_mode<>'strength' AND (COALESCE(s.duration_sec,0)>0 OR COALESCE(s.distance_m,0)>0))))`,
      [workoutId, ...filter.exerciseIds],
    )
    dimensions.push((row?.n ?? 0) > 0)
  }
  if (filter.movementPatterns.length) {
    const row = await db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id JOIN workouts w ON w.id=we.workout_id WHERE w.id=? AND we.removed_at IS NULL AND e.movement IN (${filter.movementPatterns.map(() => '?').join(',')}) AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id=we.id AND s.completed=1 AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id) AND ((we.logging_mode='strength' AND s.is_warmup=0 AND s.reps IS NOT NULL) OR (we.logging_mode<>'strength' AND (COALESCE(s.duration_sec,0)>0 OR COALESCE(s.distance_m,0)>0))))`,
      [workoutId, ...filter.movementPatterns],
    )
    dimensions.push((row?.n ?? 0) > 0)
  }
  return dimensions.every(Boolean)
}
export async function organizationCreditPreview(
  db: DbAdapter,
  input: unknown,
): Promise<OrganizationCreditPreview> {
  const p = isRecord(input) ? input : {}
  const workoutId = text(p['workoutId'], 'Workout')
  const workout = await db.queryOne<{ ended_at: string | null }>(
    'SELECT ended_at FROM workouts WHERE id=?',
    [workoutId],
  )
  const qualifies = Boolean(workout?.ended_at && (await qualifyingWork(db, workoutId)))
  const link = await db.queryOne<{ appointment_id: string | null; rotation_id: string | null }>(
    'SELECT appointment_id,rotation_id FROM organization_source_links WHERE workout_id=?',
    [workoutId],
  )
  const appointment =
    qualifies && link?.appointment_id
      ? await db.queryOne<{ id: string }>(
          "SELECT id FROM organization_appointments WHERE id=? AND ((status='open' AND workout_id IS NULL) OR (status IN ('open','fulfilled') AND workout_id=?))",
          [link.appointment_id, workoutId],
        )
      : null
  const appointmentIds = appointment ? [appointment.id] : []
  const goals: string[] = []
  if (qualifies) {
    const definitions = await db.queryAll<{ id: string; filter_json: string }>(
      'SELECT id,filter_json FROM organization_goals WHERE active=1',
    )
    for (const goal of definitions)
      if (await matchesFilter(db, workoutId, parseFilter(JSON.parse(goal.filter_json) as unknown)))
        goals.push(goal.id)
  }
  return {
    qualifies,
    appointmentIds,
    rotationId: qualifies ? (link?.rotation_id ?? null) : null,
    goalIds: goals,
  }
}
interface ReportSet {
  exercise_id: string
  exercise_name: string
  equipment: string
  equipment_sub: string
  movement: string | null
  muscles: string
  muscles_sec: string
  logging_mode: string
  completed: number
  is_warmup: number
  weight_kg: number | null
  reps: number | null
  distance_m: number | null
  duration_sec: number | null
}

type ActivityTotals = Map<string, { distanceM: number; durationSec: number; items: number }>

function addActivityTotals(
  activities: ActivityTotals,
  mode: string,
  distance: number | null,
  duration: number | null,
): void {
  const item = activities.get(mode) ?? { distanceM: 0, durationSec: 0, items: 0 }
  item.distanceM += distance ?? 0
  item.durationSec += duration ?? 0
  item.items++
  activities.set(mode, item)
}

function musclesFrom(source: string): string[] {
  const value: unknown = JSON.parse(source || '[]')
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
      ),
    ),
  ]
}

function incrementMuscleCounts(counts: Map<string, number>, muscles: string[]): void {
  for (const muscle of muscles) counts.set(muscle, (counts.get(muscle) ?? 0) + 1)
}

function reportMeasurements(
  sets: ReportSet[],
  runs: Array<{ distance_m: number | null; duration_sec: number | null }>,
): Pick<
  OrganizationReport,
  | 'workingSets'
  | 'exerciseTonnage'
  | 'movementPatterns'
  | 'primaryMuscles'
  | 'secondaryMuscles'
  | 'unclassifiedSets'
  | 'activities'
> {
  let workingSets = 0
  let unclassifiedSets = 0
  const movement = new Map<string, number>()
  const primary = new Map<string, number>()
  const secondary = new Map<string, number>()
  const activities: ActivityTotals = new Map()
  const tonnage = new Map<string, OrganizationReport['exerciseTonnage'][number]>()
  for (const set of sets) {
    if (set.completed !== 1) continue
    if (set.logging_mode !== 'strength') {
      if (Number(set.distance_m) > 0 || Number(set.duration_sec) > 0)
        addActivityTotals(activities, set.logging_mode, set.distance_m, set.duration_sec)
      continue
    }
    if (set.is_warmup === 1 || set.reps === null) continue
    workingSets++
    const pattern = set.movement || 'Unclassified'
    movement.set(pattern, (movement.get(pattern) ?? 0) + 1)
    const muscles = musclesFrom(set.muscles)
    const secondaryMuscles = musclesFrom(set.muscles_sec)
    if (!muscles.length) unclassifiedSets++
    incrementMuscleCounts(primary, muscles)
    incrementMuscleCounts(secondary, secondaryMuscles)
    addExerciseTonnage(tonnage, set)
  }
  for (const run of runs) addActivityTotals(activities, 'run', run.distance_m, run.duration_sec)
  return {
    workingSets,
    exerciseTonnage: [...tonnage.values()],
    movementPatterns: [...movement].map(([pattern, count]) => ({ pattern, sets: count })),
    primaryMuscles: [...primary].map(([muscle, count]) => ({ muscle, sets: count })),
    secondaryMuscles: [...secondary].map(([muscle, count]) => ({ muscle, sets: count })),
    unclassifiedSets,
    activities: [...activities].map(([mode, item]) => ({ mode, ...item })),
  }
}

function addExerciseTonnage(
  tonnage: Map<string, OrganizationReport['exerciseTonnage'][number]>,
  set: ReportSet,
): void {
  if (set.weight_kg === null || set.reps === null || set.reps <= 0) return
  const key = `${set.exercise_id}\\u0000${set.equipment_sub}`
  const item = tonnage.get(key) ?? {
    exerciseId: set.exercise_id,
    exerciseName: set.exercise_name,
    equipment: `${set.equipment}/${set.equipment_sub}`,
    tonnageKgReps: 0,
    sets: 0,
  }
  item.tonnageKgReps += set.weight_kg * set.reps
  item.sets++
  tonnage.set(key, item)
}

async function report(db: DbAdapter, input: unknown): Promise<OrganizationReport> {
  const p = isRecord(input) ? input : {}
  const start = date(p['startDate'], 'Start date')
  const end = date(p['endDate'], 'End date')
  const today = date(p['today'] ?? localToday())
  if (end < start) throw new Error('End date precedes start date')
  const [appointments, sets, runs, goals] = await Promise.all([
    db.queryAll<{
      id: string
      status: Appointment['status']
      postponed: number
      original_date: string
      planned_date: string
      workout_date: string | null
    }>(
      'SELECT a.id,a.status,a.postponed,a.original_date,a.planned_date,w.date AS workout_date FROM organization_appointments a LEFT JOIN workouts w ON w.id=a.workout_id WHERE (a.original_date BETWEEN ? AND ? OR a.planned_date BETWEEN ? AND ?)',
      [start, end, start, end],
    ),
    db.queryAll<ReportSet>(
      'SELECT we.exercise_id,e.name AS exercise_name,e.equipment,e.equipment_sub,e.movement,e.muscles,e.muscles_sec,we.logging_mode,s.completed,s.is_warmup,s.weight_kg,s.reps,s.distance_m,s.duration_sec FROM sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id JOIN exercises e ON e.id=we.exercise_id WHERE w.ended_at IS NOT NULL AND w.date BETWEEN ? AND ? AND we.removed_at IS NULL AND s.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM workout_set_skips WHERE set_id=s.id)',
      [start, end],
    ),
    db.queryAll<{ run_type: string; distance_m: number | null; duration_sec: number | null }>(
      'SELECT r.run_type,r.distance_m,r.duration_sec FROM runs r JOIN workouts w ON w.id=r.workout_id WHERE w.ended_at IS NOT NULL AND w.date BETWEEN ? AND ?',
      [start, end],
    ),
    db.queryAll<{ id: string; name: string; target_count: number }>(
      'SELECT g.id,g.name,g.target_count FROM organization_goals g JOIN training_plans p ON p.id=g.plan_id WHERE g.active=1 AND p.active=1',
    ),
  ])
  const commitments: OrganizationReport['commitments'] = {
    open: 0,
    fulfilled: 0,
    skipped: 0,
    postponed: 0,
    overdue: 0,
  }
  const commitmentTiming = appointments.map((item) => {
    commitments[item.status]++
    if (item.postponed) commitments.postponed++
    const overdue = item.status === 'open' && item.planned_date < today
    if (overdue) commitments.overdue++
    return {
      id: item.id,
      status: item.status,
      originalDate: item.original_date,
      plannedDate: item.planned_date,
      performedDate: item.workout_date,
      postponed: item.postponed === 1,
      overdue,
    }
  })
  const measurements = reportMeasurements(sets, runs)
  const weeklyGoals: OrganizationReport['weeklyGoals'] = []
  for (const goal of goals) {
    for (let weekStart = monday(start); weekStart <= end; weekStart = addDays(weekStart, 7)) {
      const count =
        (
          await db.queryOne<{ n: number }>(
            'SELECT COUNT(*) AS n FROM organization_goal_credits WHERE goal_id=? AND week_start=?',
            [goal.id, weekStart],
          )
        )?.n ?? 0
      weeklyGoals.push({
        id: goal.id,
        name: goal.name,
        weekStart,
        count,
        target: goal.target_count,
      })
    }
  }
  return {
    commitments,
    commitmentTiming,
    weeklyGoals,
    ...measurements,
  }
}

export async function startOrganization(
  db: DbAdapter,
  workoutId: string,
  selection: {
    appointmentId?: string
    rotationId?: string
    rotationGeneration?: number
    routineId?: string
  },
): Promise<void> {
  const workout = await db.queryOne<{ id: string; ended_at: string | null }>(
    'SELECT id,ended_at FROM workouts WHERE id=?',
    [workoutId],
  )
  if (!workout || workout.ended_at)
    throw new Error('Organization can only link to an active workout')
  if (selection.appointmentId && selection.rotationId)
    throw new Error('A workout may select one organization source')
  if (selection.appointmentId) {
    const target = await appointmentRow(db, selection.appointmentId)
    if (!selection.routineId || selection.routineId !== target.routineId)
      throw new Error('Appointment must match the explicitly started saved routine')
    if (target.status !== 'open' || target.workoutId) throw new Error('Appointment is unavailable')
    await db.exec(
      "UPDATE organization_appointments SET workout_id=? WHERE id=? AND status='open' AND workout_id IS NULL",
      [workoutId, target.id],
    )
    const linked = await db.queryOne<{ id: string }>(
      'SELECT id FROM organization_appointments WHERE id=? AND workout_id=?',
      [target.id, workoutId],
    )
    if (!linked) throw new Error('Appointment was claimed by another workout')
    await db.exec(
      'INSERT INTO organization_source_links(workout_id,appointment_id) VALUES(?,?) ON CONFLICT(workout_id) DO UPDATE SET appointment_id=excluded.appointment_id,rotation_id=NULL,rotation_generation=NULL',
      [workoutId, target.id],
    )
  } else if (selection.rotationId) {
    const generation = selection.rotationGeneration
    const rotation = await db.queryOne<{
      routine_ids_json: string
      position: number
      generation: number
    }>('SELECT * FROM organization_rotations WHERE id=?', [selection.rotationId])
    if (!rotation || !Number.isSafeInteger(generation) || rotation.generation !== generation)
      throw new Error('Rotation changed; refresh before starting')
    const routineIds = JSON.parse(rotation.routine_ids_json) as string[]
    if (
      !selection.routineId ||
      selection.routineId !== routineIds[rotation.position % routineIds.length]
    )
      throw new Error('Rotation item must match the explicitly started saved routine')
    await db.exec(
      'INSERT INTO organization_source_links(workout_id,rotation_id,rotation_generation) VALUES(?,?,?) ON CONFLICT(workout_id) DO UPDATE SET appointment_id=NULL,rotation_id=excluded.rotation_id,rotation_generation=excluded.rotation_generation',
      [workoutId, selection.rotationId, generation],
    )
  }
}
export async function finishOrganization(db: DbAdapter, workoutId: string): Promise<void> {
  const workout = await db.queryOne<{ date: string; ended_at: string | null }>(
    'SELECT date,ended_at FROM workouts WHERE id=?',
    [workoutId],
  )
  if (!workout?.ended_at) return
  const preview = await organizationCreditPreview(db, { workoutId })
  if (!preview.qualifies) {
    await db.exec(
      "UPDATE organization_appointments SET workout_id=NULL WHERE workout_id=? AND status='open'",
      [workoutId],
    )
    return
  }
  for (const goalId of preview.goalIds)
    await db.exec(
      'INSERT OR IGNORE INTO organization_goal_credits(goal_id,workout_id,week_start) VALUES(?,?,?)',
      [goalId, workoutId, monday(workout.date)],
    )
  if (preview.appointmentIds.length)
    await db.exec(
      "UPDATE organization_appointments SET status='fulfilled' WHERE id=? AND workout_id=? AND status='open'",
      [preview.appointmentIds[0], workoutId],
    )
  const link = await db.queryOne<{ rotation_id: string; rotation_generation: number }>(
    'SELECT rotation_id,rotation_generation FROM organization_source_links WHERE workout_id=? AND rotation_id IS NOT NULL',
    [workoutId],
  )
  if (link) {
    const rotation = await db.queryOne<{
      routine_ids_json: string
      position: number
      generation: number
    }>('SELECT * FROM organization_rotations WHERE id=?', [link.rotation_id])
    if (rotation && rotation.generation === link.rotation_generation) {
      const routineIds = JSON.parse(rotation.routine_ids_json) as string[]
      await advanceRotation(
        db,
        link.rotation_id,
        link.rotation_generation,
        (rotation.position + 1) % routineIds.length,
        workoutId,
        'finish',
      )
    }
  }
}
export async function discardOrganization(db: DbAdapter, workoutId: string): Promise<void> {
  const link = await db.queryOne<{ appointment_id: string | null }>(
    'SELECT appointment_id FROM organization_source_links WHERE workout_id=?',
    [workoutId],
  )
  if (link?.appointment_id)
    await db.exec(
      "UPDATE organization_appointments SET workout_id=NULL WHERE id=? AND workout_id=? AND status='open'",
      [link.appointment_id, workoutId],
    )
  await db.exec('DELETE FROM organization_source_links WHERE workout_id=?', [workoutId])
}
export async function recomputeOrganizationCredit(db: DbAdapter, workoutId: string): Promise<void> {
  const preview = await organizationCreditPreview(db, { workoutId })
  const workout = await db.queryOne<{ date: string; ended_at: string | null }>(
    'SELECT date,ended_at FROM workouts WHERE id=?',
    [workoutId],
  )
  await db.exec('DELETE FROM organization_goal_credits WHERE workout_id=?', [workoutId])
  const link = await db.queryOne<{ appointment_id: string | null }>(
    'SELECT appointment_id FROM organization_source_links WHERE workout_id=?',
    [workoutId],
  )
  if (!workout?.ended_at) return
  if (!preview.qualifies) {
    if (link?.appointment_id)
      await db.exec(
        "UPDATE organization_appointments SET status='open',workout_id=NULL WHERE id=? AND workout_id=? AND status IN ('open','fulfilled')",
        [link.appointment_id, workoutId],
      )
    return
  }
  for (const goalId of preview.goalIds)
    await db.exec(
      'INSERT OR IGNORE INTO organization_goal_credits(goal_id,workout_id,week_start) VALUES(?,?,?)',
      [goalId, workoutId, monday(workout.date)],
    )
  if (preview.appointmentIds.length)
    await db.exec(
      "UPDATE organization_appointments SET status='fulfilled',workout_id=? WHERE id=? AND (workout_id IS NULL OR workout_id=?) AND status='open'",
      [workoutId, preview.appointmentIds[0], workoutId],
    )
}
export interface RoutineReferencePlan {
  id: string
  name: string
}

/** Every personal plan that currently refers to a saved routine, independent of active state. */
export async function getRoutineReferencePlans(
  db: DbAdapter,
  routineId: string,
): Promise<RoutineReferencePlan[]> {
  const planIds = new Set<string>()
  const references = await Promise.all([
    db.queryAll<{ plan_id: string }>(
      'SELECT plan_id FROM training_plan_bindings WHERE routine_id=?',
      [routineId],
    ),
    db.queryAll<{ plan_id: string }>(
      'SELECT plan_id FROM organization_recurrence_rules WHERE routine_id=?',
      [routineId],
    ),
    db.queryAll<{ plan_id: string }>(
      'SELECT plan_id FROM organization_appointments WHERE routine_id=?',
      [routineId],
    ),
    db.queryAll<{ plan_id: string; routine_ids_json: string }>(
      'SELECT plan_id,routine_ids_json FROM organization_rotations',
    ),
  ])
  for (const rows of references.slice(0, 3)) {
    for (const row of rows) planIds.add(row.plan_id)
  }
  const rotations = references[3]
  if (!rotations) throw new Error('Rotation references could not be loaded')
  for (const rotation of rotations) {
    const routineIds: unknown = JSON.parse(rotation.routine_ids_json)
    if (!Array.isArray(routineIds) || routineIds.some((id) => typeof id !== 'string')) {
      throw new Error(`Rotation ${rotation.plan_id} has invalid routine references`)
    }
    if (routineIds.includes(routineId)) planIds.add(rotation.plan_id)
  }
  if (!planIds.size) return []
  const plans = await db.queryAll<{ id: string; name: string }>(
    `SELECT id,name FROM training_plans WHERE id IN (${[...planIds].map(() => '?').join(',')}) ORDER BY created_at,id`,
    [...planIds],
  )
  return plans
}

export function isOrganizationOperation(value: string): value is OrganizationOperation {
  return (ORGANIZATION_OPERATIONS as readonly string[]).includes(value)
}
export function dispatchOrganization<K extends OrganizationOperation>(
  db: DbAdapter,
  type: K,
  input: OrganizationOperationMap[K]['payload'],
): Promise<OrganizationOperationMap[K]['result']>
export function dispatchOrganization(
  db: DbAdapter,
  type: OrganizationOperation,
  input: unknown,
): Promise<unknown>
export function dispatchOrganization(
  db: DbAdapter,
  type: OrganizationOperation,
  input: unknown,
): Promise<unknown> {
  if (!isOrganizationOperation(type))
    return Promise.reject(new Error(`Unknown organization operation: ${type}`))
  return operations[type](db, input)
}
