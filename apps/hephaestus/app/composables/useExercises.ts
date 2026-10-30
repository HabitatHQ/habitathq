import { generateUuidV7 } from '~/lib/db-identity'
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

let exerciseLoadGeneration = 0

export function useExercises() {
  const db = useDatabase()
  const exercises = useState<ExerciseRow[]>('exercises', () => [])
  const loading = ref(false)

  async function load() {
    const generation = ++exerciseLoadGeneration
    loading.value = true
    try {
      const rows = await db.query<ExerciseRow>('SELECT * FROM exercises ORDER BY name ASC')
      if (generation === exerciseLoadGeneration) exercises.value = rows
    } finally {
      if (generation === exerciseLoadGeneration) loading.value = false
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
    const id = generateUuidV7()
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
  async function updateCustom(
    id: string,
    name: string,
    equipmentSub: EquipmentSub,
    movement: MovementPattern,
    loggingMode: LoggingMode,
  ): Promise<void> {
    const current = getById(id)
    if (current?.is_custom !== 1) throw new Error('Only saved custom exercises can be edited.')
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('Exercise name is required.')
    const equipment = equipmentCategory(equipmentSub)
    const icon = movementIcon[movement] ?? 'i-ph-barbell'
    await db.exec(
      'UPDATE exercises SET name=?,slug=?,equipment=?,equipment_sub=?,movement=?,icon=?,logging_mode=? WHERE id=? AND is_custom=1',
      [
        normalizedName,
        normalizedName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        equipment,
        equipmentSub,
        movement,
        icon,
        loggingMode,
        id,
      ],
    )
    exercises.value = exercises.value.map((exercise) =>
      exercise.id === id
        ? {
            ...exercise,
            name: normalizedName,
            slug: normalizedName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
            equipment,
            equipment_sub: equipmentSub,
            movement,
            icon,
            logging_mode: loggingMode,
          }
        : exercise,
    )
  }

  return {
    exercises: readonly(exercises),
    loading: readonly(loading),
    load,
    search,
    filter,
    getById,
    addCustom,
    updateCustom,
  }
}
