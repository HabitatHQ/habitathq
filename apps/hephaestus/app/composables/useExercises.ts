import { filterExercises, searchExercises, sortExercises } from '~/lib/exercise-helpers'
import type { Equipment, ExerciseRow, MovementPattern } from '~/types/database'

export function useExercises() {
  const db = useDatabase()
  const exercises = useState<ExerciseRow[]>('exercises', () => [])
  const loading = ref(false)

  async function load() {
    if (exercises.value.length > 0) return
    loading.value = true
    try {
      const rows = await db.query<ExerciseRow>('SELECT * FROM exercises ORDER BY name ASC')
      exercises.value = rows
    } finally {
      loading.value = false
    }
  }

  function search(query: string): ExerciseRow[] {
    return sortExercises(searchExercises(exercises.value, query), 'custom-last')
  }

  function filter(opts: {
    equipment?: Equipment
    movement?: MovementPattern
    isCustom?: boolean
  }): ExerciseRow[] {
    return sortExercises(filterExercises(exercises.value, opts), 'custom-last')
  }

  function getById(id: string): ExerciseRow | undefined {
    return exercises.value.find((e) => e.id === id)
  }

  async function addCustom(
    name: string,
    equipment: Equipment,
    movement: MovementPattern,
    muscles: string[],
    musclesSec: string[] = [],
  ): Promise<ExerciseRow> {
    const id = crypto.randomUUID()
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const now = new Date().toISOString()
    const row: ExerciseRow = {
      id,
      name,
      slug,
      equipment,
      movement,
      muscles: JSON.stringify(muscles),
      muscles_sec: JSON.stringify(musclesSec),
      cues: null,
      is_custom: 1,
      created_at: now,
    }
    await db.exec(
      `INSERT INTO exercises (id,name,slug,equipment,movement,muscles,muscles_sec,cues,is_custom,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, name, slug, equipment, movement, row.muscles, row.muscles_sec, null, 1, now],
    )
    exercises.value = [...exercises.value, row]
    return row
  }

  return {
    exercises: readonly(exercises),
    loading: readonly(loading),
    load,
    search,
    filter,
    getById,
    addCustom,
  }
}
