/**
 * The OPFS-backed store the leader opens. Wraps `@palladium/sqlite-browser`'s
 * SAHPool adapter to satisfy `@palladium/worker`'s `OpfsBackend` contract.
 *
 * Only the leader tab ever instantiates/opens this — the Web Lock guarantees a
 * single open connection, which is exactly what OPFS SAHPool requires.
 */

import { BrowserSqliteAdapter } from "@palladium/sqlite-browser";
import type { OpfsBackend } from "@palladium/worker/owner";

export const DB_NAME = "multitab-notes";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export function createBackend(): OpfsBackend {
  const adapter = new BrowserSqliteAdapter({
    vfs: { type: "opfs-sah-pool", directory: `/${DB_NAME}`, filename: `/${DB_NAME}.db` },
  });

  return {
    async open(): Promise<void> {
      await adapter.open();
      await adapter.runMigrations([SCHEMA]);
    },
    query: (sql, params) => adapter.exec(sql, params),
    async run(sql, params): Promise<number> {
      await adapter.exec(sql, params);
      const [row] = await adapter.exec<{ n: number }>("SELECT changes() AS n");
      return row?.n ?? 0;
    },
  };
}
