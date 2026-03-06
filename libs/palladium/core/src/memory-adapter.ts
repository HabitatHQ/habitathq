/**
 * In-memory StorageAdapter for testing and local-only mode.
 *
 * Uses a Map<table, Map<id, row>> store. Executes extremely simple
 * SQL-like queries by matching the pattern:
 *   SELECT * FROM <table>
 *   SELECT * FROM <table> WHERE id = ?
 *
 * This is intentionally minimal — just enough for unit tests and demos.
 * Production use should plug in the SQLite WASM adapter.
 */

import type { StorageAdapter } from "./storage.js";

type Row = Record<string, unknown>;

export class MemoryAdapter implements StorageAdapter {
  readonly #store = new Map<string, Map<string, Row>>();

  /** Low-level: insert or replace a row in a table. */
  _put(table: string, id: string, row: Row): void {
    if (!this.#store.has(table)) this.#store.set(table, new Map());
    const tbl = this.#store.get(table);
    if (tbl !== undefined) tbl.set(id, { ...row });
  }

  /** Low-level: patch an existing row. */
  _patch(table: string, id: string, patch: Partial<Row>): void {
    const existing = this.#store.get(table)?.get(id);
    if (existing !== undefined) {
      const tbl = this.#store.get(table);
      if (tbl !== undefined) tbl.set(id, { ...existing, ...patch });
    }
  }

  /** Low-level: remove a row by id. */
  _remove(table: string, id: string): void {
    this.#store.get(table)?.delete(id);
  }

  async exec<T = Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    // Expand ? placeholders with params for matching.
    const paramsCopy = [...params];
    const expanded = sql.replace(/\?/g, () => {
      const v = paramsCopy.shift();
      return JSON.stringify(v);
    });

    const table = extractTable(expanded);
    if (table === null) return [];

    const allRows = [...(this.#store.get(table)?.values() ?? [])];

    // WHERE id = <value>
    const idMatch = /WHERE\s+id\s*=\s*(.+)/i.exec(expanded);
    if (idMatch !== null) {
      const rawVal = idMatch[1]?.trim();
      const id = parseJsonValue(rawVal);
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature TS flag requires bracket access
      return allRows.filter((r) => r["id"] === id) as T[];
    }

    return allRows as T[];
  }

  async runMigrations(_migrations: readonly string[]): Promise<void> {
    // No-op for in-memory adapter — schema is inferred from writes.
  }

  async close(): Promise<void> {
    this.#store.clear();
  }
}

function extractTable(sql: string): string | null {
  const m = /FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(sql);
  return m?.[1]?.toLowerCase() ?? null;
}

function parseJsonValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
