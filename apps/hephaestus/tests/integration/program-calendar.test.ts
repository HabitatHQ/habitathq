import { isUuidV7 } from '@palladium/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchTransfer, type PortableBundle } from '~/lib/data-transfer'
import { dispatchOrganization } from '../../app/lib/organization-storage'
import { dispatchPrescriptionOperation } from '../../app/lib/prescription-storage'
import { dispatchWorkout } from '../../app/lib/workout-storage'
import type {
  ProgramDesign,
  ProgramSlot,
  SerializablePrescription,
} from '../../app/types/prescription'
import { createTestDb, type TestDb } from './helpers/db'

let raw: TestDb
let db: DbAdapter
const today = '2026-03-11'

function bindings(
  values: unknown[] | undefined,
): (string | number | null | Uint8Array)[] | undefined {
  return values?.map((value) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null ||
      value instanceof Uint8Array
    )
      return value
    throw new Error('Unsupported SQLite test binding')
  })
}
beforeEach(async () => {
  raw = await createTestDb()
  db = {
    queryAll: async <T>(sql: string, bind?: unknown[]) => raw.query<T>(sql, bindings(bind)),
    queryOne: async <T>(sql: string, bind?: unknown[]) =>
      raw.query<T>(sql, bindings(bind))[0] ?? null,
    exec: async (sql: string, bind?: unknown[]) => raw.exec(sql, bindings(bind)),
    transaction: async <T>(operation: (tx: DbAdapter) => Promise<T>) => {
      raw.exec('BEGIN')
      try {
        const result = await operation(db)
        raw.exec('COMMIT')
        return result
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${today}T12:00:00`))
})
afterEach(() => {
  vi.useRealTimers()
  raw.close()
})

function design(slots: ProgramSlot[]): ProgramDesign {
  return {
    schemaVersion: 1,
    weeks: 2,
    weekProgression: [1, 2].map((week) => ({
      week,
      progression: {
        intensityModifier: 1,
        volumeModifier: 1,
        isDeload: false,
        phase: null,
        legacyCurrentWeek: null,
      },
    })),
    slots,
  }
}
async function fixture() {
  const exerciseId = crypto.randomUUID()
  raw.exec(
    'INSERT INTO exercises(id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [
      exerciseId,
      'Squat',
      `squat-${exerciseId}`,
      'barbell',
      'barbell',
      'squat',
      '["quadriceps"]',
      '[]',
      `${today}T12:00:00`,
    ],
  )
  const prescription: SerializablePrescription = {
    schemaVersion: 1,
    evaluatorVersion: 'unresolved-v1',
    inputs: [],
    defaults: { incrementKg: 2.5, restSec: 90 },
    groups: [],
    activities: [
      {
        id: crypto.randomUUID(),
        exerciseId,
        order: 1,
        loggingMode: 'strength',
        executionGroupId: null,
        sets: [
          {
            id: crypto.randomUUID(),
            order: 1,
            role: 'working',
            reps: {
              kind: 'exact',
              value: { id: crypto.randomUUID(), rule: { kind: 'fixed', value: 8 } },
            },
            weightKg: { id: crypto.randomUUID(), rule: { kind: 'fixed', value: 90 } },
            restSec: null,
            rpe: null,
            rir: null,
            notes: null,
            legacyScheme: null,
          },
        ],
        targets: { durationSec: null, distanceM: null },
        notes: null,
      },
    ],
    provenance: {
      kind: 'authored',
      migratedAt: null,
      legacyTemplateId: null,
      unresolvedFields: [],
    },
  }
  const template = await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'TEMPLATE_CREATE', {
      name: 'Squat recipe',
      description: null,
      prescription,
    }),
  )
  const routine = await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'ROUTINE_SAVE', {
      name: 'Saved squat',
      templateId: template.templateId,
      templateRevisionId: template.id,
      inputs: {},
      fixedTargetValues: {},
      continuationPolicy: 'calendar_bound',
      deferralMode: null,
    }),
  )
  const slots: ProgramSlot[] = [1, 2, 3].map((day) => ({
    id: crypto.randomUUID(),
    templateId: template.templateId,
    templateRevisionId: template.id,
    assignmentResolved: true,
    week: 1,
    day,
    label: `Day ${day}`,
    progression: {
      intensityModifier: 1,
      volumeModifier: 1,
      isDeload: false,
      phase: null,
      legacyCurrentWeek: null,
    },
  }))
  const program = await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'PROGRAM_CREATE', {
      name: 'Two-week Program',
      description: null,
      design: design(slots),
    }),
  )
  const plan = await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_SAVE', {
      name: 'Wednesday plan',
      programId: program.programId,
      adoptedProgramRevisionId: null,
      startLocalDate: today,
      active: true,
      bindings: [],
    }),
  )
  const choices = Object.fromEntries(slots.map((slot) => [slot.id, routine.routineId]))
  const preview = await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION', {
      planId: plan.id,
      programRevisionId: program.id,
      routineBindings: choices,
    }),
  )
  await db.transaction((tx) =>
    dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_APPLY_PROGRAM_ADOPTION', {
      previewId: preview.previewId,
    }),
  )
  return { template, routine, slots, program, plan, choices }
}

describe('reviewed Program calendar adoption', () => {
  it('rejects a logical slot reused by unrelated Programs', async () => {
    const source = await fixture()
    await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'PROGRAM_CREATE', {
        name: 'Unrelated Program',
        description: null,
        design: source.program.design,
      }),
    )
    const bundle = await dispatchTransfer(db, 'TRANSFER_EXPORT_PORTABLE', {})
    expect(
      await dispatchTransfer(db, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', { bundle }),
    ).toMatchObject({ valid: false, error: expect.stringContaining('multiple Programs') })
  })

  it('ports goal-only exercises and remaps catalog and custom filters across installations', async () => {
    const source = await fixture()
    const exerciseId = source.template.prescription.activities[0]?.exerciseId
    if (!exerciseId) throw new Error('Missing fixture exercise')
    const catalog = raw.query<{ slug: string }>('SELECT slug FROM exercises WHERE id=?', [
      exerciseId,
    ])[0]
    if (!catalog) throw new Error('Missing catalog exercise')
    const customId = crypto.randomUUID()
    raw.exec(
      'INSERT INTO exercises(id,name,slug,equipment,movement,is_custom,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        customId,
        'Goal-only exercise',
        'goal-only',
        'bodyweight',
        'isolation',
        1,
        `${today}T12:00:00`,
      ],
    )
    for (const [name, id] of [
      ['Catalog goal', exerciseId],
      ['Custom goal', customId],
    ] as const)
      await dispatchOrganization(db, 'ORGANIZATION_GOAL_SAVE', {
        planId: source.plan.id,
        name,
        targetCount: 1,
        filter: { sessionTypes: [], exerciseIds: [id], movementPatterns: [] },
      })
    const bundle = (await dispatchTransfer(db, 'TRANSFER_EXPORT_PORTABLE', {})) as PortableBundle
    expect(bundle.tables['exercises']?.map((row) => row['id']).sort()).toEqual(
      [exerciseId, customId].sort(),
    )
    const destinationRaw = await createTestDb()
    const destination: DbAdapter = {
      queryAll: async <T>(sql: string, bind?: unknown[]) =>
        destinationRaw.query<T>(sql, bindings(bind)),
      queryOne: async <T>(sql: string, bind?: unknown[]) =>
        destinationRaw.query<T>(sql, bindings(bind))[0] ?? null,
      exec: async (sql: string, bind?: unknown[]) => destinationRaw.exec(sql, bindings(bind)),
      transaction: async <T>(operation: (tx: DbAdapter) => Promise<T>) => {
        destinationRaw.exec('BEGIN')
        try {
          const result = await operation(destination)
          destinationRaw.exec('COMMIT')
          return result
        } catch (error) {
          destinationRaw.exec('ROLLBACK')
          throw error
        }
      },
    }
    try {
      const destinationExercise = crypto.randomUUID()
      destinationRaw.exec(
        'INSERT INTO exercises(id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          destinationExercise,
          'Squat',
          catalog.slug,
          'barbell',
          'barbell',
          'squat',
          '["quadriceps"]',
          '[]',
          `${today}T12:00:00`,
        ],
      )
      await dispatchTransfer(destination, 'TRANSFER_IMPORT_PORTABLE', { bundle })
      await dispatchTransfer(destination, 'TRANSFER_IMPORT_PORTABLE', { bundle })
      const currentDestinationExercise = destinationRaw.query<{ id: string }>(
        'SELECT id FROM exercises WHERE slug=?',
        [catalog.slug],
      )[0]?.id
      expect(currentDestinationExercise).not.toBe(destinationExercise)
      expect(isUuidV7(currentDestinationExercise ?? '')).toBe(true)
      const goals = destinationRaw.query<{ id: string; name: string; filter_json: string }>(
        'SELECT id,name,filter_json FROM organization_goals ORDER BY name,id',
      )
      const catalogGoals = goals.filter((goal) => goal.name === 'Catalog goal')
      const customGoals = goals.filter((goal) => goal.name === 'Custom goal')
      expect(catalogGoals).toHaveLength(2)
      for (const goal of catalogGoals)
        expect(JSON.parse(goal.filter_json).exerciseIds).toEqual([currentDestinationExercise])
      const customFilters = customGoals.map((goal) => JSON.parse(goal.filter_json).exerciseIds[0])
      expect(customFilters).toHaveLength(2)
      expect(new Set(customFilters).size).toBe(2)
      for (const id of customFilters) {
        expect(id).not.toBe(customId)
        expect(destinationRaw.query('SELECT name FROM exercises WHERE id=?', [id])).toEqual([
          { name: 'Goal-only exercise' },
        ])
      }
      const routine = destinationRaw.query<{ id: string }>(
        'SELECT id FROM saved_routines LIMIT 1',
      )[0]
      if (!routine) throw new Error('Missing imported routine')
      const session = await destination.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_START', {
          id: crypto.randomUUID(),
          now: `${today}T12:00:00Z`,
          routineId: routine.id,
        }),
      )
      const draft = session.sets[0]
      if (!draft) throw new Error('Missing prescribed set')
      await destination.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_LOG_SET', {
          set: { ...draft, weight_kg: 90, reps: 8, completed: 1, logged_at: `${today}T12:30:00Z` },
        }),
      )
      await destination.transaction((tx) =>
        dispatchWorkout(tx, 'WORKOUT_FINISH', {
          workoutId: session.workout.id,
          endedAt: `${today}T13:00:00Z`,
          options: {},
        }),
      )
      const credit = await dispatchOrganization(destination, 'ORGANIZATION_CREDIT_PREVIEW', {
        workoutId: session.workout.id,
      })
      expect(credit.goalIds.sort()).toEqual(catalogGoals.map((goal) => goal.id).sort())
    } finally {
      destinationRaw.close()
    }
  })

  it('restores revision history and imports stable slots independently without breaking bindings', async () => {
    const state = await fixture()
    await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'PROGRAM_EDIT', {
        programId: state.program.programId,
        expectedRevisionId: state.program.id,
        name: 'Revised Program',
        description: null,
        design: {
          ...state.program.design,
          slots: state.program.design.slots.map((slot) => ({ ...slot, label: 'Updated day' })),
        },
      }),
    )
    const backup = await dispatchTransfer(db, 'TRANSFER_EXPORT_BACKUP', {
      settings: {
        theme: 'forge',
        weightUnit: 'kg',
        distanceUnit: 'km',
        use24HourTime: false,
        reduceMotion: false,
        defaultRestSeconds: 120,
        showRpe: true,
        showRir: false,
        warmupRamps: [40, 60, 80],
        showWarmupSuggestions: true,
        showFailurePrompt: true,
        showSessionNotes: true,
        showSetSchemes: false,
        showVariableRest: false,
        showSupersets: false,
      },
    })
    expect(await dispatchTransfer(db, 'TRANSFER_PREVIEW_RESTORE', { backup })).toMatchObject({
      valid: true,
    })
    await dispatchTransfer(db, 'TRANSFER_RESTORE_BACKUP', { backup })
    const bundle = (await dispatchTransfer(db, 'TRANSFER_EXPORT_PORTABLE', {})) as PortableBundle
    expect(
      await dispatchTransfer(db, 'TRANSFER_PREVIEW_PORTABLE_IMPORT', { bundle }),
    ).toMatchObject({ valid: true })
    await dispatchTransfer(db, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    await dispatchTransfer(db, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    const plans = raw.query<{ id: string; program_id: string }>(
      'SELECT id,program_id FROM training_plans WHERE id<>?',
      [state.plan.id],
    )
    expect(plans).toHaveLength(2)
    const importedSlotIdentities: string[] = []
    for (const plan of plans) {
      const revisions = raw.query<{ design_json: string }>(
        'SELECT design_json FROM program_revisions WHERE program_id=? ORDER BY revision_num',
        [plan.program_id],
      )
      const designs = revisions.map((row) => JSON.parse(row.design_json) as ProgramDesign)
      expect(designs).toHaveLength(2)
      const firstSlots = designs[0]?.slots.map((slot) => slot.id)
      expect(designs[1]?.slots.map((slot) => slot.id)).toEqual(firstSlots)
      expect(firstSlots).toHaveLength(3)
      for (const slotId of firstSlots ?? []) {
        expect(state.slots.map((slot) => slot.id)).not.toContain(slotId)
        expect(importedSlotIdentities).not.toContain(slotId)
        importedSlotIdentities.push(slotId)
      }
      const bindings = raw.query<{ program_slot_id: string }>(
        'SELECT program_slot_id FROM training_plan_bindings WHERE plan_id=?',
        [plan.id],
      )
      expect(bindings.map((binding) => binding.program_slot_id).sort()).toEqual(
        [...(firstSlots ?? [])].sort(),
      )
    }
  })

  it('ports a selected template with its Program, routine, personal plan and independent appointments', async () => {
    const state = await fixture()
    const originalAppointments = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', {
      planId: state.plan.id,
    })
    const bundle = (await dispatchTransfer(db, 'TRANSFER_EXPORT_PORTABLE', {
      templateId: state.template.templateId,
    })) as PortableBundle
    expect(bundle.tables['training_plans']).toEqual([
      expect.objectContaining({ id: state.plan.id }),
    ])
    await dispatchTransfer(db, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    await dispatchTransfer(db, 'TRANSFER_IMPORT_PORTABLE', { bundle })
    const importedPlans = raw.query<{
      id: string
      program_id: string
      adopted_program_revision_id: string
    }>('SELECT id, program_id, adopted_program_revision_id FROM training_plans WHERE id != ?', [
      state.plan.id,
    ])
    expect(importedPlans).toHaveLength(2)
    const routineIds: string[] = []
    for (const plan of importedPlans) {
      expect(plan.program_id).not.toBe(state.program.programId)
      const importedProgram = await dispatchPrescriptionOperation(db, 'PROGRAM_GET_REVISION', {
        programId: plan.program_id,
      })
      expect(importedProgram.id).toBe(plan.adopted_program_revision_id)
      const appointments = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', {
        planId: plan.id,
      })
      expect(appointments.map((item) => item.plannedDate).sort()).toEqual([
        '2026-03-11',
        '2026-03-12',
        '2026-03-13',
      ])
      const bindings = raw.query<{
        routine_id: string
        program_slot_id: string
        template_id: string
      }>(
        'SELECT routine_id, program_slot_id, template_id FROM training_plan_bindings WHERE plan_id=?',
        [plan.id],
      )
      expect(bindings).toHaveLength(3)
      const routineId = bindings[0]?.routine_id
      if (!routineId) throw new Error('Missing imported routine')
      routineIds.push(routineId)
      expect(routineId).not.toBe(state.routine.routineId)
      for (const binding of bindings) {
        expect(importedProgram.design.slots).toContainEqual(
          expect.objectContaining({
            id: binding.program_slot_id,
            templateId: binding.template_id,
          }),
        )
        expect(appointments).toContainEqual(
          expect.objectContaining({
            sourceId: binding.program_slot_id,
            routineId,
            workoutId: null,
          }),
        )
      }
      const routine = await dispatchPrescriptionOperation(db, 'ROUTINE_GET', { routineId })
      expect(routine.routine.templateId).toBe(bindings[0]?.template_id)
      expect(routine.revision.prescription.activities[0]?.sets[0]?.weightKg).toMatchObject({
        resolvedValue: 90,
      })
    }
    expect(new Set(routineIds).size).toBe(2)
    expect(
      await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', { planId: state.plan.id }),
    ).toEqual(originalAppointments)
  })

  it('uses Wednesday-anchored weeks and changes only reviewed future unstarted appointments', async () => {
    const state = await fixture()
    const appointments = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', {
      planId: state.plan.id,
    })
    const current = appointments.find((appointment) => appointment.sourceId === state.slots[0]?.id)
    const future = appointments.find((appointment) => appointment.sourceId === state.slots[1]?.id)
    const protectedAppointment = appointments.find(
      (appointment) => appointment.sourceId === state.slots[2]?.id,
    )
    if (!current || !future || !protectedAppointment || !state.slots[1])
      throw new Error('Missing Program appointments')
    const workoutId = crypto.randomUUID()
    await db.transaction((tx) =>
      dispatchWorkout(tx, 'WORKOUT_START', {
        id: workoutId,
        now: `${today}T12:00:00`,
        routineId: state.routine.routineId,
        options: { sessionType: 'gym', appointmentId: protectedAppointment.id },
      }),
    )
    const updatedSlot = { ...state.slots[1], day: 5 }
    const next = await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'PROGRAM_EDIT', {
        programId: state.program.programId,
        expectedRevisionId: state.program.id,
        name: 'Two-week Program',
        description: null,
        design: design([updatedSlot]),
      }),
    )
    const preview = await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION', {
        planId: state.plan.id,
        programRevisionId: next.id,
        routineBindings: { [updatedSlot.id]: state.routine.routineId },
      }),
    )
    expect(preview.calendar.changes).toEqual([
      expect.objectContaining({
        appointmentId: future.id,
        previousDate: '2026-03-12',
        plannedDate: '2026-03-15',
      }),
    ])
    await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_APPLY_PROGRAM_ADOPTION', {
        previewId: preview.previewId,
      }),
    )
    const result = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', {
      planId: state.plan.id,
    })
    expect(result.find((appointment) => appointment.id === future.id)?.plannedDate).toBe(
      '2026-03-15',
    )
    expect(result.find((appointment) => appointment.id === current.id)).toEqual(current)
    expect(result.find((appointment) => appointment.id === protectedAppointment.id)).toMatchObject({
      plannedDate: '2026-03-13',
      workoutId,
    })
    expect(
      await dispatchOrganization(db, 'ORGANIZATION_PROGRAM_WEEK', {
        planId: state.plan.id,
        date: '2026-03-18',
      }),
    ).toEqual({ week: 2, weekStart: '2026-03-18', weekEnd: '2026-03-24' })
  })

  it('rejects a calendar review after explicit postponement without changing adoption or appointments', async () => {
    const state = await fixture()
    const appointments = await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_LIST', {
      planId: state.plan.id,
    })
    const future = appointments.find((appointment) => appointment.plannedDate === '2026-03-12')
    if (!future) throw new Error('Missing future appointment')
    const preview = await db.transaction((tx) =>
      dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_PREVIEW_PROGRAM_ADOPTION', {
        planId: state.plan.id,
        programRevisionId: state.program.id,
        routineBindings: state.choices,
      }),
    )
    await dispatchOrganization(db, 'ORGANIZATION_APPOINTMENT_POSTPONE', {
      appointmentId: future.id,
      date: '2026-03-16',
    })
    await expect(
      db.transaction((tx) =>
        dispatchPrescriptionOperation(tx, 'TRAINING_PLAN_APPLY_PROGRAM_ADOPTION', {
          previewId: preview.previewId,
        }),
      ),
    ).rejects.toThrow('Program calendar changed')
    const reopened = await dispatchOrganization(db, 'ORGANIZATION_RECONCILE_OPEN', { today })
    expect(reopened.find((appointment) => appointment.id === future.id)).toMatchObject({
      plannedDate: '2026-03-16',
      postponed: true,
    })
    expect(
      raw.query<{ revision: string }>(
        'SELECT adopted_program_revision_id AS revision FROM training_plans WHERE id=?',
        [state.plan.id],
      )[0]?.revision,
    ).toBe(state.program.id)
  })
})
