import { buildTagSeed } from '~/lib/tags'
import type { TagRow } from '~/types/database'

export function useTags() {
  const db = useDatabase()

  async function ensureTagsSeed(): Promise<void> {
    const already = await db.isDefaultApplied('seed:tags:v1')
    if (already) return

    const tags = buildTagSeed(new Date().toISOString())
    for (const tag of tags) {
      await db.exec(
        `INSERT OR IGNORE INTO tags (id, name, category, is_predefined, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tag.id, tag.name, tag.category, tag.is_predefined, tag.color, tag.created_at],
      )
    }
    await db.markDefaultApplied('seed:tags:v1')
  }

  async function load(): Promise<TagRow[]> {
    return db.query<TagRow>('SELECT * FROM tags ORDER BY category, name')
  }

  async function getForWorkout(workoutId: string): Promise<TagRow[]> {
    return db.query<TagRow>(
      `SELECT t.* FROM tags t
       JOIN workout_tags wt ON wt.tag_id = t.id
       WHERE wt.workout_id = ?
       ORDER BY t.category, t.name`,
      [workoutId],
    )
  }

  async function addToWorkout(workoutId: string, tagId: string): Promise<void> {
    await db.exec('INSERT OR IGNORE INTO workout_tags (workout_id, tag_id) VALUES (?, ?)', [
      workoutId,
      tagId,
    ])
  }

  async function removeFromWorkout(workoutId: string, tagId: string): Promise<void> {
    await db.exec('DELETE FROM workout_tags WHERE workout_id = ? AND tag_id = ?', [
      workoutId,
      tagId,
    ])
  }

  async function createCustom(
    name: string,
    category: 'custom' | 'performance' | 'feel' | 'environment',
  ): Promise<TagRow> {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await db.exec(
      `INSERT INTO tags (id, name, category, is_predefined, color, created_at)
       VALUES (?, ?, ?, 0, NULL, ?)`,
      [id, name, category, createdAt],
    )
    const [tag] = await db.query<TagRow>('SELECT * FROM tags WHERE id = ?', [id])
    return tag as TagRow
  }

  return {
    ensureTagsSeed,
    load,
    getForWorkout,
    addToWorkout,
    removeFromWorkout,
    createCustom,
  }
}
