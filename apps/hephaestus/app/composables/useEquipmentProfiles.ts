import type { EquipmentProfile } from '~/lib/equipment'

export function useEquipmentProfiles() {
  const db = useDatabase()

  async function load(exerciseId?: string): Promise<EquipmentProfile[]> {
    const rows = await db.query<EquipmentProfile>(
      `SELECT * FROM equipment_profiles ${exerciseId ? 'WHERE exercise_id = ?' : ''} ORDER BY exercise_id`,
      exerciseId ? [exerciseId] : [],
    )
    return rows
  }

  async function get(exerciseId: string): Promise<EquipmentProfile | null> {
    return (await load(exerciseId))[0] ?? null
  }

  async function save(profile: Omit<EquipmentProfile, 'updated_at'>): Promise<void> {
    const loads =
      typeof profile.additional_loads_kg === 'string'
        ? (JSON.parse(profile.additional_loads_kg) as unknown)
        : profile.additional_loads_kg
    if (
      !Array.isArray(loads) ||
      loads.some((load) => typeof load !== 'number' || !Number.isFinite(load) || load < 0)
    ) {
      throw new Error('Additional loads must be a list of non-negative kilogram values')
    }
    if (
      !Number.isFinite(profile.minimum_kg) ||
      profile.minimum_kg < 0 ||
      !Number.isFinite(profile.increment_kg) ||
      profile.increment_kg <= 0 ||
      (profile.maximum_kg != null &&
        (!Number.isFinite(profile.maximum_kg) || profile.maximum_kg < profile.minimum_kg))
    ) {
      throw new Error('Equipment profile minimum, increment, or maximum is invalid')
    }
    await db.exec(
      `INSERT INTO equipment_profiles (exercise_id, minimum_kg, increment_kg, maximum_kg, additional_loads_kg, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(exercise_id) DO UPDATE SET minimum_kg=excluded.minimum_kg, increment_kg=excluded.increment_kg,
         maximum_kg=excluded.maximum_kg, additional_loads_kg=excluded.additional_loads_kg, updated_at=excluded.updated_at`,
      [
        profile.exercise_id,
        profile.minimum_kg,
        profile.increment_kg,
        profile.maximum_kg,
        JSON.stringify(loads),
        new Date().toISOString(),
      ],
    )
  }

  async function remove(exerciseId: string): Promise<void> {
    await db.exec('DELETE FROM equipment_profiles WHERE exercise_id = ?', [exerciseId])
  }

  return { load, get, save, remove }
}
