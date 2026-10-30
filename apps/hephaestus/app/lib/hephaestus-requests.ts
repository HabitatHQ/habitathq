import type { PalladiumEngine, SchemaMap, TransactableStorageAdapter } from '@palladium/core'
import { dispatchTransfer } from '~/lib/data-transfer'
import { executeBatch } from '~/lib/database-operations'
import { dispatchHistory } from '~/lib/history-correction'
import { dispatchOrganization, isOrganizationOperation } from '~/lib/organization-storage'
import type { PalladiumDatabase } from '~/lib/palladium-database'
import { dispatchPrescriptionOperation, isDomainOperation } from '~/lib/prescription-storage'
import { dispatchWorkout } from '~/lib/workout-storage'
import type { DbAdapter, DbStatement } from '~/types/database'

export interface HephaestusRequest {
  type: string
  payload?: unknown
}

interface RequestDependencies {
  readonly database: PalladiumDatabase
  readonly engine: PalladiumEngine<SchemaMap>
  readonly storage: TransactableStorageAdapter
  readonly resetLocalDatabase: () => Promise<void>
}

type RequestHandler = (payload: unknown) => Promise<unknown>

function sqlRequest(payload: unknown): { sql: string; bind: unknown[] } {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('sql' in payload) ||
    typeof payload.sql !== 'string'
  ) {
    throw new Error('A SQL statement is required')
  }
  const bind = 'bind' in payload && Array.isArray(payload.bind) ? payload.bind : []
  return { sql: payload.sql, bind }
}

function statements(payload: unknown): DbStatement[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('statements' in payload) ||
    !Array.isArray(payload.statements)
  ) {
    throw new Error('Database batch statements are required')
  }
  return payload.statements.map(sqlRequest)
}

function defaultKey(payload: unknown): string {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('key' in payload) ||
    typeof payload.key !== 'string'
  ) {
    throw new Error('A default key is required')
  }
  return payload.key
}

async function exportDatabase(
  engine: PalladiumEngine<SchemaMap>,
  storage: TransactableStorageAdapter,
): Promise<unknown> {
  if (!('serialize' in storage) || typeof storage.serialize !== 'function') {
    throw new Error('Database serialization is unavailable')
  }
  const serialize = storage.serialize.bind(storage)
  return engine.withStorage(async () => serialize())
}

function exactHandlers(dependencies: RequestDependencies): Map<string, RequestHandler> {
  const { database, engine, storage, resetLocalDatabase } = dependencies
  return new Map<string, RequestHandler>([
    [
      'RESET_DATABASE',
      async () => {
        await resetLocalDatabase()
        return null
      },
    ],
    ['EXPORT_DB', () => exportDatabase(engine, storage)],
    [
      'QUERY',
      async (payload) => {
        const { sql, bind } = sqlRequest(payload)
        return database.queryAll(sql, bind)
      },
    ],
    [
      'EXEC',
      async (payload) => {
        const { sql, bind } = sqlRequest(payload)
        await database.exec(sql, bind)
        return null
      },
    ],
    [
      'BATCH',
      async (payload) => {
        await executeBatch(database, statements(payload))
        return null
      },
    ],
    [
      'IS_DEFAULT_APPLIED',
      async (payload) =>
        (await database.queryOne('SELECT key FROM applied_defaults WHERE key=?', [
          defaultKey(payload),
        ])) !== null,
    ],
    [
      'MARK_DEFAULT_APPLIED',
      async (payload) => {
        await database.exec('INSERT OR IGNORE INTO applied_defaults(key) VALUES(?)', [
          defaultKey(payload),
        ])
        return null
      },
    ],
  ])
}

/** Restore replaces every row, so it needs the replacing transaction rather than the scoped one. */
function transferAdapter(dependencies: RequestDependencies, type: string): DbAdapter {
  const { database } = dependencies
  if (type === 'TRANSFER_RESTORE_BACKUP') {
    return { ...database, transaction: database.replaceTransaction }
  }
  return database
}

function prefixedHandler(dependencies: RequestDependencies, request: HephaestusRequest) {
  const { database } = dependencies
  const { type, payload } = request
  if (isDomainOperation(type))
    return database.transaction((tx) => dispatchPrescriptionOperation(tx, type, payload))
  if (isOrganizationOperation(type))
    return database.transaction((tx) => dispatchOrganization(tx, type, payload))
  if (type.startsWith('HISTORY_'))
    return database.transaction((tx) => dispatchHistory(tx, type, payload))
  if (type.startsWith('WORKOUT_'))
    return database.transaction((tx) => dispatchWorkout(tx, type, payload))
  if (type.startsWith('TRANSFER_'))
    return dispatchTransfer(transferAdapter(dependencies, type), type, payload)
  throw new Error(`Unknown database operation: ${type}`)
}

/** Route one serialized request to the owning engine; unknown types fail closed. */
export function createRequestRouter(
  dependencies: RequestDependencies,
): (request: HephaestusRequest) => Promise<unknown> {
  const handlers = exactHandlers(dependencies)
  return async (request: HephaestusRequest) => {
    const handler = handlers.get(request.type)
    if (handler) return handler(request.payload)
    return prefixedHandler(dependencies, request)
  }
}
