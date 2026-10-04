// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { SCHEMA_DDL } from '~/lib/db-schema'
import type { DbAdapter } from '~/types/database'
import {
  createHabit,
  deleteCompletion,
  dispatch,
  getStreak,
  replaceHabitLogsForDate,
  toggleCompletion,
} from '~/lib/db-shared'
import { localDateString } from '@habitathq/utils'

function createDb(): { db: DatabaseSync; adapter: DbAdapter } {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_DDL)
  const adapter: DbAdapter = {
    queryAll: async <T>(sql: string, bind?: unknown[]) =>
      db.prepare(sql).all(...((bind ?? []) as never[])) as T[],
    queryOne: async <T>(sql: string, bind?: unknown[]) =>
      (db.prepare(sql).get(...((bind ?? []) as never[])) as T) ?? null,
    exec: async (sql: string, bind?: unknown[]) => {
      if (bind?.length) db.prepare(sql).run(...(bind as never[]))
      else db.exec(sql)
    },
  }
  return { db, adapter }
}

function seedHabit(db: DatabaseSync, habitId: string): void {
  db.prepare('INSERT OR IGNORE INTO habits (id, name, created_at) VALUES (?, ?, ?)').run(
    habitId,
    `Test ${habitId}`,
    '2026-10-04T00:00:00Z',
  )
}

function seedLog(db: DatabaseSync, habitId: string, value: number): void {
  seedHabit(db, habitId)
  db.prepare(
    'INSERT INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`old-${habitId}`, habitId, '2026-10-04', '2026-10-04T10:00:00Z', value, 'saved')
}

describe('replaceHabitLogsForDate', () => {
  it.each(['steps', 'water', 'sleep', 'meals'])(
    'rolls back the prior %s value when replacement insertion fails',
    async (habitId) => {
      const { db, adapter } = createDb()
      seedLog(db, habitId, 17)
      db.exec(`CREATE TRIGGER reject_${habitId} BEFORE INSERT ON habit_logs
        WHEN NEW.habit_id = '${habitId}' BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END`)

      await expect(
        replaceHabitLogsForDate(adapter, habitId, '2026-10-04', 23),
      ).rejects.toThrow('injected insert failure')
      expect(db.prepare('SELECT id, value, notes FROM habit_logs WHERE habit_id = ?').all(habitId)).toEqual([
        { id: `old-${habitId}`, value: 17, notes: 'saved' },
      ])
      db.close()
    },
  )

  it('replaces all same-day rows with one positive value and clears them for zero', async () => {
    const { db, adapter } = createDb()
    seedLog(db, 'steps', 5)
    db.prepare(
      'INSERT INTO habit_logs (id, habit_id, date, logged_at, value, notes) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('old-steps-2', 'steps', '2026-10-04', '2026-10-04T11:00:00Z', 8, '')

    await replaceHabitLogsForDate(adapter, 'steps', '2026-10-04', 42)
    expect(db.prepare('SELECT value FROM habit_logs WHERE habit_id = ? AND date = ?').all('steps', '2026-10-04')).toEqual([
      { value: 42 },
    ])
    await replaceHabitLogsForDate(adapter, 'steps', '2026-10-04', 0)
    expect(db.prepare('SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?').all('steps', '2026-10-04')).toEqual([])
    db.close()
  })
})
describe('replacement dispatch isolation', () => {
  it('rolls back before a queued mutation runs and continues dispatch after rejection', async () => {
    const { db, adapter } = createDb()
    seedLog(db, 'steps', 17)

    let reachedInsert!: () => void
    const insertReached = new Promise<void>((resolve) => {
      reachedInsert = resolve
    })
    let releaseInsert!: () => void
    const insertGate = new Promise<void>((resolve) => {
      releaseInsert = resolve
    })
    let failReplacementInsert = true
    const delayedAdapter: DbAdapter = {
      ...adapter,
      async exec(sql, bind) {
        if (failReplacementInsert && sql.startsWith('INSERT INTO habit_logs')) {
          failReplacementInsert = false
          reachedInsert()
          await insertGate
          throw new Error('injected queued replacement failure')
        }
        await adapter.exec(sql, bind)
      },
    }

    const replacement = dispatch(delayedAdapter, {
      type: 'REPLACE_HABIT_LOGS_FOR_DATE',
      payload: { habit_id: 'steps', date: '2026-10-04', value: 23 },
    })
    await insertReached
    const laterMutation = dispatch(adapter, {
      type: 'LOG_HABIT_VALUE',
      payload: { habit_id: 'steps', date: '2026-10-04', value: 31 },
    })
    releaseInsert()

    await expect(replacement).rejects.toThrow('injected queued replacement failure')
    await laterMutation
    expect(db.prepare('SELECT value FROM habit_logs WHERE habit_id = ? ORDER BY value').all('steps')).toEqual([
      { value: 17 },
      { value: 31 },
    ])
    db.close()
  })
})

describe('completion action identity', () => {
  it('returns the inserted action id and deletion cannot remove a later completion', async () => {
    const { db, adapter } = createDb()
    seedHabit(db, 'h1')
    const created = await toggleCompletion(adapter, 'h1', '2026-10-04')
    expect(created).not.toBeNull()
    const originalId = created!.id
    await deleteCompletion(adapter, originalId)
    const newer = await toggleCompletion(adapter, 'h1', '2026-10-04')
    expect(newer).not.toBeNull()
    await deleteCompletion(adapter, originalId)
    expect(db.prepare('SELECT id FROM completions WHERE habit_id = ?').all('h1')).toEqual([
      { id: newer!.id },
    ])
    db.close()
  })
})
describe('new habit schedule local-day boundary', () => {
  it.each([0, 23])(
    'includes a completion on the creation day at local hour %i',
    async (hour) => {
      const { db, adapter } = createDb()
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 9, 4, hour, 30))
      try {
        const localDay = localDateString(new Date())
        const habit = await createHabit(adapter, {
          name: `Boundary habit ${hour}`,
          description: '',
          why: '',
          color: '#ffffff',
          icon: 'star',
          frequency: 'daily',
          tags: [],
          annotations: {},
          type: 'BOOLEAN',
          target_value: 1,
          paused_until: null,
        })
        expect(habit.schedule?.start_date).toBe(localDay)

        await toggleCompletion(adapter, habit.id, localDay)
        const streak = await getStreak(adapter, habit.id)
        expect(streak.current).toBe(1)
      } finally {
        vi.useRealTimers()
        db.close()
      }
    },
  )
})
