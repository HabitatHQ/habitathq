import exercisesData from '~/assets/seed/exercises.json'
import type { Equipment, EquipmentSub, MovementPattern } from '~/types/database'

interface ExerciseSeed {
  name: string
  slug: string
  equipment: Equipment
  equipment_sub: EquipmentSub
  movement: MovementPattern
  muscles: string[]
  muscles_sec: string[]
  cues: string | null
  icon: string | null
}

const seeds = exercisesData as ExerciseSeed[]

export function useSeed() {
  const db = useDatabase()

  async function seedExercises(): Promise<void> {
    const alreadyApplied = await db.isDefaultApplied('seed:exercises:v6')
    if (alreadyApplied) return

    const now = new Date().toISOString()

    // Keep each statement below SQLite's portable 999-parameter limit.
    const statements: Array<{ sql: string; bind?: unknown[] }> = []
    const BATCH = 80
    for (let i = 0; i < seeds.length; i += BATCH) {
      const batch = seeds.slice(i, i + BATCH)
      const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,0,?,?)').join(',\n')
      const bind: (string | null)[] = batch.flatMap((ex) => [
        crypto.randomUUID(),
        ex.name,
        ex.slug,
        ex.equipment,
        ex.equipment_sub,
        ex.movement,
        JSON.stringify(ex.muscles),
        JSON.stringify(ex.muscles_sec),
        ex.cues ?? null,
        ex.icon ?? null,
        ex.movement === 'cardio' ? 'cardio' : 'strength',
        now,
      ])
      statements.push({
        sql: `INSERT OR IGNORE INTO exercises (id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,cues,icon,is_custom,logging_mode,created_at) VALUES\n${placeholders}`,
        bind,
      })
    }
    statements.push(
      {
        sql: "UPDATE exercises SET logging_mode = 'cardio' WHERE movement = 'cardio' AND is_custom = 0 AND logging_mode = 'strength'",
      },
      {
        sql: "INSERT OR IGNORE INTO applied_defaults (key) VALUES ('seed:exercises:v6')",
      },
    )
    await db.batch(statements)
  }

  async function ensureSeeded(): Promise<void> {
    if (db.status.value !== 'ready') return
    await seedExercises()
  }

  return { ensureSeeded }
}
