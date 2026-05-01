import type { CircuitRestMode, GroupType, TemplateGroupRow } from '~/types/database'

export function useTemplateGroups() {
  const db = useDatabase()

  async function getForTemplate(templateId: string): Promise<TemplateGroupRow[]> {
    return db.query<TemplateGroupRow>(
      'SELECT * FROM template_groups WHERE template_id = ? ORDER BY sort_order ASC, label ASC',
      [templateId],
    )
  }

  async function create(
    templateId: string,
    label: string,
    groupType: GroupType = 'superset',
    opts: {
      name?: string
      displayName?: string
      transitionRestSec?: number
      restAfterRoundSec?: number
      circuitRestMode?: CircuitRestMode
      rounds?: number
      amrap?: boolean
      timeCapSec?: number
      sortOrder?: number
    } = {},
  ): Promise<TemplateGroupRow> {
    const id = crypto.randomUUID()
    const {
      transitionRestSec = 15,
      restAfterRoundSec = 120,
      circuitRestMode = 'after_round',
      rounds = 1,
      amrap = false,
      sortOrder = 0,
    } = opts
    const name = opts.name ?? null
    const displayName = opts.displayName ?? null
    const timeCapSec = opts.timeCapSec ?? null
    await db.exec(
      `INSERT INTO template_groups
         (id, template_id, label, name, group_type, transition_rest_sec, rest_after_round_sec,
          circuit_rest_mode, sort_order, display_name, rounds, amrap, time_cap_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        templateId,
        label,
        name,
        groupType,
        transitionRestSec,
        restAfterRoundSec,
        circuitRestMode,
        sortOrder,
        displayName,
        rounds,
        amrap ? 1 : 0,
        timeCapSec,
      ],
    )
    const [row] = await db.query<TemplateGroupRow>('SELECT * FROM template_groups WHERE id = ?', [
      id,
    ])
    return row as TemplateGroupRow
  }

  async function update(
    id: string,
    opts: Partial<
      Pick<
        TemplateGroupRow,
        | 'label'
        | 'name'
        | 'group_type'
        | 'transition_rest_sec'
        | 'rest_after_round_sec'
        | 'circuit_rest_mode'
        | 'sort_order'
        | 'display_name'
        | 'rounds'
        | 'amrap'
        | 'time_cap_sec'
      >
    >,
  ): Promise<void> {
    const entries = Object.entries(opts).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return
    const sets = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db.exec(`UPDATE template_groups SET ${sets} WHERE id = ?`, [...values, id])
  }

  async function remove(id: string): Promise<void> {
    await db.exec('DELETE FROM template_groups WHERE id = ?', [id])
  }

  async function assignExerciseToGroup(
    templateExerciseId: string,
    groupLabel: string | null,
  ): Promise<void> {
    await db.exec('UPDATE template_exercises SET superset_group = ? WHERE id = ?', [
      groupLabel,
      templateExerciseId,
    ])
  }

  async function reorderGroups(templateId: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      await db.exec('UPDATE template_groups SET sort_order = ? WHERE id = ? AND template_id = ?', [
        i,
        id,
        templateId,
      ])
    }
  }

  return {
    getForTemplate,
    create,
    update,
    remove,
    assignExerciseToGroup,
    reorderGroups,
  }
}
