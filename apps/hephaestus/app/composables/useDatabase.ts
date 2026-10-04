import type { WorkoutOperation, WorkoutOperationMap } from '~/lib/workout-storage'
import { sendToWorker } from '~/plugins/database.client'
import type { DbStatement } from '~/types/database'
import type { HistoryOperation, HistoryOperationMap } from '~/types/history-correction'
import type { OrganizationOperation, OrganizationOperationMap } from '~/types/organization'
import type { DomainOperation, DomainOperationMap } from '~/types/prescription'

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

  function domain<K extends DomainOperation>(
    type: K,
    payload: DomainOperationMap[K]['payload'],
  ): Promise<DomainOperationMap[K]['result']> {
    return sendToWorker<DomainOperationMap[K]['result']>({ type, payload })
  }

  function organization<K extends OrganizationOperation>(
    type: K,
    payload: OrganizationOperationMap[K]['payload'],
  ): Promise<OrganizationOperationMap[K]['result']> {
    return sendToWorker<OrganizationOperationMap[K]['result']>({ type, payload })
  }

  function history<K extends HistoryOperation>(
    type: K,
    payload: HistoryOperationMap[K]['payload'],
  ): Promise<HistoryOperationMap[K]['result']> {
    return sendToWorker<HistoryOperationMap[K]['result']>({ type, payload })
  }

  function workout<K extends WorkoutOperation>(
    type: K,
    payload: WorkoutOperationMap[K]['payload'],
  ): Promise<WorkoutOperationMap[K]['result']> {
    return sendToWorker<WorkoutOperationMap[K]['result']>({ type, payload })
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

  function resetDatabase(): Promise<void> {
    return sendToWorker<void>({ type: 'RESET_DATABASE' })
  }

  return {
    status: readonly(status),
    query,
    exec,
    batch,
    domain,
    organization,
    history,
    workout,
    transfer,
    isDefaultApplied,
    markDefaultApplied,
    resetDatabase,
  }
}
