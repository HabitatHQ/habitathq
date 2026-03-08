import exercisesData from '~/assets/seed/exercises.json'
import type { Equipment, MovementPattern } from '~/types/database'

interface ExerciseSeed {
  name: string
  slug: string
  equipment: Equipment
  movement: MovementPattern
  muscles: string[]
  muscles_sec: string[]
  cues: string | null
}

const seeds = exercisesData as ExerciseSeed[]

export function useSeed() {
  const db = useDatabase()

  async function seedExercises(): Promise<void> {
    const alreadyApplied = await db.isDefaultApplied('seed:exercises:v1')
    if (alreadyApplied) return

    const now = new Date().toISOString()
    for (const ex of seeds) {
      const id = crypto.randomUUID()
      await db.exec(
        `INSERT OR IGNORE INTO exercises (id,name,slug,equipment,movement,muscles,muscles_sec,cues,is_custom,created_at)
         VALUES (?,?,?,?,?,?,?,?,0,?)`,
        [
          id,
          ex.name,
          ex.slug,
          ex.equipment,
          ex.movement,
          JSON.stringify(ex.muscles),
          JSON.stringify(ex.muscles_sec),
          ex.cues,
          now,
        ],
      )
    }

    await db.markDefaultApplied('seed:exercises:v1')
  }

  async function ensureSeeded(): Promise<void> {
    if (db.status.value !== 'ready') return
    await seedExercises()
  }

  return { ensureSeeded }
}
