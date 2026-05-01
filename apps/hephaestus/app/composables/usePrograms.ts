import { BUILTIN_PROGRAMS } from '~/lib/programs'
import type { ProgramDayRow, ProgramRow } from '~/types/database'

export interface ProgramProgress {
  programId: string
  programName: string
  currentWeek: number
  totalWeeks: number
  percentComplete: number
  todaysDays: ProgramDayRow[]
}

export function usePrograms() {
  const db = useDatabase()

  async function load(): Promise<ProgramRow[]> {
    return db.query<ProgramRow>('SELECT * FROM programs ORDER BY active DESC, created_at DESC')
  }

  async function create(name: string, weeks: number, description?: string): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.exec(
      'INSERT INTO programs (id, name, description, weeks, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, description ?? null, weeks, now],
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
        opts.intensityModifier ?? 1.0,
        opts.volumeModifier ?? 1.0,
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
    const id = crypto.randomUUID()
    await db.exec(
      'INSERT INTO program_days (id, week_id, day_num, template_id, label) VALUES (?, ?, ?, ?, ?)',
      [id, weekId, dayNum, templateId, label ?? null],
    )
    return id
  }

  async function setActive(programId: string): Promise<void> {
    await db.exec('UPDATE programs SET active = 0')
    const now = new Date().toISOString()
    await db.exec(
      'UPDATE programs SET active = 1, started_at = COALESCE(started_at, ?), current_week = COALESCE(current_week, 1) WHERE id = ?',
      [now, programId],
    )
  }

  async function advanceWeek(programId: string): Promise<void> {
    await db.exec('UPDATE programs SET current_week = current_week + 1 WHERE id = ?', [programId])
  }

  async function getProgress(programId: string): Promise<ProgramProgress | null> {
    const programs = await db.query<ProgramRow>('SELECT * FROM programs WHERE id = ?', [programId])
    const program = programs[0]
    if (!program) return null

    const today = new Date()
    const days = await db.query<ProgramDayRow>(
      `SELECT pd.* FROM program_days pd
       JOIN program_weeks pw ON pw.id = pd.week_id
       WHERE pw.program_id = ? AND pw.week_num = ?`,
      [programId, program.current_week],
    )
    const todayNum = today.getDay()
    const todaysDays = days.filter((d) => d.day_num === todayNum)

    return {
      programId: program.id,
      programName: program.name,
      currentWeek: program.current_week,
      totalWeeks: program.weeks,
      percentComplete: Math.round(((program.current_week - 1) / program.weeks) * 100),
      todaysDays,
    }
  }

  async function seedBuiltinPrograms(): Promise<void> {
    const applied = await db.query<{ key: string }>(
      "SELECT key FROM applied_defaults WHERE key = 'builtin-programs'",
    )
    if (applied.length > 0) return

    for (const bp of BUILTIN_PROGRAMS) {
      const programId = await create(bp.name, bp.weeks, bp.description)
      await db.exec('UPDATE programs SET is_builtin = 1 WHERE id = ?', [programId])
      for (const week of bp.structure) {
        await addWeek(programId, week.weekNum, {
          isDeload: week.isDeload,
          intensityModifier: week.intensityModifier,
          volumeModifier: week.volumeModifier,
          ...(week.phase !== undefined ? { phase: week.phase } : {}),
        })
      }
    }
    await db.exec("INSERT OR IGNORE INTO applied_defaults (key) VALUES ('builtin-programs')")
  }

  return {
    load,
    create,
    addWeek,
    addDay,
    setActive,
    advanceWeek,
    getProgress,
    seedBuiltinPrograms,
  }
}
