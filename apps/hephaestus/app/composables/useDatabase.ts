import { sendToWorker } from '~/plugins/database.client'
import type { DbStatement } from '~/types/database'

type DbStatus = 'initializing' | 'ready' | 'lock_unavailable' | 'error'

export function useDatabase() {
  const status = useState<DbStatus>('db-status', () => 'initializing')

  function query<T = Record<string, unknown>>(sql: string, bind?: unknown[]): Promise<T[]> {
    return sendToWorker<T[]>({ type: 'QUERY', payload: { sql, bind } })
  }

  function exec(sql: string, bind?: unknown[]): Promise<void> {
    return sendToWorker<void>({ type: 'EXEC', payload: { sql, bind } })
  }

  function batch(statements: DbStatement[]): Promise<void> {
    return sendToWorker<void>({ type: 'BATCH', payload: { statements } })
  }

  function workout<T>(type: `WORKOUT_${string}`, payload?: unknown): Promise<T> {
    return sendToWorker<T>({ type, payload })
  }

  function transfer<T>(type: `TRANSFER_${string}`, payload?: unknown): Promise<T> {
    return sendToWorker<T>({ type, payload })
  }

  function isDefaultApplied(key: string): Promise<boolean> {
    return sendToWorker<boolean>({ type: 'IS_DEFAULT_APPLIED', payload: { key } })
  }

  function markDefaultApplied(key: string): Promise<void> {
    return sendToWorker<void>({ type: 'MARK_DEFAULT_APPLIED', payload: { key } })
  }

  function clearLocalData(): Promise<void> {
    return sendToWorker<void>({ type: 'RESET_LOCAL_DATA' })
  }

  return {
    status: readonly(status),
    query,
    exec,
    batch,
    workout,
    transfer,
    isDefaultApplied,
    markDefaultApplied,
    clearLocalData,
  }
}
