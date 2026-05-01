import { filterExercises, searchExercises, sortExercises } from '~/lib/exercise-helpers'
import { movementIcon } from '~/lib/exercise-icons'
import type {
  Equipment,
  EquipmentSub,
  ExerciseRow,
  LoggingMode,
  MovementPattern,
} from '~/types/database'
import { equipmentCategory } from '~/types/database'

export function useExercises() {
  const db = useDatabase()
  const exercises = useState<ExerciseRow[]>('exercises', () => [])
  const loading = ref(false)

  async function load() {
    if (loading.value) return // already in-flight, skip duplicate call
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
    equipmentSub: EquipmentSub,
    movement: MovementPattern,
    muscles: string[],
    musclesSec: string[] = [],
    loggingMode: LoggingMode = 'strength',
  ): Promise<ExerciseRow> {
    const id = crypto.randomUUID()
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const now = new Date().toISOString()
    const icon = movementIcon[movement] ?? 'i-ph-barbell'
    const equipment: Equipment = equipmentCategory(equipmentSub)
    const row: ExerciseRow = {
      id,
      name,
      slug,
      equipment,
      equipment_sub: equipmentSub,
      movement,
      muscles: JSON.stringify(muscles),
      muscles_sec: JSON.stringify(musclesSec),
      cues: null,
      icon,
      is_custom: 1,
      logging_mode: loggingMode,
      created_at: now,
    }
    await db.exec(
      `INSERT INTO exercises (id,name,slug,equipment,equipment_sub,movement,muscles,muscles_sec,cues,icon,is_custom,logging_mode,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        name,
        slug,
        equipment,
        equipmentSub,
        movement,
        row.muscles,
        row.muscles_sec,
        null,
        icon,
        1,
        loggingMode,
        now,
      ],
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
