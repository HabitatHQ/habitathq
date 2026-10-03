import { BUILTIN_PROGRAMS } from '~/lib/programs'
import type { ProgramPhase, ProgramRow } from '~/types/database'

export function usePrograms() {
  const db = useDatabase()

  async function load(): Promise<ProgramRow[]> {
    return db.query<ProgramRow>('SELECT * FROM programs ORDER BY active DESC, created_at DESC')
  }

  async function create(name: string, weeks: number, description?: string): Promise<string> {
    if (!name.trim() || !Number.isInteger(weeks) || weeks < 1)
      throw new Error('Program name and positive week count are required')
    const now = new Date().toISOString()
    const defaultProgression = {
      intensityModifier: 1,
      volumeModifier: 1,
      isDeload: false,
      phase: null,
      legacyCurrentWeek: null,
    }
    const revision = await db.domain('PROGRAM_CREATE', {
      name: name.trim(),
      description: description ?? null,
      now,
      design: {
        schemaVersion: 1,
        weeks,
        weekProgression: Array.from({ length: weeks }, (_, index) => ({
          week: index + 1,
          progression: defaultProgression,
        })),
        slots: [],
      },
    })
    return revision.programId
  }

  async function addWeek(
    programId: string,
    weekNum: number,
    opts: {
      isDeload?: boolean
      intensityModifier?: number
      volumeModifier?: number
      phase?: ProgramPhase | null
    } = {},
  ): Promise<string> {
    await db.domain('PROGRAM_ADD_WEEK', {
      programId,
      weekNum,
      ...opts,
    })
    const row = await db.query<{ id: string }>(
      'SELECT id FROM program_weeks WHERE program_id=? AND week_num=? ORDER BY id LIMIT 1',
      [programId, weekNum],
    )
    const weekId = row[0]?.id
    if (!weekId) throw new Error('Program week was not persisted')
    return weekId
  }

  async function addDay(
    weekId: string,
    dayNum: number,
    templateId: string | null,
    label?: string,
  ): Promise<string> {
    const slot = await db.domain('PROGRAM_ADD_SLOT', {
      weekId,
      dayNum,
      templateId,
      ...(label === undefined ? {} : { label }),
    })
    return slot.id
  }

  async function seedBuiltinPrograms(): Promise<void> {
    if (await db.isDefaultApplied('builtin-programs')) return
    const now = new Date().toISOString()
    for (const builtin of BUILTIN_PROGRAMS) {
      const existing = await db.query<{ id: string }>(
        'SELECT id FROM programs WHERE name=? AND is_builtin=1 ORDER BY created_at LIMIT 1',
        [builtin.name],
      )
      if (existing.length > 0) continue
      const progressionByWeek = new Map(builtin.structure.map((week) => [week.weekNum, week]))
      await db.domain('PROGRAM_CREATE', {
        name: builtin.name,
        description: builtin.description,
        isBuiltin: true,
        now,
        design: {
          schemaVersion: 1,
          weeks: builtin.weeks,
          weekProgression: Array.from({ length: builtin.weeks }, (_, index) => {
            const weekNumber = index + 1
            const week = progressionByWeek.get(weekNumber)
            return {
              week: weekNumber,
              progression: {
                intensityModifier: week?.intensityModifier ?? 1,
                volumeModifier: week?.volumeModifier ?? 1,
                isDeload: week?.isDeload ?? false,
                phase: week?.phase === 'deload' ? 'deload' : null,
                legacyCurrentWeek: null,
              },
            }
          }),
          slots: [],
        },
      })
    }
    await db.markDefaultApplied('builtin-programs')
  }

  return { load, create, addWeek, addDay, seedBuiltinPrograms }
}
