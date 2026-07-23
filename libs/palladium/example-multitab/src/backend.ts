/**
 * The OPFS-backed notes service the leader opens, wrapping
 * `@palladium/sqlite-browser`'s SAHPool adapter to satisfy the query/mutate
 * {@link DbApi} shape the bus forwards.
 *
 * Only the leader tab ever instantiates/opens this — the Web Lock guarantees a
 * single open connection, which is exactly what OPFS SAHPool requires.
 */

import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";
import type { DbApi, OwnerContext } from "@palladium/worker";

export const DB_NAME = "multitab-notes";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

/** Extract the tables a write statement touches, to scope invalidations. Naive. */
function tablesFromSql(sql: string): string[] {
  const found = new Set<string>();
  const re =
    /(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
  for (const m of sql.matchAll(re)) if (m[1]) found.add(m[1]);
  return [...found];
}

export function createNotesService(ctx: OwnerContext): DbApi & { open(): Promise<void> } {
  const adapter = new BrowserSqliteAdapter({
    vfs: { type: "opfs-sah-pool", directory: `/${DB_NAME}`, filename: `/${DB_NAME}.db` },
  });

  return {
    async open(): Promise<void> {
      await adapter.open();
      await adapter.runMigrations([SCHEMA]);
    },
    query: (sql, params) => adapter.exec(sql, params),
    async mutate(sql, params): Promise<number> {
      await adapter.exec(sql, params);
      const [row] = await adapter.exec<{ n: number }>("SELECT changes() AS n");
      ctx.invalidate(tablesFromSql(sql));
      return row?.n ?? 0;
    },
  };
}
