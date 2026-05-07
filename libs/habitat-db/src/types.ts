/**
 * Shared `DbAdapter` interface implemented by both web (palladium SAH-pool)
 * and native (Capacitor SQLite) paths. Per-app `db-shared.ts` files speak
 * only this interface so domain SQL works everywhere.
 */
export interface DbAdapter {
  queryAll<T>(sql: string, bind?: unknown[]): Promise<T[]>
  queryOne<T>(sql: string, bind?: unknown[]): Promise<T | null>
  exec(sql: string, bind?: unknown[]): Promise<void>
}
