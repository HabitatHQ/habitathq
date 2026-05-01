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
    const alreadyApplied = await db.isDefaultApplied('seed:exercises:v5')
    if (alreadyApplied) return

    const now = new Date().toISOString()

    // Batch INSERT to stay under SQLite's 999-parameter limit.
    // 11 params per row → max 90 rows per batch (90 × 11 = 990 < 999).
    const BATCH = 90
    for (let i = 0; i < seeds.length; i += BATCH) {
      const batch = seeds.slice(i, i + BATCH)
      const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,0,?)').join(',\n')
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
        now,
      ])
      await db.exec(
        `INSERT OR IGNORE INTO exercises (id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,cues,icon,is_custom,created_at) VALUES\n${placeholders}`,
        bind,
      )
    }

    await db.markDefaultApplied('seed:exercises:v5')
  }

  async function ensureSeeded(): Promise<void> {
    if (db.status.value !== 'ready') return
    await seedExercises()
  }

  return { ensureSeeded }
}
