import { BUILTIN_PROGRAMS, boundedProgramWeek, getTodaysProgramDays } from '~/lib/programs'
import type { ProgramDayRow, ProgramRow, ProgramWeekRow } from '~/types/database'

export interface ProgramProgress {
  programId: string
  programName: string
  currentWeek: number
  totalWeeks: number
  percentComplete: number
  complete: boolean
  intensityModifier: number
  volumeModifier: number
  isDeload: boolean
  todaysDays: ProgramDayRow[]
}

export function usePrograms() {
  const db = useDatabase()

  async function load(): Promise<ProgramRow[]> {
    return db.query<ProgramRow>('SELECT * FROM programs ORDER BY active DESC, created_at DESC')
  }

  async function create(name: string, weeks: number, description?: string): Promise<string> {
    if (!name.trim() || !Number.isInteger(weeks) || weeks < 1)
      throw new Error('Program name and positive week count are required')
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.exec(
      'INSERT INTO programs (id, name, description, weeks, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), description ?? null, weeks, now],
    )
    return id
  }

  async function addWeek(
    programId: string,
    weekNum: number,
    opts: {
      isDeload?: boolean
      intensityModifier?: number
      volumeModifier?: number
      phase?: string
    } = {},
  ): Promise<string> {
    const id = crypto.randomUUID()
    await db.exec(
      `INSERT INTO program_weeks (id, program_id, week_num, is_deload, intensity_modifier, volume_modifier, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        programId,
        weekNum,
        opts.isDeload ? 1 : 0,
        opts.intensityModifier ?? 1,
        opts.volumeModifier ?? 1,
        opts.phase ?? null,
      ],
    )
    return id
  }

  async function addDay(
    weekId: string,
    dayNum: number,
    templateId: string | null,
    label?: string,
  ): Promise<string> {
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 7)
      throw new Error('Program day must be Monday=1 through Sunday=7')
    const id = crypto.randomUUID()
    await db.exec(
      'INSERT INTO program_days (id, week_id, day_num, template_id, label) VALUES (?, ?, ?, ?, ?)',
      [id, weekId, dayNum, templateId, label ?? null],
    )
    return id
  }

  async function setActive(programId: string): Promise<void> {
    const rows = await db.query<ProgramRow>(
      'SELECT id, weeks, current_week FROM programs WHERE id = ?',
      [programId],
    )
    const target = rows[0]
    if (!target) throw new Error(`Program ${programId} not found`)
    const currentWeek = Math.min(target.weeks, Math.max(1, target.current_week || 1))
    const now = new Date().toISOString()
    await db.batch([
      { sql: 'UPDATE programs SET active = 0 WHERE active = 1' },
      {
        sql: 'UPDATE programs SET active = 1, started_at = COALESCE(started_at, ?), current_week = ? WHERE id = ?',
        bind: [now, currentWeek, programId],
      },
    ])
  }

  async function advanceWeek(programId: string): Promise<void> {
    const rows = await db.query<ProgramRow>(
      'SELECT id, weeks, current_week FROM programs WHERE id = ?',
      [programId],
    )
    const program = rows[0]
    if (!program) throw new Error(`Program ${programId} not found`)
    const currentWeek = boundedProgramWeek(
      Math.min(program.current_week, program.weeks),
      program.weeks,
    )
    await db.exec('UPDATE programs SET current_week = ?, active = ? WHERE id = ?', [
      currentWeek,
      currentWeek < program.weeks ? 1 : 0,
      programId,
    ])
  }

  async function getProgress(
    programId: string,
    today = new Date(),
  ): Promise<ProgramProgress | null> {
    const programs = await db.query<ProgramRow>('SELECT * FROM programs WHERE id = ?', [programId])
    const program = programs[0]
    if (!program) return null
    const currentWeek = Math.min(program.weeks, Math.max(1, program.current_week || 1))
    const [days, weekRows] = await Promise.all([
      db.query<ProgramDayRow>(
        `SELECT pd.* FROM program_days pd JOIN program_weeks pw ON pw.id = pd.week_id
         WHERE pw.program_id = ? AND pw.week_num = ? ORDER BY pd.day_num`,
        [programId, currentWeek],
      ),
      db.query<ProgramWeekRow>(
        'SELECT * FROM program_weeks WHERE program_id = ? AND week_num = ?',
        [programId, currentWeek],
      ),
    ])
    const week = weekRows[0]
    const complete =
      program.started_at !== null && currentWeek >= program.weeks && program.active === 0
    return {
      programId: program.id,
      programName: program.name,
      currentWeek,
      totalWeeks: program.weeks,
      percentComplete: complete ? 100 : Math.round(((currentWeek - 1) / program.weeks) * 100),
      complete,
      intensityModifier: week?.intensity_modifier ?? 1,
      volumeModifier: week?.volume_modifier ?? 1,
      isDeload: week?.is_deload === 1,
      todaysDays: getTodaysProgramDays(days, today),
    }
  }

  async function seedBuiltinPrograms(): Promise<void> {
    if (await db.isDefaultApplied('builtin-programs')) return
    const statements = []
    for (const builtin of BUILTIN_PROGRAMS) {
      const programId = crypto.randomUUID()
      statements.push({
        sql: 'INSERT INTO programs (id, name, description, weeks, created_at, is_builtin) VALUES (?, ?, ?, ?, ?, 1)',
        bind: [
          programId,
          builtin.name,
          builtin.description,
          builtin.weeks,
          new Date().toISOString(),
        ],
      })
      for (const week of builtin.structure) {
        statements.push({
          sql: `INSERT INTO program_weeks (id, program_id, week_num, is_deload, intensity_modifier, volume_modifier, phase)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          bind: [
            crypto.randomUUID(),
            programId,
            week.weekNum,
            week.isDeload ? 1 : 0,
            week.intensityModifier,
            week.volumeModifier,
            week.phase ?? null,
          ],
        })
      }
    }
    statements.push({
      sql: "INSERT OR IGNORE INTO applied_defaults (key) VALUES ('builtin-programs')",
    })
    await db.batch(statements)
  }

  return { load, create, addWeek, addDay, setActive, advanceWeek, getProgress, seedBuiltinPrograms }
}
