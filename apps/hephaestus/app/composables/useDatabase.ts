import { sendToWorker } from '~/plugins/database.client'

type DbStatus = 'initializing' | 'ready' | 'lock_unavailable' | 'error'

// The plugin blocks app startup until the DB is ready, so status is
// always 'ready' by the time any page or composable calls useDatabase().
const status = ref<DbStatus>('ready')

export function useDatabase() {
  function query<T = Record<string, unknown>>(sql: string, bind?: unknown[]): Promise<T[]> {
    return sendToWorker<T[]>({ type: 'QUERY', payload: { sql, bind } })
  }

  function exec(sql: string, bind?: unknown[]): Promise<void> {
    return sendToWorker<void>({ type: 'EXEC', payload: { sql, bind } })
  }

  function isDefaultApplied(key: string): Promise<boolean> {
    return sendToWorker<boolean>({ type: 'IS_DEFAULT_APPLIED', payload: { key } })
  }

  function markDefaultApplied(key: string): Promise<void> {
    return sendToWorker<void>({ type: 'MARK_DEFAULT_APPLIED', payload: { key } })
  }

  return {
    status: readonly(status),
    query,
    exec,
    isDefaultApplied,
    markDefaultApplied,
  }
}
