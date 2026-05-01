import type { TagRow } from '~/types/database'

export function useTemplateTags() {
  const db = useDatabase()

  async function getForTemplate(templateId: string): Promise<TagRow[]> {
    return db.query<TagRow>(
      `SELECT t.* FROM tags t
       JOIN template_tags tt ON tt.tag_id = t.id
       WHERE tt.template_id = ?`,
      [templateId],
    )
  }

  async function addTag(templateId: string, tagId: string): Promise<void> {
    await db.exec('INSERT OR IGNORE INTO template_tags (template_id, tag_id) VALUES (?, ?)', [
      templateId,
      tagId,
    ])
  }

  async function removeTag(templateId: string, tagId: string): Promise<void> {
    await db.exec('DELETE FROM template_tags WHERE template_id = ? AND tag_id = ?', [
      templateId,
      tagId,
    ])
  }

  async function filterByTag(tagId: string): Promise<string[]> {
    const rows = await db.query<{ template_id: string }>(
      'SELECT template_id FROM template_tags WHERE tag_id = ?',
      [tagId],
    )
    return rows.map((r) => r.template_id)
  }

  return {
    getForTemplate,
    addTag,
    removeTag,
    filterByTag,
  }
}
