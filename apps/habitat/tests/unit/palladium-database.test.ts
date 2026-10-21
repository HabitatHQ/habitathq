// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import {
  createEngine,
  generateUuidV7,
  isUuidV7,
  MemoryBlobAdapter,
  type StorageAdapter,
  type TransactableStorageAdapter,
  type WireChange,
} from '@palladium/core'
import { describe, expect, it } from 'vitest'
import { legacyRowId } from '~/lib/db-identity'
import { SCHEMA_CONFIG, SCHEMA_DDL } from '~/lib/db-schema'
import { createHabit, deleteHabit, replaceHabitLogsForDate } from '~/lib/db-shared'
import { createHabitatBackend } from '~/lib/habitat-backend'
import { toHabitatDatabase } from '~/lib/palladium-database'
import type { ExportSelection, HabitatExport } from '~/types/database'
function storageFor(db: DatabaseSync): TransactableStorageAdapter {
  const bind = (values: readonly unknown[] = []): SQLInputValue[] =>
    values.map((value) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        ArrayBuffer.isView(value)
      )
        return value
      throw new TypeError('Invalid SQLite binding')
    })
  const storage: TransactableStorageAdapter = {
    open: async () => {
      db.exec('PRAGMA foreign_keys = ON')
    },
    close: async () => db.close(),
    exec: async <T>(sql: string, params?: readonly unknown[]) =>
      db.prepare(sql).all(...bind(params)) as T[],
    put: async (table, _id, data) => {
      const keys = Object.keys(data)
      db.prepare(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((key) => key !== 'id')
          .map((key) => `${key} = excluded.${key}`)
          .join(',')}`,
      ).run(...bind(Object.values(data)))
    },
    patch: async (table, id, patch) => {
      const keys = Object.keys(patch)
      db.prepare(
        `UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(',')} WHERE id = ?`,
      ).run(...bind([...Object.values(patch), id]))
    },
    remove: async (table, id) => {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    },
    runMigrations: async (migrations) => {
      for (const sql of migrations) db.exec(sql)
    },
    transaction: async <T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T> => {
      db.exec('BEGIN; PRAGMA defer_foreign_keys = ON')
      try {
        const result = await fn(storage)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
  return storage
}

async function device() {
  const sqlite = new DatabaseSync(':memory:')
  const engine = createEngine(storageFor(sqlite))
  await engine.init(SCHEMA_CONFIG)
  return { sqlite, engine, db: toHabitatDatabase(engine) }
}

const habitPayload = {
  name: 'Walk',
  description: '',
  why: '',
  color: '#fff',
  icon: 'star',
  frequency: 'daily',
  tags: [],
  annotations: {},
  type: 'BOOLEAN' as const,
  target_value: 1,
  paused_until: null,
}

const allExportTables: ExportSelection = {
  habits: true,
  completions: true,
  habit_logs: true,
  habit_schedules: true,
  reminders: true,
  checkin_templates: true,
  checkin_questions: true,
  checkin_responses: true,
  checkin_reminders: true,
  scribbles: true,
  checkin_entries: true,
  bored_categories: true,
  bored_activities: true,
  todos: true,
  focus_sessions: true,
}

it('round-trips completed check-ins and the entire focus history through JSON backup', async () => {
  const source = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  const restored = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    const templates = (await source.dispatch({ type: 'GET_CHECKIN_TEMPLATES' })) as { id: string }[]
    const template_id = templates[0]!.id
    const date = '2026-10-17'
    await source.dispatch({ type: 'TOGGLE_CHECKIN_COMPLETION', payload: { template_id, date } })
    const archived = (await source.dispatch({
      type: 'CREATE_CHECKIN_TEMPLATE',
      payload: {
        title: 'Archived backup check-in',
        schedule_type: 'DAILY',
        days_active: null,
        icon: 'star',
        color: '#fff',
      },
    })) as { id: string }
    await source.dispatch({
      type: 'CREATE_CHECKIN_QUESTION',
      payload: {
        template_id: archived.id,
        prompt: 'Preserved question',
        response_type: 'TEXT',
        display_order: 0,
        desired_answer: 1,
      },
    })
    await source.dispatch({ type: 'DELETE_CHECKIN_TEMPLATE', payload: { id: archived.id } })
    const todo = (await source.dispatch({
      type: 'CREATE_TODO',
      payload: {
        title: 'Backup history task',
        description: '',
        due_date: null,
        priority: 'medium',
        estimated_minutes: null,
        tags: [],
        annotations: {},
        is_recurring: false,
        recurrence_rule: null,
        show_in_bored: false,
        bored_category_id: null,
      },
    })) as { id: string }
    await source.engine.tx((tx) => {
      for (let i = 0; i < 205; i++)
        tx.insert('focus_sessions', {
          id: generateUuidV7(),
          todo_id: todo.id,
          started_at: `${date}T08:00:00Z`,
          completed_at: `${date}T08:25:00Z`,
          duration_seconds: 1500,
        })
    })
    const backup = (await source.dispatch({
      type: 'EXPORT_JSON_DATA',
      payload: allExportTables,
    })) as HabitatExport
    const importedCompletion = backup.checkin_completions?.[0]
    if (!importedCompletion) throw new Error('Expected exported check-in completion')
    Reflect.set(importedCompletion, 'unexpected_column', 'ignored')
    await restored.dispatch({ type: 'IMPORT_JSON', payload: backup })
    expect(
      await restored.dispatch({ type: 'GET_CHECKIN_COMPLETIONS_FOR_DATE', payload: { date } }),
    ).toEqual([expect.objectContaining({ template_id, date })])
    expect(await restored.dispatch({ type: 'GET_FOCUS_SESSION_SUMMARY' })).toEqual({
      session_count: 205,
      total_seconds: 307500,
    })
    expect(
      await restored.engine.exec({
        text: 'SELECT archived_at FROM checkin_templates WHERE id = ?',
        params: [archived.id],
        tables: [],
      }),
    ).toEqual([{ archived_at: expect.any(String) }])
  } finally {
    await source.close()
    await restored.close()
  }
})

describe('Habitat through Palladium', () => {
  it('replicates a habit and its schedule as one atomic change, including child tombstones on delete', async () => {
    const a = await device()
    const b = await device()
    const changes: Parameters<typeof b.engine.applyRemote>[0][] = []
    a.engine.on('changes:local', (change) => changes.push({ ...change, id: change.changeId }))
    const habit = await createHabit(a.db, habitPayload)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.ops).toHaveLength(2)
    await b.engine.applyRemote(changes[0]!)
    expect(await b.db.queryAll('SELECT name FROM habits')).toEqual([{ name: 'Walk' }])
    expect(await b.db.queryAll('SELECT habit_id FROM habit_schedules')).toEqual([
      { habit_id: habit.id },
    ])
    await deleteHabit(a.db, habit.id)
    const deletion = changes[1]!
    expect(deletion.ops.filter((op) => op.type === 'delete').map((op) => op.table)).toEqual(
      expect.arrayContaining(['habits', 'habit_schedules']),
    )
    await b.engine.applyRemote(deletion)
    expect(await b.db.queryAll('SELECT * FROM habits')).toEqual([])
    expect(await b.db.queryAll('SELECT * FROM habit_schedules')).toEqual([])
    a.sqlite.close()
    b.sqlite.close()
  })

  it('rolls back a replacement and its change when an insertion fails', async () => {
    const { sqlite, db, engine } = await device()
    const habit = await createHabit(db, habitPayload)
    const id = generateUuidV7()
    await db.insert('habit_logs', {
      id,
      habit_id: habit.id,
      date: '2026-10-16',
      logged_at: '2026-10-16T00:00:00Z',
      value: 2,
      notes: 'saved',
    })
    sqlite.exec(
      "CREATE TRIGGER reject_log BEFORE INSERT ON habit_logs BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    )
    let changes = 0
    engine.on('changes:local', () => {
      changes++
    })
    await expect(replaceHabitLogsForDate(db, habit.id, '2026-10-16', 3)).rejects.toThrow(
      'injected failure',
    )
    expect(await db.queryAll('SELECT id, value FROM habit_logs')).toEqual([{ id, value: 2 }])
    expect(changes).toBe(0)
    sqlite.close()
  })
})

function syncServer() {
  const changes: WireChange[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href,
    )
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.pathname === '/v1/clock')
      return json({ version: 1, nowMs: Date.now(), maxFutureMs: 300_000 })
    if (init?.method === 'POST') {
      const change: WireChange = JSON.parse(String(init.body))
      const existing = changes.findIndex((stored) => stored.id === change.id)
      if (existing >= 0)
        return json({ version: 1, outcome: 'duplicate', cursor: String(existing + 1) })
      changes.push(change)
      return json({ version: 1, outcome: 'inserted', cursor: String(changes.length) }, 201)
    }
    const after = Number(url.searchParams.get('cursor') ?? '0')
    return json({
      version: 1,
      changes: changes.slice(after),
      cursor: String(changes.length),
      upperBound: String(changes.length),
      caughtUp: true,
      purges: [],
      events: [],
      control: { mustRefetch: false },
    })
  }
  return { fetch, changes }
}

it('recovers offline writes and replicates category, task, focus, and media deletion flows', async () => {
  const server = syncServer()
  let online = false
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!online) throw new TypeError('offline test device')
    return server.fetch(input, init)
  }
  const a = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), { fetch })
  const b = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), { fetch })
  try {
    const category = (await a.dispatch({
      type: 'CREATE_BORED_CATEGORY',
      payload: {
        name: 'Offline category',
        icon: 'star',
        color: '#fff',
        is_system: false,
        sort_order: 5,
      },
    })) as { id: string }
    const todo = (await a.dispatch({
      type: 'CREATE_TODO',
      payload: {
        title: 'Offline task',
        description: '',
        due_date: null,
        priority: 'medium',
        estimated_minutes: 5,
        tags: ['offline'],
        annotations: {},
        is_recurring: false,
        recurrence_rule: null,
        show_in_bored: true,
        bored_category_id: category.id,
      },
    })) as { id: string }
    await a.dispatch({
      type: 'CREATE_BORED_ACTIVITY',
      payload: {
        title: 'Offline activity',
        description: '',
        category_id: category.id,
        estimated_minutes: 5,
        tags: [],
        annotations: {},
        is_recurring: false,
        recurrence_rule: null,
      },
    })
    await a.dispatch({
      type: 'CREATE_FOCUS_SESSION',
      payload: {
        todo_id: todo.id,
        started_at: '2026-10-17T08:00:00Z',
        completed_at: '2026-10-17T08:05:00Z',
        duration_seconds: 300,
      },
    })
    const voiceId = generateUuidV7()
    const imageId = generateUuidV7()
    await a.dispatch({
      type: 'CREATE_VOICE_NOTE',
      payload: {
        id: voiceId,
        title: 'Offline voice',
        mime_type: 'audio/webm',
        duration: 4,
        created_at: '2026-10-17T08:00:00Z',
      },
    })
    await a.dispatch({
      type: 'CREATE_IMAGE_NOTE',
      payload: {
        id: imageId,
        title: 'Offline photo',
        mime_type: 'image/png',
        filename: 'photo.png',
        created_at: '2026-10-17T08:00:00Z',
      },
    })
    await a.transport.syncOnce()
    expect(a.engine.getSyncStatus()).toBe('offline')
    expect(await a.dispatch({ type: 'GET_TODOS' })).toEqual([
      expect.objectContaining({ id: todo.id }),
    ])
    online = true
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    expect(a.transport.lastError).toBeNull()
    expect(b.transport.lastError).toBeNull()
    expect(await b.dispatch({ type: 'GET_TODOS' })).toEqual([
      expect.objectContaining({ id: todo.id }),
    ])
    expect(await b.dispatch({ type: 'GET_VOICE_NOTES' })).toEqual([
      expect.objectContaining({ id: voiceId }),
    ])
    expect(await b.dispatch({ type: 'GET_IMAGE_NOTES' })).toEqual([
      expect.objectContaining({ id: imageId }),
    ])
    await a.dispatch({ type: 'DELETE_BORED_CATEGORY', payload: { id: category.id } })
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    expect(await b.dispatch({ type: 'GET_TODOS' })).toEqual([
      expect.objectContaining({ id: todo.id, bored_category_id: null, show_in_bored: false }),
    ])
    expect(
      await b.dispatch({
        type: 'GET_BORED_ACTIVITIES_FOR_CATEGORY',
        payload: { category_id: category.id },
      }),
    ).toEqual([])
    await a.dispatch({ type: 'DELETE_TODO', payload: { id: todo.id } })
    await a.dispatch({ type: 'DELETE_ALL_MEDIA_NOTES', payload: null })
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    expect(b.transport.lastError).toBeNull()
    expect(await b.dispatch({ type: 'GET_TODOS' })).toEqual([])
    expect(await b.dispatch({ type: 'GET_FOCUS_SESSION_SUMMARY' })).toEqual({
      session_count: 0,
      total_seconds: 0,
    })
    expect(await b.dispatch({ type: 'GET_VOICE_NOTES' })).toEqual([])
    expect(await b.dispatch({ type: 'GET_IMAGE_NOTES' })).toEqual([])
    expect(await b.dispatch({ type: 'INTEGRITY_CHECK' })).toEqual(['ok'])
  } finally {
    await a.close()
    await b.close()
  }
})

describe('Habitat backend lifecycle', () => {
  it('migrates legacy references and media without deleting child data, and queues existing data once', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(SCHEMA_DDL)
    sqlite.exec(
      "INSERT INTO habits (id, name, created_at) VALUES ('old-habit', 'Preserved', '2026-01-01')",
    )
    sqlite.exec("INSERT INTO habit_schedules (id, habit_id) VALUES ('old-schedule', 'old-habit')")
    sqlite.exec(
      "INSERT INTO completions (id, habit_id, date, completed_at) VALUES ('old-completion', 'old-habit', '2026-10-16', '2026-10-16T00:00:00Z')",
    )
    sqlite.exec(
      "INSERT INTO voice_notes (id, title, mime_type, created_at) VALUES ('old-voice', 'Recording', 'audio/webm', '2026-01-01')",
    )
    const blobs = new MemoryBlobAdapter()
    await blobs.put('old-voice', new Uint8Array([1, 2, 3]))
    const backend = await createHabitatBackend(storageFor(sqlite), { blobs })
    const rows = (await backend.dispatch({ type: 'GET_HABITS' })) as {
      id: string
      schedule: { habit_id: string }
    }[]
    expect(rows).toHaveLength(1)
    expect(isUuidV7(rows[0]!.id)).toBe(true)
    expect(rows[0]!.schedule.habit_id).toBe(rows[0]!.id)
    expect(sqlite.prepare('SELECT habit_id FROM completions').get()).toEqual({
      habit_id: rows[0]!.id,
    })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(await blobs.get(await legacyRowId('voice_notes', 'old-voice'))).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM _sync_outbox').get()?.['count'],
    ).toBeGreaterThan(0)
    expect(backend.getSyncInfo().enabled).toBe(false)
    await backend.close()
  })

  it('syncs through versioned HTTP receipts/pages and propagates reset as deletes', async () => {
    const server = syncServer()
    const a = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
      fetch: server.fetch,
    })
    const b = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
      fetch: server.fetch,
    })
    // Transport networking is explicitly driven here; normal dev startup owns its polling timer.
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    await a.transport.syncOnce()
    expect(a.transport.lastError).toBeNull()
    expect(b.transport.lastError).toBeNull()
    await a.dispatch({ type: 'CREATE_HABIT', payload: habitPayload })
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    expect(await b.dispatch({ type: 'GET_HABITS' })).toEqual(
      await a.dispatch({ type: 'GET_HABITS' }),
    )
    expect(((await b.dispatch({ type: 'GET_HABITS' })) as unknown[]).length).toBe(1)
    await a.dispatch({ type: 'RESET_DATABASE' })
    expect(await a.dispatch({ type: 'GET_CHECKIN_TEMPLATES' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Morning Check-in' })]),
    )
    expect(await a.dispatch({ type: 'GET_BORED_CATEGORIES' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Things to Read', is_system: true })]),
    )
    await a.transport.syncOnce()
    await b.transport.syncOnce()
    expect(await b.dispatch({ type: 'GET_HABITS' })).toEqual([])
    expect(await b.dispatch({ type: 'GET_CHECKIN_TEMPLATES' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Morning Check-in' })]),
    )
    await a.close()
    await b.close()
  })
})

it('converges concurrent daily completions and uses a fresh identity after undo', async () => {
  const server = syncServer()
  const a = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
    fetch: server.fetch,
  })
  const b = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
    fetch: server.fetch,
  })
  const habit = (await a.dispatch({ type: 'CREATE_HABIT', payload: habitPayload })) as {
    id: string
  }
  await a.transport.syncOnce()
  await b.transport.syncOnce()
  await a.transport.syncOnce()
  const request = {
    type: 'TOGGLE_COMPLETION' as const,
    payload: { habit_id: habit.id, date: '2026-10-16' },
  }
  const one = (await a.dispatch(request)) as { id: string }
  const two = (await b.dispatch(request)) as { id: string }
  expect(one.id).toBe(two.id)
  await a.transport.syncOnce()
  await b.transport.syncOnce()
  await a.transport.syncOnce()
  expect(a.transport.lastError).toBeNull()
  expect(b.transport.lastError).toBeNull()
  expect(await a.dispatch({ type: 'GET_ALL_COMPLETIONS' })).toEqual(
    await b.dispatch({ type: 'GET_ALL_COMPLETIONS' }),
  )
  await a.dispatch({ type: 'DELETE_COMPLETION', payload: { id: one.id } })
  await a.transport.syncOnce()
  await b.transport.syncOnce()
  const restored = (await b.dispatch(request)) as { id: string }
  expect(restored.id).not.toBe(one.id)
  await b.transport.syncOnce()
  await a.transport.syncOnce()
  expect(a.transport.lastError).toBeNull()
  expect(b.transport.lastError).toBeNull()
  expect((await a.dispatch({ type: 'GET_ALL_COMPLETIONS' })) as unknown[]).toHaveLength(1)
  await a.close()
  await b.close()
})

it('preserves the device identity and offline outbox without repeating backfill after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'habitat-palladium-'))
  const file = join(directory, 'device.sqlite')
  try {
    const first = await createHabitatBackend(storageFor(new DatabaseSync(file)))
    const habit = (await first.dispatch({ type: 'CREATE_HABIT', payload: habitPayload })) as {
      id: string
    }
    const nodeId = first.engine.nodeId
    const pending = await first.engine.exec<{ total: number }>({
      text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
      params: [],
      tables: [],
    })
    await first.close()
    const second = await createHabitatBackend(storageFor(new DatabaseSync(file)))
    expect(second.engine.nodeId).toBe(nodeId)
    expect(
      await second.engine.exec({
        text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
        params: [],
        tables: [],
      }),
    ).toEqual(pending)
    expect(await second.dispatch({ type: 'GET_HABITS' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: habit.id })]),
    )
    await second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(!process.env['HABITAT_SYNC_TEST_URL'])(
  'round-trips real Habitat operations through the Rust Palladium backend',
  async () => {
    const serverUrl = process.env['HABITAT_SYNC_TEST_URL']!
    const a = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), { serverUrl })
    const b = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), { serverUrl })
    let habitId: string | undefined
    try {
      await a.transport.start()
      await b.transport.start()
      const habit = (await a.dispatch({
        type: 'CREATE_HABIT',
        payload: { ...habitPayload, name: `Rust sync ${generateUuidV7()}` },
      })) as { id: string }
      habitId = habit.id
      await a.transport.syncOnce()
      await b.transport.syncOnce()
      expect(a.transport.lastError).toBeNull()
      expect(b.transport.lastError).toBeNull()
      expect(await b.dispatch({ type: 'GET_HABITS' })).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: habit.id })]),
      )
      await b.dispatch({
        type: 'TOGGLE_COMPLETION',
        payload: { habit_id: habit.id, date: '2026-10-16' },
      })
      await b.transport.syncOnce()
      await a.transport.syncOnce()
      expect(
        await a.dispatch({ type: 'GET_COMPLETIONS_FOR_DATE', payload: { date: '2026-10-16' } }),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ habit_id: habit.id })]))
    } finally {
      if (habitId) {
        await a.dispatch({ type: 'DELETE_HABIT', payload: { id: habitId } })
        await a.transport.syncOnce()
      }
      await a.close()
      await b.close()
    }
  },
  // Two HTTP clients hydrate existing server history before the round trip.
  // Keep this opt-in integration budget separate from the unit-test deadline.
  30_000,
)

it('keeps edited shared defaults when a fresh device joins', async () => {
  const server = syncServer()
  const a = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
    fetch: server.fetch,
  })
  const templates = (await a.dispatch({ type: 'GET_CHECKIN_TEMPLATES' })) as { id: string }[]
  const templateId = templates[0]!.id
  const questions = (await a.dispatch({
    type: 'GET_CHECKIN_QUESTIONS',
    payload: { template_id: templateId },
  })) as { id: string }[]
  const id = questions[0]!.id
  await a.dispatch({
    type: 'UPDATE_CHECKIN_QUESTION',
    payload: { id, prompt: 'My personalized question' },
  })
  await a.transport.syncOnce()
  const b = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')), {
    fetch: server.fetch,
    serverUrl: 'http://localhost',
  })
  try {
    await b.transport.start()
    await b.transport.syncOnce()
    expect(
      await b.dispatch({ type: 'GET_CHECKIN_QUESTIONS', payload: { template_id: templateId } }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, prompt: 'My personalized question' })]),
    )
  } finally {
    await a.close()
    await b.close()
  }
})

function legacyExport(): HabitatExport {
  return {
    version: 1,
    exported_at: '2026-10-16T00:00:00Z',
    habits: [
      { ...habitPayload, id: 'legacy-import-habit', created_at: '2026-01-01', archived_at: null },
    ],
    completions: [
      {
        id: 'legacy-import-completion',
        habit_id: 'legacy-import-habit',
        date: '2026-10-16',
        completed_at: '2026-10-16T00:00:00Z',
        notes: '',
        tags: [],
        annotations: {},
      },
    ],
    habit_logs: [],
    habit_schedules: [],
    reminders: [],
    checkin_templates: [],
    checkin_questions: [],
    checkin_responses: [],
    checkin_reminders: [],
    scribbles: [],
    checkin_entries: [],
    bored_categories: [],
    bored_activities: [],
    todos: [],
  }
}

it('imports old backups idempotently and respects replicated erasure when merging them again', async () => {
  const backend = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    await backend.dispatch({ type: 'IMPORT_JSON', payload: legacyExport() })
    const habits = (await backend.dispatch({ type: 'GET_HABITS' })) as { id: string }[]
    const id = habits[0]!.id
    expect(isUuidV7(id)).toBe(true)
    const pending = await backend.engine.exec({
      text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
      params: [],
      tables: [],
    })
    await backend.dispatch({ type: 'IMPORT_JSON', payload: legacyExport() })
    expect(
      await backend.engine.exec({
        text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
        params: [],
        tables: [],
      }),
    ).toEqual(pending)
    await backend.dispatch({ type: 'DELETE_HABIT', payload: { id } })
    await backend.dispatch({ type: 'IMPORT_JSON', payload: legacyExport() })
    expect(await backend.dispatch({ type: 'GET_HABITS' })).toEqual([])
    expect(await backend.dispatch({ type: 'GET_ALL_COMPLETIONS' })).toEqual([])
  } finally {
    await backend.close()
  }
})

it('imports a legacy natural-key row under a successor ID after its prior ID was deleted', async () => {
  const backend = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    const habit = (await backend.dispatch({
      type: 'CREATE_HABIT',
      payload: habitPayload,
    })) as { id: string }
    const completion = (await backend.dispatch({
      type: 'TOGGLE_COMPLETION',
      payload: { habit_id: habit.id, date: '2026-10-16' },
    })) as { id: string }
    const backup = (await backend.dispatch({
      type: 'EXPORT_JSON_DATA',
      payload: allExportTables,
    })) as HabitatExport
    const importedCompletion = backup.completions.find((row) => row.id === completion.id)
    if (!importedCompletion) throw new Error('Expected exported completion')
    importedCompletion.id = 'legacy-completion'

    await backend.dispatch({ type: 'DELETE_COMPLETION', payload: { id: completion.id } })
    await backend.dispatch({ type: 'IMPORT_JSON', payload: backup })

    const rows = await backend.engine.exec<{ id: string; habit_id: string }>(
      { text: 'SELECT id, habit_id FROM completions', params: [], tables: [] },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).not.toBe(completion.id)
    expect(rows[0]?.habit_id).toBe(habit.id)
  } finally {
    await backend.close()
  }
})

it('rolls back an entire import, including its outbox, if any imported reference is invalid', async () => {
  const backend = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    const data = legacyExport()
    data.completions[0]!.habit_id = 'missing-parent'
    const pending = await backend.engine.exec({
      text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
      params: [],
      tables: [],
    })
    await expect(backend.dispatch({ type: 'IMPORT_JSON', payload: data })).rejects.toThrow()
    expect(await backend.dispatch({ type: 'GET_HABITS' })).toEqual([])
    expect(
      await backend.engine.exec({
        text: 'SELECT COUNT(*) AS total FROM _sync_outbox',
        params: [],
        tables: [],
      }),
    ).toEqual(pending)
  } finally {
    await backend.close()
  }
})

it('recovers Boolean history from backups that predate the habit type field', async () => {
  const backend = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    const data = legacyExport()
    Reflect.deleteProperty(data.habits[0]!, 'type')
    data.completions = []
    data.habit_logs = [
      {
        id: 'old-boolean-log',
        habit_id: data.habits[0]!.id,
        date: '2026-10-16',
        logged_at: '2026-10-16T08:00:00Z',
        value: 1,
        notes: '',
      },
    ]
    await backend.dispatch({ type: 'IMPORT_JSON', payload: data })
    expect(await backend.dispatch({ type: 'GET_ALL_COMPLETIONS' })).toEqual([
      expect.objectContaining({ date: '2026-10-16' }),
    ])
  } finally {
    await backend.close()
  }
})
it('recovers boolean history when a partial backup omits habits and completions', async () => {
  const backend = await createHabitatBackend(storageFor(new DatabaseSync(':memory:')))
  try {
    const habit = (await backend.dispatch({
      type: 'CREATE_HABIT',
      payload: habitPayload,
    })) as { id: string }
    const data = legacyExport()
    Reflect.deleteProperty(data, 'habits')
    Reflect.deleteProperty(data, 'completions')
    data.habit_logs = [
      {
        id: 'old-boolean-log',
        habit_id: habit.id,
        date: '2026-10-16',
        logged_at: '2026-10-16T08:00:00Z',
        value: 1,
        notes: '',
      },
    ]

    await backend.dispatch({ type: 'IMPORT_JSON', payload: data })

    expect(await backend.dispatch({ type: 'GET_ALL_COMPLETIONS' })).toEqual([
      expect.objectContaining({ habit_id: habit.id, date: '2026-10-16' }),
    ])
  } finally {
    await backend.close()
  }
})


it('keeps write capture registered until an in-flight mutation has committed during shutdown', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const storage = storageFor(sqlite)
  let release!: () => void
  let reached!: () => void
  const reachedQuery = new Promise<void>((resolve) => {
    reached = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let blocking = false
  let pending: string[] = []
  const backend = await createHabitatBackend({
    ...storage,
    async exec<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      if (blocking && sql.includes('FROM habits WHERE name_key')) {
        blocking = false
        reached()
        await gate
      }
      return storage.exec<T>(sql, params)
    },
    async close() {
      pending = sqlite
        .prepare('SELECT ops FROM _sync_outbox')
        .all()
        .map((row) => String(row['ops']))
      await storage.close()
    },
  })
  blocking = true
  const writing = backend.dispatch({ type: 'CREATE_HABIT', payload: habitPayload })
  await reachedQuery
  const closing = backend.close()
  await new Promise<void>((resolve) => setImmediate(resolve))
  release()
  await writing
  await closing
  expect(pending.some((ops) => ops.includes('Walk'))).toBe(true)
})

it('preserves duplicate legacy question prompts and activity titles during startup migration', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(SCHEMA_DDL)
  sqlite.exec(`
    INSERT INTO checkin_templates (id, title) VALUES ('legacy-template', 'Morning Check-in');
    INSERT INTO checkin_questions (id, template_id, prompt) VALUES
      ('legacy-question-one', 'legacy-template', 'Same prompt'),
      ('legacy-question-two', 'legacy-template', 'Same prompt');
    INSERT INTO bored_categories (id, name, icon, color, is_system, sort_order, created_at)
      VALUES ('legacy-category', 'System category', 'star', '#fff', 1, 0, '2026-01-01');
    INSERT INTO bored_activities (id, title, category_id, created_at) VALUES
      ('legacy-activity-one', 'Same title', 'legacy-category', '2026-01-01'),
      ('legacy-activity-two', 'Same title', 'legacy-category', '2026-01-01');
  `)
  const backend = await createHabitatBackend(storageFor(sqlite))
  try {
    const questions = sqlite
      .prepare("SELECT id FROM checkin_questions WHERE prompt = 'Same prompt'")
      .all()
    const activities = sqlite
      .prepare("SELECT id FROM bored_activities WHERE title = 'Same title'")
      .all()
    expect(questions).toHaveLength(2)
    expect(activities).toHaveLength(2)
    for (const row of [...questions, ...activities]) expect(isUuidV7(row['id'])).toBe(true)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    await backend.close()
  }
})
