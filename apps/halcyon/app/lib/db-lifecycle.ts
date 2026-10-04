import * as schema from '~/lib/db-schema'
import type { DbAdapter } from '~/types/database'

export interface ResettableDatabaseStorage {
  resetStorage(): Promise<void>
}

export async function initializeDatabase(db: DbAdapter): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON')
  await db.exec(schema.SCHEMA_DDL)
  await schema.runMigrations(db)
  await schema.seedDefaults(db)
}

export async function resetDatabaseStorage(
  storage: ResettableDatabaseStorage,
  db: DbAdapter,
): Promise<void> {
  await storage.resetStorage()
  await initializeDatabase(db)
}
