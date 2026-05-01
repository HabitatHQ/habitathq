import type { TemplateFolderRow, TemplateRow } from '~/types/database'

export function useTemplateFolders() {
  const db = useDatabase()

  async function load(): Promise<TemplateFolderRow[]> {
    return db.query<TemplateFolderRow>(
      'SELECT * FROM template_folders ORDER BY sort_order ASC, name ASC',
    )
  }

  async function create(name: string, color?: string): Promise<TemplateFolderRow> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.exec(
      'INSERT INTO template_folders (id, name, color, created_at) VALUES (?, ?, ?, ?)',
      [id, name, color ?? null, now],
    )
    const rows = await db.query<TemplateFolderRow>('SELECT * FROM template_folders WHERE id = ?', [
      id,
    ])
    return rows[0] as TemplateFolderRow
  }

  async function update(
    id: string,
    opts: Partial<Pick<TemplateFolderRow, 'name' | 'color' | 'sort_order'>>,
  ): Promise<void> {
    const entries = Object.entries(opts).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return
    const sets = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db.exec(`UPDATE template_folders SET ${sets} WHERE id = ?`, [...values, id])
  }

  async function remove(id: string): Promise<void> {
    await db.exec('DELETE FROM template_folders WHERE id = ?', [id])
  }

  async function addTemplate(folderId: string, templateId: string, sortOrder = 0): Promise<void> {
    await db.exec(
      'INSERT OR IGNORE INTO template_folder_items (template_id, folder_id, sort_order) VALUES (?, ?, ?)',
      [templateId, folderId, sortOrder],
    )
  }

  async function removeTemplate(folderId: string, templateId: string): Promise<void> {
    await db.exec('DELETE FROM template_folder_items WHERE folder_id = ? AND template_id = ?', [
      folderId,
      templateId,
    ])
  }

  async function getTemplates(folderId: string): Promise<TemplateRow[]> {
    return db.query<TemplateRow>(
      `SELECT t.* FROM templates t
       JOIN template_folder_items tfi ON tfi.template_id = t.id
       WHERE tfi.folder_id = ? AND t.archived_at IS NULL
       ORDER BY tfi.sort_order ASC`,
      [folderId],
    )
  }

  async function reorder(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await db.exec('UPDATE template_folders SET sort_order = ? WHERE id = ?', [i, ids[i]])
    }
  }

  return {
    load,
    create,
    update,
    remove,
    addTemplate,
    removeTemplate,
    getTemplates,
    reorder,
  }
}
