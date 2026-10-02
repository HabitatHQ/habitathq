import type { DbAdapter, DbStatement } from '~/types/database'

export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export async function executeBatch(
  db: DbAdapter,
  statements: readonly DbStatement[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.exec(statement.sql, statement.bind)
  })
}
