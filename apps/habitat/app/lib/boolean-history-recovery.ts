/** Minimal database surface shared by schema seeds and application imports. */
export interface BooleanHistoryStore {
  queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]>
  exec(sql: string, bind?: unknown[]): Promise<void>
}

/**
 * Restores Boolean completions from positive logs created before tracking types
 * became immutable. Existing completions remain authoritative.
 */
export async function recoverBooleanHistoryFromLogs(db: BooleanHistoryStore): Promise<void> {
  const legacyLogs = await db.queryAll<{ habit_id: string; date: string; completed_at: string }>(
    `SELECT hl.habit_id, hl.date, MIN(hl.logged_at) AS completed_at
     FROM habit_logs hl
     JOIN habits h ON h.id = hl.habit_id
     WHERE h.type = 'BOOLEAN'
       AND hl.value > 0
       AND NOT EXISTS (
         SELECT 1 FROM completions c WHERE c.habit_id = hl.habit_id AND c.date = hl.date
       )
     GROUP BY hl.habit_id, hl.date`,
  )
  for (const log of legacyLogs) {
    await db.exec(
      'INSERT INTO completions (id,habit_id,date,completed_at,notes,tags,annotations) VALUES (?,?,?,?,?,?,?)',
      [crypto.randomUUID(), log.habit_id, log.date, log.completed_at, '', '[]', '{}'],
    )
  }
}
